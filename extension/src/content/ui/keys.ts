/**
 * ⌘V as a smart paste: in a field the scan already answered, the keystroke
 * inserts that answer instead of the clipboard, and pressing it again in the
 * same field cycles to the next most likely one. With no answer it is an
 * ordinary paste, and a field smartpaste asked about says so.
 *
 * Depends on: state.ts (answers, asked, cycle), ui/marks.ts (flash, hint),
 * widgets/set-value.ts (setValue).
 *
 * ATS quirks: none of its own -- setValue drives whatever control the field
 * is. The keystroke must decide synchronously whether to intercept, which is
 * why every answer is fetched up front by the scan.
 */
import { answers, asked, cycle } from "../state.ts";
import { flash, hint } from "./marks.ts";
import { setValue } from "../widgets/set-value.ts";

export function onKeyDown(event: KeyboardEvent): void {
  const isPaste = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v";
  if (!isPaste || event.altKey) return;

  const field = event.target as HTMLInputElement;
  const answer = answers.get(field);
  // No confident answer: leave the keystroke alone and paste normally --
  // but say so. Otherwise whatever was on the clipboard lands in the box
  // and looks exactly like smartpaste put it there.
  if (!answer || !answer.value) {
    if (asked.has(field)) hint(field, "no answer in your profile — normal paste");
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  // A repeat press cycles to the next most likely snippet, which is how a
  // low-confidence answer gets corrected without any menu.
  const options = answer.alternatives.length
    ? answer.alternatives
    : [{ value: answer.value, p: answer.confidence }];
  const index = field.value === options[cycle.get(field) ?? 0]?.value
    ? ((cycle.get(field) ?? 0) + 1) % options.length
    : cycle.get(field) ?? 0;
  cycle.set(field, index);

  const option = options[index];
  setValue(field, option.value as string);
  flash(field, option.p, options.length > 1 ? `${index + 1}/${options.length}` : "");
}
