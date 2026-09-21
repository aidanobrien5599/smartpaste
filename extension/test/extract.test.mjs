// linesFromItems against pdf.js-shaped fragments taken from a real resume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linesFromItems } from "../lib/extract.js";

const item = (str, x, y, width, height = 10, fontName = "text") =>
  ({ str, transform: [1, 0, 0, 1, x, y], width, height, fontName });
const icons = (i) => i.fontName === "icon";

test("a wide gap on one baseline is a column break", () => {
  const lines = linesFromItems([
    item("University of Wisconsin - Madison", 46.8, 700.8, 171.7),
    item(" ", 218.5, 700.8, 250.2, 0),
    item("Sep 2023 - May 2027", 468.7, 700.8, 101.9),
  ]);
  assert.deepEqual(lines, ["University of Wisconsin - Madison", "Sep 2023 - May 2027"]);
});

test("icon glyphs are dropped by font, and do not split their row", () => {
  const lines = linesFromItems([
    item("Ó", 112.3, 740.3, 7.8, 10, "icon"),
    item(" ", 120.1, 740.3, 3, 0),
    item("908-216-0389", 123.1, 740.3, 61.7),
    item(" ", 184.9, 740.3, 2.8, 0),
    item("|", 187.7, 740.3, 2.8),
    item(" ", 190.4, 740.3, 2.8, 0),
    item("R", 193.2, 740.3, 10, 10, "icon"),
    item(" ", 203.2, 740.3, 3.1, 0),
    item("aidan@x.com", 206.2, 740.3, 128.8),
  ], icons);
  assert.deepEqual(lines, ["908-216-0389 | aidan@x.com"]);
});

test("a small-caps heading stays one line", () => {
  const lines = linesFromItems([
    item("A", 218.3, 756.5, 16.1, 24.8),
    item("IDAN", 235.7, 756.5, 51.9, 19.8),
    item(" ", 287.6, 756.5, 8.5, 0),
    item("O’B", 296.1, 756.5, 43, 24.8),
    item("RIEN", 340.3, 756.5, 50.3, 19.8),
  ]);
  assert.deepEqual(lines, ["AIDAN O’BRIEN"]);
});

test("a dropped space is restored from the gap", () => {
  const lines = linesFromItems([item("Drove", 50, 600, 30), item("$15M", 83, 600, 25)]);
  assert.deepEqual(lines, ["Drove $15M"]);
});

test("LaTeX T1 control codes become the characters they encode", () => {
  const lines = linesFromItems([
    item("Aug 2022 \u0015 May 2026", 50, 600, 90),
    item("\u0088", 50, 580, 5), item("Built a \u001daky-test bot o\u001fine", 60, 580, 150),
  ]);
  assert.deepEqual(lines, ["Aug 2022 – May 2026", "• Built a flaky-test bot offline"]);
});

test("a sidebar is read column by column, not woven together", () => {
  const rows = [
    ["+1 416 555 0199", 55, 700, "EXPERIENCE", 315], ["EDUCATION", 55, 680, "Wealthsimple", 315],
    ["University of Toronto", 55, 665, "Jan 2025 – Apr 2025", 315], ["Sep 2021 – Apr 2026", 55, 650, "Rewrote the tax job in Rust", 315],
    ["SKILLS", 55, 620, "Shopify", 315],
    ["Ruby, Rust, React", 55, 605, "May 2024 \u2013 Dec 2024", 315],
    ["GraphQL, MySQL", 55, 590, "Shipped bulk editing to merchants", 315],
    ["Toronto, ON", 55, 575, "Fixed an N+1 query in the admin", 315],
  ];
  const items = rows.flatMap(([l, lx, y, r, rx]) => [item(l, lx, y, l.length * 5), item(r, rx, y, r.length * 5)]);
  const lines = linesFromItems(items);
  // Every left-column line comes before the right column begins.
  const start = lines.indexOf("EXPERIENCE");
  assert.ok(start > 0);
  for (const l of ["+1 416 555 0199", "EDUCATION", "University of Toronto", "SKILLS", "Toronto, ON"]) {
    assert.ok(lines.indexOf(l) < start, `${l} should precede the right column`);
  }
});

test("right-aligned dates are not mistaken for a column", () => {
  const items = [0, 1, 2, 3, 4].flatMap((i) => {
    const date = ["May 2026 – Aug 2026", "Dec 2025 – May 2026", "Jun 2025 – Aug 2025", "Sep 2023 – May 2027", "Jan 2024 – Jul 2024"][i];
    const w = date.length * 5;
    return [item(`Role ${i}`, 50, 700 - i * 20, 60), item(date, 560 - w, 700 - i * 20, w)];
  });
  const lines = linesFromItems(items);
  assert.equal(lines[0], "Role 0");
  assert.match(lines[1], /2026/); // the date stays beside its own role
});

test("a wrapped bullet joins by position; the next entry at the margin does not", () => {
  const lines = linesFromItems([
    item("\u2022 Related coursework: Software Project Management, Systems Analysis and Design,", 72, 600, 380),
    item("Skills in Network Security, Advanced Operations Management", 84, 588, 300),
    item("Bachelor of Science, Computer Information Systems (CIS), Towson University, Towson, MD", 54, 572, 420),
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Design, Skills in Network Security/);
  assert.match(lines[1], /^Bachelor of Science/);
});

test("a Kysely-style capitalised continuation under a bullet still joins", () => {
  const lines = linesFromItems([
    item("\u2022 Designed a PostgreSQL database through a Hono/Bun +", 50, 500, 400),
    item("Kysely API, with typo-tolerant fuzzy search.", 60, 488, 300),
  ]);
  assert.equal(lines.length, 1);
});

test("an email under a phone number is its own line", () => {
  const lines = linesFromItems([item("+1 416 555 0199", 40, 710, 80), item("d.okafor@example.com", 40, 697, 110)]);
  assert.deepEqual(lines, ["+1 416 555 0199", "d.okafor@example.com"]);
});

test("page numbers are dropped, years are not", () => {
  const lines = linesFromItems([item("SAP SE", 50, 700, 40), item("1", 300, 40, 5),
    item("Page 2 of 2", 280, 30, 50), item("2014", 50, 600, 25)]);
  assert.deepEqual(lines, ["SAP SE", "2014"]);
});

test("a word hyphenated across the line break is rejoined", () => {
  const lines = linesFromItems([item("Stanford Graduate School of Busi-", 50, 500, 180), item("ness", 50, 488, 20)]);
  assert.deepEqual(lines, ["Stanford Graduate School of Business"]);
});

test("page furniture: footers everywhere, running headers after page 1", async () => {
  const { inBody } = await import("../lib/extract.js");
  const at = (y) => ({ transform: [1, 0, 0, 1, 50, y] });
  assert.equal(inBody(at(20), 792, 1), false);   // footer
  assert.equal(inBody(at(760), 792, 1), true);   // page 1 top: the name
  assert.equal(inBody(at(760), 792, 2), false);  // page 2 running header
  assert.equal(inBody(at(400), 792, 2), true);
});

test("a line ending on a dangling word runs on, even into a capital", () => {
  const lines = linesFromItems([item("Note: Employed by Sony LLC; seconded to", 50, 500, 200),
    item("Tokyo HQ for the liaison role.", 50, 488, 150)]);
  assert.equal(lines.length, 1);
});
