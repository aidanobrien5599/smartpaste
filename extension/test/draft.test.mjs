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
  assert.deepEqual(parseDates("May 2026 – August 2026"), { start: "May 2026", end: "August 2026" });
  assert.deepEqual(parseDates("05/2025 - 08/2025"), { start: "05/2025", end: "08/2025" });
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
