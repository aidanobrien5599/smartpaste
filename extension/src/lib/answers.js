/**
 * Your own answers to open-ended questions, written once and reused.
 *
 * Jev chooses; it does not write. So "Why do you want to work here?" gets
 * your words, matched to the form's wording of the question, with
 * {company} and {role} filled in from the page you are applying on.
 */

export const PLACEHOLDER = /\{(company|role)\}/gi;

/** Stored shape, cleaned: [{ question, answer }], both non-empty. */
export function normalizeAnswers(list) {
  return (Array.isArray(list) ? list : [])
    .map((e) => ({ question: String(e?.question || "").trim(), answer: String(e?.answer || "").trim() }))
    .filter((e) => e.question && e.answer);
}

/** Profile options: each question is the label a form field is matched on. */
export function answerOptions(list) {
  const options = {};
  normalizeAnswers(list).forEach((e, i) => {
    options[`custom${i + 1}`] = { field: e.question, value: e.answer };
  });
  return options;
}

export const hasPlaceholders = (text) => new RegExp(PLACEHOLDER.source, "i").test(String(text || ""));

/** Fill {company} / {role}; null if one is needed but unknown. */
export function fillPlaceholders(text, known) {
  let missing = false;
  const out = String(text).replace(PLACEHOLDER, (whole, name) => {
    const value = known?.[name.toLowerCase()];
    if (!value) missing = true;
    return value || whole;
  });
  return missing ? null : out;
}

// URL path segments that are plumbing, not names.
const NOISE = /^(?:jobs?|careers?|apply|application|applyManually|recruiting|en-us|en|us|job-boards|embed|postings?|details?|view|wday|cxs|external|gh_jid|login)$/i;

/** "WellsFargoJobs" -> "Wells Fargo Jobs", "ellipsis-labs" -> "Ellipsis Labs". */
function deslug(segment) {
  const words = decodeURIComponent(segment)
    .replace(/[_+-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Strings the page offers as its company and its role: pieces of the title
 * (split at " at ", " - ", " | ", "@"), the page heading, and readable URL
 * path segments. Code only cuts them out; Jev decides which is which.
 */
export function pageCandidates({ url = "", title = "", heading = "" } = {}) {
  const out = [];
  const add = (text) => {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 90) return;
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const piece of String(title).split(/\s+(?:at|@|-|–|—|\||·)\s+|\s*\|\s*/i)) add(piece.replace(/^Job Application for\s+/i, ""));
  add(heading);
  try {
    for (const segment of new URL(url).pathname.split("/")) {
      // Workday puts the job title in the path: "XMLNAME-2027-Technology-
      // Summer-Internship---…_R-574285". Drop its prefix and requisition id;
      // skip ids and long numbers, keep years.
      const clean = decodeURIComponent(segment).replace(/^XMLNAME-/i, "").replace(/_?R-?\d+$/i, "");
      if (!clean || NOISE.test(clean) || /\d{5,}|^[0-9a-f-]{16,}$/i.test(clean)) continue;
      add(deslug(clean).replace(/\s+Jobs$/i, ""));
    }
  } catch { /* not a URL */ }
  return out.slice(0, 20);
}
