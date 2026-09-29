/**
 * Plain-text autocompletes, whose value only counts once a suggestion is
 * clicked: telling one from a plain box, typing a search, reading the
 * suggestions that appear beneath it, and picking the best.
 *
 * Depends on: discover/labels.ts (labelFor), discover/selectors.ts
 * (NOT_A_SUGGESTION), dom/query.ts, dom/text.ts,
 * widgets/text.ts (nativeSet, typeLikeAPerson).
 *
 * ATS quirks: Lever's location keeps the real value in a hidden
 * selectedLocation set only by clicking a suggestion, and live, four of
 * eight Lever forms met the first search with "No location found", so a
 * second, shorter search ("Madison" for "Madison, WI") runs before giving
 * up. Workday's "Address", "City", "Postal code" and "Location" are plain
 * boxes, so only a location/hometown name hints at an autocomplete, and a
 * box that never offers suggestions keeps the typed text.
 */
import { labelFor } from "../discover/labels.ts";
import { NOT_A_SUGGESTION } from "../discover/selectors.ts";
import { fire, sleep } from "../dom/query.ts";
import { normalize } from "../dom/text.ts";
import { nativeSet, typeLikeAPerson } from "./text.ts";

// A name hint is only for autocompletes that do not say so (Lever's
// "Current location"). "Address", "City", "Postal code" are plain boxes on
// Workday -- guessing otherwise waited 3s on each for suggestions.
const AUTOCOMPLETE_HINT = /location|hometown/i;

const SUGGESTION_BOX =
  '[role="listbox"], [class*="dropdown-results"], [class*="suggest"], ' +
  '[class*="autocomplete"], [class*="typeahead"], [class*="pac-container"]';

export function looksLikeAutocomplete(field: HTMLInputElement): boolean {
  if (field.getAttribute("aria-autocomplete") || field.getAttribute("list")) return true;
  // "Email Address" is not a place, and waiting on it for suggestions that
  // never come cost three seconds a form.
  if (field.type === "email" || /e-?mail/i.test(labelFor(field))) return false;
  // Label and name only: ids and classes carry section names
  // ("addressSection_postalCode") that say nothing about the widget.
  const hints = [field.name, labelFor(field)].join(" ");
  return AUTOCOMPLETE_HINT.test(hints);
}

interface Suggestion { node: Element; text: string }

/** Whether any menu at all opened under the field, even an empty one. */
function menuOpenedNear(field: Element): boolean {
  const box = field.getBoundingClientRect();
  for (const list of document.querySelectorAll(SUGGESTION_BOX)) {
    const rect = list.getBoundingClientRect();
    if (rect.height && rect.top >= box.top - 4 && rect.top <= box.bottom + 400) return true;
  }
  return false;
}

/** Suggestions that appeared just below the field, in reading order. */
function suggestionsNear(field: Element): Suggestion[] {
  const box = field.getBoundingClientRect();
  const items: Suggestion[] = [];
  for (const list of document.querySelectorAll(SUGGESTION_BOX)) {
    const rect = list.getBoundingClientRect();
    if (!rect.height || rect.top < box.top - 4 || rect.top > box.bottom + 400) continue;
    const leaves = [...list.querySelectorAll('[role="option"], li, div')].filter(
      (n) => !n.querySelector("li, div, [role='option']") && n.textContent!.trim()
    );
    for (const leaf of leaves.length ? leaves : [list]) {
      const text = leaf.textContent!.trim();
      if (!NOT_A_SUGGESTION.test(text)) items.push({ node: leaf, text });
    }
  }
  return items;
}

/** One search: type `probe`, then wait for the suggestions it brings back. */
async function searchSuggestions(field: HTMLInputElement, probe: string, rounds = 12): Promise<Suggestion[]> {
  await typeLikeAPerson(field, probe);
  let items: Suggestion[] = [];
  for (let i = 0; i < rounds && !items.length; i++) {
    await sleep(100);
    items = suggestionsNear(field);
  }
  return items;
}

/**
 * Whether the box says it is an autocomplete, rather than merely being
 * called "Location". Workday's Work Experience Location is a plain text
 * box: on Adobe's form, three of them spent 2.6s each -- a full wait, a
 * second shortened search, another full wait -- before typing the value
 * that was right the first time. Nearly 8 of that fill's 14 seconds.
 */
function declaresItself(field: HTMLInputElement): boolean {
  return Boolean(field.getAttribute("aria-autocomplete") || field.getAttribute("list") ||
    field.getAttribute("role") === "combobox" || field.getAttribute("aria-expanded") ||
    field.getAttribute("aria-controls") || field.closest('[class*="autocomplete" i], [class*="typeahead" i]'));
}

// A geocoder that knows no state abbreviation finds nothing for "Madison,
// WI" and everything for "Madison", so the second search asks for less.
const cityOf: (value: string) => string = (value) => value.split(",")[0].trim() || value;

/**
 * A plain-text autocomplete: typed text alone is not an answer. Lever keeps
 * the real value in a hidden selectedLocation that is only set by clicking
 * a suggestion, so a field that merely looks filled is submitted empty.
 *
 * And one search is not an answer either: live on 2026-09-23, four of eight
 * Lever forms met the first search with "No location found. Try entering a
 * different location", kept the typed text, and went in with no location.
 * So the search is run again before the field is given up on.
 */
export async function setAutocomplete(field: HTMLInputElement, value: string): Promise<boolean> {
  // A box that never says it is an autocomplete gets one short look. The
  // second search is for a real one that answered "no location found".
  const declared = declaresItself(field);
  let items = await searchSuggestions(field, value, declared ? 12 : 5);
  if (!items.length) {
    // Lever answers a search it cannot place with "No location found. Try
    // entering a different location" -- a menu, just an unhelpful one, and
    // worth a second, shorter search. Workday's plain Location box opens
    // nothing at all, and searching it again only costs another 1.3s.
    items = declared || menuOpenedNear(field) ? await searchSuggestions(field, cityOf(value)) : [];
    if (!items.length) {
      // Two searches, no suggestions: the box may be a plain one after all
      // (Workday's "Location"), where what was typed is the answer -- so
      // put the whole of it back, the shortened probe included.
      nativeSet(field, value);
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return Boolean(field.value);
    }
  }
  const want = normalize(value);
  const pick =
    items.find((i) => normalize(i.text) === want) ||
    items.find((i) => normalize(i.text).startsWith(want)) ||
    items[0];
  fire(pick.node, "mousedown");
  fire(pick.node, "mouseup");
  fire(pick.node, "click");
  await sleep(200);
  return true;
}
