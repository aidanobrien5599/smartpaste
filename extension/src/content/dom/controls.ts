/**
 * What kind of control an element is, and whether it is there for the
 * applicant to see and use right now.
 *
 * ATS quirks: React Select renders a real combobox input plus a second,
 * empty one for form submission (COMBO_SELECTOR / isCombobox find only the
 * first). `visible` treats a read-only combobox as a live dropdown, since
 * that is how ByteDance's Degree field opens on click; it hides an
 * aria-hidden box unless it is a native <select>, since Workable parks
 * hidden city/postcode/country boxes beside its address autocomplete while
 * Lever's select2 (a 2,965-school list) keeps the real value on a hidden
 * native select.
 *
 * Depends on nothing else in content/.
 */

// React Select renders a text input with role=combobox plus a second, empty
// input for form submission. Only the first is a field; the second is noise.
export const COMBO_SELECTOR = 'input[role="combobox"], input.select__input';
export const SELECT_SHELL = '[class*="select__control"], [class*="select-shell"]';

export function isCombobox(field: Element): boolean {
  return field.matches(COMBO_SELECTOR);
}

export function visible(field: Element): boolean {
  const el = field as HTMLInputElement; // the old code assumed a form control here
  // A read-only combobox is a select-only dropdown (ByteDance's Degree):
  // it opens on click and takes a value from its menu.
  if (el.disabled || (el.readOnly && !isCombobox(field))) return false;
  // The hidden twin inside a React Select is not a field of its own; it
  // otherwise gets picked up and labelled from the "Select..." placeholder.
  if (field.closest(SELECT_SHELL) && !isCombobox(field)) return false;
  // A box the page hides from screen readers is the widget's, not the
  // applicant's: Workable parks city / postcode / country in 1px boxes
  // beside the address autocomplete and writes them itself from the place
  // you pick, so asking about them only spent a Jev call on "country".
  // ...but a hidden native <select> IS the field behind a custom picker:
  // select2 (Lever's 2,965-school list) marks its own select that way and
  // takes the value there. Only a hidden text box is the page's own.
  if (field.getAttribute("aria-hidden") === "true" && field.tagName !== "SELECT") return false;
  const rect = field.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function nodeVisible(node: Element): boolean {
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
