// Does each fix have a test that fails without it?
//
//   node bench/mutation-check.mjs [name-filter]
//
// For each entry below: undo one fix in extension/content.js, run the
// content tests that should guard it, and report CAUGHT (some test failed
// or hung) or MISSED (everything still passed -- the fix is unguarded).
// content.js is restored afterwards, whatever happens.
//
// Add an entry whenever a live bug gets a fix and a test: the entry is the
// proof the test can see the bug. A MISSED entry means the fixture is kinder
// than the site (bytedance.html's menus once closed each other, which the
// real page never does, and hid the stale-menu bug).
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "extension", "content.js");
const TESTS = "C3|ByteDance|year|consent box";

// [name, the fixed code, the code before the fix]
const MUTATIONS = [
  ["ownership label", "return ownerLabel(field) || clean(field.placeholder)", "return clean(field.placeholder)"],
  ["consent: the question around a lone box", "|| CONSENT.test(ownerLabel(box))) continue;", ") continue;"],
  ["consent: a bare 'I Accept'", "agree|accept|consent", "agree|consent"],
  ["page chrome (site search, cookie banner)", "const pageChrome = (element) => element.closest(PAGE_CHROME) !== null;", "const pageChrome = () => false;"],
  ["month dropdown + Year box", "const hasYear = (node) => node.querySelector(YEAR_BOX) ||", "const hasYear = (node) =>"],
  ["smallest date wrapper", "if (onlyDate(byId)) return byId;", "if (byId && hasYear(byId)) return byId;"],
  ["read-only combobox is a dropdown", "(field.readOnly && !isCombobox(field))", "field.readOnly"],
  ["ByteDance menu is the whole list", '.map((n) => n.closest(".ud__select__list") || n.parentElement))];', ".map((n) => n.parentElement))];"],
  // Three defences, any one enough on its own: undo all of them.
  ["stale menus (close before, skip stale, close after)",
    "      await closeUdMenus();\n      staleMenus.set(field, new Set(udLists()));\n      try { return await pickCombobox(field, want); } finally { await closeUdMenus(); }",
    "      return pickCombobox(field, want);"],
  ["a lone option counts only after a search", "texts.length === 1 && searched) index = 0;", "texts.length === 1) index = 0;"],
  ["tree: leaves named by path", "if (!tree.length) return", "if (true) return"],
  ["calendar picker takes YYYY-MM", "if (picker && parts?.month)", "if (false)"],
  ["year-only box gets the year", "if (onlyYear && parts && !shape) return parts.year;", ""],
  ["bare 'Mobile' is the number", "? `${label} phone number` : label;", "? label : label;"],
  ["resume dropzone text", "input.closest(\"[class*='upload' i]\")?.textContent?.slice(0, 140) || \"\"]", "\"\"]"],
  ["bare Add found by section title", "if (section && !found.some((f) => f.root === section.root)) found.push({ ...section, prefix: \"\", button });", ""],
  ["roles split intern / work", "(p.experience || []).filter((role) => !split || !isIntern(role))", "(p.experience || [])"],
  ["card label names its entry", 'return `${titled.name} ${n}${subject ? ` (${subject})` : ""}: `;', "return `${titled.name} ${n}: `;"],
];

const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const original = readFileSync(SRC, "utf8");
let missed = 0;
try {
  for (const [name, fixed, before] of MUTATIONS) {
    if (filter && !filter.test(name)) continue;
    if (!original.includes(fixed)) {
      console.log(`STALE   ${name} -- the fixed code is no longer there; update this entry`);
      missed++;
      continue;
    }
    writeFileSync(SRC, original.replace(fixed, before));
    const run = spawnSync("node", ["--test", `--test-name-pattern=${TESTS}`, "extension/test/content.test.mjs"],
      { cwd: root, encoding: "utf8", timeout: 240_000 });
    const failed = [...new Set([...(run.stdout || "").matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
    const hung = run.error?.code === "ETIMEDOUT";
    if (hung) spawnSync("pkill", ["-f", "smartpaste-chrome-"]);
    const caught = hung || failed.length > 0;
    if (!caught) missed++;
    console.log(`${caught ? "CAUGHT" : "MISSED"}  ${name}${hung ? " -> (hung)" : failed.length ? ` -> ${failed.map((f) => f.slice(0, 50)).join("; ")}` : ""}`);
  }
} finally {
  writeFileSync(SRC, original);
}
process.exit(missed ? 1 : 0);
