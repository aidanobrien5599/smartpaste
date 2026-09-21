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
export const AUTO = 0.65;
export const MENU = 0.4;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL = /(?:https?:\/\/|www\.)\S+|(?:[\w-]+\.)+(?:com|io|dev|org|net|ai)\/\S+/g;
// An opening bracket is part of "(404) 555-0182".
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/g;
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
// Spelled-out forms first, and an abbreviation must end at a word boundary --
// otherwise "B.A." with optional dots matches the "Ba" of "Bachelor".
const DEGREE_PREFIX =
  /^\s*(?:(?:Bachelor|Master)(?:'s)?(?:\s+of\s+(?:Science|Arts|Engineering))?|Ph\.?D\.?|[BM]\.?(?:S|A|Eng)\.?)(?=[\s,-]|$)\s*(?:in\s+|,\s*|-\s*)?/i;
const DEGREE_TAIL =
  /\s*[,;(]?\s*\b(?:expected|expecting|anticipated|graduating|grad(?:uation)?|class of|in progress|gpa)\b.*$/i;
// "Netflix Los Gatos, CA", "Intelligible AI Remote" -- a resume puts the
// employer and the place on one line, and a Company field wants only the name.
// "Los Gatos, CA", "Remote". One line often holds both an employer and a
// place -- "Netflix Los Gatos, CA" -- and only knowing that Netflix is a
// company tells you where the boundary falls. So the two fields disagree on
// purpose: a Location field prefers the longest place, a Company field
// prefers the longest one that still leaves a name in front of it.
const PLACE = /^(?:[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*,\s*[A-Z]{2}|Remote|Hybrid|On-?site)$/;
const MAX_PLACE_WORDS = 4;

/** Every way the line could end in a place, longest first. */
function placeSplits(text) {
  const tokens = text.trim().split(/\s+/);
  const splits = [];
  for (let i = Math.max(0, tokens.length - MAX_PLACE_WORDS); i < tokens.length; i++) {
    const place = tokens.slice(i).join(" ");
    if (PLACE.test(place)) splits.push({ place, rest: tokens.slice(0, i).join(" ") });
  }
  return splits;
}

const TRAILING_RANGE = new RegExp(
  `\\s*(?:${MONTHS})\\.?\\s*\\d{4}\\s*(?:[-\\u2012-\\u2015]\\s*(?:(?:${MONTHS})\\.?\\s*)?(?:\\d{4}|present|current)\\s*)?$`,
  "i"
);

// A date range reads "Sep 2023 - May 2027": graduation is the end of it.
const END_DATE_WORDS = [
  "graduation", "grad date", "completion", "expected", "end date", "end of",
];
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

// An extractor returns DROP to say the chosen line does not hold the value at
// all -- distinct from null, which means "no narrower value, keep the line".
export const DROP = Symbol("drop");

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
  [["major", "discipline", "field of study", "concentration"],
    (s) =>
      s
        .replace(DEGREE_TAIL, "")
        .replace(DEGREE_PREFIX, "")
        .trim()
        .replace(/[,;-]+$/, "") || null],
  [["degree"],
    (s) => s.replace(DEGREE_TAIL, "").trim().replace(/[,;-]+$/, "") || null],
  [["job title", "title", "position", "role at"],
    (s) => s.replace(TRAILING_RANGE, "").trim().replace(/[,;-]+$/, "") || null],
  [["company", "employer", "organisation", "organization"],
    (s) => {
      const dated = s.replace(TRAILING_RANGE, "").trim();
      const splits = placeSplits(dated);
      // A company needs a name left over, so skip the reading that swallows
      // the whole line. If every reading does, the line is only a place.
      const named = splits.find((split) => split.rest);
      const name = named ? named.rest : splits.length ? "" : dated;
      return name.trim().replace(/[,;-]+$/, "") || null;
    }],
  // A blank location beats a wrong one: if the line names no place, say so
  // rather than handing back the school or employer sitting in front of it.
  [["location", "city and state", "office location"],
    (s) => {
      const splits = placeSplits(s);
      if (!splits.length) return DROP; // blank beats wrong
      // A line that is nothing but a place is the whole answer. Otherwise
      // take the longest trailing place, which leaves a name in front.
      return splits[0].rest === "" ? splits[0].place : splits[0].place;
    }],
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
      if (value === DROP) return null;
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
    .map(([k, p]) => ({ value: refine(label, options[k]), p }))
    .filter((alternative) => alternative.value !== null);

  const choice = answer.choice;
  const confidence = Number(answer.confidence ?? 0);
  if (choice === NONE || !(choice in options)) {
    return { label, status: "none", value: null, confidence, alternatives: [] };
  }
  const certainty = Math.min(Number(probabilities[choice] ?? confidence), confidence);
  if (certainty < MENU) {
    return { label, status: "none", value: null, confidence: certainty, alternatives: [] };
  }
  // The chosen line may hold no such value at all (a school line asked for a
  // location): that is no answer, not the whole line.
  const value = refine(label, options[choice]);
  if (value === null) {
    return { label, status: "none", value: null, confidence: certainty, alternatives: [] };
  }
  return {
    label,
    status: certainty >= AUTO ? "auto" : "pick",
    value,
    confidence: certainty,
    alternatives: ranked.slice(0, 4),
  };
}
