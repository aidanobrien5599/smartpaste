/**
 * Reading the question a field asks: from its own label, from the wrapper
 * that owns it, from a group's shared legend, or from the text just above a
 * widget with no label of its own.
 *
 * ATS quirks:
 * - Shadow DOM components (<spl-input label="First name">) carry the label
 *   as an attribute or a same-root <label>, checked before the light DOM.
 * - Workable's phone box shares a <label> with intl-tel-input's 244
 *   countries, and a react-datepicker shares one with its calendar; the
 *   question is the part of the label the control is not in (labelOnly).
 * - Ashby's "School" search box has no id for its <label for=> to point at,
 *   so that label is found by walking just above the field's wrapper
 *   instead (labelFor's fourth pass).
 * - C3's Greenhouse-API form puts <label>Question</label> beside the
 *   input's own <div>, with no for= and no id to tie them; ByteDance wraps
 *   each input in an empty <label> and keeps the question up to seven
 *   levels up. Both are read by ownerLabel: the label of the smallest
 *   wrapper that holds this field and no other, stopping at the first
 *   wrapper holding a second control (a phone's country-code picker, or the
 *   other half of a start / end range, excepted).
 * - Vercel puts a choice group's question in a plain <p> just before the
 *   role="radiogroup"; Ashby wraps radios in a <fieldset> with no <legend>
 *   and puts the question in a <label> just above (questionFor).
 * - Rippling's custom questions keep theirs in a paragraph six wrappers up
 *   from the combobox they belong to (questionAbove).
 * - A Workday split date is labelled by its form field, not by each part's
 *   own hidden "Month" / "Year" label (dateLabel).
 * - Rippling names each box afresh on every load, so a required question
 *   with no label of its own came out as "6u6RxcGTFfn" -- the box's name --
 *   and was left blank. A placeholder or a name that is no question at all
 *   is skipped (junkLabel) and the walk goes on to questionAbove.
 *
 * Depends on: dom/text.ts, dom/controls.ts, discover/selectors.ts.
 */
import { shownText, clean } from "../dom/text.ts";
import { nodeVisible } from "../dom/controls.ts";
import { QUESTION_BOX, FIELD_SELECTOR, FIELD_ENTRY, DATE_PART, junkLabel, ANY_CONTROL, LISTBOX_BUTTON } from "./selectors.ts";

const QUESTION_TEXT = '.application-label, legend, [class*="question-label"]';

function questionText(field: Element): Element | null {
  const box = field.closest(QUESTION_BOX);
  if (!box) return null;
  // A fieldset around several fields is a section, and its legend the
  // section's title ("Position Specific Questions"), not this question.
  // (A fieldset of radios alone, as Lever draws a question, holds none.)
  if ([...box.querySelectorAll(FIELD_SELECTOR)].filter(nodeVisible).length > 1) return null;
  return box.querySelector(QUESTION_TEXT);
}

