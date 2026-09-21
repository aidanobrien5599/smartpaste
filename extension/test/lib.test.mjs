// Unit tests for extension/lib. Run: node --test extension/test/
// The JS refine() is a port of smartpaste/answer.py and has drifted from it
// once already (it lost "end" from its end-of-range words); these pin it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { refine, resolve } from "../lib/resolve.js";
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
