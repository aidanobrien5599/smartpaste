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
