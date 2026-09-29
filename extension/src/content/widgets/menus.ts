/**
 * Reading any open menu, whoever drew it: finding the menu that belongs to
 * a field, waiting for its options, reading all of them (scrolling a
 * virtualized list), finding one option's node again, clicking it where it
 * listens, and closing menus afterwards. Every dropdown driver builds on
 * this file.
 *
 * Depends on: discover/selectors.ts, dom/controls.ts, dom/query.ts,
 * dom/text.ts, state.ts (staleMenus).
 *
 * ATS quirks:
 * - Greenhouse (React Select): scope a menu by aria-controls, since a bare
 *   [role=option] query sweeps up a phone widget's 244 countries; its "No
 *   options" notice lives under the whole select, not beside the control.
 * - Figma's location box has no aria-controls; its menu is React Select's
 *   sibling. Garner Health's School says "No options" for a tick before its
 *   search starts, so a notice must stand NOTICE_HOLDS before it counts.
 * - ByteDance (Universe Design): rows have no role, each in its own wrapper,
 *   so the menu is the whole .ud__select__list; a menu left open by another
 *   field is stale, not this one's (it once answered work authorization
 *   from the sponsorship menu, with No); its location picker is a tree whose
 *   leaves are named by path ("San Jose" is in Costa Rica and California).
 * - Oracle's cx-select lists rows as gridcells of a role="grid".
 * - Workday draws only the rows in view (250 countries show a dozen), marks
 *   the open popup data-automation-activepopup, lets a closing popup linger
 *   on screen, nests options (li[role=option] > div[promptOption]), takes a
 *   click on the row rather than its label, and can ignore Escape.
 */
import { NOT_A_SUGGESTION, UD_SELECT, UD_TREE_NODE } from "../discover/selectors.ts";
import { SELECT_SHELL, nodeVisible } from "../dom/controls.ts";
import { click, frames, press, scroller, sleep } from "../dom/query.ts";
import { normalize, optionText } from "../dom/text.ts";
import { staleMenus } from "../state.ts";

/**
 * A menu's option texts, read in order. It also carries where each option
 * was seen (`at`, option text -> the list's scrollTop) and, after a survey
 * that already picked the answer, `done`.
 */
export type MenuTexts = string[] & {
  at?: any; // a Map<string, number>; the name shadows Array's own .at on purpose, so no narrower type fits
  done?: boolean;
};

const OPTION = '[role="option"], [data-automation-id*="promptOption"]';

// A Workday result row: a radio circle plus a promptOption label. The row
// takes the click; the label inside it does not.
const PROMPT_LEAF = '[data-automation-id="promptLeafNode"]';

const UD_OPTION = `.ud__select__list__item, ${UD_TREE_NODE}`;

// Oracle's cx-select lists its rows as gridcells of a role="grid". Only
// ever read inside the field's own aria-controls menu (menuFor), so a date
// picker's calendar grid is never taken for a list of answers.
const MENU_OPTION = `[role="option"], [role="gridcell"], ${UD_OPTION}`;

/**
 * A menu's rows as choices. In a tree only the leaves are, each named by
 * its path: "San Jose" alone is in Costa Rica and in California.
 */
export function menuChoices(nodes: Element[]): { nodes: Element[]; texts: string[] } {
  const tree = nodes.filter((n) => n.matches(UD_TREE_NODE));
  if (!tree.length) return { nodes, texts: nodes.map((n) => n.textContent!.trim()) };
  const depth = (n: Element) => n.querySelectorAll(".ud__tree__node__indent").length;
  const name = (n: Element) => n.querySelector(".ud__tree__node__label")?.textContent!.trim() || n.textContent!.trim();
  const path: string[] = [];
  const leaves: [Element, string][] = [];
  for (const node of tree) {
    path.length = depth(node);
    path.push(name(node));
    const leaf = !node.querySelector(".ud__expandButton") || node.querySelector(".ud__expandButton-as-placeholder");
    if (leaf) leaves.push([node, path.join(" / ")]);
  }
  return { nodes: leaves.map(([n]) => n), texts: leaves.map(([, t]) => t) };
}

