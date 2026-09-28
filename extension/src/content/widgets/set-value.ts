/**
 * setValue: put a value into any field, whatever it is. It picks the driver
 * for the control (Workday listbox button or date, a search picker, an
 * autocomplete, a combobox, a native select) and otherwise types into a
 * plain box. Every driver sits below this file; none imports it.
 *
 * Depends on: every other widgets/ driver, discover/labels.ts,
 * discover/selectors.ts, dom/controls.ts, state.ts (dateWrappers).
 *
 * ATS quirks: React (Greenhouse, Ashby, Lever...) tracks a box's value on
 * the DOM node, so a plain `.value =` reverts on blur; the value goes
 * through the native setter plus input and change events. Workday's skills
 * picker takes several values (setMultiPrompt), its other pickers one.
 * The drivers other than a plain box are async; callers await the result.
 */
import { labelFor } from "../discover/labels.ts";
import { LISTBOX_BUTTON, PROMPT_INPUT } from "../discover/selectors.ts";
import { isCombobox } from "../dom/controls.ts";
import { dateWrappers } from "../state.ts";
import { looksLikeAutocomplete, setAutocomplete } from "./autocomplete.ts";
import { setCombobox } from "./combobox.ts";
import { formatForField, setDate } from "./date.ts";
import { setListbox } from "./listbox.ts";
import { setMultiPrompt, setPrompt } from "./prompt.ts";
import { setSelect } from "./select.ts";

/**
 * React tracks its own value on the DOM node, so assigning `.value` leaves
 * the component's state stale and the field reverts on blur. Going through
 * the native setter and dispatching an input event is what React listens for.
 */
export function setValue(field: HTMLElement, value: string): boolean | Promise<boolean> {
  if (field.matches(LISTBOX_BUTTON)) return setListbox(field, value); // async
  if (dateWrappers.has(field)) return setDate(field, value); // async
  if (field.matches(PROMPT_INPUT)) {
    return /\bskills?\b/i.test(labelFor(field)) ? setMultiPrompt(field as HTMLInputElement, value) : setPrompt(field as HTMLInputElement, value); // async
  }
  if (field.tagName === "INPUT" && !isCombobox(field) && looksLikeAutocomplete(field as HTMLInputElement)) {
    return setAutocomplete(field as HTMLInputElement, value); // async
  }
  if (isCombobox(field)) return setCombobox(field as HTMLInputElement, value); // async
  if (field.tagName === "SELECT") return setSelect(field as HTMLSelectElement, value); // async
  value = formatForField(field as HTMLInputElement, value);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