/** aria-labelledby may name several ids; their texts, in order. */
function labelledBy(field: Element): string {
  const ids = (field.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
}

// A <label> wrapped around a field wraps its whole widget, and a widget can
// carry a great deal of text. Workable's phone box shares its label with
// intl-tel-input's 244 countries, so the question arrived as "*Phone+1United
// States+1United Kingdom+44Canada..."; a date box shares its label with a
// react-datepicker ("Start date...Previous Year2026JanFeb..."). The question
// is the part of the label the control is not in.
function labelOnly(label: Element, field: Element): string | null {
  if (!label.contains(field)) return shownText(label);
  const outside = [...label.childNodes].filter((node) => node !== field && !node.contains(field));
  const text = outside.map((node) => (node.nodeType === 1 ? shownText(node as Element) : node.textContent)).join(" ");
  // A label holding nothing but the widget (ByteDance's empty ones) says
  // nothing; let the next candidate speak.
  return clean(text) ? text : shownText(label);
}

export function labelFor(field: Element): string {
  // Inside a component, the label is the component's own attribute
  // (<spl-input label="First name">), or a <label> in the same shadow root.
  const root = field.getRootNode();
  if (root instanceof ShadowRoot) {
    const host = root.host;
    const inner = (field as HTMLInputElement).id && root.querySelector(`label[for="${CSS.escape((field as HTMLInputElement).id)}"]`);
    for (const text of [inner && shownText(inner), host.getAttribute("label"), field.getAttribute("aria-label"),
      host.getAttribute("splarialabel"), host.getAttribute("aria-label")]) {
      if (clean(text)) return clean(text);
    }
  }
  const byFor =
    (field as HTMLInputElement).id && document.querySelector(`label[for="${CSS.escape((field as HTMLInputElement).id)}"]`);
  const candidates = [
    byFor,
    // What the field names as its label outranks the box it sits in.
    labelledBy(field),
    questionText(field),
    field.closest("label"),
    field.getAttribute("aria-label"),
    (field as HTMLInputElement).labels && (field as HTMLInputElement).labels![0],
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const text = clean(typeof candidate === "string" ? candidate : labelOnly(candidate, field));
    if (text) return text;
  }
  // A label whose for= names nothing on the page, just above the field's
  // wrapper: Ashby's "School" (its search box has no id to point at).
  for (let node = field.parentElement, depth = 0; node && depth < 2; node = node.parentElement, depth++) {
    const label = node.previousElementSibling;
    if (label && label.matches("label[for]") && !document.getElementById((label as HTMLLabelElement).htmlFor)) {
      const text = clean(label.textContent);
      if (text) return text;
    }
  }
  // Greenhouse and friends often put the label in a preceding sibling. Stop
  // at the first form control: anything before it is that control's label,
  // not ours, and walking past it silently steals the neighbour's name.
  let node = field.previousElementSibling;
  for (let hops = 0; node && hops < 3; hops++, node = node.previousElementSibling) {
    if (node.matches("input, textarea, select, button")) break;
    if (node.matches("label[for]") && node.getAttribute("for") !== (field as HTMLInputElement).id) break;
    const text = clean(node.textContent);
    if (text) return text;
  }
  // Last resorts, in the order they are worth having. The text above the
  // field's block outranks the field's own name, and a placeholder or a name
  // is only worth taking when it says something: Rippling names every box
  // afresh on each load, so a required question with nothing above it either
  // came out as "6u6RxcGTFfn" and was left blank.
  for (const candidate of [ownerLabel(field), (field as HTMLInputElement).placeholder,
    questionAbove(field), (field as HTMLInputElement).name]) {
    const text = clean(candidate);
    if (text && !junkLabel(text)) return text;
  }
  return "";
}

const LABEL_LIKE = 'label, legend, [class*="item-label"], [class*="field-label"], [class*="form__label"]';
const RANGE = /\b(?:start|from)\b.*\b(?:end|to|until)\b/i;

// The label of the smallest wrapper that holds this field and no other:
// C3's Greenhouse-API form puts <label>Question</label> beside the input's
// own <div>, with no for= and no id to tie them. Stops at the first
// wrapper holding a second control, whose label may be the neighbour's.
//
// ByteDance wraps each input in an empty <label> and keeps the question
// seven levels up, sometimes in a plain <div class="…-label">. Two things
// may share the wrapper without making the label someone else's: a phone
// number's country-code picker, and the other half of a start / end range.
export function ownerLabel(field: Element): string {
  let node = field.parentElement;
  for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
    const controls = [...node.querySelectorAll(ANY_CONTROL)];
    const others = controls.filter((c) => c !== field && !((c as HTMLInputElement).type === "search" && (field as HTMLInputElement).type !== "search"));
    if (others.length > 1) return "";
    const label = [...node.querySelectorAll(LABEL_LIKE)].find((l) =>
      !l.contains(field) && !((l as HTMLLabelElement).htmlFor && (l as HTMLLabelElement).htmlFor !== (field as HTMLInputElement).id) && !l.querySelector(ANY_CONTROL) && clean(l.textContent));
    const text = label ? clean(label.textContent) : "";
    if (!others.length && text) return text;
    if (others.length && text) {
      if (!RANGE.test(text) || others[0].tagName !== field.tagName) return "";
      const first = field.compareDocumentPosition(others[0]) & Node.DOCUMENT_POSITION_FOLLOWING;
      return `${text} (${first ? "start" : "end"})`;
    }
  }
  return "";
}

/**
 * The question a group of options answers: the nearest label or legend,
 * walking up from the options, that is not one of the options' own labels.
 * Ashby wraps its radios in a <fieldset> with no <legend> and puts the
 * question in a <label> just above; looking only for a legend dropped the
 * degree, graduation, veteran, disability and transgender questions.
 */
