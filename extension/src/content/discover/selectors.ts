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
 * - Rippling names each box afresh on every load ("6u6RxcGTFfn"), and Lever
 *   names one after the card it is in ("cards[d2bd48…][field0]"); taken for
 *   a question, Jev is asked a random id (junkLabel).
 *
 * Depends on nothing else in content/.
 */

export const FILE_SELECTOR = 'input[type="file"]';
const JUNK_LABELS = /^(?:select\.{0,3}|choose\.{0,3}|please select|search|--)$/i;
// A placeholder that tells you how to answer but never says what is asked:
// Lever's "Type your response", Ashby's "Start typing...". A verb and a
// generic object and nothing else -- "Enter your email" says what it wants
// and is kept, "Select all that apply" names the options and is kept too.
const PROMPT_ONLY =
  /^(?:(?:start|begin)\s+typing|type|enter|write|input|search|select|choose|pick)(?:\s+(?:your|an?|the|one|some))?(?:\s+(?:answer|response|option|value|text|name|here|below))?\s*(?:\.{2,}|…)?$/i;
// A name or an id is not a question. Three shapes, all of them seen live:
// a bare UUID (Ashby), a form field's own name (Lever's
// "cards[d2bd48ea-…][field0]", Rippling's "customQuestions.<id>.<id>",
// Greenhouse's "eeo[race]", a plain "sms_opt_in"), and a generated token
// (Rippling's "6u6RxcGTFfn", "RKGxbnAylmH", a fresh one on every load).
// Each separator here is outside the run it follows, so no two parts of a
// pattern can match the same character: one long word_of_underscores would
// otherwise take a minute to be refused (catastrophic backtracking).
const UUID_LABEL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_NAME = /^[\w$-]+(?:\[[^\]]*\]|\.[\w$-]+)+$/;
const SNAKE_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i;
const ONE_TOKEN = /^[\w$-]{6,}$/;
// A word is lower case ("email"), an acronym ("GPA"), or capitals each
// carrying their own lower-case tail ("LinkedIn", "opportunityLocationId").
// A base62 token is none of those: "RKGxbnAylmH" has capitals side by side
// and single letters between them, and no way to read as words.
const WORD = /^(?:[a-z]+(?:[A-Z][a-z]+)*|(?:[A-Z][a-z]+)+|[A-Z]+)$/;
const generatedId: (text: string) => boolean = (text) => ONE_TOKEN.test(text) &&
  !text.replace(/\d+/g, "").split(/[\s._-]+/).filter(Boolean).every((part) => WORD.test(part));

/**
 * Is this text something other than a question? A placeholder, a form
 * field's name or a generated id all read as one, and asking Jev "what is
 * your 6u6RxcGTFfn?" leaves a required box blank. The walk keeps looking.
 */
export function junkLabel(text: string): boolean {
  return JUNK_LABELS.test(text) || PROMPT_ONLY.test(text) ||
    UUID_LABEL.test(text) || PATH_NAME.test(text) || SNAKE_NAME.test(text) || generatedId(text);
}

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
// input[type="number"] is in here for a reason: Scale AI's Greenhouse
// education block draws the month as a React Select and the year as a bare
// number box, and without it the REQUIRED "Start date year" was never even
// asked about. A number box also holds a GPA, a salary or a count of years.
export const FIELD_SELECTOR =
  'input:not([type]), input[type="text"], input[type="email"], ' +
  'input[type="tel"], input[type="url"], input[type="search"], ' +
  'input[type="date"], input[type="number"], textarea, select';

export const ANY_CONTROL = 'input:not([type="hidden"]):not([type="file"]), textarea, select';

export const NOT_A_SUGGESTION = /^(?:no .* found|no items|loading|searching)/i;

// ByteDance's own select (its "Universe Design"): the menu is rendered
// away from the control, with no aria-controls, and its rows carry no role.
export const UD_SELECT = ".ud__select";
// Its location picker is a tree -- country, state, city -- of checkbox rows.
export const UD_TREE_NODE = ".ud__treeSelect__overlay .ud__tree__node";
