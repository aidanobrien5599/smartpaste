/**
 * Typing into boxes: setting a value the way a framework will keep it
 * (nativeSet), typing it key by key for widgets that only listen to the
 * keyboard (typeLikeAPerson), and cutting a URL down to what a box with a
 * shown prefix wants (afterShownPrefix).
 *
 * Depends on: discover/selectors.ts (ANY_CONTROL), dom/query.ts (sleep),
 * dom/text.ts (clean).
 *
 * ATS quirks: Lever's location autocomplete ignores a synthetic "input"
 * event and keys off keydown's keyCode, which a constructed KeyboardEvent
 * leaves at 0, so it is typed a character at a time with a real keyCode.
 * Vercel's LinkedIn box shows "linkedin.com/in/" in front of it (an
 * aria-hidden label for= the box), so a full URL typed in would read
 * "linkedin.com/in/https://www.linkedin.com/in/..."; the box gets the handle.
 */
import { ANY_CONTROL } from "../discover/selectors.ts";
import { sleep } from "../dom/query.ts";
import { clean } from "../dom/text.ts";

/**
 * Type the way a keyboard does, one character at a time with a real keyCode.
 *
 * Some autocompletes ignore a synthetic "input" event and key off keydown's
 * keyCode, which a constructed KeyboardEvent leaves at 0. Lever's location
 * field showed no suggestions for nativeSet + input, and did for this.
 */
export async function typeLikeAPerson(field: HTMLInputElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const key = (type: string, ch: string) => {
    const event = new KeyboardEvent(type, { key: ch, bubbles: true, cancelable: true });
    const code = ch.toUpperCase().charCodeAt(0);
    Object.defineProperty(event, "keyCode", { get: () => code });
    Object.defineProperty(event, "which", { get: () => code });
    field.dispatchEvent(event);
  };
  field.focus();
  setter.call(field, "");
  for (const ch of text) {
    key("keydown", ch);
    key("keypress", ch);
    setter.call(field, field.value + ch);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    key("keyup", ch);
    await sleep(8);
  }
}

export function nativeSet(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

// Text shown inside a box, ahead of what you type: Vercel's LinkedIn box
// reads "linkedin.com/in/ [handle]", its Portfolio box "https:// [...]".
// The prefix is a label for= the box (aria-hidden, so it is not the
// question), or a sibling right beside it.
const URL_PREFIX = /^(?:https?:\/\/)?(?:[\w-]+\.)*[a-z]{2,}\/[\w./-]*$|^https?:\/\/$/i;

function shownPrefix(field: HTMLElement): string {
  const candidates = [
    ...(field.id ? document.querySelectorAll(`label[for="${CSS.escape(field.id)}"]`) : []),
    field.previousElementSibling, field.nextElementSibling,
  ];
  for (const node of candidates) {
    if (!node || node.matches(ANY_CONTROL) || node.querySelector(ANY_CONTROL)) continue;
    const text = clean(node.textContent);
    if (URL_PREFIX.test(text)) return text;
  }
  return "";
}

const bareUrl: (url: string) => string = (url) => url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");

/** A URL with the box's shown prefix cut off: the handle, or the host. */
export function afterShownPrefix(field: HTMLElement, value: string): string {
  const prefix = shownPrefix(field);
  if (!prefix || typeof value !== "string" || !/^(?:https?:\/\/|www\.)/i.test(value)) return value;
  const want = bareUrl(prefix).toLowerCase();
  const have = bareUrl(value);
  if (!have.toLowerCase().startsWith(want)) return value;
  return have.slice(want.length).replace(/\/+$/, "");
}
