/**
 * Ink on the fields themselves: the confidence marker a scan leaves on each
 * answered field (its left edge, green or amber, via content.css), and the
 * small badges ⌘V flashes above a field.
 *
 * Depends on: shared/types.ts, for the Result a mark describes.
 *
 * ATS quirks: none. A badge is absolutely positioned over its field, so it
 * stays in the field's own frame even when the pill is drawn in the top
 * document (see ui/note.ts).
 */
import type { Result } from "../../shared/types.ts";

export function mark(field: HTMLElement, answer: Result): void {
  field.dataset.smartpaste = answer.status;
  field.title =
    `smartpaste: ⌘V inserts "${answer.value}" ` +
    `(${answer.confidence.toFixed(2)})`;
}

export function hint(field: Element, text: string): void {
  const badge = document.createElement("div");
  badge.className = "smartpaste-flash smartpaste-muted";
  badge.textContent = text;
  const rect = field.getBoundingClientRect();
  badge.style.top = `${window.scrollY + rect.top - 22}px`;
  badge.style.left = `${window.scrollX + rect.left}px`;
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 1600);
}

export function flash(field: Element, probability: number, position: string): void {
  const badge = document.createElement("div");
  badge.className = "smartpaste-flash";
  badge.textContent = position
    ? `${probability.toFixed(2)} · ⌘V again ${position}`
    : probability.toFixed(2);
  const rect = field.getBoundingClientRect();
  badge.style.top = `${window.scrollY + rect.top - 22}px`;
  badge.style.left = `${window.scrollX + rect.left}px`;
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 1400);
}
