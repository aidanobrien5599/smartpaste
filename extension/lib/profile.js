/**
 * Turning the stored profile into Jev's option set.
 *
 * Two kinds of option live side by side. A profile field is an object that
 * carries its own name, so Jev disambiguates by label and the value comes back
 * verbatim. A resume line is a bare string with no label, so it still needs
 * the regex layer to extract a substring. Structured wins wherever it exists.
 */

import { LABELS } from "./schema.js";

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

/** The full option set: labelled profile fields first, then free-form lines. */
export function buildOptions(profile = {}, extraText = "") {
  const options = {};
  for (const [key, value] of Object.entries(profile)) {
    if (!value || !String(value).trim()) continue;
    options[key] = { field: LABELS[key] || key, value: String(value).trim() };
  }
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
