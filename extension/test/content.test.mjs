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
// null until the first scan has asked (an empty array would read as ready).
const asked = `window.__messages.find(m => m.type === 'answer-fields')?.fields.map(f => f.label) ?? null`;

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
      return ["May 2026", "September 2023", "Sept. 2023", "05/2027", "2027-05", "2027", "Present", "Spring 2027", "",
        "09/21/2026", "2026-09-21", "Sep 21, 2026", "May 2nd, 2027"].map((v) => dateParts(v));
    });
    assert.deepEqual(parts, [
      { year: "2026", month: 5, day: null },
      { year: "2023", month: 9, day: null },
      { year: "2023", month: 9, day: null },
      { year: "2027", month: 5, day: null },
      { year: "2027", month: 5, day: null },
      { year: "2027", month: null, day: null },
      null,
      { year: "2027", month: null, day: null }, // a season is not a month; left for the user
      null,
      { year: "2026", month: 9, day: 21 },
      { year: "2026", month: 9, day: 21 },
      { year: "2026", month: 9, day: 21 },
      { year: "2027", month: 5, day: 2 },
    ]);
  }));

test("formatForField: a date in the shape the box asks for", { skip }, () =>
  withPage("contact.html", async (page) => {
    const out = await page.eval(() => {
      const { formatForField } = window.__smartpasteTest;
      const input = (attrs) => Object.assign(document.createElement("input"), attrs);
      return [
        formatForField(input({ placeholder: "MM/DD/YYYY" }), "09/21/2026"),
        formatForField(input({ placeholder: "MM/DD/YYYY" }), "May 2026"),
        formatForField(input({ placeholder: "DD/MM/YYYY" }), "Sep 21, 2026"),
        formatForField(input({ placeholder: "MM/YYYY" }), "May 2027"),
        formatForField(input({ type: "date" }), "09/21/2026"),
        formatForField(input({ placeholder: "MM/DD/YYYY" }), "Present"),
        formatForField(input({ placeholder: "Your name" }), "May 2026"),
      ];
    });
    assert.deepEqual(out, ["09/21/2026", "05/01/2026", "21/09/2026", "05/2027", "2026-09-21", "Present", "May 2026"]);
  }));

test("formatForField: a box asking only for a year gets the year", { skip }, () =>
  withPage("contact.html", async (page) => {
    const out = await page.eval(() => {
      const { formatForField } = window.__smartpasteTest;
      const input = (attrs) => Object.assign(document.createElement("input"), attrs);
      const labelled = (text) => { const i = input({}); i.setAttribute("aria-label", text); return i; };
      return [
        formatForField(labelled("Year of Graduation"), "May 2027"),
        formatForField(labelled("Expected graduation year"), "May 2027"),
        formatForField(input({ type: "number", placeholder: "Year" }), "May 2027"),
        formatForField(labelled("Graduation date"), "May 2027"),                 // a date, not a year
        formatForField(labelled("Month and year of graduation"), "May 2027"),    // asks for the month too
        formatForField(labelled("Years of experience"), "3"),
        formatForField(labelled("Year in school"), "Senior"),                    // no year to cut out
      ];
    });
    assert.deepEqual(out, ["2027", "2027", "2027", "May 2027", "May 2027", "3", "Senior"]);
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
        localMatch(["Bachelor of Science", "Master of Science"], "Undergrad in science"), // no spelling of a degree: Jev
      ];
    });
    assert.deepEqual(picks, [0, 0, 0, -1, -1, -1]);
    // Degrees, from a live Workday list: near-equivalents split Jev's vote,
    // so a degree's spellings are matched here, plainest first.
    const degrees = await page.eval(() => {
      const { localMatch } = window.__smartpasteTest;
      const live = ["Select One", "MIT", "Not Applicable", "BSc (Hons)", "B.Com", "B.A.", "B.A (Hons)", "B Com (Hons)", "A.A.", "B.S.", "Bachelor's Degree", "M.S."];
      return [
        live[localMatch(live, "Bachelor of Science")],
        live[localMatch(live, "BS")],
        live[localMatch(live, "Bachelor of Arts")],
        live[localMatch(live, "Master of Science")],
        ((short) => short[localMatch(short, "Bachelor of Science")])(["BSc (Hons)", "Bachelor's Degree", "Master's Degree"]),
        localMatch(["BSc (Hons)", "B.Com"], "Bachelor of Science"), // nothing plain: Jev decides
      ];
    });
    assert.deepEqual(degrees, ["B.S.", "B.S.", "B.A.", "M.S.", "Bachelor's Degree", -1]);
  }));

