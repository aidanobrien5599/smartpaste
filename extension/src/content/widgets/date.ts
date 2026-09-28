/**
 * Dates: reading the date shapes a profile holds (dateParts), writing one in
 * the shape a box asks for (formatForField), and filling a date split into
 * separate month / day / year boxes (setDate).
 *
 * Depends on: discover/labels.ts (labelFor), dom/query.ts (sleep),
 * widgets/text.ts (afterShownPrefix, nativeSet).
 *
 * ATS quirks: Workday splits a date into month / day / year boxes and
 * re-renders the widget on every change, so each box is found again by its
 * stable id when it is set, and gets its whole value at once (typed digits
 * arrived twice, "05" as "0055"). Ambrook disables End Date once "Still
 * Student?" is ticked and still rejects a value there. ByteDance's calendar
 * picker boxes state no format, take ISO, and drop anything else on blur.
 * C3 pairs a Month dropdown with a Year box; a box asking only for a year
 * ("Year of Graduation") gets the year.
 */
import { labelFor } from "../discover/labels.ts";
import { sleep } from "../dom/query.ts";
import { afterShownPrefix, nativeSet } from "./text.ts";

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface DateParts { year: string; month: number | null; day: number | null }

/**
 * "May 2027", "05/2027", "2027-05", "2027", and with a day: "09/21/2026",
 * "2026-09-21", "Sep 21, 2026" -> {year, month, day}.
 */
export function dateParts(value: unknown): DateParts | null {
  const text = String(value || "");
  const year = text.match(/\b(19|20)\d{2}\b/);
  if (!year) return null;
  const full = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d{2})\b/) || // MM/DD/YYYY
    text.match(/\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/); // YYYY-MM-DD
  if (full) {
    const [month, day] = full[3].length === 4 ? [full[1], full[2]] : [full[2], full[3]];
    if (Number(month) <= 12 && Number(day) <= 31) return { year: year[0], month: Number(month), day: Number(day) };
  }
  const named = text.match(/\b([A-Za-z]{3})[a-z]*\.?\b/g)?.map((w) => MONTH_NAMES.indexOf(w.slice(0, 3).toLowerCase())).find((i) => i >= 0);
  const numeric = text.match(/\b(\d{1,2})[/.-](?:19|20)\d{2}\b/) || text.match(/\b(?:19|20)\d{2}[/.-](\d{1,2})\b/);
  const month = named !== undefined && named >= 0 ? named + 1 : numeric ? Number(numeric[1]) : null;
  const day = named !== undefined && named >= 0 ? text.match(/\b[A-Za-z]{3}[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?/)?.[1] : null;
  return {
    year: year[0],
    month: month && month <= 12 ? month : null,
    day: day && Number(day) <= 31 ? Number(day) : null,
  };
}

const pad: (n: number) => string = (n) => String(n).padStart(2, "0");

/**
 * A date in the shape the field asks for. A box that says MM/DD/YYYY (in
 * its placeholder or label) gets exactly that, a native date input gets
 * YYYY-MM-DD, and anything else keeps the profile's own wording.
 */
