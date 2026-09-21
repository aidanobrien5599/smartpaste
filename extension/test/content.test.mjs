// Content-script tests: real headless Chrome against fixture pages shaped
// like each ATS. Run: node --test extension/test/
// Skipped when no Chrome is installed; set CHROME=/path/to/chrome to point
// at one. Jev is not called: fixtures/stub.js answers by label and plays
// Jev's part in choose-option, so these pin the page-driving code only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, chromePath } from "./browser.mjs";

const skip = chromePath ? false : "no Chrome found (set CHROME)";
let browser;
before(async () => { if (!skip) browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function withPage(fixture, fn) {
  const page = await browser.open(fixture);
  try { return await fn(page); } finally { await page.close(); }
}

const BUTTON = "document.querySelector('.smartpaste-button')?.textContent";
const asked = `(window.__messages.find(m => m.type === 'answer-fields')?.fields || []).map(f => f.label)`;

/** Click Autofill and wait for its summary note. */
async function autofill(page, timeout = 30000) {
  await page.waitFor(BUTTON);
  await page.eval("document.querySelector('.smartpaste-button').click()");
  return page.waitFor(
    "(document.querySelector('.smartpaste-note')?.textContent || '').startsWith('filled') && " +
      "document.querySelector('.smartpaste-note').textContent", timeout);
}

const value = (selector) => `document.querySelector(${JSON.stringify(selector)}).value`;
const text = (selector) => `document.querySelector(${JSON.stringify(selector)}).textContent.trim()`;

/* --------------------------------------------------------- pure helpers */

test("dateParts reads the date shapes a profile holds", { skip }, () =>
  withPage("contact.html", async (page) => {
    const parts = await page.eval(() => {
      const { dateParts } = window.__smartpasteTest;
      return ["May 2026", "September 2023", "Sept. 2023", "05/2027", "2027-05", "2027", "Present", "Spring 2027", ""]
        .map((v) => dateParts(v));
    });
    assert.deepEqual(parts, [
      { year: "2026", month: 5 },
      { year: "2023", month: 9 },
      { year: "2023", month: 9 },
      { year: "2027", month: 5 },
      { year: "2027", month: 5 },
      { year: "2027", month: null },
      null,
      { year: "2027", month: null }, // a season is not a month; left for the user
      null,
    ]);
  }));

test("localMatch: exact, or the one option that starts with the answer", { skip }, () =>
  withPage("contact.html", async (page) => {
    const picks = await page.eval(() => {
      const { localMatch } = window.__smartpasteTest;
      const source = ["Other Source", "Job Board Other", "Organizational Affiliation Other"];
      return [
        localMatch(source, "Other"),                                   // the screenshot case
        localMatch(["Yes, I am authorized", "No"], "Yes"),
        localMatch(["No", "No, not now", "Yes"], "No"),                // exact beats prefix
        localMatch(["Yes, now", "Yes, later", "No"], "Yes"),           // two prefixes: ask Jev
        localMatch(["Nothing", "Yes"], "No"),                          // "No" is not a word of "Nothing"
        localMatch(["Bachelor of Science", "Master of Science"], "B.S."),
      ];
    });
    assert.deepEqual(picks, [0, 0, 0, -1, -1, -1]);
  }));

/* ------------------------------------------------------ application gate */

for (const fixture of ["form.html", "application-no-upload.html", "workday.html", "ashby.html", "lever.html"]) {
  test(`gate: ${fixture} is an application, so the button appears`, { skip }, () =>
    withPage(fixture, async (page) => {
      assert.match(await page.waitFor(BUTTON), /^Autofill \d+ field/);
    }));
}

for (const fixture of ["contact.html", "login.html", "checkout.html", "newsletter.html"]) {
  test(`gate: ${fixture} is not, and its labels never leave the page`, { skip }, () =>
    withPage(fixture, async (page) => {
      await new Promise((r) => setTimeout(r, 1500)); // well past the first scan
      assert.equal(await page.eval(BUTTON), undefined);
      assert.deepEqual(await page.eval("window.__messages.map(m => m.type)"), []);
    }));
}

/* ---------------------------------------------------------------- labels */

test("labels: Greenhouse shapes (for, aria, placeholder, wrapping, sibling)", { skip }, () =>
  withPage("form.html", async (page) => {
    const labels = await page.waitFor(asked);
    for (const label of ["First Name", "Last Name", "Email", "Phone", "LinkedIn Profile",
      "Personal website", "Expected graduation date", "Current GPA", "Why do you want to work here?",
      "Are you legally authorized to work in the United States?"]) {
      assert.ok(labels.includes(label), `missing ${label}: ${labels}`);
    }
    assert.ok(!labels.some((l) => /password/i.test(l)), "a password field was sent");
    const auth = await page.eval(
      "window.__messages[0].fields.find(f => /authorized/.test(f.label)).options");
    assert.deepEqual(auth, ["Yes", "No"], "a select carries its own options, minus the placeholder");
  }));

test("labels: Workday widgets, with repeat-panel prefixes", { skip }, () =>
  withPage("workday.html", async (page) => {
    const labels = await page.waitFor(asked);
    for (const label of [
      "How Did You Hear About Us?", "Country", "Phone Device Type", "First Name",
      "Work Experience 1: Job Title", "Work Experience 2: Job Title", "Work Experience 2: Company",
      "Work Experience 1: From", "Education 1: School or University", "Education 1: Degree",
      "Education 1: To (Actual or Expected)", "Have you previously worked for Wells Fargo?",
      "Are you legally authorized to work in the United States?", "Gender",
    ]) assert.ok(labels.includes(label), `missing ${label}: ${labels}`);
    // A split date is one question, not a "Month" and a "Year".
    assert.ok(!labels.some((l) => /^(?:month|year)$/i.test(l)), labels.join(" | "));
    assert.equal(new Set(labels).size, labels.length, "two fields share a label");
    // "Have you worked for us before?" needs to know who "us" is.
    const sent = await page.eval("window.__messages.find(m => m.type === 'answer-fields').page");
    assert.match(sent.url, /workday\.html$/);
    assert.equal(sent.title, "Apply - Workday");
  }));

test("labels: Lever question text, heavy asterisk stripped, radios grouped", { skip }, () =>
  withPage("lever.html", async (page) => {
    const labels = await page.waitFor(asked);
    assert.ok(labels.includes("Full name"), labels);
    assert.ok(labels.includes("LinkedIn URL"), labels);
    const radio = await page.eval(
      "window.__messages[0].fields.find(f => /authorized/.test(f.label))");
    assert.deepEqual(radio, { label: "Are you authorized to work in the US?", options: ["Yes", "No"] });
  }));

/* --------------------------------------------------------------- filling */

test("fill: Greenhouse text, selects, React revert, and documents", { skip }, () =>
  withPage("form.html", async (page) => {
    await autofill(page);
    assert.equal(await page.eval(value("#first_name")), "Aidan");
    assert.equal(await page.eval(value("#email")), "aidanobrien5599@gmail.com");
    assert.equal(await page.eval(value("#grad")), "May 2027");
    assert.equal(await page.eval(value("#gpa")), "3.9");
    assert.equal(await page.eval(value("#auth")), "Yes");
    assert.equal(await page.eval(value("#spon")), "No");
    // The fixture reverts a naive el.value on blur; the native setter survives it.
    await page.eval("document.getElementById('first_name').focus(); document.getElementById('first_name').blur()");
    assert.equal(await page.eval(value("#first_name")), "Aidan");
    // Never overwrite what is already there, never touch what has no answer.
    assert.equal(await page.eval(value("#prefill")), "Already typed");
    assert.equal(await page.eval(value("#why")), "");
    const files = await page.eval(() =>
      Object.fromEntries(["resume", "transcript", "headshot"].map((id) =>
        [id, document.getElementById(id).files[0]?.name || null])));
    assert.deepEqual(files, { resume: "resume.pdf", transcript: "transcript.pdf", headshot: null });
  }));

test("fill: Greenhouse comboboxes pick by meaning, scoped to their own menu", { skip }, () =>
  withPage("combobox.html", async (page) => {
    await autofill(page);
    // "May 2027" is not an option; Jev maps it to "Spring 2027" among the
    // four grad options, not the 200-option decoy that is also open.
    assert.equal(await page.eval(text("#grad-value")), "Spring 2027");
    const choice = await page.eval("window.__messages.find(m => m.type === 'choose-option' && m.want === 'May 2027')");
    assert.equal(choice.options.length, 4);
    // "Start typing..." has no options until typed into.
    assert.equal(await page.eval(text("#loc-value")), "Madison, Wisconsin, United States");
    // Each is a quick open-read-click with no fixed sleeps. The location box
    // shows no menu until its 400ms search returns; waiting 1.5s for one to
    // open by itself first was most of Figma's 2.0s.
    const times = Object.fromEntries((await page.eval("window.__smartpasteTest.timeline")).map((t) => [t.field, t.ms]));
    assert.ok(times["When do you expect to graduate?"] < 250, JSON.stringify(times));
    assert.ok(times["Location (City)"] < 900, JSON.stringify(times));
    assert.equal(await page.eval(text("#loc-value")), "Madison, Wisconsin, United States");
  }));

test("fill: attaching a resume does not hold up the fill", { skip }, () =>
  withPage("form.html", async (page) => {
    // This page does not re-render on upload; waiting 2.5s "in case" it did
    // was most of a 3s Ashby fill.
    const summary = await autofill(page);
    const seconds = Number(summary.match(/in ([0-9.]+)s/)[1]);
    assert.match(summary, /attached 2 files/);
    assert.ok(seconds < 1, summary);
  }));

test("fill: a site that rebuilds the form after reading the resume is refilled", { skip }, () =>
  withPage("lever-reparse.html", async (page) => {
    await autofill(page);
    await page.waitFor("window.__rebuilt === 1");
    await page.waitFor("document.querySelector('input[name=email]').value", 5000);
    assert.equal(await page.eval(value("input[name=email]")), "aidanobrien5599@gmail.com");
    assert.equal(await page.eval(value("input[name=name]")), "Aidan O'Brien");
    assert.equal(await page.eval(value("input[name^=urls]")), "https://www.linkedin.com/in/aidanobrien5599");
  }));

test("fill: a menu that re-renders while Jev decides still gets its click", { skip }, () =>
  withPage("combobox.html", async (page) => {
    // Figma, live: Location (City) failed after ~780ms. Its results render
    // twice; the node read before Jev's ~350ms answer was gone by the click.
    await page.waitFor(BUTTON);
    await page.eval("window.__jevDelay = 500");
    await autofill(page);
    assert.equal(await page.eval(text("#loc-value")), "Madison, Wisconsin, United States");
  }));

test("fill: a form rebuilt after smartpaste scanned it is filled, not timed out on", { skip }, () =>
  withPage("combobox.html#rehydrate", async (page) => {
    // Figma, live: React threw the form away after the scan (hydration
    // error #418) and the fill spent ~6s per dropdown on detached elements.
    await page.waitFor(BUTTON);
    await page.waitFor("window.__rebuilt === true", 5000);
    const summary = await autofill(page);
    assert.equal(await page.eval(value("#first_name")), "Aidan");
    assert.equal(await page.eval(text("#grad-value")), "Spring 2027");
    assert.equal(await page.eval(text("#loc-value")), "Madison, Wisconsin, United States");
    assert.ok(Number(summary.match(/in ([0-9.]+)s/)[1]) < 2, summary);
  }));

test("fill: Ashby toggle buttons", { skip }, () =>
  withPage("ashby.html", async (page) => {
    await autofill(page);
    const pressed = await page.eval(() =>
      ["sponsor", "relocate"].map((id) =>
        document.querySelector(`#${id} button[aria-pressed="true"]`)?.textContent));
    assert.deepEqual(pressed, ["No", "Yes, I am"]);
    assert.equal(await page.eval(value("#_systemfield_name")), "Aidan O'Brien");
  }));

test("fill: Lever radios", { skip }, () =>
  withPage("lever.html", async (page) => {
    await autofill(page);
    assert.equal(await page.eval("document.querySelector('#auth input:checked')?.value"), "Yes");
    assert.equal(await page.eval(value("input[name=email]")), "aidanobrien5599@gmail.com");
  }));

test("fill: a whole Workday page", { skip }, () =>
  withPage("workday.html", async (page) => {
    const summary = await autofill(page, 60000);
    const model = await page.eval("window.__model");
    const dates = await page.eval(
      "[...document.querySelectorAll('[data-automation-id^=dateSection]')].map(e => e.value)");
    const radio = await page.eval("document.querySelector('input[name=previousWorker]:checked')?.id");
    assert.deepEqual(
      { ...model, dates, radio },
      {
        // listbox buttons, including a virtualized 237-country list
        country: "United States of America", phoneType: "Mobile", degree: "Bachelor of Science",
        authorized: "Yes", gender: "I do not wish to answer",
        // search prompts: one found by search, one by its category
        source: "LinkedIn Jobs", school: "University of Wisconsin - Madison",
        // plain inputs, committed on blur
        "address--addressLine1": "123 State St", "address--city": "Madison", "address--postalCode": "53703",
        "name--legalName--firstName": "Aidan", "name--legalName--lastName": "O'Brien",
        "emailAddress--emailAddress": "aidanobrien5599@gmail.com", "phoneNumber--phoneNumber": "9082160389",
        "workExperience-1--jobTitle": "Software Engineer Intern", "workExperience-1--companyName": "Netflix",
        "workExperience-2--jobTitle": "Founding Engineer", "workExperience-2--companyName": "Intelligible AI",
        "date0_dateSectionMonth-input": "05", "date1_dateSectionYear-input": "2026",
        "date2_dateSectionYear-input": "2027",
        resume: "resume.pdf",
        dates: ["05", "2026", "2027"], radio: "pw-no",
      });
    // 21 filled; the "broken" prompt never takes a click and is left for you.
    assert.match(summary, /^filled 21 in [0-9.]+s, attached 1 file, left 1 for you(?: · slowest: .*)?$/);
    assert.equal(await page.eval("document.querySelectorAll('.pop').length"), 0, "a menu was left open");
    // Only menus with no plain match go to Jev: "United States" is the one
    // country starting with it, "LinkedIn" the one source. Degree and gender
    // need the model ("B.S.", "Prefer not to say").
    const asked = await page.eval("window.__messages.filter(m => m.type === 'choose-option').map(m => m.label)");
    assert.deepEqual(asked.sort(), ["Education 1: Degree", "Gender"]);
  }));

test("fill: Workday menus are read first and decided together, not one round trip each", { skip }, () =>
  withPage("workday.html", async (page) => {
    await page.waitFor(BUTTON);
    await page.eval("window.__jevDelay = 900"); // about what Jev takes
    const started = Date.now();
    await autofill(page, 60000);
    const elapsed = Date.now() - started;
    // Two dropdowns need Jev; they must be in flight together.
    assert.equal(await page.eval("window.__maxInFlight"), 2, "choose-option calls ran one at a time");
    assert.ok(elapsed < 8000, `a Workday page took ${elapsed}ms to fill`);
    assert.equal(await page.eval("window.__model.gender"), "I do not wish to answer");
  }));

test("fill: every instant field is in before the first menu is opened", { skip }, () =>
  withPage("workday.html", async (page) => {
    await page.waitFor(BUTTON);
    await page.eval("window.__jevDelay = 900");
    // "How Did You Hear About Us?" is the first field on the page and a
    // search picker; in field order it held up every text box below it.
    await page.eval(`(() => {
      window.__order = [];
      const seen = new Set();
      const note = (key) => { if (!seen.has(key)) { seen.add(key); window.__order.push(key); } };
      document.addEventListener("blur", (e) => { if (e.target.id && e.target.value) note("text"); }, true);
      new MutationObserver(() => { if (document.querySelector(".pop")) note("menu"); })
        .observe(document.body, { childList: true });
    })()`);
    await autofill(page, 60000);
    assert.deepEqual(await page.eval("window.__order"), ["text", "menu"]);
  }));

test("fill: a picker whose clicks never take is given up on, not retried for ages", { skip }, () =>
  withPage("workday.html", async (page) => {
    await page.waitFor(BUTTON);
    await page.eval("window.__jevDelay = 900");
    let took = await page.eval(`(async () => {
      const t = performance.now();
      const ok = await window.__smartpasteTest.setPrompt(document.getElementById("referral--referral"), "Career Site");
      return { ms: performance.now() - t, ok, open: document.querySelectorAll(".pop").length };
    })()`);
    assert.deepEqual({ ok: took.ok, open: took.open }, { ok: false, open: 0 });
    took = took.ms;
    assert.ok(took < 7000, `the broken picker held the page for ${Math.round(took)}ms`);
    assert.equal(await page.eval("window.__model.referral"), undefined);
    const asks = await page.eval("window.__messages.filter(m => m.type === 'choose-option').length");
    assert.ok(asks <= 2, `asked Jev ${asks} times about one picker`);
  }));

test("only real autocompletes are waited on: not Email, Address, City or Postal Code", { skip }, () =>
  withPage("form.html", async (page) => {
    const verdicts = await page.eval(() => {
      const { looksLikeAutocomplete } = window.__smartpasteTest;
      const field = (html) => {
        const box = document.createElement("div");
        box.innerHTML = html;
        document.body.appendChild(box);
        return looksLikeAutocomplete(box.querySelector("input"));
      };
      return {
        email: field('<label for="t1">Email Address</label><input id="t1" type="text">'),
        emailType: field('<label for="t2">Address</label><input id="t2" type="email">'),
        street: field('<label for="t3">Address Line 1</label><input id="addressSection_addressLine1" type="text">'),
        city: field('<label for="t4">City</label><input id="addressSection_city" type="text">'),
        postal: field('<label for="t5">Postal Code</label><input id="addressSection_postalCode" type="text">'),
        lever: field('<label>Current location<input name="location" type="text"></label>'),
        aria: field('<label for="t6">Town</label><input id="t6" aria-autocomplete="list" type="text">'),
      };
    });
    // Each false positive typed slowly, then waited 3s for suggestions that
    // never come: 9.5s of a 10.2s Workday fill (Address, City, Postal Code).
    assert.deepEqual(verdicts, {
      email: false, emailType: false, street: false, city: false, postal: false, lever: true, aria: true,
    });
  }));

/* ----------------------------------------------------------------- Cmd-V */

test("cmd-v: inserts the answer, and leaves an unanswered field to a normal paste", { skip }, () =>
  withPage("form.html", async (page) => {
    await page.waitFor(BUTTON);
    const press = (id) => page.eval(`(() => {
      const el = document.getElementById(${JSON.stringify(id)}); el.focus();
      const e = new KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return { prevented: e.defaultPrevented, value: el.value };
    })()`);
    assert.deepEqual(await press("last_name"), { prevented: true, value: "O'Brien" });
    assert.deepEqual(await press("why"), { prevented: false, value: "" });
  }));
