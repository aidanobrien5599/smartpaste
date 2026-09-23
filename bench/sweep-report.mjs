// Summarise a sweep: per page, then every blank field grouped by widget kind.
//
//   node bench/sweep-report.mjs [bench/sweeps/<dir>]   (default: the newest)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "sweeps");
const dir = process.argv[2] || join(root, readdirSync(root).sort().pop());
const pages = readdirSync(dir).filter((f) => /^\d+-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
const ats = (host) => /greenhouse/.test(host) ? "greenhouse" : /ashbyhq/.test(host) ? "ashby" : /lever\.co/.test(host) ? "lever"
  : /workable/.test(host) ? "workable" : /rippling/.test(host) ? "rippling" : /icims/.test(host) ? "icims" : host;
// Fields nobody should fill: optional extras, the site's own search boxes.
const IGNORE = /^(search|g-recaptcha|captcha)|cover letter|middle name|preferred (first )?name|pronoun|twitter|facebook|x \(fka/i;

console.log(dir);
console.log("\nPAGE".padEnd(60), "status   filled/controls  req-blank  fill-s");
for (const p of pages.sort((a, b) => a.n - b.n)) {
  const c = (p.controls || []).filter((x) => x.label && !IGNORE.test(x.label));
  const filled = c.filter((x) => x.value).length;
  const reqBlank = c.filter((x) => x.required && !x.value).length;
  console.log(`${String(p.n).padStart(2)} ${ats(p.host).padEnd(10)} ${p.url.split("/")[3]?.slice(0, 40).padEnd(44)} ${p.status.padEnd(8)} ${String(filled).padStart(3)}/${String(c.length).padEnd(4)}        ${String(reqBlank).padStart(3)}      ${p.fillSeconds ?? "-"} ${p.why || p.error || ""}`);
}

const byAts = {};
for (const p of pages) {
  const a = ats(p.host); byAts[a] ||= { pages: 0, filled: 0, controls: 0, reqBlank: 0, noPill: 0, gated: 0 };
  const s = byAts[a]; s.pages++;
  if (p.status === "no-pill") s.noPill++;
  if (p.status === "gated") s.gated++;
  const c = (p.controls || []).filter((x) => x.label && !IGNORE.test(x.label));
  s.controls += c.length; s.filled += c.filter((x) => x.value).length; s.reqBlank += c.filter((x) => x.required && !x.value).length;
}
console.log("\nBY SYSTEM");
for (const [a, s] of Object.entries(byAts)) {
  console.log(`  ${a.padEnd(12)} pages ${s.pages}  filled ${s.filled}/${s.controls} (${s.controls ? Math.round(100 * s.filled / s.controls) : 0}%)  required-blank ${s.reqBlank}  no-pill ${s.noPill}  gated ${s.gated}`);
}

console.log("\nBLANK FIELDS BY KIND (required first)");
const blanks = {};
for (const p of pages) for (const x of p.controls || []) {
  if (!x.label || x.value || IGNORE.test(x.label)) continue;
  (blanks[x.kind] ||= []).push({ ...x, page: `${ats(p.host)}:${p.url.split("/")[3]}` });
}
for (const [kind, list] of Object.entries(blanks).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ${kind} (${list.length})`);
  for (const x of list.sort((a, b) => b.required - a.required).slice(0, 25)) {
    console.log(`    ${x.required ? "*" : " "} ${x.label.slice(0, 80).padEnd(82)} ${x.page}${x.options ? ` [${x.options} options]` : ""}`);
  }
}