//
// Vercel puts the question in a plain <p> just before the role="radiogroup",
// and walking on up found the First Name box's <label> instead -- five
// questions asked as "First Name". A label holding or naming some other
// control is that control's; the text block just before the options is ours.
export function questionFor(inputs: Element[]): string {
  const own = (node: Element) => inputs.some((i) => node.contains(i) || ((i as HTMLInputElement).id && (node as HTMLLabelElement).htmlFor === (i as HTMLInputElement).id));
  // A label for= the group's own container is the group's question:
  // Eightfold's <label for="…_94552_1"> names the div[role=radiogroup].
  // One whose for= names nothing on the page is no other control's either:
  // Ashby's question title points at the question's id, which no element
  // has. Taken for foreign, every Ashby choice question lost its title and
  // the walk went on up to "This job has application limits…" above the
  // form, or found nothing and dropped the question.
  const foreign = (node: HTMLLabelElement) => {
    if ([...node.querySelectorAll(ANY_CONTROL)].some((c) => !inputs.includes(c))) return true;
    if (!node.htmlFor || inputs.some((i) => (i as HTMLInputElement).id === node.htmlFor)) return false;
    const target = document.getElementById(node.htmlFor);
    return Boolean(target) && !(target as Element).contains(inputs[0]);
  };
  let node = inputs[0].parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const direct = questionText(inputs[0]);
    if (direct && !own(direct) && clean(direct.textContent)) return clean(direct.textContent);
    const found = [...node.querySelectorAll("label, legend, .application-label")]
      .find((l) => !own(l) && !foreign(l as HTMLLabelElement) && clean(l.textContent));
    if (found) return clean(found.textContent);
    const before = node.previousElementSibling;
    if (before && before.matches("p, h1, h2, h3, h4, h5, h6, div, span") &&
        !before.matches(ANY_CONTROL) && !before.querySelector(`${ANY_CONTROL}, button`) && clean(before.textContent)) {
      return clean(before.textContent);
    }
  }
  return "";
}

/**
 * The question a dropdown answers, for a widget with no label of its own.
 * Rippling's custom questions keep theirs in a paragraph above the field's
 * block -- six wrappers up from the combobox, tied to it by nothing. Walk
 * out until something above has text, and stop at anything holding another
 * control: that text is the neighbour's question, not ours.
 */
function questionAbove(widget: Element): string {
  const somebodysField = `${ANY_CONTROL}, ${LISTBOX_BUTTON}`;
  for (let node: Element | null = widget, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
    for (let above = node.previousElementSibling; above; above = above.previousElementSibling) {
      if (above.matches(somebodysField) || above.querySelector(somebodysField)) return "";
      const text = clean(above.textContent);
      if (text) return text;
    }
  }
  return "";
}

/** A listbox button's question. Its aria-label also holds its current value. */
export function listboxLabel(button: Element): string {
  const byFor =
    ((button as HTMLElement).id && document.querySelector(`label[for="${CSS.escape((button as HTMLElement).id)}"]`)) as Element | null;
  const entry = button.closest(FIELD_ENTRY);
  const inEntry = entry && entry.querySelectorAll("label, legend").length === 1
    ? entry.querySelector("label, legend") : null;
  // What the widget names as its label outranks the box it sits in, as it
  // does for a field: Rippling's EEO dropdowns say "Gender" that way and
  // nowhere else (their aria-label is the placeholder, "Select...").
  const text = clean(byFor?.textContent || "") || clean(labelledBy(button)) || clean(inEntry?.textContent || "");
  if (text) return text;
  const own = clean(
    (button.getAttribute("aria-label") || "")
      .replace(button.textContent!.trim(), "")
      .replace(/\b(?:select one|required)\b/gi, "")
  );
  return own && !junkLabel(own) ? own : questionAbove(button);
}

/** A date split into boxes is one question, labelled by its form field. */
const PART_NAME = /^(?:month|day|year|mm|dd|yyyy)$/i;

/**
 * The question a split date answers: "From", not "Month". Live, each
 * Workday date box has its own hidden label ("Month", "Year") tied to it
 * with for=; taking that one asked Jev about "Work Experience 1: Month",
 * which nothing answers, and From / To were never filled.
 */
export function dateLabel(wrapper: Element): string {
  const entry = wrapper.closest(FIELD_ENTRY);
  const candidates = [
    (wrapper as HTMLElement).id && document.querySelector(`label[for="${CSS.escape((wrapper as HTMLElement).id)}"]`),
    ...(entry ? entry.querySelectorAll("label, legend") : []),
    wrapper.getAttribute("aria-labelledby") && document.getElementById(wrapper.getAttribute("aria-labelledby")!),
    ...[...wrapper.querySelectorAll(DATE_PART)].map((p) => (p as HTMLElement).id && document.querySelector(`label[for="${CSS.escape((p as HTMLElement).id)}"]`)),
  ];
  for (const node of candidates) {
    const text = node ? clean(node.textContent) : "";
    if (text && !PART_NAME.test(text)) return text;
  }
  // No label at all, only a hint beside the boxes: C3's "Start" / "End".
  const hint = [...wrapper.children].find((c) => !c.matches("input, select, textarea") && clean(c.textContent));
  return hint ? clean(hint.textContent) : "";
}

/** A group's question: its form field's own label, or Lever's / a legend. */
export function groupLabel(group: Element[]): string {
  return questionFor([...group]);
}
