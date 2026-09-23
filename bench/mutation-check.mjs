// Does each fix have a test that fails without it?
//
//   node bench/mutation-check.mjs [name-filter]
//
// For each entry below: undo one fix in extension/content.js, run the
// content tests that should guard it, and report CAUGHT (some test failed
// or hung) or MISSED (everything still passed -- the fix is unguarded).
// Each mutant is a temp copy the tests load via SMARTPASTE_CONTENT; the real
// content.js is only read. (Rewriting it in place once erased another
// session's commit that landed mid-run.)
//
// Add an entry whenever a live bug gets a fix and a test: the entry is the
// proof the test can see the bug. A MISSED entry means the fixture is kinder
// than the site (bytedance.html's menus once closed each other, which the
// real page never does, and hid the stale-menu bug).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "extension", "content.js");
const TESTS = "C3|ByteDance|Eightfold|Workable|year|consent box|search";

// [name, the fixed code, the code before the fix]
const MUTATIONS = [
  ["ownership label", "return ownerLabel(field) || clean(field.placeholder)", "return clean(field.placeholder)"],
  ["consent: the question around a lone box", "|| CONSENT.test(ownerLabel(box))) continue;", ") continue;"],
  ["consent: a bare 'I Accept'", "agree|accept|consent", "agree|consent"],
  ["page chrome (site search, cookie banner)",
    "const pageChrome = (element) => element.closest(PAGE_CHROME) !== null ||\n    SEARCH_ACTION.test(element.closest(\"form\")?.getAttribute(\"action\") || \"\");",
    "const pageChrome = () => false;"],
  ["'search' inside a word is not a search form", "const SEARCH_ACTION = /(?:^|[/?&=._-])search(?:$|[/?&=.#_-])/i;", "const SEARCH_ACTION = /search/i;"],
  ["a 'No options' tick before a search is not its answer",
    "if (settled !== null && Date.now() - settled >= NOTICE_HOLDS) return [];", "if (settled !== null) return [];"],
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
  ["a section-wide fieldset is not a write-in", "return [...box.querySelectorAll(FIELD_SELECTOR)].filter(nodeVisible).length <= 1;", "return true;"],
  ["a section's legend is no field's label", "if ([...box.querySelectorAll(FIELD_SELECTOR)].filter(nodeVisible).length > 1) return null;", ""],
  ["aria-labelledby outranks the legend", "      labelledBy(field),\n      questionText(field),", "      questionText(field),\n      labelledBy(field),"],
  ["label for= a group's container", "&&\n        !document.getElementById(node.htmlFor)?.contains(inputs[0]));", ");"],
  ["'If yes' follow-ups left empty", "&& !FOLLOW_UP.test(f.label))", ")"],
  ["a signature is asked as my full legal name", "? `${label} (type your full legal name)` : label;", "? label : label;"],
  ["'Save my answers' is a preference", "|save my (?:answers|information|details|profile)", ""],
  ["long menus shortlisted by shared words", "if (index < 0) index = await chooseAmong(labelFor(field), want, texts);", "if (index < 0) index = await askChoice(labelFor(field), want, texts.slice(0, MAX_MENU));"],
  ["a failed pick clears its search text", "      if (searched) nativeSet(field, \"\");\n", ""],
  ["a wrapping label is not its widget's text", "candidate : labelOnly(candidate, field));", "candidate : shownText(candidate));"],
  ["a required star before the question", "      .replace(/^\\s*[*\\u2731\\u2217]+\\s*/, \"\")\n", ""],
  ["Workable's Education / Experience group names its boxes", "      if (named) return `${named}: `;\n", ""],
  ["a box hidden from screen readers is the widget's",
    "    if (field.getAttribute(\"aria-hidden\") === \"true\") return false;\n", ""],
];

const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const original = readFileSync(SRC, "utf8");
const scratch = mkdtempSync(join(tmpdir(), "smartpaste-mutant-"));
const MUTANT = join(scratch, "content.js");
let missed = 0;
try {
  for (const [name, fixed, before] of MUTATIONS) {
    if (filter && !filter.test(name)) continue;
    if (!original.includes(fixed)) {
      console.log(`STALE   ${name} -- the fixed code is no longer there; update this entry`);
      missed++;
      continue;
    }
    writeFileSync(MUTANT, original.replace(fixed, before));
    const run = spawnSync("node", ["--test", `--test-name-pattern=${TESTS}`, "extension/test/content.test.mjs"],
      { cwd: root, encoding: "utf8", timeout: 240_000, env: { ...process.env, SMARTPASTE_CONTENT: MUTANT } });
    const failed = [...new Set([...(run.stdout || "").matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
    const hung = run.error?.code === "ETIMEDOUT";
    if (hung) spawnSync("pkill", ["-f", "smartpaste-chrome-"]);
    const caught = hung || failed.length > 0;
    if (!caught) missed++;
    console.log(`${caught ? "CAUGHT" : "MISSED"}  ${name}${hung ? " -> (hung)" : failed.length ? ` -> ${failed.map((f) => f.slice(0, 50)).join("; ")}` : ""}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(missed ? 1 : 0);
