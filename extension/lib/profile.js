/**
 * Turning the stored profile into Jev's option set.
 *
 * Two kinds of option live side by side. A profile field is an object that
 * carries its own name, so Jev disambiguates by label and the value comes back
 * verbatim. A resume line is a bare string with no label, so it still needs
 * the regex layer to extract a substring. Structured wins wherever it exists.
 */

import { LABELS, ORDINALS, REPEATABLE } from "./schema.js";
import { placesOptions } from "./places.js";
import { answerOptions } from "./answers.js";

export const NONE = "__none__";
export const MAX_OPTIONS = 254;

const BULLET_PREFIX = /^\s*(?:[-*•·▪●‣]|\d+[.)])\s+/;
const BULLET_START = /^\s*[-*•·▪●‣]/;
const ENDS_SENTENCE = /[.!?]$/;
const HEADING = /^[A-Z][A-Z\s&]{3,}$/;

/**
 * Rejoin bullets the PDF wrapped across lines.
 *
 * A resume bullet runs past the page width and continues on the next line, so
 * splitting on newlines yields two half-sentences and a description that stops
 * mid-clause. Only bullets are joined, and only until the text reaches a full
 * stop -- joining every unterminated line would weld "University of Wisconsin"
 * onto the date sitting beneath it.
 */
export function unwrap(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let block = lines[i];
    if (BULLET_START.test(block)) {
      let joined = 0;
      while (
        joined < 3 &&
        i + 1 < lines.length &&
        !ENDS_SENTENCE.test(block) &&
        continues(block, lines[i + 1])
      ) {
        block += " " + lines[++i];
        joined++;
      }
    }
    out.push(block);
  }
  return out.join("\n");
}

// A title, company, date or place is never the rest of a bullet, even when
// the bullet has no full stop -- which most do not. Joining on "no full stop"
// alone swallowed the next job's title, dates and company into a bullet.
const DATEISH = /(?:19|20)\d{2}|\bPresent\b/;
function titleLike(line) {
  const words = line.split(/\s+/);
  return words.length <= 6 && words.every((w) => /^[A-Z0-9&(]/.test(w) || /^(?:of|and|the|in|at|for|&|-|–|—)$/.test(w));
}
// The PDF extractor joins wrapped lines by position (lib/extract.js); text
// alone is only trusted for a line that plainly starts mid-sentence. A "long
// line running on" rule swallowed whole Word entry lines into the bullet
// above them.
function continues(block, next) {
  if (BULLET_START.test(next) || HEADING.test(next)) return false;
  return /^[a-z(,;%$]/.test(next);
}

/** Free-form lines (resume bullets, extra notes) as unlabeled options. */
export function extraSnippets(text, startIndex = 0, minLength = 8) {
  const out = {};
  if (!text) return out;
  let n = startIndex;
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(BULLET_PREFIX, "");
    // A company name can be very short. "Netflix" is seven characters, and
    // dropping it loses the employer of the most recent role entirely.
    if (line.length < minLength) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out[`e${String(++n).padStart(3, "0")}`] = line;
  }
  return out;
}

/** Repeated entries, each option labelled with its ordinal and its subject. */
function repeatedOptions(profile) {
  const options = {};
  for (const section of REPEATABLE) {
    const entries = Array.isArray(profile[section.key]) ? profile[section.key] : [];
    entries.forEach((entry, index) => {
      const ordinal = ORDINALS[index] || `${index + 1}th most recent`;
      const subject = (entry[section.summary] || "").trim();
      for (const [key, label] of section.fields) {
        const value = (entry[key] || "").toString().trim();
        if (!value) continue;
        const field = section.named && subject
          ? (key === section.summary ? `${label} (${subject})` : `${subject} ${label.toLowerCase()}`)
          : `${label} of the ${ordinal} ${section.singular}` +
            (subject && key !== section.summary ? ` (${subject})` : "");
        options[`${section.key}${index + 1}_${key}`] = { field, value };
      }
    });
  }
  return options;
}

/**
 * Answers that follow from others.
 *
 * Jev selects; it never composes. Asked for "Name" with only a first and last
 * name stored it correctly returns nothing, because handing back "Aidan" for a
 * full-name box would be wrong. Joining the two is code's job, so the composed
 * answer is offered as an option of its own. Anything typed explicitly wins.
 */
function derived(profile) {
  const has = (key) => Boolean(String(profile[key] || "").trim());
  const get = (key) => String(profile[key] || "").trim();
  const out = {};

  if (!has("full_name") && has("first_name") && has("last_name")) {
    out.full_name = `${get("first_name")} ${get("last_name")}`;
  }
  // And the other way round, for a profile that only gave a full name.
  if (has("full_name") && !has("first_name") && !has("last_name")) {
    const parts = get("full_name").split(/\s+/);
    if (parts.length >= 2) {
      out.first_name = parts[0];
      out.last_name = parts[parts.length - 1];
    }
  }
  // Workday requires a device type next to any phone number. Unsaid, it is
  // almost always a mobile; a value you enter wins over this guess.
  if (has("phone") && !has("phone_type")) out.phone_type = "Mobile";
  if (!has("location") && has("city")) {
    out.location = [get("city"), get("state")].filter(Boolean).join(", ");
  }
  return out;
}

/**
 * Workday's Websites section is a list of bare "URL" boxes, one per Add.
 * Numbered in a fixed order, "Websites 2: URL" has one right answer.
 */
const WEBSITES = [["linkedin", "LinkedIn"], ["github", "GitHub"], ["portfolio", "portfolio"], ["other_link", "other site"]];

function websiteOptions(profile) {
  const options = {};
  WEBSITES.filter(([key]) => String(profile[key] || "").trim()).forEach(([key, name], i) => {
    options[`website${i + 1}`] = { field: `URL of website ${i + 1} (${name})`, value: String(profile[key]).trim() };
  });
  return options;
}

/** The full option set: labelled profile fields first, then free-form lines. */
export function buildOptions(profile = {}, extraText = "") {
  const options = {};
  const complete = { ...derived(profile), ...profile };
  for (const [key, value] of Object.entries(complete)) {
    if (Array.isArray(value) || value === null || typeof value === "object") continue;
    if (!String(value).trim()) continue;
    options[key] = { field: LABELS[key] || key, value: String(value).trim() };
  }
  Object.assign(options, repeatedOptions(profile));
  Object.assign(options, websiteOptions(profile));
  Object.assign(options, placesOptions(profile.work_locations));
  Object.assign(options, answerOptions(profile.custom_answers));
  Object.assign(options, extraSnippets(extraText));
  return Object.fromEntries(Object.entries(options).slice(0, MAX_OPTIONS));
}

export function asCriteria(options) {
  return { ...options, [NONE]: "None of these answers this field" };
}

/** A labelled option answers verbatim; a bare line still needs extraction. */
export function isStructured(option) {
  return Boolean(option) && typeof option === "object";
}

export function valueOf(option) {
  return isStructured(option) ? option.value : option;
}
