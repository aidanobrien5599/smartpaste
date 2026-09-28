/**
 * Checkbox questions: "check all that apply" groups, sharing a name or a
 * form field, and a lone checkbox read as a Yes/No question.
 *
 * ATS quirks:
 * - Workday names every job's "I currently work here" box
 *   currentlyWorkHere, so by name alone two jobs' boxes looked like one
 *   check-all-that-apply question with no text, and neither was ever
 *   answered; grouping instead by the form field they sit in fixed it
 *   (CHOICE_FIELD, groupCheckboxes).
 * - Oracle groups unnamed race boxes in one .input-row--radiogroup.
 * - Workday's Self Identify asks "Please check one of the boxes below" over
 *   three boxes with names of their own, so a field with one box reads as
 *   a yes/no question instead.
 * - A lone checkbox is a yes/no question -- "I currently work here" --
 *   unless it is a consent, which is the applicant's to tick, never ours
 *   (CONSENT, collectSingleCheckboxes).
 *
 * Depends on: dom/text.ts, dom/controls.ts, discover/selectors.ts,
 * discover/labels.ts, discover/gate.ts, shared/types.ts.
 */
import { clean } from "../../dom/text.ts";
import { nodeVisible } from "../../dom/controls.ts";
import { QUESTION_BOX } from "../selectors.ts";
import { labelFor, groupLabel, ownerLabel } from "../labels.ts";
import { pageChrome } from "../gate.ts";
import type { Field } from "../../../shared/types.ts";

type CheckboxGroup = HTMLInputElement[] & { name: string; field: Element | null };

// One question's box: Workday's form field, or Lever's / a fieldset.
// Oracle: unnamed race boxes in one .input-row--radiogroup.
const CHOICE_FIELD = '[data-automation-id^="formField"], .input-row--radiogroup, ' + QUESTION_BOX;

/**
 * Which checkboxes form one question: same name AND same form field.
 * Workday names every job's "I currently work here" box currentlyWorkHere,
 * so by name alone two jobs' boxes looked like one check-all-that-apply
 * question with no text, and neither was ever answered.
 */
/**
 * Checkboxes in one form field are one question, whatever their names:
 * Workday's Self Identify asks "Please check one of the boxes below" over
 * three boxes with names of their own. Outside any field, a name groups
 * them. A field with one box is a yes/no question ("I currently work here").
 */
export function groupCheckboxes(): CheckboxGroup[] {
  const groups: CheckboxGroup[] = [];
  for (const box of document.querySelectorAll('input[type="checkbox"]')) {
    if ((box as HTMLInputElement).disabled) continue;
    const field = box.closest(CHOICE_FIELD);
    const name = (box as HTMLInputElement).name || box.id;
    const group = field
      ? groups.find((g) => g.field === field)
      : name && groups.find((g) => !g.field && g.name === name);
    if (group) group.push(box as HTMLInputElement);
    else groups.push(Object.assign([box as HTMLInputElement], { name, field }));
  }
  return groups;
}

/**
 * "Check all that apply": native checkboxes sharing a name, under one
 * question (Lever's language and office questions). Several may be right,
 * so the answer is a list of options, not one.
 */
export function collectCheckboxGroups(): Field[] {
  const groups = new Map(groupCheckboxes().filter((g) => g.length > 1).map((g, i): [number, CheckboxGroup] => [i, g]));
  const fields: Field[] = [];
  for (const boxes of groups.values()) {
    if (boxes.length < 2 || boxes.length > 60) continue;
    const first = boxes[0];
    const label = groupLabel(boxes);
    const options = boxes.map((b) =>
      clean(
        b.closest("label")?.textContent ||
          (b.id && document.querySelector(`label[for="${CSS.escape(b.id)}"]`)?.textContent) ||
          b.value || ""
      )
    );
    if (label.length < 2 || options.some((o) => !o)) continue;
    const element = (boxes.field || first.closest(QUESTION_BOX) || first.parentElement) as HTMLElement;
    if (!nodeVisible(element)) continue;
    fields.push({ element, label, options, buttons: boxes, combobox: false, multi: true });
  }
  return fields;
}

// A lone checkbox is a yes/no question -- "I currently work here" -- unless
// it is a consent. Those are the applicant's to tick, never ours.
const CONSENT = /agree|accept|consent|terms|privacy|acknowledg|certif|attest|marketing|newsletter|subscribe|remember me|save my (?:answers|information|details|profile)|sms|text messages?|contact me|do not sell/i;

export function collectSingleCheckboxes(): Field[] {
  const fields: Field[] = [];
  for (const [box, ...rest] of groupCheckboxes()) {
    if (rest.length || pageChrome(box)) continue;
    const label = labelFor(box) ||
      clean(box.closest('[data-automation-id^="formField"]')?.querySelector("label, legend")?.textContent || "");
    // The box's own text can be a bare "I Accept" under a privacy notice,
    // so the question around it gets a say too.
    if (label.length < 3 || CONSENT.test(label) || CONSENT.test(ownerLabel(box))) continue;
    const shown = box.closest("label, [data-automation-id^='formField']") || box;
    if (!nodeVisible(shown) && !nodeVisible(box)) continue;
    fields.push({ element: box, label, options: ["Yes", "No"], buttons: [box], combobox: false, single: true });
  }
  return fields;
}
