// Put two runs side by side: ours (bench/sweep.mjs) and a rival's
// (bench/rival.mjs). Both were read by bench/readout.mjs, so the only
// difference between the columns is the tool.
//
//   node bench/compare.mjs bench/sweeps/<ours> bench/sweeps/<theirs>
//   node bench/compare.mjs <ours> <theirs> --fields     every field, both tools
//
// Read it with two cautions. Each tool fills from ITS OWN stored profile, so
// a different email or city is a difference in their data, not an error. And
// a filled field is not a right one -- --fields prints both tools' values so
// a wrong answer can be seen, which no count will show you.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Also: Workable's address autocomplete writes city / postcode / country
// into 1px aria-hidden boxes of its own. The readout leaves those out now,
// but runs recorded before it did still carry them, so they are ignored
// here too -- otherwise two runs scored either side of that change are not
// comparable.
const IGNORE = /^(search|g-recaptcha|captcha|city$|postcode$|country$)|cover letter|middle name|preferred (first )?name|pronoun|twitter|facebook|x \(fka/i;
const nameOf = (x) => x.pageLabel ?? x.label ?? "";
const ats = (host) => /greenhouse/.test(host) ? "greenhouse" : /ashbyhq/.test(host) ? "ashby" : /lever\.co/.test(host) ? "lever"
  : /workable/.test(host) ? "workable" : /rippling/.test(host) ? "rippling" : /icims/.test(host) ? "icims" : host;

function load(dir) {
  const pages = readdirSync(dir).filter((f) => /^\d+-.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const byUrl = new Map();
  for (const p of pages) {
    const fields = (p.controls || []).filter((x) => nameOf(x) && !IGNORE.test(nameOf(x)));
    byUrl.set(p.url.split("?")[0], {
      status: p.status, fields,
      filled: fields.filter((x) => x.value).length,
      required: fields.filter((x) => x.required).length,
      reqBlank: fields.filter((x) => x.required && !x.value).length,
      ms: p.fillMs ?? null,
      host: p.host, url: p.url,
    });
  }
  return byUrl;
}

const [oursDir, theirsDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!oursDir || !theirsDir) {
  console.error("usage: node bench/compare.mjs <ours-sweep-dir> <rival-sweep-dir> [--fields]");
  process.exit(1);
}
const ours = load(oursDir);
const theirs = load(theirsDir);
const shared = [...ours.keys()].filter((u) => theirs.has(u));

console.log(`ours:   ${oursDir}\ntheirs: ${theirsDir}\nforms both ran: ${shared.length}\n`);
console.log("PAGE".padEnd(46) + "   ours      theirs    ours-s  theirs-s");
const totals = { ours: { f: 0, n: 0, rb: 0, ms: [] }, theirs: { f: 0, n: 0, rb: 0, ms: [] } };
const bySystem = {};
for (const url of shared) {
  const a = ours.get(url), b = theirs.get(url);
  const name = `${ats(a.host)}:${url.split("/")[3] || ""}`.slice(0, 44);
  console.log(`${name.padEnd(46)} ${String(a.filled).padStart(3)}/${String(a.fields.length).padEnd(4)} ${String(b.filled).padStart(3)}/${String(b.fields.length).padEnd(4)}` +
    `  ${(a.ms ? (a.ms / 1000).toFixed(1) : "-").padStart(6)}  ${(b.ms ? (b.ms / 1000).toFixed(1) : "-").padStart(7)}`);
  for (const [side, run] of [["ours", a], ["theirs", b]]) {
    totals[side].f += run.filled; totals[side].n += run.fields.length; totals[side].rb += run.reqBlank;
    if (run.ms) totals[side].ms.push(run.ms / 1000);
  }
  const key = ats(a.host);
  bySystem[key] ||= { ours: [0, 0], theirs: [0, 0] };
  bySystem[key].ours[0] += a.filled; bySystem[key].ours[1] += a.fields.length;
  bySystem[key].theirs[0] += b.filled; bySystem[key].theirs[1] += b.fields.length;
}

const median = (xs) => xs.length ? [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] : 0;
const pct = (f, n) => n ? `${Math.round(100 * f / n)}%` : "-";
console.log("\nBY SYSTEM           ours        theirs");
for (const [key, s] of Object.entries(bySystem)) {
  console.log(`  ${key.padEnd(14)} ${pct(...s.ours).padStart(5)} (${s.ours[0]}/${s.ours[1]})   ${pct(...s.theirs).padStart(5)} (${s.theirs[0]}/${s.theirs[1]})`);
}
console.log(`\nOVERALL   ours ${pct(totals.ours.f, totals.ours.n)} (${totals.ours.f}/${totals.ours.n}), required blank ${totals.ours.rb}, median ${median(totals.ours.ms).toFixed(1)}s`);
console.log(`        theirs ${pct(totals.theirs.f, totals.theirs.n)} (${totals.theirs.f}/${totals.theirs.n}), required blank ${totals.theirs.rb}, median ${median(totals.theirs.ms).toFixed(1)}s`);

if (process.argv.includes("--fields")) {
  console.log("\nFIELD BY FIELD (a filled field is not a right one -- read the values)");
  for (const url of shared) {
    const a = ours.get(url), b = theirs.get(url);
    const theirsByLabel = new Map(b.fields.map((x) => [nameOf(x), x]));
    console.log(`\n  ${url}`);
    for (const x of a.fields) {
      const mine = x.value || "";
      const yours = theirsByLabel.get(nameOf(x))?.value || "";
      if (!mine && !yours) continue;
      const mark = mine && yours ? "both" : mine ? "OURS" : "THEIRS";
      console.log(`    ${x.required ? "*" : " "} ${mark.padEnd(6)} ${nameOf(x).slice(0, 44).padEnd(46)} ours: ${mine.slice(0, 28).padEnd(30)} theirs: ${yours.slice(0, 28)}`);
    }
  }
}
