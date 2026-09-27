/**
 * Choice groups answered by clicking: a toggle or radio group (click the
 * member that expresses the answer) and check-all-that-apply boxes (tick
 * every one the answer lists).
 *
 * Depends on: answer/ask.ts (chooseAmong), discover/collect/choices.ts
 * (toggleAnswered), dom/query.ts, dom/text.ts, shared/types.ts.
 *
 * ATS quirks: Ashby's Yes/No is two <button aria-pressed> over a hidden
 * checkbox, so a click is confirmed by re-reading the group
 * (toggleAnswered) rather than by the button's own state.
 */
import type { Field } from "../../shared/types.ts";
import { chooseAmong } from "../answer/ask.ts";
import { toggleAnswered } from "../discover/collect/choices.ts";
import { sleep } from "../dom/query.ts";
import { normalize } from "../dom/text.ts";

/** Click the button in a toggle group that expresses `want`. */
export async function setToggle(entry: Field, want: string, decided?: Promise<number>): Promise<boolean> {
  const index = await (decided ?? chooseAmong(entry.label, want, entry.options!));
  if (index < 0 || !entry.buttons![index]) return false;
  entry.buttons![index].click();
  await sleep(150);
  return toggleAnswered(entry);
}

/** Tick every box in `wants` that is not ticked already. */
export async function setChecks(entry: Field, wants: string[]): Promise<boolean> {
  let ticked = 0;
  for (const want of wants) {
    const i = entry.options!.findIndex((o) => normalize(o) === normalize(want));
    const box = entry.buttons![i] as HTMLInputElement;
    if (!box) continue;
    if (!box.checked) box.click();
    if (box.checked) ticked++;
  }
  await sleep(50);
  return ticked > 0;
}
