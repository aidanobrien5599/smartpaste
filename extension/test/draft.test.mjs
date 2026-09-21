import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPieces, parseDates, assemble, splitDegreeField, cleanGpa, headingCandidates } from "../lib/draft.js";

test("splitPieces: the standard student format is four fields", () => {
  assert.deepEqual(
    splitPieces("Master of Science, Computer Science, Towson University, Towson, MD"),
    ["Master of Science", "Computer Science", "Towson University", "Towson, MD"]);
});

test("splitPieces: separators, em dashes and a leading date column", () => {
  assert.deepEqual(splitPieces("Wealthsimple — Backend Developer Intern"), ["Wealthsimple", "Backend Developer Intern"]);
  assert.deepEqual(splitPieces("Jan 2025 – Apr 2025 · Toronto, ON"), ["Jan 2025 – Apr 2025", "Toronto, ON"]);
  assert.deepEqual(splitPieces("08/2024 – 12/2025 Carnegie Mellon University, Pittsburgh, PA"),
    ["08/2024 – 12/2025", "Carnegie Mellon University", "Pittsburgh, PA"]);
  assert.deepEqual(splitPieces("Intern Web Master/Web Database Developer; BXR Inc., Towson, MD"),
    ["Intern Web Master/Web Database Developer", "BXR Inc.", "Towson, MD"]);
  assert.deepEqual(splitPieces("London, UK | Jul 2024 – Sep 2024"), ["London, UK", "Jul 2024 – Sep 2024"]);
});

test("splitPieces: what must stay whole", () => {
  assert.deepEqual(splitPieces("University of Wisconsin - Madison"), ["University of Wisconsin - Madison"]);
  assert.deepEqual(splitPieces("University of California, Berkeley"), ["University of California, Berkeley"]);
  assert.deepEqual(splitPieces("• Built a thing, then shipped it"), ["Built a thing, then shipped it"]);
});

test("parseDates", () => {
  assert.deepEqual(parseDates("May 2026 – August 2026"), { start: "May 2026", end: "Aug 2026" });
  assert.deepEqual(parseDates("05/2025 - 08/2025"), { start: "May 2025", end: "Aug 2025" });
  assert.deepEqual(parseDates("Aug 2024 – Present"), { start: "Aug 2024", end: "Present" });
  assert.deepEqual(parseDates("Expected May 2026"), { start: "", end: "May 2026" });
});

test("assemble: a repeated field starts the next entry, whatever leads", () => {
  const roles = assemble([
    { text: "05/2025 – 08/2025", label: "dates" }, { text: "Amazon", label: "company" },
    { text: "SDE Intern", label: "title" }, { text: "Did a thing", bullet: true },
    { text: "07/2023 – 07/2024", label: "dates" }, { text: "Flipkart", label: "company" },
    { text: "Did another", bullet: true }, { text: "And more", bullet: true },
  ], "experience");
  assert.equal(roles.length, 2);
  assert.equal(roles[0].company, "Amazon");
  assert.deepEqual(roles[1].description, ["Did another", "And more"]);
});

test("splitDegreeField", () => {
  assert.deepEqual(splitDegreeField("B.S. in Computer Science"), { degree: "B.S.", field: "Computer Science" });
  assert.deepEqual(splitDegreeField("Bachelor of Science in Data Science"), { degree: "Bachelor of Science", field: "Data Science" });
  assert.deepEqual(splitDegreeField("MEng Computing"), { degree: "MEng", field: "Computing" });
  assert.deepEqual(splitDegreeField("B.Tech in Computer Science and Engineering"),
    { degree: "B.Tech", field: "Computer Science and Engineering" });
  assert.deepEqual(splitDegreeField("BSE Computer Engineering"), { degree: "BSE", field: "Computer Engineering" });
});

test("cleanGpa", () => {
  assert.equal(cleanGpa("GPA: 3.82/4.00"), "3.82/4.00");
  assert.equal(cleanGpa("Cumulative GPA 3.6/4.0"), "3.6/4.0");
});

test("headingCandidates keeps short plain lines only", () => {
  const got = headingCandidates(["EXPERIENCE", "Professional Experience", "a@b.com | 555-123-4567",
    "• Built things", "This is a long sentence that is certainly not a section heading at all"]).map((c) => c.text);
  assert.deepEqual(got, ["EXPERIENCE", "Professional Experience"]);
});

test("splitPieces: date words need word boundaries", () => {
  assert.deepEqual(splitPieces("Snowflake"), ["Snowflake"]);
  assert.deepEqual(splitPieces("Nowhere Labs, Mayfield, OH"), ["Nowhere Labs", "Mayfield, OH"]);
});

