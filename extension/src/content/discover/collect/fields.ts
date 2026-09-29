/**
 * The entry point: every field on the page, gathered from a plain form
 * control and every collector beside it, then named with its section
 * prefix and its card's heading if its own text names nothing.
 *
 * ATS quirks:
 * - ByteDance labels its phone box just "Mobile", and Jev took that for the
 *   phone *type* in my profile and typed "Mobile" into it. On a box you
 *   type into, a bare Mobile / Cell is the number (bareMobile).
 * - An electronic signature is my full legal name, typed. New York Life's
 *   bare "Applicant Electronic Signature" read as nothing in my profile and
 *   was left blank, so the question says what a signature is (signatureLabel).
 * - "If yes, please provide the name of the relative" explains a Yes; the
 *   profile never holds that explanation, and Jev filled one with "No"
 *   (FOLLOW_UP, dropped rather than asked).
 * - Two CesiumAstro (Lever) cards ask questions whose first 200 characters
 *   match, and a label is cut to 200: both arrived as one label, which
 *   answers are keyed by (distinguishByCard).
 * - A write-in ("Other: ___") inside a choice question is not that
 *   question: New York Life's (Eightfold) "Position Specific Questions" is
 *   one <fieldset> around every question, and each was taken for the
 *   "Other: ___" of some checkbox in it and dropped (insideChoiceQuestion).
 *
 * Depends on: dom/query.ts, dom/controls.ts, discover/selectors.ts,
 * discover/labels.ts, discover/gate.ts, discover/sections.ts,
 * discover/collect/{choices,widgets,checkboxes}.ts, shared/types.ts.
 */
import { deepAll } from "../../dom/query.ts";
import { visible, nodeVisible, isCombobox } from "../../dom/controls.ts";
import { FIELD_SELECTOR, DATE_PART, PROMPT_INPUT, junkLabel, QUESTION_BOX } from "../selectors.ts";
import { labelFor } from "../labels.ts";
import { pageChrome } from "../gate.ts";
import { sectionPrefix, cardQuestion, distinguishByCard } from "../sections.ts";
import { selectOptions, collectToggleGroups, collectRadioGroups } from "./choices.ts";
import { collectWidgets, monthYearWrapper } from "./widgets.ts";
import { collectCheckboxGroups, collectSingleCheckboxes } from "./checkboxes.ts";
import type { Field } from "../../../shared/types.ts";

// ByteDance labels its phone box just "Mobile", and Jev took that for the
// phone *type* in my profile and typed "Mobile" into it. On a box you type
// into, a bare Mobile / Cell is the number.
const bareMobile: (element: Element, label: string) => string = (element, label) =>
  element.tagName === "INPUT" && /^(?:mobile|cell)$/i.test(label) ? `${label} phone number` : label;

// An electronic signature is my full legal name, typed: my choice, made
// once (2026-09-21), so it is filled like any name. But Jev read New York
// Life's bare "Applicant Electronic Signature" as nothing in my profile and
// left it blank, so the question says what a signature is.
const SIGNATURE = /\b(?:e-?signature|electronic signature|signature|sign your name|type your (?:full )?name to sign)\b/i;
const signatureLabel: (element: Element, label: string) => string = (element, label) =>
  element.tagName === "INPUT" && SIGNATURE.test(label) ? `${label} (type your full legal name)` : label;

// "If yes, please provide the name of the relative" explains a Yes. The
// profile never holds that explanation, and Jev filled one with "No".
const FOLLOW_UP = /^(?:if (?:yes|so)\b|if you answered yes\b|please (?:provide|give) (?:an? )?(?:explanation|details?) if you answered yes\b)/i;

/** A write-in ("Other: ___") inside a choice question is not that question. */
function insideChoiceQuestion(element: Element): boolean {
  const box = element.closest(QUESTION_BOX);
  if (!box || box.querySelectorAll('input[type="checkbox"], input[type="radio"]').length < 2) return false;
  // A write-in is the one box in its question. A fieldset holding several
  // is a section: New York Life's (Eightfold) "Position Specific Questions"
  // is one <fieldset> around every question, and each was taken for the
  // "Other: ___" of some checkbox in it and dropped.
  return [...box.querySelectorAll(FIELD_SELECTOR)].filter(nodeVisible).length <= 1;
}

export function collectFields(): Field[] {
  const fields = deepAll(FIELD_SELECTOR)
    .filter((element) => visible(element) && !element.matches(DATE_PART) && !insideChoiceQuestion(element) && !pageChrome(element) && !monthYearWrapper(element))
    .map((element): Field => ({
      element: element as HTMLElement,
      label: signatureLabel(element, bareMobile(element, labelFor(element))),
      options: selectOptions(element),
      combobox: isCombobox(element),
      widget: element.matches(PROMPT_INPUT) ? "prompt" : null,
    }))
    .concat(collectWidgets())
    .filter((f) => f.label.length >= 2 && !junkLabel(f.label) && !FOLLOW_UP.test(f.label))
    .concat(collectToggleGroups())
    .concat(collectRadioGroups())
    .concat(collectCheckboxGroups())
    .concat(collectSingleCheckboxes())
    .map((f) => ({ ...f, label: sectionPrefix(f.element) + cardQuestion(f.element, f.label) }));
  // Answers are keyed by label, so two fields may not share one.
  return distinguishByCard(fields);
}
