/**
 * The CSS selectors and regexes discover/ shares across its modules: what
 * counts as a file input, a fillable text field, a section box, or
 * Workday's own listbox / date / tree widgets. A constant used by several
 * discover modules lives here, the lowest one.
 *
 * ATS quirks (see each constant's own comment for the full story):
 * - Workday builds its forms from widgets rather than form controls
 *   (LISTBOX_BUTTON, PROMPT_INPUT, DATE_PART). LISTBOX_BUTTON also covers
 *   Rippling, which draws the same dropdown as a <div role="combobox">.
 * - Rippling's empty-dropdown placeholder is "Select...", so the ellipsis
 *   is part of the emptiness (EMPTY_BUTTON), not of an answer.
 * - Lever wraps inputs in a <label> that also holds status text, and its
 *   custom questions have no label at all (QUESTION_BOX).
 * - ByteDance's own select ("Universe Design") renders its menu away from
 *   the control with no aria-controls (UD_SELECT), and its location picker
 *   is a tree of checkbox rows (UD_TREE_NODE).
 *
 * Depends on nothing else in content/.
 */

export const FILE_SELECTOR = 'input[type="file"]';
export const JUNK_LABELS = /^(?:select\.{0,3}|choose\.{0,3}|please select|search|--)$/i;
export const FIELD_ENTRY =
  '[class*="fieldEntry"], [class*="field-entry"], [class*="formField"], ' +
  '[data-automation-id^="formField"], .application-question, fieldset';
// Workday builds its forms from widgets rather than form controls: a
// dropdown is a <button> that opens a listbox, a searchable picker is a text
// input that only takes a value by choosing from its results, and a date is
// split into month / day / year boxes.
// Others draw the same dropdown as a plain element: Rippling's whole EEO
// block is <div role="combobox" aria-haspopup="listbox" tabindex="0">. An
// <input> with that role is a searchable combobox instead, and stays a
// field of its own (COMBO_SELECTOR) rather than a menu.
export const LISTBOX_BUTTON = 'button[aria-haspopup="listbox"], ' +
  '[role="combobox"][aria-haspopup="listbox"]:not(input):not(select):not(textarea)';
export const PROMPT_INPUT =
  'input[data-uxi-widget-type="selectinput"], ' +
  '[data-automation-id="multiSelectContainer"] input[type="text"]';
// Workday marks date boxes either way: dateSectionMonth-input, or just an
// aria-label of Month / Day / Year (its My Experience step).
export const DATE_PART = '[data-automation-id^="dateSection"], input[aria-label="Month"], ' +
  'input[aria-label="Day"], input[aria-label="Year"]';
// What a dropdown shows while it holds nothing. Rippling's placeholder is
// "Select...", so the ellipsis is part of the emptiness, not of an answer.
export const EMPTY_BUTTON = /^(?:select one|select(?:\.{3}|…)?|choose one|choose(?:\.{3}|…)?|--)?$/i;
// Where a question keeps its text when the input has no label of its own.
// Lever wraps inputs in a <label> that also holds status text ("No location
// found. Try entering…"), and its custom questions have no label at all.
export const QUESTION_BOX = '.application-question, [role="radiogroup"], fieldset';
export const FIELD_SELECTOR =
  'input:not([type]), input[type="text"], input[type="email"], ' +
  'input[type="tel"], input[type="url"], input[type="search"], ' +
  'input[type="date"], textarea, select';

export const ANY_CONTROL = 'input:not([type="hidden"]):not([type="file"]), textarea, select';

export const NOT_A_SUGGESTION = /^(?:no .* found|no items|loading|searching)/i;

// ByteDance's own select (its "Universe Design"): the menu is rendered
// away from the control, with no aria-controls, and its rows carry no role.
export const UD_SELECT = ".ud__select";
// Its location picker is a tree -- country, state, city -- of checkbox rows.
export const UD_TREE_NODE = ".ud__treeSelect__overlay .ud__tree__node";