export const udLists: () => Element[] = () => [...new Set([...document.querySelectorAll(UD_OPTION)].filter(nodeVisible)
  .map((n) => n.closest(".ud__select__list") || n.parentElement))] as Element[];

/** Close whatever ByteDance menu is open; true once none shows. */
export async function closeUdMenus(): Promise<boolean> {
  for (let attempt = 0; attempt < 3 && udLists().length; attempt++) {
    const active = document.activeElement;
    if (active && active !== document.body) {
      press(active, "Escape", 27);
      (active as HTMLElement).blur();
    }
    for (const type of ["mousedown", "mouseup", "click"]) {
      document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    for (let i = 0; i < 10 && udLists().length; i++) await sleep(30);
  }
  return !udLists().length;
}

/**
 * A combobox's menu: by aria-controls, or else React Select's sibling
 * menu. Figma's location box has no aria-controls at all, so looking only
 * there never saw its menu and sat out every timeout.
 */
function menuFor(field: Element): Element | null {
  const id = field.getAttribute("aria-controls");
  const menu = (id && document.getElementById(id)) ||
    selectRoot(field)?.querySelector('[class*="select__menu"]');
  if (menu || !field.closest(UD_SELECT)) return menu || null;
  // Each row has a wrapper of its own, so the list is the menu, not a parent.
  // A menu left open by the field before is not this one's -- reading it
  // answered "authorized to work?" from the sponsorship menu, with No.
  const stale = staleMenus.get(field) || new Set();
  const lists = udLists().filter((l) => !stale.has(l));
  const at = field.getBoundingClientRect();
  const gap = (list: Element) => {
    const r = list.getBoundingClientRect();
    return Math.min(Math.abs(r.top - at.bottom), Math.abs(at.top - r.bottom));
  };
  return lists.sort((a, b) => gap(a) - gap(b))[0] || null;
}

/** The whole React Select: control, menu and notices all live under it. */
function selectRoot(field: Element): Element | null {
  return field.closest('[class*="select-shell"], [class*="select__container"]') ||
    field.closest(SELECT_SHELL)?.parentElement || null;
}

// Opening a menu shows it at once, even if its options are still loading
// (a school list). Nothing at all after this long means it will not open
// until typed into.
const OPENS_WITHIN = 300;

// A search box says "No options" the moment it is typed into, before its
// debounced search has begun: Garner Health's School showed it for a tick,
// then "Loading...", then the Wisconsin schools. Believed at once, it had
// the fill give up on the search and School left blank.
const NOTICE_HOLDS = 250;

/**
 * Read a combobox's menu, scoped by aria-controls.
 *
 * Scoping matters: a bare [role=option] query sweeps up every open menu on
 * the page, and a phone widget's 244 countries will happily swamp a Yes/No.
 * Options can also load asynchronously -- a school list arrives well after
 * the menu opens -- so this polls rather than sleeping once.
 */
export async function menuOptions(field: Element, timeout = 2500, { opening = false } = {}): Promise<Element[]> {
  const started = Date.now();
  let settled: number | null = null; // since when a "No options" notice has stood
  while (Date.now() - started < timeout) {
    const menu = menuFor(field);
    const nodes = menu ? [...menu.querySelectorAll(MENU_OPTION)] : [];
    if (nodes.length) return nodes;
    // An open menu saying "No options" is an answer, not a slow load --
    // once it has stood long enough not to be the pre-search tick.
    const notice = menuNotice(field);
    settled = notice && !/loading|searching/i.test(notice) ? settled ?? Date.now() : null;
    if (settled !== null && Date.now() - settled >= NOTICE_HOLDS) return [];
    // Opened and still empty with no "Loading" notice: it lists nothing
    // until typed into (Greenhouse's location box shows a bare empty list).
    if (opening && Date.now() - started > OPENS_WITHIN) return [];
    await sleep(25);
  }
  return [];
}

function menuNotice(field: Element): string {
  // Under the whole select: on Greenhouse the menu is not a sibling of the
  // control, so looking beside it missed "No options" and sat out 1.5s.
  const root = selectRoot(field);
  const notice = root && root.querySelector('[class*="menu-notice"]');
  return notice && nodeVisible(notice) ? notice.textContent!.trim() : "";
}

/**
 * Options showing in whatever menu just opened for `anchor`. The menu is
 * portalled to the end of <body>, so it is found by position, not nesting:
 * the visible options nearest the thing that opened it.
 */
export function optionsNear(anchor: Element): Element[] {
  // The popup this anchor opened, when we know it. Nothing else can be
  // confused for it -- not a menu left over from the field before, not one
  // that merely sits nearby.
  const id = anchor.getAttribute("aria-controls");
  const owned = (id && document.getElementById(id)) || ownPopup.get(anchor);
  if (owned?.isConnected && nodeVisible(owned)) {
    const rows = leafOptions(owned);
    if (rows.length) return rows;
  }
  // Workday marks the open popup data-automation-activepopup="true" and
  // its field aria-expanded="true". Read only that popup: a menu that just
  // closed stays on screen for a moment as it animates out, and reading
  // by position picked up its options -- State's list when opening Phone
  // Device Type, so "Mobile" was never there to be chosen.
  if (anchor.hasAttribute("aria-expanded")) {
    const popups = [...document.querySelectorAll('[data-automation-activepopup="true"]')].filter(nodeVisible);
    if (popups.length) {
      if (anchor.getAttribute("aria-expanded") !== "true") return [];
      return leafOptions(popups[popups.length - 1]);
    }
  }
  const box = anchor.getBoundingClientRect();
  return leafOptions(document).filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > box.top - 500 && rect.top < box.bottom + 700;
  });
}

