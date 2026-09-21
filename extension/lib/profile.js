/**
 * Turning the stored profile into Jev's option set.
 *
 * Two kinds of option live side by side. A profile field is an object that
 * carries its own name, so Jev disambiguates by label and the value comes back
 * verbatim. A resume line is a bare string with no label, so it still needs
 * the regex layer to extract a substring. Structured wins wherever it exists.
 */

import { LABELS, ORDINALS, REPEATABLE } from "./schema.js";

export const NONE = "__none__";
export const MAX_OPTIONS = 254;

const BULLET_PREFIX = /^\s*(?:[-*•·▪●‣]|\d+[.)])\s+/;

/** Free-form lines (resume bullets, extra notes) as unlabeled options. */
export function extraSnippets(text, startIndex = 0) {
  const out = {};
  if (!text) return out;
  let n = startIndex;
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(BULLET_PREFIX, "");
    if (line.length < 8) continue;
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
        options[`${section.key}${index + 1}_${key}`] = {
          field: `${label} of the ${ordinal} ${section.singular}` +
            (subject && key !== section.summary ? ` (${subject})` : ""),
          value,
        };
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
  if (!has("location") && has("city")) {
    out.location = [get("city"), get("state")].filter(Boolean).join(", ");
  }
  return out;
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
