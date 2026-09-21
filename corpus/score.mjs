// Score the resume drafter against the corpus.
//
//   node corpus/score.mjs [label]
//
// Runs the extension's real code -- lib/extract.js for the PDF, then
// background.js's profileFromResume against the live Jev API -- on every PDF
// in corpus/pdf, and grades each field against corpus/truth. Formatting
// differences are not errors: 05/2025 = May 2025, August = Aug, straight vs
// curly apostrophes, phone numbers by digits.
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CORPUS = path.join(ROOT, "corpus");
const label = process.argv[2] || "run";
// Which answer keys to score: "synthetic" (corpus/truth), "bench"
// (ResumeExtractBench, downloaded locally), or "all".
const SET = process.env.SET || "all";
const TRUTH_DIRS = {
  synthetic: [path.join(CORPUS, "truth")],
  bench: [path.join(CORPUS, "external/resumeextractbench/truth")],
  career: [path.join(CORPUS, "external/career-centers/truth")],
};
TRUTH_DIRS.all = [...TRUTH_DIRS.synthetic, ...TRUTH_DIRS.career, ...TRUTH_DIRS.bench];

const key = fs.readFileSync(process.env.HOME + "/.config/smartpaste/env", "utf8").split("=")[1].trim();
const listeners = [];
globalThis.chrome = {
  storage: { local: { get: async () => ({ apiKey: key, profile: {}, extraText: "" }) } },
  runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, getURL: (p) => p },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  tabs: { query: async () => [] },
};
const pdfjs = await import(path.join(ROOT, "extension/vendor/pdf.mjs"));
pdfjs.GlobalWorkerOptions.workerSrc = path.join(ROOT, "extension/vendor/pdf.worker.mjs");
const { textFromPdfBytes } = await import(path.join(ROOT, "extension/lib/extract.js"));
await import(path.join(ROOT, "extension/background.js"));
// ENGINE=lines (the original search drafter) or segments (classification).
const ENGINE = process.env.ENGINE || "segments";
const draft = (text) =>
  new Promise((r) => listeners[0]({ type: "profile-from-resume", text, engine: ENGINE }, {}, r));

// ------------------------------------------------------------ normalisation
const MONTHS = { january: "jan", february: "feb", march: "mar", april: "apr", june: "jun", july: "jul",
  august: "aug", september: "sep", sept: "sep", october: "oct", november: "nov", december: "dec" };
const NUM_MONTH = ["", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function norm(value, field = "") {
  let s = String(value ?? "").normalize("NFKC").toLowerCase()
    .replace(/[‘’ʼ]/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (/phone/.test(field)) return s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (/linkedin|github|portfolio/.test(field)) return s.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  if (/date/.test(field)) {
    s = s.replace(/^expected\s+/, "");
    s = s.replace(/\b(\d{1,2})\/(\d{4})\b/, (_, m, y) => `${NUM_MONTH[+m]} ${y}`);
    s = s.replace(/\b[a-z]+\b/g, (w) => MONTHS[w] || w);
  }
  return s.replace(/[.,;:]+$/, "").trim();
}
// A location answer of "San Francisco" is right for "San Francisco, CA".
const correct = (got, accept, field) =>
  accept.length
    ? accept.some((a) => {
        const want = norm(a, field), have = norm(got, field);
        if (want === have || (/location/.test(field) && have.startsWith(want + ","))) return true;
        // A key holding only a year is matched by a more specific date in
        // that year: "Summer 2015" for "2015".
        return /date/.test(field) && /^\d{4}$/.test(want) && new RegExp(`\\b${want}$`).test(have);
      })
    : null;

function bulletRecall(description, bullets) {
  const d = norm(description);
  if (!bullets.length) return null;
  return bullets.filter((b) => d.includes(norm(b).slice(0, 36))).length / bullets.length;
}

// ------------------------------------------------------------------ score
const FLAT = ["full_name", "first_name", "last_name", "email", "phone", "linkedin", "github"];
const EDU = ["school", "degree", "major", "gpa", "start_date", "end_date"];
const EXP = ["company", "title", "location", "start_date", "end_date"];

const tally = {}; // "section.field" -> [right, total]
const add = (k, ok) => { if (ok === null) return; (tally[k] ||= [0, 0]); tally[k][1]++; if (ok) tally[k][0]++; };
const misses = [];
const perResume = [];

const truthFiles = TRUTH_DIRS[SET].filter((d) => fs.existsSync(d))
  .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(d, f)));
