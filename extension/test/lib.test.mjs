// Unit tests for extension/lib. Run: node --test extension/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { isYesNo, maxTicks, refine, resolve, yesNoCertainty, yesNoFromEntry } from "../lib/resolve.js";
import { placeSaysYes } from "../lib/places.js";
import { isPriorEmploymentQuestion } from "../lib/history.js";
import { LABELS } from "../lib/schema.js";
import { buildOptions, unwrap, extraSnippets, NONE } from "../lib/profile.js";

test("refine: names from an all-caps header", () => {
  assert.equal(refine("First name", "AIDAN O'BRIEN"), "Aidan");
  assert.equal(refine("Last name", "AIDAN O'BRIEN"), "O'Brien");
  assert.equal(refine("Last name", "Aidan O'Brien Jr."), "O'Brien");
});

test("refine: contact line", () => {
  const line = "aidan@x.com | 908-216-0389 | github.com/aidan";
  assert.equal(refine("Email", line), "aidan@x.com");
  assert.equal(refine("Phone", line), "908-216-0389");
  assert.equal(refine("GitHub", line), "github.com/aidan");
});

test("refine: date ranges pick the right end", () => {
  assert.equal(refine("Expected graduation date", "Sep 2023 - May 2027"), "May 2027");
  assert.equal(refine("Start date", "Sep 2023 - May 2027"), "Sep 2023");
  assert.equal(refine("End date of the most recent role", "May 2026 - August 2026"), "August 2026");
});

test("refine: employer, title and place share one line", () => {
  assert.equal(refine("Company of the most recent role", "Netflix Los Gatos, CA"), "Netflix");
  assert.equal(refine("Company of the 2nd most recent role", "Intelligible AI Remote"), "Intelligible AI");
  assert.equal(refine("Location of the most recent role", "Los Gatos, CA"), "Los Gatos, CA");
  assert.equal(refine("Location of the 2nd most recent role", "Intelligible AI Remote"), "Remote");
  assert.equal(
    refine("Job title of the most recent role", "Software Engineer Intern May 2026 - August 2026"),
    "Software Engineer Intern"
  );
});

test("refine: education line", () => {
  assert.equal(refine("Degree", "B.S. Computer Science GPA: 3.9/4.00"), "B.S. Computer Science");
  assert.equal(refine("Current GPA", "B.S. Computer Science GPA: 3.9/4.00"), "3.9/4.00");
  assert.equal(
    refine("School", "University of Wisconsin - Madison Sep 2023 - May 2027"),
    "University of Wisconsin - Madison"
  );
});

test("refine: a labelled profile value is returned untouched", () => {
  assert.equal(refine("Phone", { field: "Phone", value: "908-216-0389" }), "908-216-0389");
  assert.equal(refine("School", { field: "School", value: "UW Sep 2023" }), "UW Sep 2023");
});

test("resolve: the escape option yields nothing, not a guess", () => {
  const r = resolve("Salary", { choice: NONE, probabilities: { [NONE]: 1 }, confidence: 1 }, {});
  assert.equal(r.status, "none");
  assert.equal(r.value, null);
});

test("resolve: confidence gate", () => {
  const opts = { a: { field: "A", value: "x" }, b: { field: "B", value: "y" } };
  assert.equal(resolve("A", { choice: "a", probabilities: { a: 0.97 }, confidence: 0.97 }, opts).status, "auto");
  assert.equal(resolve("A", { choice: "a", probabilities: { a: 0.6, b: 0.4 }, confidence: 0.6 }, opts).status, "pick");
  assert.equal(resolve("A", { choice: "a", probabilities: { a: 0.3 }, confidence: 0.3 }, opts).status, "none");
});

