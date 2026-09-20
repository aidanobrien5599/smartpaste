/**
 * Turning Jev's probability distribution into something to type into a box.
 *
 * Jev decides which snippet contains the answer. Everything after that is
 * ordinary code: pulling the surname out of a name header, or the date out of
 * "B.S. Computer Science, expected May 2027", is a regex's job, and regexes do
 * not hallucinate. Jev locates; this file transcribes.
 */

import { NONE, isStructured, valueOf } from "./profile.js";

// Above AUTO, Cmd-V pastes silently. Below MENU we offer nothing at all and
// let the keystroke fall through to an ordinary paste.
export const AUTO = 0.85;
export const MENU = 0.4;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL = /(?:https?:\/\/|www\.)\S+|(?:[\w-]+\.)+(?:com|io|dev|org|net|ai)\/\S+/g;
const PHONE = /\+?\d[\d\s().-]{5,}\d/g;
const MIN_PHONE_DIGITS = 7;

const MONTHS =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|" +
  "Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|" +
  "Spring|Summer|Fall|Autumn|Winter";
const DATE = new RegExp(
  `(?:${MONTHS})\\.?\\s+\\d{4}|\\d{1,2}/\\d{4}|\\b(?:19|20)\\d{2}\\b`,
  "gi"
);
const GPA = /\d\.\d+\s*(?:\/\s*\d(?:\.\d+)?)?/g;
const DEGREE_TAIL =
  /\s*[,;(]?\s*\b(?:expected|expecting|anticipated|graduating|grad(?:uation)?|class of|in progress|gpa)\b.*$/i;
const TRAILING_RANGE = new RegExp(
  `\\s*(?:${MONTHS})\\.?\\s*\\d{4}\\s*(?:[-\\u2012-\\u2015]\\s*(?:(?:${MONTHS})\\.?\\s*)?(?:\\d{4}|present|current)\\s*)?$`,
  "i"
);

// A date range reads "Sep 2023 - May 2027": graduation is the end of it.
const END_DATE_WORDS = ["graduation", "grad date", "completion", "expected"];
const NAME_SUFFIX = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd"]);

function looksLikeName(s) {
  if (/\d/.test(s) || s.includes("@")) return false;
  const n = s.trim().split(/\s+/).length;
  return n > 1 && n <= 5;
}

function nameParts(s) {
  let parts = s
    .trim()
    .split(/\s+/)
    .filter((p) => !NAME_SUFFIX.has(p.toLowerCase().replace(/,$/, "")));
  // Resume headers are often set in all caps; restore normal casing. A letter
  // following any non-letter starts a word, so O'BRIEN becomes O'Brien.
  if (s === s.toUpperCase()) {
    parts = parts.map((p) =>
      p.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, before, letter) =>
        before + letter.toUpperCase()
      )
    );
  }
  return parts;
}

function matcher(pattern, minDigits = 0) {
  return (snippet, label) => {
    const found = [...snippet.matchAll(pattern)]
      .map((m) => m[0].trim().replace(/[.,;]+$/, ""))
      .filter(
        (v) =>
          !minDigits || (v.match(/\d/g) || []).length >= minDigits
      );
    if (!found.length) return null;
    if (pattern === DATE && END_DATE_WORDS.some((w) => label.includes(w))) {
      return found[found.length - 1];
    }
    return found[0];
  };
}

// Label keyword -> extractor. Order matters: "first name" before the generic
// full-name rule, or every name field returns the whole header.
const EXTRACTORS = [
  [["first name", "given name", "forename", "preferred name"],
    (s) => (looksLikeName(s) ? nameParts(s)[0] : null)],
  [["last name", "surname", "family name"],
    (s) => (looksLikeName(s) ? nameParts(s).slice(-1)[0] : null)],
  [["full name", "legal name", "your name"],
    (s) => (looksLikeName(s) ? nameParts(s).join(" ") : null)],
  [["email", "e-mail"], matcher(EMAIL)],
  [["phone", "mobile", "telephone", "cell"], matcher(PHONE, MIN_PHONE_DIGITS)],
  [["gpa", "grade point"], matcher(GPA)],
  [["graduation", "grad date", "start date", "available", "date"], matcher(DATE)],
  [["degree", "major", "discipline", "field of study"],
    (s) => s.replace(DEGREE_TAIL, "").trim().replace(/[,;-]+$/, "") || null],
  [["school", "university", "college", "institution"],
    (s) => s.replace(TRAILING_RANGE, "").trim().replace(/[,;-]+$/, "") || null],
  [["website", "url", "link", "portfolio", "github", "linkedin", "twitter"],
    matcher(URL)],
];

/**
 * Pull the exact value out of an option.
 *
 * A labelled profile field is already exactly what the box wants, so it is
 * returned untouched -- no regex can improve a value you typed yourself, and
 * every regex can spoil one. Extraction applies only to unlabelled resume
 * lines, where the option is a whole sentence containing the answer.
 */
export function refine(label, option) {
  if (isStructured(option)) return valueOf(option);
  const snippet = option;
  const low = label.toLowerCase();
  for (const [keywords, extract] of EXTRACTORS) {
    if (keywords.some((w) => low.includes(w))) {
      const value = extract(snippet, low);
      if (value) return value;
      break;
    }
  }
  return snippet;
}

/**
 * One Jev answer -> what Cmd-V should do. `alternatives` lets a second Cmd-V
 * cycle to the next most likely snippet instead of needing any menu.
 */
export function resolve(label, answer, options) {
  const probabilities = answer.probabilities || {};
  const ranked = Object.entries(probabilities)
    .filter(([k]) => k !== NONE && k in options)
    .sort((a, b) => b[1] - a[1])
    .map(([k, p]) => ({ value: refine(label, options[k]), p }));

  const choice = answer.choice;
  const confidence = Number(answer.confidence ?? 0);
  if (choice === NONE || !(choice in options)) {
    return { label, status: "none", value: null, confidence, alternatives: [] };
  }
  const certainty = Math.min(Number(probabilities[choice] ?? confidence), confidence);
  if (certainty < MENU) {
    return { label, status: "none", value: null, confidence: certainty, alternatives: [] };
  }
  return {
    label,
    status: certainty >= AUTO ? "auto" : "pick",
    value: refine(label, options[choice]),
    confidence: certainty,
    alternatives: ranked.slice(0, 4),
  };
}