/* ------------------------------------------------------ application gate */

// workday-questions.html: a step of only questions (age, salary,
// sponsorship) -- too few kinds of field on its own, but inside Workday's
// application flow, which settles it.
for (const fixture of ["form.html", "application-no-upload.html", "workday.html", "ashby.html", "lever.html", "workday-questions.html"]) {
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
    assert.deepEqual(radio, { label: "Are you authorized to work in the US?", options: ["Yes", "No"], multi: false });
    const langs = await page.eval("window.__messages[0].fields.find(f => /Language/.test(f.label))");
    assert.equal(langs.label, "Language Skill(s) (Check all that apply)");
    assert.equal(langs.multi, true);
    assert.equal(langs.options.length, 6);
    // The "Other" write-in inside the office question is not that question:
    // it used to take its label and get the ranked list of places typed in.
    assert.equal(labels.filter((l) => /office location/.test(l)).length, 1, labels.join(" | "));
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
    // "Date" beside a signature gets today's date, in the box's own shape;
    // a native date picker gets YYYY-MM-DD.
    assert.equal(await page.eval(value("#signed")), "09/21/2026");
    assert.equal(await page.eval(value("#available")), "2027-05-15");
    // Revealed by the Hispanic answer mid-fill, then filled in a follow-up.
    assert.equal(await page.eval(value("#hispanic")), "No");
    await page.waitFor("document.getElementById('race')?.value", 5000);
    assert.equal(await page.eval(value("#race")), "White");
    assert.match(await page.eval("document.querySelector('.smartpaste-note').textContent"), / · then new questions: filled 1 /);
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
    // Loose enough for a loaded machine; the waits these guard against were 1.5s+.
    assert.ok(times["When do you expect to graduate?"] < 400, JSON.stringify(times));
    assert.ok(times["Location (City)"] < 1200, JSON.stringify(times));
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

test("fill: Lever radios and check-all-that-apply boxes", { skip }, () =>
  withPage("lever.html", async (page) => {
    await autofill(page);
    const ticked = (id) => page.eval(`[...document.querySelectorAll("#${id} input:checked")].map(b => b.value)`);
    assert.deepEqual(await ticked("langs"), ["English (ENG)"]);
    assert.deepEqual(await ticked("offices"), ["New York, NY", "Washington, DC", "Seattle, WA"]);
    assert.equal(await page.eval(value("input[name='cards[o1][field1]']")), "");
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

test("fill: Ashby radios with no legend, orphan labels, and Month/Year selects", { skip }, () =>
  withPage("ashby-eeo.html", async (page) => {
    const labels = await page.waitFor(asked);
    for (const label of ["Which degree are you currently pursuing?", "When is your expected graduation date?",
      "Are you a veteran or active member of the United States Armed Forces?", "Do you identify as transgender?",
      "Education History: School", "Education History: Degree", "Education History: Start Date", "Education History: End Date"]) {
      assert.ok(labels.includes(label), `missing ${label}: ${labels.join(" | ")}`);
    }
    await autofill(page);
    const checked = (id) => page.eval(`document.querySelector("#${id} input:checked")?.id || null`);
    assert.equal(await checked("degree"), "deg-0");
    assert.equal(await checked("grad"), "grad-1");
    assert.equal(await checked("vet"), "vet-1");
    // Nothing in the profile says: left alone, never guessed.
    assert.equal(await checked("trans"), null);
    assert.equal(await page.eval(value("input[placeholder='Search schools...']")), "University of Wisconsin - Madison");
    // "Still Student?" ticked means no End Date: Ashby rejects both at once.
    assert.equal(await page.eval("document.getElementById('still').checked"), true);
    assert.deepEqual(await page.eval("['sm','sy','em','ey'].map(id => document.getElementById(id).value)"), ["9", "2023", "", ""]);
    // A second pass (after a resume upload rebuilds the form) finds the box
    // already ticked, so not due; the entry is still ongoing. Re-enabled
    // here so only that, not the disabled selects, keeps End Date empty.
    await new Promise((r) => setTimeout(r, 1500)); // the first fill's follow-up rounds
    await page.eval("document.querySelectorAll('#em, #ey').forEach(s => { s.disabled = false; }); document.querySelector('.smartpaste-note')?.remove()");
    await autofill(page);
    assert.deepEqual(await page.eval("['em','ey'].map(id => document.getElementById(id).value)"), ["", ""]);
  }));

test("fill: SmartRecruiters -- inputs inside web components, labelled on the host", { skip }, () =>
  withPage("smartrecruiters.html", async (page) => {
    const labels = await page.waitFor(asked);
    for (const label of ["First name", "Last name", "Email", "Confirm your email", "Phone number", "LinkedIn"]) {
      assert.ok(labels.includes(label), `missing ${label}: ${labels.join(" | ")}`);
    }
    await autofill(page);
    const model = await page.eval("window.__model");
    assert.equal(model["first-name-input"], "Aidan");
    assert.equal(model["last-name-input"], "O'Brien");
    assert.equal(model["confirm-email-input"], "aidanobrien5599@gmail.com");
    assert.equal(model["linkedin-input"], "https://www.linkedin.com/in/aidanobrien5599");
    assert.equal(model["resume-upload"], "resume.pdf");
    assert.equal(model["apply-with-resume-container"], undefined, "never hand the file to the site's parser");
  }));

test("fill: Workday Self Identify -- one question over three checkboxes", { skip }, () =>
  withPage("workday-questions.html", async (page) => {
    await page.waitFor(asked);
    const sent = await page.eval("window.__messages.find(m => m.type === 'answer-fields').fields.find(f => /check one/.test(f.label))");
    assert.equal(sent?.label, "Please check one of the boxes below");
    assert.equal(sent.multi, true);
    assert.equal(sent.options.length, 3);
    await autofill(page);
    assert.deepEqual(await page.eval("[...document.querySelectorAll('#disability input:checked')].map(b => b.id)"), ["d-no"]);
  }));

test("fill: Workday My Experience -- entries added, then filled", { skip }, () =>
  withPage("workday-experience.html", async (page) => {
    // Its sections start empty: each job, school and website exists only
    // after its Add button is clicked, so nothing here was ever filled.
    const summary = await autofill(page, 60000);
    assert.deepEqual(await page.eval("window.__added"), { "Work-Experience": 2, Education: 1, Websites: 2 });
    const model = await page.eval("window.__model");
    const want = {
      "we1-title": "Software Engineer Intern", "we1-company": "Netflix", "we1-location": "Los Gatos, CA",
      "we1-from-m": "05", "we1-from-y": "2026", "we1-to-m": "08", "we1-to-y": "2026",
      "we1-desc": "Drove $15M+ in projected savings.",
      "we2-title": "Founding Engineer", "we2-company": "Intelligible AI", "we2-from-m": "12", "we2-from-y": "2025",
      "ed1-gpa": "3.9", "ed1-from-y": "2023", "ed1-to-y": "2027",
      school1: "University of Wisconsin - Madison", degree: "Bachelor of Science",
      web1: "https://www.linkedin.com/in/aidanobrien5599", web2: "https://github.com/aidanobrien5599",
      resume: "resume.pdf",
    };
    for (const [key, value] of Object.entries(want)) assert.equal(model[key], value, `${key}: ${JSON.stringify(model[key])}`);
    // Skills one at a time; one with no plain match (Next.js) is skipped.
    assert.deepEqual(model.skills, ["Python", "TypeScript", "Java", "React.js"]);
    // "I currently work here" (every job's box is name="currentlyWorkHere"):
    // ticked for the current job only.
    assert.equal(model["we2-current"], true);
    assert.equal(model["we1-current"], undefined);
    assert.match(summary, /^filled \d+ in/);
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
      return { ms: performance.now() - t, ok, open: document.querySelectorAll(".pop:not([data-closing])").length };
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

/* ------------------------------------------ company-built forms (live-found) */

// c3.html is C3 AI's own form over the Greenhouse API, as served. Every
// question is a <label> beside the input's <div>, with no for= and no id:
// before it, only School and Degree were read and 0 of 16 fields filled.
test("labels: C3 -- a label beside the input's wrapper, no search box, no consents", { skip }, () =>
  withPage("c3.html", async (page) => {
    const labels = await page.waitFor(asked);
    for (const label of ["First Name", "Last Name", "Email", "Phone", "LinkedIn Profile", "Location",
      "What is your expected graduation month and year?", "How did you hear about C3 AI?",
      "Do you now or will you in the future require immigration sponsorship to work at C3 AI?",
      "Education: School", "Education: Degree", "Education: Field of study",
      // Month dropdown + Year box: one split date each, not a lone "Start" menu.
      "Education: Start", "Education: End (or expected)"]) {
      assert.ok(labels.includes(label), `missing ${label}: ${JSON.stringify(labels)}`);
    }
    // The header's site search and the cookie banner are page chrome, and a
    // bare "I Accept" under a privacy notice is a consent -- never a question.
    for (const bad of [/search/i, /do not sell/i, /^i accept$/i]) {
      assert.ok(!labels.some((l) => bad.test(l)), `${bad} was asked: ${JSON.stringify(labels)}`);
    }
    // Two dates, two fields: the page-level id'd wrapper once merged them
    // into one field labelled with the whole job description.
    assert.equal(labels.filter((l) => /^Education: (Start|End)/.test(l)).length, 2);
  }));

test("fill: C3 -- text, month + year pairs, resume; consent boxes left alone", { skip }, () =>
  withPage("c3.html", async (page) => {
    await autofill(page, 60000);
    const model = await page.eval("window.__model");
    const want = {
      "First Name": "Aidan", "Last Name": "O'Brien", Email: "aidanobrien5599@gmail.com", Phone: "9082160389",
      "LinkedIn Profile": "https://www.linkedin.com/in/aidanobrien5599", "Resume/CV": "resume.pdf",
      School: "University of Wisconsin - Madison", "Field of study": "Computer Science",
      "Start month": "September", "Start year": "2023", "End (or expected) month": "May", "End (or expected) year": "2027",
    };
    for (const [key, value] of Object.entries(want)) assert.equal(model[key], value, `${key}: ${JSON.stringify(model)}`);
    assert.equal(await page.eval(`[...document.querySelectorAll(".gh-apply-form__checkbox input")][0].checked`), false, "ticked I Accept");
    assert.equal(await page.eval(`document.getElementById("ckyCCPAOptOut").checked`), false, "ticked Do Not Sell");
  }));

// bytedance.html rebuilds ByteDance's signed-in application and its widgets
// (see the fixture's header for each quirk).
test("labels: ByteDance -- questions far above empty labels; Mobile is the number", { skip }, () =>
  withPage("bytedance.html", async (page) => {
    const labels = await page.waitFor(asked);
    for (const label of ["Name", "Mobile phone number", "Email", "Preferred work location",
      "Education 1 (University of Wisconsin - Madison): Degree",
      "Education 1 (University of Wisconsin - Madison): Start & end date (start)",
      "Education 1 (University of Wisconsin - Madison): Start & end date (end)",
      "Where did you hear about this opportunity? Choose the option(s) that influenced your decision to apply.",
      "Are you legally authorized to work in the US without restriction?",
      "Will you now or in the future require visa sponsorship or a visa transfer?"]) {
      assert.ok(labels.includes(label), `missing ${label}: ${JSON.stringify(labels)}`);
    }
    // A bare "Mobile" was answered with my phone *type*.
    assert.ok(!labels.includes("Mobile"));
    assert.ok(!labels.some((l) => /privacy/i.test(l)), "asked about the privacy consent");
  }));

test("fill: ByteDance -- Yes / No right after a dropdown whose pick failed", { skip }, () =>
  withPage("bytedance.html", async (page) => {
    // "Where did you hear" has no option matching its answer, so its pick
    // fails and its menu is left open over the next two questions. Reading
    // that leftover menu once made sponsorship click "No" in the
    // *authorization* menu -- live, on a real application.
    await autofill(page, 60000);
    const model = await page.eval("window.__model");
    assert.equal(model.Authorized, "Yes");
    assert.equal(model.Sponsorship, "No");
    assert.equal(model["Where did you hear"], undefined, "clicked an option that is not the answer");
    assert.equal(model["Interview language"], undefined, "clicked the only option, which is not the answer");
    assert.equal(await page.eval("document.querySelectorAll('.ud__select__dropdown').length"), 0, "left a menu open");
  }));

test("fill: ByteDance -- read-only dropdown, location tree, ISO dates, hidden resume input", { skip }, () =>
  withPage("bytedance.html", async (page) => {
    await autofill(page, 60000);
    const model = await page.eval("window.__model");
    // Each row in a wrapper of its own: read as one menu, not one row.
    assert.equal(model["Education 1: Degree"], "Bachelor's degree");
    // Leaves only, named by path: San Jose is in Costa Rica too.
    assert.deepEqual(model["Preferred work location"], ["United States of America/California/San Jose"]);
    // The picker keeps YYYY-MM and clears "Sep 2023" on blur.
    assert.equal(model["Education 1: Start & end date start"], "2023-09");
    assert.equal(model["Education 1: Start & end date end"], "2027-05");
    assert.equal(model.Mobile, "9082160389");
    assert.equal(model.Attachment, "resume.pdf");
    assert.equal(model.Privacy, undefined, "ticked the privacy consent");
  }));

test("fill: ByteDance -- bare Add buttons by section title, roles split intern / work", { skip }, () =>
  withPage("bytedance.html", async (page) => {
    await autofill(page, 60000);
    // The stub profile: Netflix (Software Engineer Intern), Intelligible AI
    // (Founding Engineer), no projects -- so no Project card.
    assert.deepEqual(await page.eval("window.__added"), { "Work Experience": 1, "Internship Experience": 1 });
    const labels = await page.eval("window.__messages.filter(m => m.type === 'answer-fields').flatMap(m => m.fields.map(f => f.label))");
    // Each card names the entry it is for: Work Experience 1 is my 2nd most
    // recent role, and without its subject Jev answered it as the 1st.
    assert.ok(labels.includes("Work Experience 1 (Intelligible AI): Company name"), JSON.stringify(labels));
    assert.ok(labels.includes("Internship Experience 1 (Netflix): Company name"), JSON.stringify(labels));
    const model = await page.eval("window.__model");
    const want = {
      "Work Experience 1: Company name": "Intelligible AI", "Work Experience 1: Title": "Founding Engineer",
      "Work Experience 1: Start & end date start": "2025-12", "Work Experience 1: Start & end date end": "2026-05",
      "Internship Experience 1: Company name": "Netflix", "Internship Experience 1: Title": "Software Engineer Intern",
      "Internship Experience 1: Start & end date start": "2026-05", "Internship Experience 1: Start & end date end": "2026-08",
    };
    for (const [key, value] of Object.entries(want)) assert.equal(model[key], value, `${key}: ${JSON.stringify(model[key])}`);
  }));

test("collect: a lone consent box, by its own text or by the question around it", { skip }, () =>
  withPage("contact.html", async (page) => {
    const labels = await page.eval(() => {
      const box = (question, text) => {
        const field = document.createElement("div");
        field.innerHTML = `<label>${question}</label><div><label><input type="checkbox">${text}</label></div>`;
        document.body.append(field);
      };
      box("Please confirm you have read the notice above", "I Accept"); // the box's own text says so
      box("I consent to receiving text messages about my application", "Yes"); // only the question does
      const job = document.createElement("div"); // a real yes/no question, as Workday draws it
      job.innerHTML = `<label><input type="checkbox">I currently work here</label>`;
      document.body.append(job);
      return window.__smartpasteTest.collectFields().filter((f) => f.single).map((f) => f.label);
    });
    assert.deepEqual(labels, ["I currently work here"]);
  }));

/* ---------------------------------------------------------------- Vercel */

const vercelField = (pattern) =>
  `window.__messages.find(m => m.type === 'answer-fields')?.fields.find(f => ${pattern}.test(f.label)) ?? null`;

test("labels: Vercel -- a <p> beside the radiogroup is the question, not a neighbour's label", { skip }, () =>
  withPage("vercel.html", async (page) => {
    const labels = await page.waitFor(asked);
    for (const q of [
      /^Are you currently based in any of these countries\?/,
      /^Are you able to work from our London office on a hybrid schedule, 3 days a week\?$/,
      /^Will you require Visa Sponsorship now, or in the future\?$/,
      /^Your authorization to work in the country where you live\./,
      /^Do you live in one of the following states\? Alabama, Alaska/,
      /^Where did you first hear about this role\?$/,
    ]) assert.ok(labels.some((l) => q.test(l)), `${q} not asked; asked: ${labels.join(" | ")}`);
    // Only the real First Name box is called First Name.
    assert.equal(labels.filter((l) => /first name/i.test(l)).length, 1, labels.join(" | "));
    const sponsorship = await page.eval(vercelField("/Sponsorship/"));
    assert.deepEqual(sponsorship.options, ["Yes", "No"]);
    const heard = await page.eval(vercelField("/first hear/"));
    assert.equal(heard.options.length, 14);
    assert.ok(heard.options.includes("LinkedIn"));
  }));

const checked = (name) =>
  `document.querySelector('input[name="${name}"]:checked')?.closest('label')?.textContent.replace(/\\u200b/g, '').trim() ?? null`;

test("fill: Vercel -- radio questions are answered by clicking", { skip }, () =>
  withPage("vercel.html", async (page) => {
    await autofill(page);
    assert.equal(await page.eval(checked("question_19385414004")), "United States");
    assert.equal(await page.eval(checked("question_19392536004")), "Yes");
    assert.equal(await page.eval(checked("question_19385415004")), "No");
    assert.equal(await page.eval(checked("question_19385416004")), "I am authorized to work in the country due to my nationality");
    assert.equal(await page.eval(checked("question_19385417004")), "No");
    assert.equal(await page.eval(checked("question_19385422004")), "LinkedIn");
    assert.equal(await page.eval(value('[name="first_name"]')), "Aidan");
    assert.equal(await page.eval("window.__submitted ?? false"), false);
  }));

const ACK_PRIVACY = "question_19385423004";
const ACK_ACCURATE = "question_19385424004";

async function withSettings(fixture, settings, fn) {
  const page = await browser.open(fixture, { scripts: [`window.__settings = ${JSON.stringify(settings)};`] });
  try { return await fn(page); } finally { await page.close(); }
}

test("acknowledge: off by default -- one-option acknowledgements are left for you, and never sent to Jev", { skip }, () =>
  withPage("vercel.html", async (page) => {
    await autofill(page);
    assert.equal(await page.eval(checked(ACK_PRIVACY)), null);
    assert.equal(await page.eval(checked(ACK_ACCURATE)), null);
    const labels = await page.eval(`window.__messages.filter(m => m.type === 'answer-fields').flatMap(m => m.fields.map(f => f.label))`);
    assert.ok(!labels.some((l) => /acknowledge|double-check/i.test(l)), labels.join(" | "));
  }));

test("acknowledge: on -- Vercel's privacy notice and accuracy confirmation are ticked", { skip }, () =>
  withSettings("vercel.html", { acknowledge: true }, async (page) => {
    const note = await autofill(page);
    assert.equal(await page.eval(checked(ACK_PRIVACY)), "Acknowledge/Confirm");
    assert.equal(await page.eval(checked(ACK_ACCURATE)),
      "I have reviewed and confirmed that all the information provided is accurate and complete.");
    assert.match(note, /2 acknowledged/);
    assert.equal(await page.eval("window.__submitted ?? false"), false);
  }));

test("acknowledge: on -- C3's I Accept is ticked, the cookie banner's Do Not Sell never is", { skip }, () =>
  withSettings("c3.html", { acknowledge: true }, async (page) => {
    await autofill(page, 60000);
    assert.equal(await page.eval(`document.querySelector(".gh-apply-form__checkbox input").checked`), true, "I Accept");
    assert.equal(await page.eval(`document.getElementById("ckyCCPAOptOut").checked`), false, "ticked Do Not Sell");
  }));

test("acknowledge: marketing, texts and talent pools are never ticked, however they are worded", { skip }, () =>
  withPage("contact.html", async (page) => {
    const picked = await page.eval(() => {
      document.body.insertAdjacentHTML("beforeend", `<form id="acks">
        <label><input type="checkbox" id="a1">I have read and understood the Privacy Notice</label>
        <label><input type="checkbox" id="a2">I acknowledge and agree to receive marketing emails</label>
        <label><input type="checkbox" id="a3">I accept being added to the talent community for future roles</label>
        <label><input type="checkbox" id="a4">I consent to receive SMS text messages about my application</label>
        <label><input type="checkbox" id="a5">I currently work here</label>
        <label><input type="checkbox" id="a6">I certify that my answers are true and complete</label>
      </form>`);
      return window.__smartpasteTest.acknowledgements().map((b) => b.id);
    });
    assert.deepEqual(picked, ["a1", "a6"]);
  }));

test("fill: Vercel -- a box after a shown linkedin.com/in/ prefix takes the handle, not the URL", { skip }, () =>
  withPage("vercel.html", async (page) => {
    const labels = await page.waitFor(asked);
    for (const l of ["LinkedIn", "GitHub", "Portfolio"]) assert.ok(labels.includes(l), `${l}: ${labels.join(" | ")}`);
    await autofill(page);
    assert.equal(await page.eval(value('[name="question_19385418004"]')), "aidanobrien5599");
    assert.equal(await page.eval(value('[name="question_19385420004"]')), "aidanobrien5599");
    assert.equal(await page.eval(value('[name="question_19385421004"]')), "aidanobrien.dev");
  }));
