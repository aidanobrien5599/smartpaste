/**
 * What a fill has to say for itself: the questions it could not place, the
 * dropdowns it could not match, and the required questions it left for the
 * user to write.
 *
 * Depends on: discover/collect/fields.ts (collectFields), dom/controls.ts
 * (nodeVisible), dom/text.ts (clean), state.ts, widgets/menus.ts (MenuTexts).
 */
import { collectFields } from "../discover/collect/fields.ts";
import { nodeVisible } from "../dom/controls.ts";
import { clean } from "../dom/text.ts";
import { state } from "../state.ts";
import type { KnownField } from "../../shared/types.ts";
import type { MenuTexts } from "../widgets/menus.ts";

/** A menu surveyed during a fill that Jev's choice did not land in. */
export interface MenuRecord { entry: KnownField; texts: MenuTexts; read: string; decision: Promise<number>; failed?: boolean }

// A question the site insists on: its own flag, or a star in its label.
const STARRED = /[*\u2731\u2217]|\(required\)|\brequired\b/i;

function isRequired(entry: KnownField): boolean {
  const el = entry.element as HTMLInputElement;
  if (el.required || el.getAttribute("aria-required") === "true") return true;
  const box = el.closest('[data-automation-id^="formField"], .application-question, fieldset, label') || el.parentElement;
  const text = clean(box?.querySelector("label, legend")?.textContent || box?.textContent || "");
  return STARRED.test(text.slice(0, 200));
}

/**
 * The required questions a fill could not answer and left empty.
 *
 * These are almost always the written answers -- "Why do you want to work
 * here?", "Tell us about a challenge" -- which no model should invent and
 * which the profile only holds if the user has written them. Counting them
 * ("left 9 for you") says nothing about which; naming them is what lets the
 * user fill the profile field once and have every later form answered.
 *
 * Read from the page, not from what was answered: a question with no answer
 * never reaches state.known (answer() drops it), and those are exactly the
 * ones at issue. A dropdown the model would not choose in counts too -- it
 * is required, it is empty, and it is now the user's.
 */
export function needsYou(filled: (entry: KnownField) => boolean): string[] {
  const known = new Map(state.known.map((k) => [k.element, k]));
  const blank = new Set<string>();
  for (const field of collectFields()) {
    const entry = (known.get(field.element) || { ...field, result: UNANSWERED }) as KnownField;
    if (entry.result.status === "auto" && filled(entry)) continue;
    if (filled(entry) || !nodeVisible(field.element) || !isRequired(entry)) continue;
    blank.add(field.label);
  }
  return [...blank];
}

const UNANSWERED = { label: "", status: "none", value: null, confidence: 0, alternatives: [] } as const;

/**
 * For diagnosing a page from one console paste: questions on it that
 * smartpaste found no field in, with a trimmed copy of their markup, and
 * for each dropdown that failed, what it wanted and every option offered.
 */
export function reportGaps(menus: MenuRecord[] = []): void {
  const handled = [...state.known.map((k) => k.element), ...collectFields().map((f) => f.element)];
  const gaps = [];
  for (const box of document.querySelectorAll('[data-automation-id^="formField"], .application-question, fieldset')) {
    if (!nodeVisible(box) || box.querySelector('[data-automation-id^="formField"], input[type="file"]')) continue;
    if (handled.some((el) => box.contains(el) || el.contains(box))) continue;
    const label = clean(box.querySelector("label, legend")?.textContent || "");
    if (!label) continue;
    const html = box.outerHTML.replace(/\s(?:class|style)="[^"]*"/g, "").replace(/\s+/g, " ").slice(0, 700);
    gaps.push({ question: label, markup: html });
  }
  const failed = menus.filter((m) => m.failed).map((m) => ({ field: m.entry.label, wanted: m.entry.result.value, options: m.texts.join(" | ").slice(0, 1500) }));
  if (!gaps.length && !failed.length) return;
  console.groupCollapsed(`smartpaste: ${gaps.length} question(s) not recognised, ${failed.length} dropdown(s) not matched -- paste this when reporting a problem`);
  if (gaps.length) console.table(gaps);
  if (failed.length) console.table(failed);
  console.groupEnd();
}
