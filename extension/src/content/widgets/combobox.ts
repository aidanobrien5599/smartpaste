/**
 * Searchable comboboxes (React Select and kin): open the menu and read it
 * whole, take an exact match or let Jev choose among what is there, and
 * type only to narrow a menu too long to show everything.
 *
 * Depends on: answer/ask.ts (chooseAmong), discover/labels.ts (labelFor),
 * discover/selectors.ts, dom/controls.ts, dom/query.ts, dom/text.ts,
 * state.ts (staleMenus), widgets/menus.ts, widgets/text.ts (nativeSet).
 *
 * ATS quirks:
 * - Greenhouse (React Select): typing the literal value filters the menu to
 *   nothing ("May 2027" has to become "Spring 2027"), so the menu is read
 *   whole; a school list opens on "Aalborg University", so a long menu is
 *   narrowed by one distinctive word; a React Select drops typed text on
 *   blur, so an unmatched one is cleared rather than left looking filled.
 * - "Start typing..." autocompletes show nothing until typed into.
 * - Oracle's cx-select opens from its arrow button, not a click on the box.
 * - ByteDance: close every other menu first and remember which were already
 *   open (staleMenus); a tree row is ticked by its checkbox.
 * - Eightfold's 254 country codes never filter as you type; Figma's
 *   location results render twice, so the option is re-found before the
 *   click; "New York City" is listed as "New York".
 */
// askChoice and MAX_MENU are what bench/mutation-check.mjs's "long menus
// shortlisted by shared words" mutant calls here in place of chooseAmong.
import { chooseAmong, askChoice, MAX_MENU } from "../answer/ask.ts";
import { labelFor } from "../discover/labels.ts";
import { UD_SELECT, UD_TREE_NODE } from "../discover/selectors.ts";
import { COMBO_SELECTOR, SELECT_SHELL } from "../dom/controls.ts";
import { fire, sleep } from "../dom/query.ts";
import { normalize } from "../dom/text.ts";
import { staleMenus } from "../state.ts";
import { closeUdMenus, menuChoices, menuOptions, udLists } from "./menus.ts";
import { nativeSet } from "./text.ts";

/** "Start typing..." -- a menu with nothing in it until you type. */
const TYPE_FIRST = /start typing|type to search|begin typing|search for/i;

function needsTyping(field: HTMLInputElement): boolean {
  const shown = field.closest(SELECT_SHELL)?.querySelector('[class*="placeholder"]')?.textContent || "";
  return TYPE_FIRST.test(`${field.placeholder || ""} ${shown}`);
}

function isReactSelect(field: HTMLInputElement): boolean {
  return (
    field.classList.contains("select__input") ||
    Boolean(field.closest(SELECT_SHELL)) ||
    (field.matches(COMBO_SELECTOR) && Boolean(field.closest(UD_SELECT)))
  );
}

export function currentValue(field: HTMLInputElement): string {
  const ud = field.matches(COMBO_SELECTOR) && field.closest(UD_SELECT);
  if (ud) {
    const shown = [...ud.querySelectorAll('[class*="selector__selectItem"], [class*="selector__tag"]')];
    return shown.map((n) => n.textContent!.trim()).filter(Boolean).join(", ");
  }
  const shell = field.closest(SELECT_SHELL);
  if (!shell) return field.value.trim(); // not a React Select (Ashby's search boxes): its text is its value
  const shown = shell.querySelector('[class*="single-value"], [class*="multi-value__label"]');
  return shown ? shown.textContent!.trim() : "";
}

// Below this the whole menu is on screen and typing can only do harm.
const LONG_MENU = 40;

/** The most distinctive word in a value, for narrowing a long menu. */
export function narrowingToken(want: string): string {
  const words = want.match(/[A-Za-z]{4,}/g) || [];
  const skip = /^(the|and|for|university|college|school|degree|bachelor|master)$/i;
  return (
    words.find((w) => !skip.test(w)) || words[0] || want.slice(0, 12)
  );
}

/**
 * Pick `want` out of a combobox.
 *
 * Do not type the value in. A menu's wording is its own: an expected
 * graduation of "May 2027" has to become "Spring 2027", and typing the
 * literal value filters that menu to nothing, destroying the very list the
 * decision needs. So the menu is opened and read whole, an exact match wins
 * if there is one, and otherwise Jev chooses among what is actually there.
 *
 * Typing is only a fallback, and only for a menu long enough to be paged --
 * a school list opens on "Aalborg University" and will never show Wisconsin
 * on its own. Then one distinctive word narrows it, never the whole value.
 */