test("buildOptions: derives a full name, explicit value wins", () => {
  const o = buildOptions({ first_name: "Aidan", last_name: "O'Brien", city: "Madison", state: "Wisconsin" });
  assert.equal(o.full_name.value, "Aidan O'Brien");
  assert.equal(o.location.value, "Madison, Wisconsin");
  const p = buildOptions({ first_name: "Aidan", last_name: "O'Brien", full_name: "Aidan P. O'Brien" });
  assert.equal(p.full_name.value, "Aidan P. O'Brien");
});

test("buildOptions: repeated entries carry ordinal and subject", () => {
  const o = buildOptions({ experience: [{ company: "Netflix", title: "SWE Intern" }, { company: "CargoLabs" }] });
  assert.match(o.experience1_title.field, /most recent role \(Netflix\)/);
  assert.match(o.experience2_company.field, /2nd most recent/);
});

test("buildOptions: blank fields are never offered", () => {
  const o = buildOptions({ email: "", phone: "  ", first_name: "Aidan" });
  assert.ok(!("email" in o) && !("phone" in o));
});

test("unwrap: rejoins a wrapped bullet but not an education block", () => {
  const out = unwrap([
    "• Drove $15M in savings by leading an A/B test on the cancel flow to improve",
    "subscriber save rate across the React frontend.",
    "University of Wisconsin - Madison",
    "Sep 2023 - May 2027",
  ].join("\n")).split("\n");
  assert.equal(out.length, 3);
  assert.match(out[0], /to improve subscriber save rate/);
  assert.equal(out[1], "University of Wisconsin - Madison");
});

test("extraSnippets: short company names survive when asked to", () => {
  assert.ok(!Object.values(extraSnippets("Netflix")).includes("Netflix"));
  assert.ok(Object.values(extraSnippets("Netflix", 0, 3)).includes("Netflix"));
});

test("refine: a line naming no place gives no location, not the line", () => {
  assert.equal(refine("Location of the most recent school", "University of Wisconsin - Madison"), null);
  assert.equal(refine("Location of the most recent role", "Los Gatos, CA"), "Los Gatos, CA");
});

test("refine: a major is the subject without the degree", () => {
  assert.equal(refine("Major / discipline of the most recent school", "B.S. Computer Science"), "Computer Science");
  assert.equal(refine("Major", "Bachelor of Science in Computer Science GPA: 3.9"), "Computer Science");
  assert.equal(refine("Degree", "B.S. Computer Science GPA: 3.9/4.00"), "B.S. Computer Science");
});

test("resolve: a line that holds no such value is no answer", () => {
  const opts = { s1: "University of Wisconsin - Madison" };
  const r = resolve("Location of the most recent school",
    { choice: "s1", probabilities: { s1: 0.95 }, confidence: 0.95 }, opts);
  assert.equal(r.status, "none");
});

test("unwrap: a bullet without a full stop does not swallow the next job", () => {
  const out = unwrap([
    "• Run weekly workshops for a 300-member student club and organise the annual hackathon",
    "Software Engineering Intern", "May 2025 – Aug 2025", "Ford Motor Company",
  ].join("\n")).split("\n");
  assert.equal(out.length, 4);
});

test("unwrap: text alone joins only a line that starts mid-sentence", () => {
  const out = unwrap(["\u2022 Designed a database served through a Hono/Bun +",
    "and a Redis caching layer."].join("\n")).split("\n");
  assert.equal(out.length, 1);
});

test("buildOptions: a phone number implies a mobile device type unless one is given", () => {
  assert.equal(buildOptions({ phone: "908-216-0389" }).phone_type.value, "Mobile");
  assert.equal(buildOptions({ phone: "908-216-0389", phone_type: "Home" }).phone_type.value, "Home");
  assert.equal(buildOptions({ email: "a@b.co" }).phone_type, undefined);
  assert.equal(buildOptions({ phone: "1" }).phone_type.field, "Phone device type");
});

