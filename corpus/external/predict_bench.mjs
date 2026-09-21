// Run the Jev drafter on ResumeExtractBench and write predictions in the
// benchmark's own format, for its official grader:
//
//   node corpus/external/predict_bench.mjs
//   corpus/external/bench-venv/bin/resume-bench grade-file corpus/results/bench-predictions.jsonl
//
// Image-only resumes get an empty prediction: we have no text to read, and
// guessing would only add hallucinations to the score.
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const DATA = path.join(process.env.HOME, ".cache/resume-bench/dataset");
const OUT = path.join(ROOT, "corpus/results/bench-predictions.jsonl");

const key = fs.readFileSync(process.env.HOME + "/.config/smartpaste/env", "utf8").split("=")[1].trim();
const listeners = [];
globalThis.chrome = {
  storage: { local: { get: async () => ({ apiKey: key }) } },
  runtime: { onMessage: { addListener: (f) => listeners.push(f) }, getURL: (p) => p },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }, tabs: { query: async () => [] },
};
const pdfjs = await import(path.join(ROOT, "extension/vendor/pdf.mjs"));
pdfjs.GlobalWorkerOptions.workerSrc = path.join(ROOT, "extension/vendor/pdf.worker.mjs");
const { textFromPdfBytes } = await import(path.join(ROOT, "extension/lib/extract.js"));
await import(path.join(ROOT, "extension/background.js"));
const draft = (text) => new Promise((r) => listeners[0]({ type: "profile-from-resume", text }, {}, r));

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function date(text) {
  if (!text) return { month: null, year: null, current: false };
  if (/^present$/i.test(text)) return { month: null, year: null, current: true };
  const year = text.match(/(?:19|20)\d{2}/);
  const month = MONTHS.indexOf(text.slice(0, 3).toLowerCase());
  return { month: month >= 0 ? month + 1 : null, year: year ? Number(year[0]) : null, current: false };
}
const city = (location) => (location ? location.split(",")[0].trim() : null);
const empty = () => ({
  basics: { fname: "", lname: "", email: "", phone: "", city: "", state: "", country: "", hasPersonalPhoto: false },
  personalSummary: "", experience: [], education: [], projects: [], certifications: [], awards: [],
  volunteering: [], skills: [],
});

const rows = fs.readFileSync(path.join(DATA, "test.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const lines = [];
let withText = 0;
for (const row of rows) {
  const prediction = empty();
  const bytes = new Uint8Array(fs.readFileSync(path.join(DATA, row.files.pdf)));
  const text = await textFromPdfBytes(bytes, pdfjs).catch(() => "");
  if (text.split("\n").filter(Boolean).length >= 4) {
    withText++;
    const reply = await draft(text);
    if (reply.ok) {
      const f = reply.fields;
      Object.assign(prediction.basics, {
        fname: f.first_name || "", lname: f.last_name || "", email: f.email || "", phone: f.phone || "",
      });
      prediction.experience = reply.sections.experience.map((x, i) => {
        const start = date(x.start_date), end = date(x.end_date);
        return {
          company: x.company || "", position: x.title || "",
          startMonth: start.month, startYear: start.year,
          endMonth: end.month, endYear: end.year, currentlyWorkHere: end.current,
          city: city(x.location), country: null,
          description: reply.debug?.experienceBullets?.[i] || (x.description ? [x.description] : []),
        };
      });
      prediction.education = reply.sections.education.map((e) => {
        const start = date(e.start_date), end = date(e.end_date);
        return {
          institution: e.school || "", area: e.major || "", studyType: e.degree || "", score: e.gpa || null,
          startMonth: start.month, startYear: start.year, endMonth: end.month, endYear: end.year,
          currentlyStudyHere: end.current, city: city(e.location), country: null, description: [],
        };
      });
    }
  }
  lines.push(JSON.stringify({ resume_id: row.resume_id, prediction }));
  process.stdout.write(".");
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`\n${rows.length} predictions (${withText} with a text layer) -> ${path.relative(ROOT, OUT)}`);
