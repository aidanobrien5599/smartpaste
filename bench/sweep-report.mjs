// Summarise a sweep: per page, then every blank field grouped by widget kind.
//
// Every label here is `pageLabel` -- what bench/sweep.mjs could read off the
// page, NOT the question the extension asks Jev (its content script runs in
// an isolated world, out of reach). Use this to find which field is blank,
// then read the extension's own question live before calling it a bug.
//
//   node bench/sweep-report.mjs [bench/sweeps/<dir>] [--values]
//
// (default: the newest sweep). --values lists what was filled in, per page,
// instead of what was left blank: a blank is a miss the score already counts,
// but a WRONG answer scores as a success, so the only way to catch one is to
// read the values. ("Which city will you be working from?" -> "New York
// City", a yes/no question -> "May 2027".)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "sweeps");
const named = process.argv.slice(2).find((a) => !a.startsWith("--"));
const dir = named || join(root, readdirSync(root).sort().pop());
const pages = readdirSync(dir).filter((f) => /^\d+-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
// Sweeps written before the rename carry `label`; it meant the same thing.
const nameOf = (x) => x.pageLabel ?? x.label ?? "";
const ats = (host) => /greenhouse/.test(host) ? "greenhouse" : /ashbyhq/.test(host) ? "ashby" : /lever\.co/.test(host) ? "lever"
  : /workable/.test(host) ? "workable" : /rippling/.test(host) ? "rippling" : /icims/.test(host) ? "icims" : host;
// Fields nobody should fill: optional extras, the site's own search boxes.
const IGNORE = /^(search|g-recaptcha|captcha)|cover letter|middle name|preferred (first )?name|pronoun|twitter|facebook|x \(fka/i;

console.log(dir);
console.log("\nPAGE".padEnd(60), "status   filled/controls  req-blank  fill");
for (const p of pages.sort((a, b) => a.n - b.n)) {
  const c = (p.controls || []).filter((x) => nameOf(x) && !IGNORE.test(nameOf(x)));
  const filled = c.filter((x) => x.value).length;
  const reqBlank = c.filter((x) => x.required && !x.value).length;
  console.log(`${String(p.n).padStart(2)} ${ats(p.host).padEnd(10)} ${p.url.split("/")[3]?.slice(0, 40).padEnd(44)} ${p.status.padEnd(8)} ${String(filled).padStart(3)}/${String(c.length).padEnd(4)}        ${String(reqBlank).padStart(3)}      ${p.fillMs ? (p.fillMs / 1000).toFixed(1) + "s" : "-"} ${p.why || p.error || ""}`);
}

const byAts = {};
for (const p of pages) {
  const a = ats(p.host); byAts[a] ||= { pages: 0, filled: 0, controls: 0, reqBlank: 0, noPill: 0, gated: 0 };
  const s = byAts[a]; s.pages++;
  if (p.status === "no-pill") s.noPill++;
  if (p.status === "gated") s.gated++;
  const c = (p.controls || []).filter((x) => nameOf(x) && !IGNORE.test(nameOf(x)));
  s.controls += c.length; s.filled += c.filter((x) => x.value).length; s.reqBlank += c.filter((x) => x.required && !x.value).length;
}
console.log("\nBY SYSTEM");
for (const [a, s] of Object.entries(byAts)) {
  console.log(`  ${a.padEnd(12)} pages ${s.pages}  filled ${s.filled}/${s.controls} (${s.controls ? Math.round(100 * s.filled / s.controls) : 0}%)  required-blank ${s.reqBlank}  no-pill ${s.noPill}  gated ${s.gated}`);
}

console.log("\nBLANK FIELDS BY KIND (required first)");
const blanks = {};
for (const p of pages) for (const x of p.controls || []) {
  if (!nameOf(x) || x.value || IGNORE.test(nameOf(x))) continue;
  (blanks[x.kind] ||= []).push({ ...x, page: `${ats(p.host)}:${p.url.split("/")[3]}` });
}
for (const [kind, list] of Object.entries(blanks).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ${kind} (${list.length})`);
  for (const x of list.sort((a, b) => b.required - a.required).slice(0, 25)) {
    console.log(`    ${x.required ? "*" : " "} ${nameOf(x).slice(0, 80).padEnd(82)} ${x.page}${x.options ? ` [${x.options} options]` : ""}`);
  }
}

// --values: what went into each field, for judging answers rather than counts.
if (process.argv.includes("--values")) {
  console.log("\nFILLED VALUES BY PAGE");
  for (const p of pages.sort((a, b) => a.n - b.n)) {
    const filled = (p.controls || []).filter((x) => nameOf(x) && x.value && !IGNORE.test(nameOf(x)));
    if (!filled.length) continue;
    console.log(`\n  ${ats(p.host)}:${p.url.split("/")[3]} (${p.url})`);
    for (const x of filled) {
      console.log(`    ${x.required ? "*" : " "} ${nameOf(x).slice(0, 70).padEnd(72)} => ${String(x.value).slice(0, 60)}`);
    }
  }
}