test("maxTicks: how many boxes a question allows", () => {
  assert.equal(maxTicks("Select 1-3 from below."), 3);
  assert.equal(maxTicks("Choose up to 2 locations"), 2);
  assert.equal(maxTicks("Pick 3"), 3);
  assert.equal(maxTicks("Please check one of the boxes below:"), 1);
  assert.equal(maxTicks("Select only one"), 1);
  assert.equal(maxTicks("Language Skill(s) (Check all that apply)"), Infinity);
  assert.equal(maxTicks("Which offices? (select all)"), Infinity);
});

test("buildOptions defaults conflict-of-interest answers to No unless set", () => {
  const o = buildOptions({ first_name: "Aidan" });
  assert.equal(o.related_employee.value, "No");
  assert.equal(o.non_compete.value, "No");
  assert.equal(o.history_default.value, "No");
  assert.match(o.history_default.field, /ties to the company/);
  assert.equal(buildOptions({ non_compete: "Yes, a 6-month non-compete" }).non_compete.value, "Yes, a 6-month non-compete");
});

test("isPriorEmploymentQuestion: a right-to-work question is not about this employer", () => {
  // Rivian/VW (Ashby), live: "currently ... work for" matched, so it went out
  // as a question over my work history and came back "cannot tell which
  // employer is meant" -- and the field stayed blank. With it excluded, real
  // Jev picks the citizen option at 1.00.
  assert.ok(!isPriorEmploymentQuestion("Are you currently authorized to work for any employer in the United States?"));
  assert.ok(!isPriorEmploymentQuestion("Are you currently eligible to work for any employer in the US without sponsorship?"));
  assert.ok(isPriorEmploymentQuestion("Have you previously worked for Rocket Lab?"));
  assert.ok(isPriorEmploymentQuestion("Are you a former employee of this company?"));
});

test("Say yes covers consenting, not only doing", () => {
  // An interview-recording consent sat at 0.30 against the escape option;
  // naming consent in the catch-all took it to 0.92.
  assert.match(LABELS.willing_default, /consent/i);
  assert.match(LABELS.willing_default, /recorded|transcrib/i);
});

test("buildOptions: Say yes offers a Yes catch-all for willing / able questions, only when on", () => {
  assert.equal(buildOptions({ first_name: "Aidan" }).willing_default, undefined);
  const o = buildOptions({ first_name: "Aidan" }, "", { say_yes: true });
  assert.match(o.willing_default.value, /^Yes\b/);
  assert.match(o.willing_default.field, /willing/);
  assert.equal(buildOptions({ willing_default: "No" }, "", { say_yes: true }).willing_default.value, "No");
});

test("buildOptions: names get a straight apostrophe; a US phone gets a +1 country code", () => {
  const o = buildOptions({ first_name: "Aidan", last_name: "O’Brien", full_name: "Aidan O’Brien", phone: "908-216-0389" });
  assert.equal(o.last_name.value, "O'Brien");
  assert.equal(o.full_name.value, "Aidan O'Brien");
  assert.equal(o.phone_country_code.value, "+1 (United States)");
  assert.equal(buildOptions({ first_name: "Aidan", last_name: "O’Brien" }).full_name.value, "Aidan O'Brien");
  assert.equal(buildOptions({ phone: "+44 20 7946 0000", country: "United Kingdom" }).phone_country_code, undefined);
});

test("yesNoFromEntry: a confident Yes/No profile entry selects the matching option", () => {
  const options = buildOptions({ first_name: "Aidan" });
  const sure = { choice: "history_default", confidence: 0.95, probabilities: { history_default: 0.95 } };
  assert.equal(yesNoFromEntry(["Select One", "Yes", "No"], sure, options), 2);
  assert.equal(yesNoFromEntry(["Select One", "Yes", "No"], { ...sure, confidence: 0.5 }, options), -1);
  assert.equal(yesNoFromEntry(["Yes", "No"], { choice: "first_name", confidence: 1, probabilities: { first_name: 1 } }, options), -1);
  assert.equal(yesNoFromEntry(["Yes", "No"], { choice: NONE, confidence: 1, probabilities: { [NONE]: 1 } }, options), -1);
  assert.ok(isYesNo(["Select One", "Yes", "No"]));
  assert.ok(!isYesNo(["Midwest", "West"]));
});