for (const file of truthFiles) {
  const truth = JSON.parse(fs.readFileSync(file, "utf8"));
  const pdfPath = truth.file.includes("/") ? path.join(CORPUS, truth.file) : path.join(CORPUS, "pdf", truth.file);
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const t0 = Date.now();
  let text = "", reply;
  try {
    text = await textFromPdfBytes(bytes, pdfjs);
    reply = await draft(text);
  } catch (error) {
    reply = { ok: false, error: error.message };
  }
  const got = reply.ok ? reply : { fields: {}, sections: {} };
  let right = 0, total = 0;
  const mark = (k, ok, g, want) => {
    add(k, ok);
    if (ok === null) return;
    total++; if (ok) right++;
    else misses.push({ resume: truth.file, field: k, got: g ?? "—", want: want[0] });
  };

  for (const f of FLAT) mark(`contact.${f}`, correct(got.fields[f], truth.fields[f], f), got.fields[f], truth.fields[f]);
  truth.education.forEach((want, i) => {
    const e = (got.sections.education || [])[i] || {};
    for (const f of EDU) mark(`education.${f}`, correct(e[f], want[f] || [], f), e[f], want[f] || []);
  });
  let recallSum = 0, roles = 0;
  truth.experience.forEach((want, i) => {
    const x = (got.sections.experience || [])[i] || {};
    for (const f of EXP) mark(`experience.${f}`, correct(x[f], want[f], f), x[f], want[f]);
    const r = bulletRecall(x.description || "", want.bullets);
    if (r !== null) { recallSum += r; roles++; add("experience.description", r === 1); }
  });
  perResume.push({ file: truth.file, layout: truth.layout, right, total,
    recall: roles ? recallSum / roles : null, seconds: (Date.now() - t0) / 1000,
    lines: text.split("\n").filter(Boolean).length, error: reply.ok ? null : reply.error });
  const p = perResume.at(-1);
  console.log(`${(100 * right / Math.max(total, 1)).toFixed(0).padStart(3)}%  ${String(right).padStart(2)}/${String(total).padEnd(2)}` +
    `  bullets ${p.recall === null ? "  - " : (100 * p.recall).toFixed(0).padStart(3) + "%"}  ${p.lines.toString().padStart(3)} lines` +
    `  ${path.basename(truth.file).slice(0, 58)}${p.error ? "   !! " + p.error.slice(0, 40) : ""}`);
}

const withText = perResume.filter((p) => p.lines >= 4);
const imageOnly = perResume.filter((p) => p.lines < 4);
const sum = (rows) => rows.reduce((acc, p) => [acc[0] + p.right, acc[1] + p.total], [0, 0]);
const pct = ([a, b]) => `${(100 * a / b).toFixed(0).padStart(3)}%  (${a}/${b})`;
console.log("\nBY FIELD");
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k.padEnd(26)} ${pct(v)}`);
const all = Object.entries(tally).filter(([k]) => k !== "experience.description")
  .reduce((acc, [, [a, b]]) => [acc[0] + a, acc[1] + b], [0, 0]);
const recalls = perResume.filter((p) => p.recall !== null);
console.log(`\nTEXT LAYER   ${withText.length} resumes  fields ${pct(sum(withText))}`);
console.log(`IMAGE ONLY   ${imageOnly.length} resumes  fields ${pct(sum(imageOnly))}  (nothing to read without OCR)`);
console.log(`\nOVERALL fields ${pct(all)}   mean bullet recall ${(100 * recalls.reduce((s, p) => s + p.recall, 0) / recalls.length).toFixed(0)}%`);

fs.mkdirSync(path.join(CORPUS, "results"), { recursive: true });
const out = path.join(CORPUS, "results", `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${label}.json`);
fs.writeFileSync(out, JSON.stringify({ label, tally, perResume, misses }, null, 1));
console.log(`\nsaved ${path.relative(ROOT, out)}  (${misses.length} misses listed there)`);