test("splitPieces: a GPA is its own field even without a separator", () => {
  assert.deepEqual(splitPieces("BSE Computer Engineering GPA: 3.91/4.00"), ["BSE Computer Engineering", "GPA: 3.91/4.00"]);
});

test("headingCandidates: a company or a job title is not a heading", () => {
  const got = headingCandidates(["EDUCATION", "Michigan Hackers", "Embedded Software Intern",
    "Academic Background", "Professional Experience", "Honors:", "Qualcomm"]).map((c) => c.text);
  assert.deepEqual(got, ["EDUCATION", "Academic Background", "Professional Experience", "Honors:"]);
});

test("creative headings still map by their section word", async () => {
  const { sectionByVocabulary } = await import("../lib/draft.js");
  assert.equal(sectionByVocabulary("Career Journey"), "experience");
  assert.equal(sectionByVocabulary("Academic Credentials"), "education");
  assert.equal(sectionByVocabulary("Michigan Hackers"), null);
});

test("splitPieces: never inside brackets, and prose stays whole", () => {
  assert.ok(splitPieces("Compilers, Operating Systems (C, Rust)").includes("Operating Systems (C, Rust)"));
  const prose = "In this role I taught Ruby to first-year undergraduates, which was confusing for everyone involved";
  assert.equal(splitPieces(prose).length, 1);
  assert.equal(splitPieces("Bachelor of Science, Computer Information Systems (CIS), Towson University, Towson, MD").length, 4);
});

test("Present and Now are dates only at the end of a range", () => {
  assert.deepEqual(splitPieces("Momentum Solutions (now Apex Systems)"), ["Momentum Solutions (now Apex Systems)"]);
  assert.deepEqual(parseDates("Aug 2024 – Present"), { start: "Aug 2024", end: "Present" });
  assert.deepEqual(splitPieces("Mar 2022 – Now, Remote"), ["Mar 2022 – Now", "Remote"]);
});

test("company suffixes stay with their company", () => {
  assert.deepEqual(splitPieces("Stripe, Inc., San Francisco, CA"), ["Stripe, Inc.", "San Francisco, CA"]);
  assert.deepEqual(splitPieces("MercadoApps S.A., Buenos Aires"), ["MercadoApps S.A.", "Buenos Aires"]);
});

test("Class of 2017 is one date", () => {
  assert.deepEqual(splitPieces("INSEAD, Class of 2017"), ["INSEAD", "Class of 2017"]);
  assert.deepEqual(parseDates("Class of 2017"), { start: "", end: "2017" });
});

test("assemble: a title holding a comma stays one title and one entry", () => {
  const roles = assemble([
    { text: "Global Dynamics Inc.", label: "company", index: 1 },
    { text: "Senior Director", label: "title", index: 2 },
    { text: "International Business Development", label: "title", index: 2 },
    { text: "Jan 2022 – Present", label: "dates", index: 3 },
  ], "experience");
  assert.equal(roles.length, 1);
  assert.equal(roles[0].title, "Senior Director, International Business Development");
});

test("headingCandidates: a heading starts with a capital", () => {
  assert.deepEqual(headingCandidates(["career.", "Career"]).map((c) => c.text), ["Career"]);
});

test("headingCandidates: look past a leading icon", () => {
  const got = headingCandidates(["[BRIEFCASE] Work History", "\u{1F4BC} Experience", "[GRADUATION] Education"]).map((c) => c.text);
  assert.equal(got.length, 3);
});

test("parseDates normalises the many spellings of a date", async () => {
  assert.deepEqual(parseDates("Feb \u201919 \u2013 Dec. 2020"), { start: "Feb 2019", end: "Dec 2020" });
  assert.deepEqual(parseDates("March \u2013 June 2019"), { start: "Mar 2019", end: "Jun 2019" });
  assert.deepEqual(parseDates("2013/09 \u2013 2015/08"), { start: "Sep 2013", end: "Aug 2015" });
  assert.deepEqual(parseDates("09.2013 - 08.2015"), { start: "Sep 2013", end: "Aug 2015" });
  assert.deepEqual(parseDates("2019 \u2013 present"), { start: "2019", end: "Present" });
  assert.deepEqual(parseDates("May 2026 \u2013 August 2026"), { start: "May 2026", end: "Aug 2026" });
});

test("splitPieces keeps the new date spellings whole", () => {
  assert.deepEqual(splitPieces("Acme, Feb \u201919 \u2013 Dec. 2020"), ["Acme", "Feb \u201919 \u2013 Dec. 2020"]);
  assert.deepEqual(splitPieces("Acme, March \u2013 June 2019"), ["Acme", "March \u2013 June 2019"]);
  assert.deepEqual(splitPieces("Acme, 2013/09 \u2013 2015/08"), ["Acme", "2013/09 \u2013 2015/08"]);
});