test("yesNoFromEntry: entries that say the same Yes pool their probability", () => {
  // Hudl's "on-site in Lincoln, NE for the full program?" (live Jev, 2026-09-22).
  const options = buildOptions({ flexibility_default: "Yes I am flexible", work_locations: { ranked: [], anywhere: true } });
  const split = { choice: "flexibility_default", confidence: 0.53,
    probabilities: { flexibility_default: 0.55, open_to_any_location: 0.15, [NONE]: 0.3 } };
  assert.equal(yesNoFromEntry(["Yes", "No"], split, options), 0);
  assert.ok(Math.abs(yesNoCertainty(split, options).certainty - 0.7 * 0.53 / 0.55) < 1e-9);
  // Disagreeing entries do not add up, and a low confidence still discounts.
  const torn = { ...split, probabilities: { flexibility_default: 0.55, history_default: 0.15, [NONE]: 0.3 } };
  assert.equal(yesNoFromEntry(["Yes", "No"], torn, buildOptions({ flexibility_default: "Yes" })), -1);
  assert.equal(yesNoFromEntry(["Yes", "No"], { ...split, confidence: 0.3 }, options), -1);
});

test("yesNoFromEntry: a place preference reads Yes only when anywhere is fine", () => {
  // Garner Health: "based in or planning to relocate to the NYC area?" picks the top city.
  const nyc = { choice: "top_work_location", confidence: 0.44,
    probabilities: { top_work_location: 0.46, work_locations: 0.22, [NONE]: 0.13 } };
  const anywhere = buildOptions({ work_locations: { ranked: ["New York City", "Chicago"], anywhere: true } });
  assert.equal(yesNoFromEntry(["Yes", "No"], nyc, anywhere), 0);
  assert.ok(placeSaysYes("top_work_location", anywhere));
  const listed = buildOptions({ work_locations: { ranked: ["New York City", "Chicago"], anywhere: false } });
  assert.equal(yesNoFromEntry(["Yes", "No"], nyc, listed), -1);
  assert.ok(!placeSaysYes("top_work_location", listed));
  assert.ok(!placeSaysYes("location", anywhere));
});

test("buildOptions: a citizen is on no visa; a bachelor's-only list has no graduate degree", () => {
  const o = buildOptions({ visa_status: "US Citizen", education: [{ degree: "Bachelor of Science" }, { school: "Shore Regional" }] });
  assert.equal(o.on_visa.value, "No");
  assert.match(o.on_visa.field, /OPT/);
  assert.match(o.graduate_degree.value, /^None\b/);
  assert.match(buildOptions({ visa_status: "Permanent resident (green card)" }).on_visa.value, /^No\b/);
  // Nothing to go on, or a visa or a graduate degree listed: no such entry.
  assert.equal(buildOptions({ visa_status: "F-1 (OPT)" }).on_visa, undefined);
  assert.equal(buildOptions({ first_name: "Aidan" }).on_visa, undefined);
  assert.equal(buildOptions({ education: [{ school: "UW" }] }).graduate_degree, undefined);
  for (const degree of ["Master of Science", "M.S.", "MS", "MEng", "PhD", "Ph.D.", "MBA", "Doctor of Philosophy"]) {
    assert.equal(buildOptions({ education: [{ degree: "B.S." }, { degree }] }).graduate_degree, undefined, degree);
  }
  for (const degree of ["B.S.", "Bachelor of Arts", "BSc", "Associate of Science"]) {
    assert.ok(buildOptions({ education: [{ degree }] }).graduate_degree, degree);
  }
});

test("catch-alls name the history and willingness questions they now cover", () => {
  assert.match(buildOptions({}).history_default.field, /interviewed there before/);
  assert.match(buildOptions({}, "", { say_yes: true }).willing_default.field, /pay it states/);
});
