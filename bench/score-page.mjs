// Score a form ANOTHER tool filled, by the rules bench/sweep.mjs scores ours.
//
//   node bench/score-page.mjs --snippet        print the snippet to paste
//   node bench/score-page.mjs <saved.json>     score what it saved
//
// The point is fairness: smartpaste's own numbers come from bench/readout.mjs
// driving a headless Chrome, and a rival's would otherwise come from counting
// by eye. The snippet below is that same readout, wrapped so it saves its
// result to a file. Run a tool on a page, let it finish, paste the snippet in
// the console, and score the file it downloads.
//
// It reads the page and writes a file. It clicks nothing and submits nothing.
import { readFileSync } from "node:fs";
import { READOUT } from "./readout.mjs";

// Fields nobody should be marked down for: the site's own search box, extras
// no profile holds. Kept identical to bench/sweep-report.mjs.
const IGNORE = /^(search|g-recaptcha|captcha)|cover letter|middle name|preferred (first )?name|pronoun|twitter|facebook|x \(fka/i;

if (process.argv.includes("--snippet")) {
  console.log(`(() => {
  const rows = ${READOUT};
  const out = { url: location.href, title: document.title, when: new Date().toISOString(), controls: rows };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
  a.download = "filled-" + location.hostname.replace(/[^a-z0-9]+/gi, "-") + ".json";
  a.click();
  return \`saved \${a.download}: \${rows.filter((r) => r.value).length}/\${rows.length} fields hold a value\`;
})()`);
  process.exit(0);
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node bench/score-page.mjs --snippet | node bench/score-page.mjs <saved.json>");
  process.exit(1);
}
const page = JSON.parse(readFileSync(file, "utf8"));
const name = (x) => x.pageLabel ?? x.label ?? "";
const real = (page.controls || []).filter((x) => name(x) && !IGNORE.test(name(x)));
const filled = real.filter((x) => x.value);
const requiredBlank = real.filter((x) => x.required && !x.value);

console.log(`${page.url}\n${page.title || ""}\n`);
console.log(`filled ${filled.length}/${real.length} (${real.length ? Math.round(100 * filled.length / real.length) : 0}%)  required blank ${requiredBlank.length}\n`);
console.log("BLANK:");
for (const x of real.filter((x) => !x.value)) console.log(`  ${x.required ? "*" : " "} ${name(x).slice(0, 80)}`);
console.log("\nFILLED (read these: a wrong answer scores as a success):");
for (const x of filled) console.log(`  ${x.required ? "*" : " "} ${name(x).slice(0, 60).padEnd(62)} => ${String(x.value).slice(0, 50)}`);
