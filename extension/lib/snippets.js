/**
 * Your resume as a flat library of atomic snippets.
 *
 * Jev cannot emit strings -- it returns a typed decision and nothing else. So
 * the resume is pre-split here, in ordinary code, and Jev only ever picks
 * which piece contains the answer. A resume is already a list of atomic facts,
 * one per line, which is why this needs no extraction model.
 */

// A Choice takes at most 255 options; one slot goes to the escape hatch.
export const MAX_SNIPPETS = 254;
export const NONE = "__none__";

const BULLET_PREFIX = /^\s*(?:[-*•·▪●‣]|\d+[.)])\s+/;
const SPLIT = /\s*(?:[|•·▪●‣]|\s[–—]\s)\s*/;

/** Fields a resume never contains but applications always ask for. */
export const SUPPLEMENTARY = [
  ["work_auth", "Yes, I am legally authorized to work in the United States"],
  ["sponsorship", "No, I will not require visa sponsorship now or in the future"],
  ["start_date", "Available to start full-time in June 2027"],
  ["pronouns", "he/him"],
  ["why_us", "Two or three sentences you are happy to reuse"],
  ["salary_expectation", "Negotiable / open to discussion"],
  ["proud_project", "A short paragraph about work you would happily be asked about"],
];

export function snippetsFromResume(text, max = MAX_SNIPPETS) {
  const found = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(BULLET_PREFIX, "");
    if (!line) continue;
    for (const part of line.split(SPLIT)) {
      const value = part.trim().replace(/[,;]+$/, "");
      if (value.length < 2) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(value);
      if (found.length >= max) return index(found);
    }
  }
  return index(found);
}

function index(values) {
  const out = {};
  values.forEach((v, i) => {
    out[`s${String(i + 1).padStart(3, "0")}`] = v;
  });
  return out;
}

/** Snippets as Choice options, plus the escape option that stops invention. */
export function asCriteria(snippets) {
  return { ...snippets, [NONE]: "None of the snippets answers this field" };
}
