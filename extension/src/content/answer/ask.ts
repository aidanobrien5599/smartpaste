/**
 * Asking the background worker (and through it, Jev) for answers: the one
 * batched "answer-fields" call a scan makes for every field on the page, and
 * the per-menu "choose-option" call that picks which of a dropdown's own
 * wordings expresses an answer -- after the local matches that need no model.
 *
 * Depends on: shared/messages.ts (send), shared/types.ts, state.ts (answers,
 * asked), dom/text.ts (normalize), ui/marks.ts (mark), ui/note.ts (note).
 *
 * ATS quirks: Workday lists several spellings of one degree at once ("BSc
 * (Hons)", "B.S.", "Bachelor's Degree"), which split Jev's probability, so
 * degrees are matched locally (DEGREE_ALIASES). Greenhouse's location search
 * lists "Madison, Wisconsin, United States" twice, so askChoice asks about
 * each wording once. A country list runs to ~250 options, so a long menu is
 * cut to the options sharing a word with the answer (MAX_MENU).
 */
import { send } from "../../shared/messages.ts";
import type { Field, KnownField } from "../../shared/types.ts";
import { answers, asked } from "../state.ts";
import { normalize } from "../dom/text.ts";
import { mark } from "../ui/marks.ts";
import { note } from "../ui/note.ts";

/** Ask for answers to `fields`; returns those with one, or null on error. */
export async function answer(fields: Field[]): Promise<KnownField[] | null> {
  const reply = await send({
    type: "answer-fields",
    fields: fields.map((f) => ({ label: f.label, options: f.options, multi: Boolean(f.multi) })),
    // Which employer "have you worked for us?" means.
    // ...and which company and role {company} / {role} mean.
    page: { url: location.href, title: document.title,
      heading: document.querySelector("h1, h2")?.textContent!.replace(/\s+/g, " ").trim().slice(0, 120) || "" },
  });
  if (!reply || !reply.ok) {
    if (reply && reply.error) note(reply.error, true);
    return null;
  }
  fields.forEach((f) => asked.add(f.element));
  reply.results.forEach((result, i) => {
    if (result.status !== "none") {
      answers.set(fields[i].element, result);
      mark(fields[i].element, result);
    }
  });
  return fields
    .map((f, i) => ({ ...f, result: reply.results[i] }))
    .filter((f) => f.result && f.result.status !== "none");
}

// A Choice takes 255 options; a long menu still fits with room to spare.
export const MAX_MENU = 150;

/**
 * Which of `texts` is `want`: exact first, then Jev. A long list is cut to
 * the options sharing a word with the answer, since "United States" has to
 * find "United States of America" in 250 countries and a Choice takes 255.
 */
/**
 * An option that is plainly the answer, with no model needed: the same
 * text, or the only option that starts with the answer as whole words
 * ("Other" -> "Other Source", but not "Job Board Other"; "Yes" -> "Yes,
 * I am authorized"). Simplify's Workday rules use the same two tiers.
 */
// A degree has many spellings, and a Workday list holds several at once
// ("BSc (Hons)", "B.S.", "Bachelor's Degree"...). Asked to pick among them,
// Jev's probability splits across the near-equivalents and none clears
// the bar, so a degree is matched here: its spellings, most specific first.
const DEGREE_ALIASES: [RegExp, string[]][] = [
  [/^b(achelor'?s?)?\.?\s*(of\s*)?s(cience)?\.?$|^b\.?\s?sc?\.?$/i, ["Bachelor of Science", "BS", "B.S.", "BSc", "B.Sc", "B.Sc.", "Bachelors of Science", "Bachelor's of Science", "Bachelor of Science (BS)", "Bachelor's Degree", "Bachelors Degree", "Bachelor's", "Bachelors"]],
  [/^b(achelor'?s?)?\.?\s*(of\s*)?a(rts)?\.?$/i, ["Bachelor of Arts", "BA", "B.A.", "Bachelors of Arts", "Bachelor's of Arts", "Bachelor of Arts (BA)", "Bachelor's Degree", "Bachelors Degree", "Bachelor's", "Bachelors"]],
  [/^b(achelor'?s?)?\.?\s*(of\s*)?e(ng(ineering)?)?\.?$/i, ["Bachelor of Engineering", "BE", "B.E.", "BEng", "B.Eng", "B.Eng.", "Bachelor's Degree", "Bachelors Degree"]],
  [/^m(aster'?s?)?\.?\s*(of\s*)?s(cience)?\.?$|^m\.?\s?sc?\.?$/i, ["Master of Science", "MS", "M.S.", "MSc", "M.Sc", "M.Sc.", "Masters of Science", "Master's of Science", "Master's Degree", "Masters Degree", "Master's", "Masters"]],
  [/^m(aster'?s?)?\.?\s*(of\s*)?a(rts)?\.?$/i, ["Master of Arts", "MA", "M.A.", "Master's Degree", "Masters Degree"]],
  [/^(ph\.?\s?d\.?|doctor(ate)?( of philosophy)?)$/i, ["PhD", "Ph.D.", "Ph.D", "Doctor of Philosophy", "Doctorate", "Doctoral Degree"]],
  [/^(mba|master of business administration)$/i, ["MBA", "M.B.A.", "Master of Business Administration", "Master's Degree"]],
];

export function degreeMatch(texts: string[], want: string): number {
  const row = DEGREE_ALIASES.find(([test]) => test.test(String(want).trim()));
  if (!row) return -1;
  for (const alias of row[1]) {
    const i = texts.findIndex((t) => normalize(t) === normalize(alias));
    if (i >= 0) return i;
  }
  return -1;
}

export function localMatch(texts: string[], want: string): number {
  const exact = texts.findIndex((t) => normalize(t) === normalize(want));
  if (exact >= 0) return exact;
  const degree = degreeMatch(texts, want);
  if (degree >= 0) return degree;
  const head = want.trim().toLowerCase();
  if (head.length < 2) return -1;
  const starts = texts
    .map((t, i): [string, number] => [t.trim().toLowerCase(), i])
    .filter(([t]) => t.startsWith(head) && /^[^a-z0-9]/.test(t.slice(head.length)));
  return starts.length === 1 ? starts[0][1] : -1;
}

export async function chooseAmong(label: string, want: string, texts: string[]): Promise<number> {
  const local = localMatch(texts, want);
  if (local >= 0) return local;
  let pool = texts.map((t, i) => i);
  if (pool.length > MAX_MENU) {
    const words = (want.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
    const shared = pool.filter((i) => words.some((w) => texts[i].toLowerCase().includes(w)));
    pool = (shared.length ? shared : pool).slice(0, MAX_MENU);
  }
  const picked = await askChoice(label, want, pool.map((i) => texts[i]));
  return picked >= 0 ? pool[picked] : -1;
}

/**
 * Ask Jev which of `texts` expresses `want`, giving each wording once.
 *
 * Menus repeat themselves: Greenhouse's location search lists "Madison,
 * Wisconsin, United States" twice (two places share the name). Asked about
 * both copies, Jev splits its probability between them (0.36 live), neither
 * clears the bar, and the field is left empty. Either copy is the answer,
 * so ask about the wording and click its first occurrence.
 */
export async function askChoice(label: string, want: string, texts: string[]): Promise<number> {
  const unique = [...new Set(texts)];
  const reply = await send({ type: "choose-option", label, want, options: unique });
  if (!reply || !reply.ok || reply.index < 0) return -1;
  return texts.indexOf(unique[reply.index]);
}