export async function setCombobox(field: HTMLInputElement, want: string): Promise<boolean> {
  const ud = Boolean(field.closest(UD_SELECT));
  if (ud) {
    await closeUdMenus();
    staleMenus.set(field, new Set(udLists()));
    try { return await pickCombobox(field, want); } finally { await closeUdMenus(); }
  }
  return pickCombobox(field, want);
}

async function pickCombobox(field: HTMLInputElement, want: string): Promise<boolean> {
  field.focus();
  fire(field, "mousedown");
  fire(field, "mouseup");
  fire(field, "click");

  // A type-first menu is empty when opened: waiting on it only costs time.
  const read = (found: Element[]) => ({ nodes, texts } = menuChoices(found));
  let nodes!: Element[], texts!: string[];
  read(needsTyping(field) ? [] : await menuOptions(field, 1500, { opening: true }));
  const exact = () => texts.findIndex((t) => normalize(t) === normalize(want));
  let searched = false;

  // An autocomplete has nothing to show until you type -- that is what a
  // "Start typing..." placeholder means. Opening it yields an empty menu,
  // so here typing is the only way to get any options at all.
  // Oracle's cx-select opens from its arrow button, not a click on the box.
  const controls = field.getAttribute("aria-controls");
  const toggle = !nodes.length && controls && !needsTyping(field) &&
    [...document.querySelectorAll<HTMLElement>(`button[aria-controls="${CSS.escape(controls)}"]`)].find((b) => b !== field);
  if (toggle) {
    toggle.click();
    read(await menuOptions(field, 1500, { opening: true }));
  }
  if (!nodes.length) {
    searched = true;
    // A place's generic tail finds nothing in a list of places: "New York
    // City" is listed as "New York".
    const place = want.replace(/\s+(?:city|metro(?:politan)?(?: area)?|area|greater)$/i, "").replace(/^greater\s+/i, "");
    for (const probe of [...new Set([want, place, narrowingToken(want)])]) {
      nativeSet(field, probe);
      read(await menuOptions(field, 3000));
      if (nodes.length) break;
    }
  }

  if (exact() < 0 && texts.length >= LONG_MENU) {
    nativeSet(field, narrowingToken(want));
    const narrowed = await menuOptions(field, 3000);
    if (narrowed.length) {
      searched = true;
      read(narrowed);
    } else {
      // The narrowing matched nothing; restore the full menu.
      nativeSet(field, "");
      read(await menuOptions(field));
    }
  }
  if (!nodes.length) {
    // A plain autocomplete keeps what you typed, so leaving it is a real
    // answer. A React Select discards it on blur, so leaving it would only
    // look filled -- clear it and report the field as still needing you.
    if (isReactSelect(field)) {
      nativeSet(field, "");
      field.blur();
      return false;
    }
    nativeSet(field, want);
    return Boolean(field.value);
  }

  let index = exact();
  // The one result of a search is the match; the one row of a menu we only
  // opened is just what it shows (a menu half-read showed a lone "No" to a
  // "Yes", and it was clicked).
  if (index < 0 && texts.length === 1 && searched) index = 0;
  // chooseAmong, not askChoice on the first 150: past Jev's list size it
  // keeps the rows sharing a word with the answer. Eightfold's 254 country
  // codes never filter as you type, and "(+1) United States" is past 150.
  if (index < 0) index = await chooseAmong(labelFor(field), want, texts);
  if (index < 0 || !nodes[index]) {
    // What we typed to search is not an answer: "United" was left in the
    // country-code box.
    if (searched) nativeSet(field, "");
    field.blur();
    return false;
  }

  // Jev takes a few hundred ms, and a menu can re-render its options in
  // the meantime (Figma's location results render twice). A click on the
  // replaced node reaches nothing, so click the option showing now.
  let target = nodes[index];
  if (!target.isConnected) {
    const want = texts[index];
    const now = menuChoices(await menuOptions(field, 1500));
    target = now.nodes[now.texts.indexOf(want)];
    if (!target) { field.blur(); return false; }
  }
  // A tree row is ticked by its checkbox, not by a click on the row.
  if (target.matches(UD_TREE_NODE)) target = target.querySelector('input[type="checkbox"]') || target;
  fire(target, "mousedown");
  fire(target, "mouseup");
  fire(target, "click");
  for (let i = 0; i < 16 && !currentValue(field); i++) await sleep(25);
  return Boolean(currentValue(field));
}
