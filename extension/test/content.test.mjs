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
        "name--legalName--firstName": "Aidan", "name--legalName--lastName": "O'Brien",
        "emailAddress--emailAddress": "aidanobrien5599@gmail.com", "phoneNumber--phoneNumber": "9082160389",
        "workExperience-1--jobTitle": "Software Engineer Intern", "workExperience-1--companyName": "Netflix",
        "workExperience-2--jobTitle": "Founding Engineer", "workExperience-2--companyName": "Intelligible AI",
        "date0_dateSectionMonth-input": "05", "date1_dateSectionYear-input": "2026",
        "date2_dateSectionYear-input": "2027",
        resume: "resume.pdf",
        dates: ["05", "2026", "2027"], radio: "pw-no",
      });
    // 18 filled; the "broken" prompt never takes a click and is left for you.
    assert.match(summary, /filled 18, attached 1 file, left 1 for you/);
    assert.equal(await page.eval("document.querySelectorAll('.pop').length"), 0, "a menu was left open");
    // The long list reached Jev shortlisted, not as 237 options.
    const country = await page.eval("window.__messages.find(m => m.type === 'choose-option' && m.label === 'Country')");
    assert.ok(country.options.length <= 5, country.options);
  }));

test("fill: Workday menus are read first and decided together, not one round trip each", { skip }, () =>
  withPage("workday.html", async (page) => {
    await page.waitFor(BUTTON);
    await page.eval("window.__jevDelay = 900"); // about what Jev takes
    const started = Date.now();
    await autofill(page, 60000);
    const elapsed = Date.now() - started;
    // Four dropdowns need Jev; asked one after another that alone is 3.6s.
    assert.ok(await page.eval("window.__maxInFlight") >= 3, "choose-option calls ran one at a time");
    assert.ok(elapsed < 8000, `a Workday page took ${elapsed}ms to fill`);
    assert.equal(await page.eval("window.__model.gender"), "I do not wish to answer");
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

test("an Email Address field is not mistaken for a location autocomplete", { skip }, () =>
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
        street: field('<label for="t3">Street Address</label><input id="t3" type="text">'),
        city: field('<label for="t4">City</label><input id="t4" type="text">'),
      };
    });
    // Treating it as one typed it slowly, then waited 3s for suggestions.
    assert.deepEqual(verdicts, { email: false, emailType: false, street: true, city: true });
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
