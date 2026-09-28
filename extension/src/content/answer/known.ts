/**
 * The answered fields a scan holds on to (state.known), kept bound to the
 * page's live elements: dropped when the page stops being an application,
 * and re-found by label when the page rebuilds its form under us.
 *
 * Depends on: state.ts (state, answers), shared/types.ts,
 * discover/collect/fields.ts (collectFields), ui/note.ts (ourPill).
 *
 * ATS quirks: React throws a form away and rebuilds it when hydration fails
 * (Figma with Grammarly installed); holding the old nodes, a fill spent ~6s
 * per dropdown on elements no longer on the page. Answers are keyed by
 * label, so rebinding needs no new Jev call.
 */
import type { KnownField, Result } from "../../shared/types.ts";
import { state, answers } from "../state.ts";
import { collectFields } from "../discover/collect/fields.ts";
import { ourPill } from "../ui/note.ts";

export function forget(): void {
  state.known = [];
  state.lastSignature = "";
  ourPill()?.remove();
}

export const detached: (entry: KnownField) => boolean = (entry) =>
  !entry.element.isConnected || (entry.buttons || []).some((b) => !b.isConnected);

/**
 * Swap in the page's current elements for any the page has thrown away.
 * React discards and rebuilds a form when hydration fails (Figma, with
 * Grammarly installed); holding the old nodes, a fill spent ~6s per
 * dropdown on elements no longer on the page. Answers are keyed by label,
 * so rebinding needs no new Jev call.
 */
export function rebind(): boolean {
  if (!state.known.some(detached)) return false;
  const byLabel = new Map(state.known.map((k): [string, Result] => [k.label, k.result]));
  state.known = collectFields()
    .filter((f) => byLabel.has(f.label))
    .map((f): KnownField => ({ ...f, result: byLabel.get(f.label)! }));
  for (const k of state.known) answers.set(k.element, k.result);
  return true;
}
