/**
 * The native <select> driver: read its real options (skipping placeholders),
 * pick the one that expresses the answer, and set it with the events a
 * framework listens for.
 *
 * Depends on: answer/ask.ts (chooseAmong), discover/labels.ts (labelFor).
 *
 * ATS quirks: Lever's GPA select offers "4.0 / 3.9 / 3.8" for a profile
 * value of "3.9/4.00", so a value that matches no option exactly is asked
 * about rather than given up on.
 */
import { chooseAmong } from "../answer/ask.ts";
import { labelFor } from "../discover/labels.ts";

/**
 * A native <select>. Usually the background already chose among its own
 * options, so the value matches exactly. When it does not -- a profile GPA
 * of "3.9/4.00" against options "4.0 / 3.9 / 3.8" -- ask which option
 * expresses it rather than giving up.
 */
export function selectChoices(field: HTMLSelectElement): HTMLOptionElement[] {
  return [...field.options].filter(
    (o) => o.value !== "" && !/^(?:select|choose|please select|--)/i.test(o.textContent!.trim())
  );
}

export async function setSelect(field: HTMLSelectElement, value: string, decided?: Promise<number>): Promise<boolean> {
  const options = selectChoices(field);
  const texts = options.map((o) => o.textContent!.trim());
  const index = await (decided ?? chooseAmong(labelFor(field), value, texts));
  if (index < 0) return false;
  field.value = options[index].value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
