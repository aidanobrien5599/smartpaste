/**
 * Choice fields collectFields() has to find beyond a plain <select>: a
 * dropdown's own answer set, Ashby's button-drawn toggles, and native radio
 * groups by name.
 *
 * ATS quirks:
 * - Lever's school picker holds 2,965 universities; sent without a cap the
 *   sixty options that used to go were Australia's, alphabetical by
 *   country, and Jev rightly picked none of them (MAX_SENT_OPTIONS).
 * - Ashby renders Yes/No as two <button aria-pressed> over a hidden
 *   checkbox; the checkbox is invisible so it is skipped, and the buttons
 *   are not form controls, so without collectToggleGroups the question is
 *   simply never seen. Oracle's Yes/No "pills" sit in a plain .input-row,
 *   named by their ul[role=radiogroup]'s own aria-label.
 * - Lever asks its sponsorship question as native radios grouped by name,
 *   which is neither a text field nor a toggle button.
 * - Vercel's "Where did you first hear about this role?" radio group has
 *   14 options.
 *
 * Depends on: dom/text.ts, dom/controls.ts, discover/selectors.ts,
 * discover/labels.ts, shared/types.ts.
 */
import { clean } from "../../dom/text.ts";
import { nodeVisible } from "../../dom/controls.ts";
import { FIELD_ENTRY, QUESTION_BOX } from "../selectors.ts";
import { questionFor } from "../labels.ts";
import type { Field } from "../../../shared/types.ts";

// Yes/No rendered as buttons over a hidden checkbox, as Ashby does it.
const TOGGLE_SELECTOR =
  'button[aria-pressed], button[role="radio"], [role="radio"], [data-option]';

// What a question may carry with it. Past this a dropdown is a directory,
// not a set of answers: Lever's school picker holds 2,965 universities,
// alphabetical by country, and the sixty that used to be sent were
// Australia's -- Jev rightly picked none of them, live, and Shield AI's
// required school was left blank. Sent without options the question is
// answered from the profile as text, and setSelect matches that answer
// against the whole list (localMatch first, then a narrowed askChoice).
const MAX_SENT_OPTIONS = 60;

/** A dropdown carries its own answer set, so send it along with the label. */
export function selectOptions(element: Element): string[] | null {
  if (element.tagName !== "SELECT") return null;
  // Each wording once, for the same reason as askChoice().
  const texts = [...new Set([...(element as HTMLSelectElement).options]
    .map((o) => o.textContent!.trim())
    .filter((t) => t && !/^(?:select|choose|please select|--)/i.test(t)))];
  return texts.length > MAX_SENT_OPTIONS ? null : texts;
}

/**
 * Choice fields built from buttons rather than form controls.
 *
 * Ashby renders yes/no as two <button aria-pressed> over a hidden checkbox.
 * The checkbox is invisible so it is skipped, and the buttons are not form
 * controls, so without this the question is simply never seen.
 */
export function collectToggleGroups(): Field[] {
  const groups = new Map<Element, HTMLElement[]>();
  for (const button of document.querySelectorAll(TOGGLE_SELECTOR)) {
    if (!nodeVisible(button)) continue;
    // Oracle's Yes/No "pills" sit in a plain .input-row; their
    // ul[role=radiogroup] carries the question as its aria-label.
    const wrap = button.closest(FIELD_ENTRY) || button.closest('[role="radiogroup"][aria-label]');
    if (!wrap) continue;
    if (!groups.has(wrap)) groups.set(wrap, []);
    groups.get(wrap)!.push(button as HTMLElement);
  }
  const fields: Field[] = [];
  for (const [wrap, buttons] of groups) {
    // One label and a handful of buttons means one question; more than that
    // and we have walked up into a container holding several fields.
    const named = wrap.matches('[role="radiogroup"][aria-label]') ? wrap.getAttribute("aria-label") : null;
    // A group the page itself names as one question can be long: Oracle's
    // Degree is ten pills. Unnamed, more than eight is several fields.
    if (buttons.length < 2 || buttons.length > (named ? 20 : 8)) continue;
    if (!named && wrap.querySelectorAll("label, legend").length !== 1) continue;
    const label = clean(named ?? wrap.querySelector("label, legend")!.textContent);
    const options = buttons.map((b) => b.textContent!.trim()).filter(Boolean);
    if (label.length < 2 || options.length !== buttons.length) continue;
    fields.push({ element: wrap as HTMLElement, label, options, buttons, combobox: false });
  }
  return fields;
}

export function toggleAnswered(field: Field): boolean {
  return field.buttons!.some(
    (b) =>
      (b as HTMLInputElement).checked ||
      b.getAttribute("aria-pressed") === "true" ||
      b.getAttribute("aria-checked") === "true"
  );
}

/**
 * Native radio buttons, grouped by name. Lever asks its sponsorship question
 * this way, and a radio is neither a text field nor a toggle button, so the
 * question was simply never collected.
 */
export function collectRadioGroups(): Field[] {
  const groups = new Map<string, HTMLInputElement[]>();
  for (const radio of document.querySelectorAll('input[type="radio"]')) {
    const r = radio as HTMLInputElement;
    if (!r.name || r.disabled) continue;
    if (!groups.has(r.name)) groups.set(r.name, []);
    groups.get(r.name)!.push(r);
  }
  const fields: Field[] = [];
  for (const radios of groups.values()) {
    // Vercel's "Where did you first hear about this role?" has 14.
    if (radios.length < 2 || radios.length > 20) continue;
    const first = radios[0];
    const label = questionFor(radios);
    const options = radios.map((r) =>
      clean(
        r.closest("label")?.textContent ||
          (r.id && document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent) ||
          r.value || ""
      )
    );
    if (label.length < 2 || options.some((o) => !o)) continue;
    const element = (first.closest(QUESTION_BOX) || first.parentElement) as HTMLElement;
    if (!nodeVisible(element) && !radios.some(nodeVisible)) continue;
    fields.push({ element, label, options, buttons: radios, combobox: false });
  }
  return fields;
}