/** Visible options under `root`, innermost only (see optionsNear). */
function leafOptions(root: ParentNode): Element[] {
  return [...root.querySelectorAll(OPTION)].filter((node) => {
    // Options nest on Workday (li[role=option] > div[promptOption]). Keep
    // the innermost, which carries the label; optionTarget() climbs back
    // to the row for the click. Dropping both levels -- as this once did --
    // found no options at all, and every Workday menu timed out.
    if (node.querySelector(OPTION)) return false;
    if (!node.getBoundingClientRect().height) return false;
    return !NOT_A_SUGGESTION.test(optionText(node));
  });
}

export async function waitForOptions(anchor: Element, timeout = 2500): Promise<Element[]> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const nodes = optionsNear(anchor);
    if (nodes.length) return nodes;
    await sleep(40);
  }
  return [];
}

/**
 * Every option in a menu, including the ones not rendered yet. Workday only
 * draws the rows in view, so a 250-country list shows a dozen until you
 * scroll -- reading it means scrolling it. Stops early on `stopAt`.
 */
export async function readMenu(anchor: Element, stopAt?: string): Promise<MenuTexts> {
  let nodes = optionsNear(anchor);
  const texts: MenuTexts = [];
  // Where each option was seen, so clicking it later is one jump, not a
  // second scroll through the whole list.
  texts.at = new Map();
  let pane: Element | null | 0 = null;
  const add = (list: Element[]) => list.forEach((n) => {
    const t = optionText(n);
    if (texts.includes(t)) return;
    texts.push(t);
    texts.at.set(t, pane ? pane.scrollTop : 0);
  });
  add(nodes);
  pane = nodes.length && scroller(nodes[0]);
  if (!pane) return texts;
  pane.scrollTop = 0;
  // The rows on screen right now, to tell a redrawn list from one that has
  // not caught up yet.
  const drawn = () => optionsNear(anchor).map(optionText).join("\u0000");
  const newRows = (before: string) => { const now = drawn(); return Boolean(now) && now !== before; };
  for (let step = 0; step < 80; step++) {
    if (stopAt && texts.some((t) => normalize(t) === normalize(stopAt))) break;
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) break;
    const before = drawn();
    pane.scrollTop += Math.max(40, pane.clientHeight * 0.9);
    pane.dispatchEvent(new Event("scroll"));
    // A virtualized list draws the rows for the new scrollTop a frame or
    // two later -- but plenty draw them in the scroll handler itself, and
    // two frames spent per step on every step is what made Workday's 250
    // countries cost 0.85s. Wait for rows that are both there and new, no
    // longer than the two frames this always took: a list caught with no
    // rows at all is mid-redraw, not redrawn.
    for (let waited = 0; waited < 2 && !newRows(before); waited++) await frames(1);
    add(optionsNear(anchor));
  }
  return texts;
}

