/**
 * Turning Jev's probability distribution into something to type into a box.
 *
 * Jev decides which snippet contains the answer. Everything after that is
 * ordinary code: pulling the surname out of a name header, or the date out of
 * "B.S. Computer Science, expected May 2027", is a regex's job, and regexes do
 * not hallucinate. Jev locates; this file transcribes.
 */

import { NONE, isStructured, valueOf } from "./profile.ts";
import { placeSaysYes } from "./places.ts";
import type { Option, Options } from "./schema.ts";

// Above AUTO, Cmd-V pastes silently. Below MENU we offer nothing at all and
// let the keystroke fall through to an ordinary paste.
// Aidan, 2026-09-30: 0.65 left too much for the keyboard on borderline
// questions. Measured on the 42-form corpus, 0.55 newly fills 13 fields;
// the ones with a value are "Other website" on four forms (right) and
// "Current company" on three (wrong, and fixed in lib/profile.ts by saying
// there is no current employer rather than naming a finished internship).
export const AUTO = 0.55;
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
function placeSplits(text: string): { place: string; rest: string }[] {
  const tokens = text.trim().split(/\s+/);
  const splits: { place: string; rest: string }[] = [];
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

function looksLikeName(s: string): boolean {
  if (/\d/.test(s) || s.includes("@")) return false;
  const n = s.trim().split(/\s+/).length;
  return n > 1 && n <= 5;
}

function nameParts(s: string): string[] {
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

function matcher(pattern: RegExp, minDigits = 0): Extractor {
  return (snippet: string, label: string): string | null => {
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

type Extractor = (snippet: string, label: string) => string | null | typeof DROP;

// Label keyword -> extractor. Order matters: "first name" before the generic
// full-name rule, or every name field returns the whole header.
const EXTRACTORS: [string[], Extractor][] = [
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
export function refine(label: string, option: Option): string | null {
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

/** One answer from Jev: which option, and how sure. */
export type Answer = { choice: string; confidence?: number; probabilities?: Record<string, number> };

/** What Cmd-V does with a resolved answer. */
export type Resolution = {
  label: string;
  status: "none" | "auto" | "pick";
  value: string | null;
  confidence: number;
  alternatives: { value: string | null; p: number }[];
};

/**
 * One Jev answer -> what Cmd-V should do. `alternatives` lets a second Cmd-V
 * cycle to the next most likely snippet instead of needing any menu.
 */
// "If you are accepted for this in-person position, what city will you be
// working from?" is asking where the JOB is, which only the employer knows.
// Live on SEP (Westfield, IN) the ranked preference answered it "New York
// City" at 0.74, on two boxes of that form. Rewording the preference entries
// away from it made Jev answer NO to "would you relocate to the NYC area?",
// which is worse, so the entries keep their wording and this question keeps
// its silence.
const THEIR_OFFICE = /\b(?:what|which|where)\b[^?]*\b(?:city|town|location|office|site)\b[^?]*\b(?:you|your)\b[^?]*\b(?:work|working|based|report)/i;
const THIS_JOB = /\bthis (?:position|role|job|internship)\b|\bif (?:you are|you're) (?:accepted|hired|offered|selected)\b/i;
const PREFERENCE = new Set(["work_locations", "top_work_location", "open_to_any_location"]);

// A question about who someone IS. The profile has a field for each, and
// only that field may answer it: live at the 0.55 bar, "Do you identify as
// transgender?" came back No at 0.52-0.59 from the gender entry, on a
// profile that says nothing about it. An invented answer about a protected
// characteristic is worse than a blank, and blank is what the form means by
// "prefer not to say".
const DEMOGRAPHIC: [RegExp, string[]][] = [
  [/\btransgender\b/i, ["transgender"]],
  [/\bsexual orientation\b|\blgbtq/i, ["orientation", "lgbtq"]],
  [/\bdisabilit(?:y|ies)\b|\bchronic condition\b/i, ["disability"]],
  [/\bveteran\b|\barmed forces\b|\bmilitary service\b/i, ["veteran"]],
  [/\bhispanic\b|\blatino\b/i, ["hispanic_latino", "race"]],
  [/\brace\b|\bethnicit(?:y|ies)\b|\bracial\b/i, ["race", "hispanic_latino"]],
  [/\bgender identity\b|\bgender\b|\bpronouns?\b/i, ["gender", "pronouns"]],
];

// "Current or most recent employer" wants the most recent one. The entry
// that says there is no current employer answered it "None -- I am a
// full-time student", which is not what was asked.
const OR_MOST_RECENT = /\b(?:most recent|previous|last|prior)\b/i;

/**
 * Whether the question asks who someone is, and the profile does not say.
 *
 * Live at the 0.55 bar, "Do you identify as transgender?" was answered No at
 * 0.52-0.62 on a profile that holds no such field -- inferred from the
 * gender entry. Nobody's protected characteristics should be guessed from a
 * neighbouring one, and a blank is what "prefer not to say" looks like.
 */
export function unanswerableDemographic(label: string, options: Options): boolean {
  for (const [asks, fields] of DEMOGRAPHIC) {
    if (!asks.test(label)) continue;
    return !fields.some((key) => String(valueOf(options[key]) ?? "").trim());
  }
  return false;
}

export function resolve(label: string, answer: Answer, options: Options): Resolution {
  const chose = String(answer?.choice ?? "");
  if (unanswerableDemographic(label, options)) {
    return { label, status: "none", value: null, confidence: 0, alternatives: [] };
  }
  for (const [asks, fields] of DEMOGRAPHIC) {
    if (asks.test(label) && chose && !fields.includes(chose)) {
      return { label, status: "none", value: null, confidence: 0, alternatives: [] };
    }
  }
  if (chose === "current_employer" && OR_MOST_RECENT.test(label)) {
    return { label, status: "none", value: null, confidence: 0, alternatives: [] };
  }
  if (PREFERENCE.has(String(answer?.choice)) && THEIR_OFFICE.test(label) && THIS_JOB.test(label)) {
    return { label, status: "none", value: null, confidence: 0, alternatives: [] };
  }
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
  // Entries that agree add up. Adobe's Workday asks "able to work daily at
  // the location? If not, willing to relocate at your own expense?" as a
  // menu, so it is asked with no options and answered from the profile --
  // where the relocation entry, the flexibility catch-all and (with Say yes
  // on) the willing catch-all all say Yes and split the vote: 0.45, under
  // the bar, blank. Only plain Yes / No answers pool; two entries that
  // happen to agree on a school name say nothing about each other.
  const pooled = yesNoCertainty(answer, options);
  const own = Math.min(Number(probabilities[choice] ?? confidence), confidence);
  const agreeing = yesNoOf(choice, options);
  const certainty = agreeing && pooled.said === agreeing ? Math.max(own, pooled.certainty) : own;
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

/** "Select 1-3", "choose up to 3", "pick 2": the most boxes to tick. */
export function maxTicks(label: string): number {
  // "Please check one of the boxes below", "select one", "choose only one"
  if (/\b(?:select|choose|pick|check|tick)\s+(?:only\s+)?one\b/i.test(String(label))) return 1;
  const m = String(label).match(/\b(?:select|choose|pick|check|tick)\s+(?:up to\s+|at most\s+|\d+\s*(?:-|–|to)\s*)?(\d+)\b/i) ||
    String(label).match(/\bup to (\d+)\b/i);
  return m ? Number(m[1]) : Infinity;
}

/** What a check-all-that-apply group resolves to: the boxes to tick. */
export type Ticks = Omit<Resolution, "value"> & { value: string[] | null; multi?: true };

/** How sure Jev is of its own pick: its probability, discounted by its confidence. */
const certainty = (answer: Answer, choice: string): number =>
  Math.min(Number(answer.probabilities?.[choice] ?? 0), Number(answer.confidence ?? 0));

/**
 * "Check all that apply": which boxes to tick.
 *
 * `boxes[j]` is Jev's yes/no on option j asked on its own -- one pick-one
 * question over all of them would split its probability across every right
 * answer (English and Spanish both), so none would clear the bar. `pick` is
 * the same group asked the other way, "which ONE of these?", and is the
 * fallback when no box clears the bar.
 *
 * Both asks are needed because each fails where the other works:
 * - Only the boxes answer a question with several right answers. DoorDash's
 *   five placement cities came back yes at 0.82-0.95 each; the pick-one ask
 *   named New York alone.
 * - Only the pick-one ask answers a pick-one question whose right answer is
 *   the catch-all. Relay Pro's graduation question offers December 2027,
 *   May 2028, Summer 2028, December 2028 and Other; the profile graduates
 *   May 2027, so the answer is Other. Asked "should Other be ticked?" Jev
 *   says no (yes=0.21): it has a real answer, and the ask tells it not to
 *   reach for Other when it does. Asked "which of these?" the same profile
 *   gives Other at 0.74. CTC's 31-option "How did you hear about CTC?" is
 *   the same shape: 0.15 from the boxes, 0.94 from the pick-one ask.
 */
export function ticks(
  label: string,
  options: string[],
  boxes: (Answer | undefined)[],
  pick?: Answer
): Ticks {
  const yes = options
    .map((value, j) => {
      const a = boxes[j];
      return { value, p: a && a.choice === "yes" ? certainty(a, "yes") : 0 };
    })
    .filter((o) => o.p >= MENU)
    .sort((a, b) => b.p - a.p)
    .slice(0, maxTicks(label));
  if (!yes.length) return theOne(label, options, pick);
  return {
    label,
    status: yes.some((o) => o.p >= AUTO) ? "auto" : "pick",
    value: yes.filter((o) => o.p >= AUTO).map((o) => o.value),
    confidence: Math.min(...yes.map((o) => o.p)),
    multi: true,
    alternatives: yes,
  };
}

/** The one box the pick-one ask named, when no box was ticked on its own. */
function theOne(label: string, options: string[], answer?: Answer): Ticks {
  const blank = { label, status: "none" as const, value: null, confidence: 0, alternatives: [] };
  if (!answer) return blank;
  const p = certainty(answer, answer.choice);
  const picked = options[Number(String(answer.choice).replace("o", ""))];
  if (answer.choice === NONE || picked === undefined || p < MENU) return { ...blank, confidence: p };
  return {
    label,
    status: p >= AUTO ? "auto" : "pick",
    value: p >= AUTO ? [picked] : [],
    confidence: p,
    multi: true,
    alternatives: [{ value: picked, p }],
  };
}

/**
 * A Yes/No dropdown answered through the profile's own labels.
 *
 * Asked to pick "Yes" or "No" directly, Jev rarely leans on a catch-all
 * ("Default answer on any other question about my ties to the company"):
 * PwC's "worked with an engagement team as a client?" came back 0.35-0.46.
 * Asked which profile entry answers it, it picks that catch-all at 0.9+. So
 * a Yes/No dropdown asks both, and a confident entry that starts with Yes
 * or No selects the matching option. Returns that option's index, or -1.
 *
 * Only the Yes or No matters, not which entry says it, so entries that agree
 * pool their probability. Hudl's "on-site in Lincoln, NE for the full
 * program?" split 0.55 / 0.11 between the flexibility catch-all and "open to
 * any location" -- both Yes, neither alone over the bar. Jev's confidence
 * discounts the pooled share as it discounts its own pick.
 */
export function yesNoFromEntry(fieldOptions: string[], answer: Answer, options: Options): number {
  const { said, certainty } = yesNoCertainty(answer, options);
  if (!said || certainty < AUTO) return -1;
  return fieldOptions.findIndex((text) => String(text).trim().toLowerCase() === said);
}

/** The Yes or No the profile entries lean to, and how surely. */
export function yesNoCertainty(
  answer: Answer | null | undefined,
  options: Options
): { said: "yes" | "no" | null; certainty: number } {
  if (!answer || answer.choice === NONE) return { said: null, certainty: 0 };
  const probabilities = answer.probabilities || {};
  const pooled = { yes: 0, no: 0 };
  for (const [key, p] of Object.entries(probabilities)) {
    const said = key === NONE ? null : yesNoOf(key, options);
    if (said) pooled[said] += Number(p) || 0;
  }
  const top = Number(probabilities[answer.choice] ?? 0);
  const discount = top > 0 ? Math.min(1, Number(answer.confidence ?? 0) / top) : 0;
  const said = pooled.yes >= pooled.no ? "yes" : "no";
  return pooled[said] ? { said, certainty: pooled[said] * discount } : { said: null, certainty: 0 };
}

/** Which of Yes / No a profile entry says, if either. */
function yesNoOf(key: string, options: Options): "yes" | "no" | null {
  const option = options[key];
  if (!isStructured(option)) return null;
  const said = String(valueOf(option)).trim().match(/^(yes|no)\b/i);
  if (said) return said[1].toLowerCase() as "yes" | "no";
  return placeSaysYes(key, options) ? "yes" : null;
}

/** Whether a dropdown's choices include both a plain "Yes" and a plain "No". */
export function isYesNo(fieldOptions: string[] | null | undefined): boolean {
  const set = new Set((fieldOptions || []).map((t) => String(t).trim().toLowerCase()));
  return set.has("yes") && set.has("no");
}

/**
 * A yes/no question asked in a free-text box.
 *
 * OnLogic's Workable form, live: "We expect this role to begin in January
 * 2027 and run until June 2027. Does this align with your academic
 * schedule?" is a plain text box. Asked which profile entry answers it, Jev
 * split the vote between the current-status entry (0.45), the graduation
 * date (0.25) and the start date (0.20) -- and those do not pool, because
 * pooling only applies to entries whose value starts with Yes or No. The
 * winner would have typed a sentence about being enrolled into a box whose
 * only sensible answers are "Yes" and "No"; an earlier run typed the bare
 * date "May 2027". A Yes/No dropdown is already asked its own two options
 * as well as its entries (isYesNo, yesNoFromEntry); this says when a box
 * with no options at all deserves the same treatment.
 *
 * The test is the LAST sentence, because the question proper sits at the end
 * of whatever preamble the employer wrote. It must open with a yes/no
 * auxiliary, and it must not go on to ask for something a bare Yes or No
 * cannot supply -- "...and if so, which one?" is not a yes/no box.
 */
const YES_NO_OPENER =
  /^(?:do|does|did|are|is|was|were|will|would|can|could|have|has|had|should|shall|may|must)\s+(?:you|your|i|we|they|he|she|it|this|that|there|the|any|all)\b/i;
// "If yes, does this…", "And are you…": a connective in front of the auxiliary.
const CONNECTIVE = /^(?:and|but|so|also|then|if\s+(?:so|yes|no|not))\b[\s,:;-]*/i;
// Neither a Yes nor a No answers any of these, so the box wants prose.
const WANTS_MORE =
  /\b(?:how|what|which|when|where|why|who|whom|whose|explain|describe|specify|elaborate|list|provide|detail|details)\b/i;

export function isYesNoQuestion(label: string | null | undefined): boolean {
  const text = String(label || "").trim();
  if (!text.endsWith("?")) return false;
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const last = (sentences[sentences.length - 1] || "").replace(CONNECTIVE, "");
  return YES_NO_OPENER.test(last) && !WANTS_MORE.test(last);
}

/**
 * What to type into a free-text yes/no box: the word, never the entry.
 *
 * Asked both ways, as a Yes/No dropdown is. `direct` is "is the answer Yes
 * or No?"; `entry` is "which profile entry answers this?", whose Yes- and
 * No-valued entries pool exactly as they do for a dropdown -- OnLogic's "we
 * offer no relocation assistance; do you have the resources to work here?"
 * splits 0.39 willing / 0.24 relocate, and only pooled does it clear the
 * bar. The stronger of the two wins, and the value returned is "Yes" or
 * "No" whichever entry said it: the catch-all sentence it is stored as
 * belongs in the profile, not in the employer's box.
 */
export function yesNoAnswer(
  label: string,
  direct: Answer | null | undefined,
  entry: Answer | null | undefined,
  options: Options
): Resolution {
  const ranked: { value: string; p: number }[] = [];
  if (direct && (direct.choice === "yes" || direct.choice === "no")) {
    ranked.push({
      value: direct.choice === "yes" ? "Yes" : "No",
      p: Math.min(Number(direct.probabilities?.[direct.choice] ?? 0), Number(direct.confidence ?? 0)),
    });
  }
  const pooled = yesNoCertainty(entry, options);
  if (pooled.said) ranked.push({ value: pooled.said === "yes" ? "Yes" : "No", p: pooled.certainty });
  ranked.sort((a, b) => b.p - a.p);
  const best = ranked[0];
  if (!best || best.p < MENU) {
    return { label, status: "none", value: null, confidence: best ? best.p : 0, alternatives: [] };
  }
  const alternatives = ranked.filter((a, i) => ranked.findIndex((b) => b.value === a.value) === i);
  return {
    label,
    status: best.p >= AUTO ? "auto" : "pick",
    value: best.value,
    confidence: best.p,
    alternatives,
  };
}
