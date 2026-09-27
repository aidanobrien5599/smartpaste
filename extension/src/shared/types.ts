/**
 * The shapes that cross module boundaries in the content script, and the
 * one that crosses to the background: a field on the page, and what the
 * background decided for it.
 *
 * Depends on nothing else in content/.
 */

/** One question on the page, as collectFields() finds it. */
export interface Field {
  /** What gets filled: the input, the select, a toggle group's wrapper, a Workday button or date wrapper. */
  element: HTMLElement;
  /** The question text Jev is asked, section prefix included. */
  label: string;
  /** A dropdown's or group's own choices, sent along with the label; null for free text. */
  options: string[] | null;
  /** True for a searchable text combobox (React Select and kin). */
  combobox: boolean;
  /** A toggle, radio or checkbox group's clickable members. */
  buttons?: HTMLElement[];
  /** Any number of the group may be ticked. */
  multi?: boolean;
  /** A lone checkbox asked as Yes/No. */
  single?: boolean;
  /**
   * A widget that is not a form control: Workday's listbox button, a split
   * date, or a searchable prompt picker (Workday's multiSelectContainer).
   * collectFields() sets this to null on every plain field it maps, so the
   * key is present (not merely absent) on most of what it returns.
   */
  widget?: "listbox" | "date" | "prompt" | null;
}

/** What the background decided for one field (lib/resolve.ts, background.js's answerFields). */
export interface Result {
  label: string;
  /** auto: fill silently. pick: fill, flagged for a look. none: offer nothing. */
  status: "auto" | "pick" | "none";
  /** A check-all-that-apply field's answer is the list of options to tick. */
  value: string | string[] | null;
  confidence: number;
  alternatives: { value: string; p: number }[];
  /** Set for a check-all-that-apply field (ticked(), background.js); mirrors Field.multi. */
  multi?: boolean;
  /** Set when the answer came from the field's own <select> options, not free text (background.js's answerFor). Unread by the content script today. */
  isSelect?: boolean;
}

export interface KnownField extends Field {
  result: Result;
}