export function formatForField(field: HTMLInputElement, value: string): string {
  if (field.tagName !== "INPUT") return value;
  value = afterShownPrefix(field, value);
  const hint = `${field.placeholder || ""} ${field.getAttribute("aria-label") || ""} ${labelFor(field)}`;
  const shape = field.type === "date" ? "YYYY-MM-DD"
    : (hint.match(/\b(MM\/DD\/YYYY|DD\/MM\/YYYY|MM\/YYYY|YYYY-MM-DD|MM-DD-YYYY)\b/i) || [])[1]?.toUpperCase();
  const parts = dateParts(value);
  // "Year of Graduation" wants 2027, not the profile's "May 2027". Only
  // when the box names a year and nothing finer: "Month and year" and
  // "Graduation date" keep the whole date, "Years of experience" is a count.
  const onlyYear = /\byear\b/i.test(hint) && !/\b(?:month|day|date|mm|dd)\b/i.test(hint);
  if (onlyYear && parts && !shape) return parts.year;
  // A calendar picker's text box with no format stated (ByteDance's start
  // / end range) takes ISO, and drops anything else on blur.
  const picker = !shape && field.closest('[class*="date-range-picker"], [class*="date-picker"], [class*="picker-input"]');
  if (picker && parts?.month) return parts.day ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : `${parts.year}-${pad(parts.month)}`;
  if (!shape) return value;
  if (!parts || !parts.month) return value;
  const [y, m, d] = [parts.year, pad(parts.month), pad(parts.day || 1)];
  return ({ "MM/DD/YYYY": `${m}/${d}/${y}`, "DD/MM/YYYY": `${d}/${m}/${y}`, "MM/YYYY": `${m}/${y}`,
    "YYYY-MM-DD": `${y}-${m}-${d}`, "MM-DD-YYYY": `${m}-${d}-${y}` } as Record<string, string>)[shape];
}

type DateBox = HTMLInputElement | HTMLSelectElement;

/** A Workday date: separate month / day / year boxes. */
export async function setDate(wrapper: Element, value: string): Promise<boolean> {
  const parts = dateParts(value);
  if (!parts) return false;
  const selectFor = (name: string) => [...wrapper.querySelectorAll("select")]
    .find((s) => new RegExp(`^${name}`, "i").test(s.options[0]?.textContent!.trim() || ""));
  const box = (name: string): DateBox | null | undefined => wrapper.querySelector<HTMLInputElement>(`[data-automation-id="dateSection${name}-input"], input[aria-label="${name}"], input[placeholder="${name}" i]`) || selectFor(name);
  // Workday's date widget re-renders on every change: a box held from
  // before is no longer on the page, and a value set on it goes nowhere.
  // Its ids are stable ("workExperience-1--startDate-dateSectionYear-input"),
  // so each box is found again by id at the moment it is set.
  const finder = (name: string) => {
    const first = box(name);
    if (!first) return null;
    const id = first.id;
    return (): DateBox | null | undefined => (id && document.getElementById(id) as DateBox | null) || (first.isConnected ? first : box(name));
  };
  const month = finder("Month");
  const day = finder("Day");
  const year = finder("Year");
  if (month && !parts.month) return false; // "Present", or a year alone
  // Disabled boxes are not the applicant's to fill: Ambrook disables End
  // Date once "Still Student?" is ticked, and still rejects a value there.
  const boxes = [month, day, year].filter(Boolean).map((find) => find!());
  if (boxes.length && boxes.every((b) => b?.disabled)) return false;
  // Each box gets its whole value at once, as a paste would, then change
  // and blur -- what Simplify's Workday rules do too. Typing digit by digit
  // lost dates: Workday's spinbuttons take digits on keydown themselves,
  // so typed digits arrived twice ("05" as "0055", no month at all).
  const put = async (find: (() => DateBox | null | undefined) | null, text: string) => {
    if (!find) return true;
    for (let attempt = 0; attempt < 2; attempt++) {
      const input = find();
      if (!input) return false;
      if (input.tagName === "SELECT") {
        // Options valued 1-12 / 2027, or worded "May": take the one that matches.
        const option = [...(input as HTMLSelectElement).options].find((o) => Number(o.value) === Number(text) || Number(o.textContent) === Number(text) ||
          (input === month?.() && MONTH_NAMES[Number(text) - 1] === o.textContent!.trim().slice(0, 3).toLowerCase()));
        if (!option) return false;
        input.value = option.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      input.focus();
      nativeSet(input as HTMLInputElement, text);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      await sleep(20); // let a re-render land before reading back
      if (Number(find()?.value) === Number(text)) return true;
    }
    return false;
  };
  const ok = [
    await put(month, pad(parts.month || 1)),
    await put(day, pad(parts.day || 1)),
    await put(year, parts.year),
  ];
  return ok.every(Boolean);
}
