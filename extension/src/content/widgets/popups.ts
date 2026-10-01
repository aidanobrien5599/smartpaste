/**
 * Which popup belongs to which field, and closing them again. Every menu on
 * a page looks alike from the outside, so telling one apart from the menu
 * that closed a moment ago is its own problem -- kept here, away from
 * reading and clicking the rows (widgets/menus.ts).
 *
 * Depends on: dom/controls.ts (nodeVisible), dom/query.ts.
 *
 * ATS quirks: Adobe's Workday marks no popup data-automation-activepopup
 * and leaves a closed menu on screen, so a popup is remembered as the one
 * that was not there before its field was clicked. Workday puts the
 * expanded flag on a dropdown button itself but, on a search prompt, on the
 * container around the <input> rather than the input. Workday's popups can
 * ignore Escape; a click outside shuts them.
 */
import { nodeVisible } from "../dom/controls.ts";
import { click, press, sleep } from "../dom/query.ts";

// Every container a menu can be drawn in. Used to tell which popup a button
// opened: the one that was not on screen before it was clicked.
const POPUP = '[data-automation-activepopup], [data-automation-id="activeListContainer"], ' +
  '[role="listbox"], [role="grid"], [class*="popup" i], [class*="menu" i]';
export const ownPopup = new WeakMap<Element, Element>();

/** The popups on screen right now, to compare against after opening one. */
export function popupsNow(): Set<Element> {
  return new Set([...document.querySelectorAll(POPUP)].filter(nodeVisible));
}

/**
 * Remember the popup this anchor just opened.
 *
 * Adobe's Workday marks no popup data-automation-activepopup, so reading
 * fell back to position -- and a menu near the field answered for it. State
 * came back "United States of America (+1) | Select One | Alabama...", the
 * phone's country-code list merged into it, and a Yes/No menu was answered
 * by clicking a row belonging to the question above it.
 */
export function rememberPopup(anchor: Element, before: Set<Element>): void {
  const fresh = [...document.querySelectorAll(POPUP)].filter((p) => nodeVisible(p) && !before.has(p));
  // The innermost of the new ones: a popup often sits inside a wrapper that
  // is new too, and the rows live in the innermost.
  const own = fresh.filter((p) => !fresh.some((other) => other !== p && p.contains(other))).pop();
  if (own) ownPopup.set(anchor, own);
}

export const ACTIVE_POPUP =
  '[data-automation-activepopup="true"], [data-automation-id="activeListContainer"]';

/** Close a menu. Workday's popups can ignore Escape; a click outside shuts them. */
export function closeMenu(field: Element): void {
  press(document.activeElement || field, "Escape", 27);
  (field as HTMLElement).blur();
  if ([...document.querySelectorAll(ACTIVE_POPUP)].some(nodeVisible)) {
    const outside = document.querySelector("#mainContent, main");
    if (outside) click(outside);
  }
}

/**
 * Whether the thing that opened a menu says it is open: true, false, or
 * null when nothing nearby says either way.
 *
 * Workday puts the flag on a dropdown button itself, but on a search prompt
 * the <input> carries aria-expanded="false" forever and the container around
 * it is what flips to true. Asking the input alone had Adobe's "How Did You
 * Hear About Us?" read 0 options with its popup open in front of it, and the
 * question was left blank -- while every dropdown button on the page filled.
 * Only the field's own wrappers are consulted, so a collapsible section
 * standing open is not read as this field's menu.
 */
export function saysOpen(anchor: Element): boolean | null {
  let said: boolean | null = null;
  let node: Element | null = anchor;
  for (let up = 0; node && up < 3; up++, node = node.parentElement) {
    const flag = node.getAttribute("aria-expanded");
    if (flag === "true") return true;
    if (flag === "false") said = false;
  }
  return said;
}

/** The popup standing open for this anchor, whether or not it holds rows. */
export function openPopup(anchor: Element): Element | null {
  const id = anchor.getAttribute("aria-controls");
  const owned = (id && document.getElementById(id)) || ownPopup.get(anchor);
  if (owned?.isConnected && nodeVisible(owned)) return owned;
  if (saysOpen(anchor) === false) return null;
  const popups = [...document.querySelectorAll(ACTIVE_POPUP)].filter(nodeVisible);
  return popups[popups.length - 1] || null;
}

/** Close whatever popup is open and let it go before opening another. */
export async function settlePopups(field: Element): Promise<void> {
  const open = () => [...document.querySelectorAll('[data-automation-activepopup="true"]')].some(nodeVisible);
  if (!open()) return;
  closeMenu(field);
  for (let i = 0; i < 20 && open(); i++) await sleep(25);
}