/** The node for option `text`, scrolling it into existence if need be. */
export async function findOption(anchor: Element, text: string, seenAt?: number): Promise<Element | null | undefined> {
  const here = () => optionsNear(anchor).find((n) => optionText(n) === text);
  if (here()) return here();
  const first = optionsNear(anchor)[0];
  const pane = first && scroller(first);
  if (!pane) return null;
  // Look before every wait, not after: a list that draws its rows in the
  // scroll handler has the row there already, and sleeping first cost a
  // flat 40ms on every jump back to where the option was seen.
  if (seenAt !== undefined) {
    pane.scrollTop = seenAt;
    pane.dispatchEvent(new Event("scroll"));
    for (let i = 0; i < 5; i++) { if (here()) return here(); await sleep(40); }
  }
  pane.scrollTop = 0;
  for (let step = 0; step < 80; step++) {
    pane.dispatchEvent(new Event("scroll"));
    if (here()) return here();
    await sleep(50);
    if (here()) return here();
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) break;
    pane.scrollTop += Math.max(40, pane.clientHeight * 0.8);
  }
  return null;
}

// Every container a menu can be drawn in. Used to tell which popup a button
// opened: the one that was not on screen before it was clicked.
const POPUP = '[data-automation-activepopup], [data-automation-id="activeListContainer"], ' +
  '[role="listbox"], [role="grid"], [class*="popup" i], [class*="menu" i]';
const ownPopup = new WeakMap<Element, Element>();

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

const ACTIVE_POPUP =
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

// How long a clicked row is given to show that it took the click.
const TOOK_THE_CLICK = 240;

/** The element that actually takes an option's click. */
const optionTarget: (node: Element) => Element = (node) => node.closest(PROMPT_LEAF) || node.closest('[role="option"]') || node;

export function optionPicked(node: Element): boolean {
  const target = optionTarget(node);
  return target.getAttribute("data-automation-checked") === "Checked" ||
    target.getAttribute("aria-selected") === "true" ||
    target.getAttribute("aria-checked") === "true";
  // Not a ticked radio inside it: a bare radio ticks itself when clicked,
  // whether or not the widget took the choice.
}

/**
 * Click an option where it listens: the row, not the label inside it. If
 * the row did not take it, its own radio / checkbox is the last resort --
 * never a second click on the row, which would untick a multiselect.
 *
 * `took` is the caller's own proof the click landed, and it is what makes
 * this fast. Not every widget marks the row: a Workday result row sets
 * data-automation-checked, but a dropdown button only changes its own
 * text, so waiting for a mark that never comes sat out the whole budget --
 * 240ms on every menu and on every skill added, a quarter of a Workday
 * fill. Both signals land in the same tick as the click, so they are
 * polled for, and checked once before any waiting at all.
 */
export async function pickOption(node: Element, took: () => boolean = () => false): Promise<void> {
  const target = optionTarget(node);
  target.scrollIntoView({ block: "nearest" });
  click(target);
  for (const deadline = Date.now() + TOOK_THE_CLICK; Date.now() < deadline;) {
    if (!target.isConnected || optionPicked(node) || took()) return;
    await sleep(10);
  }
  const box = target.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
  if (box && !box.checked) { click(box); await sleep(200); }
}

/** Close whatever popup is open and let it go before opening another. */
export async function settlePopups(field: Element): Promise<void> {
  const open = () => [...document.querySelectorAll('[data-automation-activepopup="true"]')].some(nodeVisible);
  if (!open()) return;
  closeMenu(field);
  for (let i = 0; i < 20 && open(); i++) await sleep(25);
}
