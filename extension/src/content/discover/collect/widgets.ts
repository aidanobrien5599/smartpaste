/**
 * The widgets collectFields() has to find beyond a form control: Workday's
 * listbox buttons, and a date split across month / day / year boxes.
 *
 * ATS quirks:
 * - Workday marks a date box's wrapper with
 *   [data-automation-id="dateInputWrapper"] (DATE_WRAPPER); when it doesn't,
 *   the nearest formField or plain parent stands in for it.
 * - A Month... <select> with a Year beside it under one label is a split
 *   date too: a Year... <select> (Ashby's education Start Date / End Date),
 *   or a number box whose placeholder says Year (C3's Greenhouse-API form).
 *
 * Depends on: dom/controls.ts, state.ts, discover/selectors.ts,
 * discover/labels.ts, shared/types.ts.
 */
import { nodeVisible } from "../../dom/controls.ts";
import { dateWrappers } from "../../state.ts";
import { LISTBOX_BUTTON, DATE_PART } from "../selectors.ts";
import { listboxLabel, dateLabel } from "../labels.ts";
import type { Field } from "../../../shared/types.ts";

const DATE_WRAPPER = '[data-automation-id="dateInputWrapper"]';

// A Month... dropdown with a Year beside it under one label is a split
// date: a Year... <select> (Ashby's education Start Date / End Date), or a
// number box whose placeholder says Year (C3's Greenhouse-API form).
const YEAR_BOX = 'input[placeholder="Year" i]';
export function monthYearWrapper(select: Element): Element | null {
  const sel = select as HTMLSelectElement;
  if (sel.tagName !== "SELECT" || !/^month/i.test(sel.options[0]?.textContent!.trim() || "")) return null;
  const isMonth = (s: HTMLSelectElement) => /^month/i.test(s.options[0]?.textContent!.trim() || "");
  const hasYear = (node: Element) => node.querySelector(YEAR_BOX) ||
    [...node.querySelectorAll("select")].some((s) => /^year/i.test(s.options[0]?.textContent!.trim() || ""));
  // One date only: the nearest id'd wrapper (Ashby, whose label points at
  // it) unless that holds a second date too -- C3's is the whole page.
  const onlyDate = (node: Element | null | undefined) => node && [...node.querySelectorAll("select")].filter(isMonth).length === 1 && hasYear(node);
  const byId = sel.parentElement?.closest("[id]");
  if (onlyDate(byId)) return byId!;
  let node = sel.parentElement;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    if (onlyDate(node)) return node;
    if ([...node.querySelectorAll("select")].filter(isMonth).length > 1) break;
  }
  return null;
}

export function collectWidgets(): Field[] {
  const fields: Field[] = [];
  for (const button of document.querySelectorAll(LISTBOX_BUTTON)) {
    // A div says it is disabled with aria-disabled; only a button has .disabled.
    if (!nodeVisible(button) || (button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true" ||
      button.closest(".smartpaste-button")) continue;
    fields.push({ element: button as HTMLElement, label: listboxLabel(button), options: null, combobox: false, widget: "listbox" });
  }
  const wrappers = new Set<Element>();
  for (const select of document.querySelectorAll("select")) {
    const wrapper = monthYearWrapper(select);
    if (wrapper && nodeVisible(wrapper)) wrappers.add(wrapper);
  }
  for (const part of document.querySelectorAll(DATE_PART)) {
    const wrapper = part.closest(DATE_WRAPPER) || part.closest('[data-automation-id^="formField"]') || part.parentElement;
    if (wrapper && nodeVisible(wrapper)) wrappers.add(wrapper);
  }
  for (const wrapper of wrappers) {
    dateWrappers.add(wrapper);
    fields.push({ element: wrapper as HTMLElement, label: dateLabel(wrapper), options: null, combobox: false, widget: "date" });
  }
  return fields;
}
