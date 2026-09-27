/**
 * Filling the answered fields, fastest first: choices whose options are on
 * the page (plain matches now, the rest to Jev in the background), then
 * text and dates, then menus read one at a time while Jev decides, then
 * autocompletes that wait on suggestions. Reports the timing to the console
 * and the summary in the corner note.
 *
 * Depends on: answer/ (chooseAmong, localMatch, detached, rebind),
 * discover/ (toggleAnswered, collectFields, selectors), dom/, state.ts,
 * ui/note.ts, and every widgets/ driver.
 *
 * ATS quirks: Workday commits a typed value only on blur, so plain fields
 * are focused and blurred around the fill; its search pickers wait on a
 * server, so they no longer hold up every box below them. An empty Workday
 * date box holds its mask ("MM", "YYYY"), which is not a value. Ashby
 * rejects an End Date beside a ticked "Still Student?", so an ongoing
 * entry's end date is left empty. A page may rebuild its form mid-fill, so
 * each field is re-found by label and a detached one is never waited on.
 */
import type { KnownField } from "../../shared/types.ts";
import { chooseAmong, localMatch } from "../answer/ask.ts";
import { detached, rebind } from "../answer/known.ts";
import { toggleAnswered } from "../discover/collect/choices.ts";
import { collectFields } from "../discover/collect/fields.ts";
import { DATE_PART, EMPTY_BUTTON, LISTBOX_BUTTON, PROMPT_INPUT } from "../discover/selectors.ts";
import { isCombobox, nodeVisible } from "../dom/controls.ts";
import { clean } from "../dom/text.ts";
import { dateWrappers, state } from "../state.ts";
import { note } from "../ui/note.ts";
import { looksLikeAutocomplete } from "../widgets/autocomplete.ts";
import { currentValue } from "../widgets/combobox.ts";
import { setDate } from "../widgets/date.ts";
import { applyListbox, surveyListbox } from "../widgets/listbox.ts";
import type { MenuTexts } from "../widgets/menus.ts";
import { applyPrompt, promptChosen, setMultiPrompt, surveyPrompt } from "../widgets/prompt.ts";
import { selectChoices, setSelect } from "../widgets/select.ts";
import { setValue } from "../widgets/set-value.ts";
import { setChecks, setToggle } from "../widgets/toggle.ts";

/** One row of the console timeline a fill prints. */
interface Step { field: string; kind: string | null | undefined; ms: number; ok: boolean; read?: string; wanted?: string }
/** A menu surveyed in step 3, waiting on Jev's decision. */
interface MenuRecord { entry: KnownField; texts: MenuTexts; read: string; decision: Promise<number>; failed?: boolean }

export function isFilled(entry: KnownField): boolean {
  const { element } = entry;
  if (entry.buttons) return toggleAnswered(entry);
  if (element.matches(LISTBOX_BUTTON)) return !EMPTY_BUTTON.test(element.textContent!.trim());
  // Live, an empty date box holds its mask -- "MM", "YYYY" ("current value
  // is MM/YYYY") -- and counting that as filled skipped every From / To.
  if (dateWrappers.has(element)) return [...element.querySelectorAll(DATE_PART)].some((p) => /\d/.test((p as HTMLInputElement).value));
  if (element.matches(PROMPT_INPUT)) return Boolean(promptChosen(element));
  if (isCombobox(element)) return Boolean(currentValue(element as HTMLInputElement));
  return Boolean((element as HTMLInputElement).value && (element as HTMLInputElement).value.trim());
}

// "Still Student?" / "I currently work here" ticked means the entry has no
// end. Ashby rejects an End Date beside a ticked "Still Student?", so the
// end date of the same entry is left empty instead of filled.
const ONGOING = /\b(?:still (?:a )?student|currently (?:work|study|attend|enrolled)|(?:i )?(?:still )?work here|present|ongoing|current(?:ly)? (?:role|position|job))\b/i;

// The field's own label, after any section prefix: "End Date", "To (Actual
// or Expected)", "Graduation date".
const END_DATE = /^(?:end(?:ing)?\b|to\b|until\b|graduation date)/i;

function dropEndDatesOfOngoing(todo: KnownField[]): void {
  // From every known box, not just those still to tick: a second pass
  // (after a resume upload rebuilds the form) finds the box already ticked.
  const ongoing = state.known.filter((e) => e.single && ONGOING.test(e.label) &&
    ((e.element as HTMLInputElement).checked || (e.result.status === "auto" && /^y/i.test(e.result.value as string))));
  for (const box of ongoing) {
    const ends = todo.filter((e) => END_DATE.test(e.label.split(": ").pop()!));
    // The same entry: the nearest ancestor holding the box and an end date.
    for (let node = box.element.parentElement; node; node = node.parentElement) {
      const mine = ends.filter((e) => node!.contains(e.element));
      if (!mine.length) continue;
      for (const e of mine) todo.splice(todo.indexOf(e), 1);
      break;
    }
  }
}

export async function fillFields(started: number, attached: number, prefix = "", only: Set<string> | null = null): Promise<void> {
  rebind();
  let filled = 0;
  let skipped = 0;
  const count = (ok: boolean) => (ok ? filled++ : skipped++);
  const todo = state.known.filter((entry) => {
    if (only && !only.has(entry.label)) return false;
    const due = entry.result.status === "auto" && !isFilled(entry);
    if (!due) skipped++;
    return due;
  });
  dropEndDatesOfOngoing(todo);

  // Nothing waits on anything slower than itself. Instant fields go in
  // one pass, as on Ashby; a Workday search picker waits on its server,
  // and in field order it used to hold up every text box below it.
  const timeline: Step[] = [];
  // The page may rebuild the form mid-fill too: re-find by label, and never
  // wait on a detached element (every one of its timeouts runs out).
  const live = (entry: KnownField) => {
    if (!detached(entry)) return entry;
    rebind();
    const fresh = state.known.find((k) => k.label === entry.label);
    if (fresh) Object.assign(entry, { element: fresh.element, buttons: fresh.buttons });
    return entry;
  };
  const timed = async (entry: KnownField, kind: string, work: () => boolean | Promise<boolean>) => {
    const t = performance.now();
    live(entry);
    const ok = detached(entry) ? false : await work();
    timeline.push({ field: entry.label, kind, ms: Math.round(performance.now() - t), ok });
    count(ok);
    return ok;
  };
  const isSkills: (entry: KnownField) => boolean = (entry) => entry.widget === "prompt" && /\bskills?\b/i.test(entry.label);
  const isMenu: (entry: KnownField) => boolean = (entry) => (entry.widget === "listbox" || entry.widget === "prompt") && !isSkills(entry);
  const isTyped: (entry: KnownField) => boolean = (entry) =>
    !entry.buttons && !isMenu(entry) && entry.widget !== "date" && entry.element.tagName !== "SELECT" &&
    (isCombobox(entry.element) || looksLikeAutocomplete(entry.element as HTMLInputElement));

  // 1. Choices whose options are already on the page: plain matches are
  //    clicked now, the rest go to Jev together in the background.
  const pending: [KnownField, Promise<number>][] = [];
  for (const entry of todo) {
    if (entry.multi) {
      await timed(entry, "checkboxes", () => setChecks(entry, entry.result.value as string[]));
      continue;
    }
    if (entry.single) {
      await timed(entry, "checkbox", async () => {
        const box = entry.buttons![0] as HTMLInputElement;
        if (/^y/i.test(entry.result.value as string) && !box.checked) box.click();
        return true; // "No" is an unticked box: nothing to do
      });
      continue;
    }
    const texts = entry.buttons ? entry.options
      : entry.element.tagName === "SELECT" ? selectChoices(entry.element as HTMLSelectElement).map((o) => o.textContent!.trim())
      : null;
    if (!texts) continue;
    const decision = chooseAmong(entry.label, entry.result.value as string, texts);
    if (localMatch(texts, entry.result.value as string) < 0) { pending.push([entry, decision]); continue; }
    await timed(entry, entry.buttons ? "toggle" : "select", () => entry.buttons
      ? setToggle(entry, entry.result.value as string, decision)
      : setSelect(entry.element as HTMLSelectElement, entry.result.value as string, decision));
  }
  // 2. Text and dates: no decision, no menu, no waiting.
  for (const entry of todo) {
    if (entry.buttons || entry.element.tagName === "SELECT" || isMenu(entry) || isTyped(entry) || isSkills(entry)) continue;
    if (entry.widget === "date") { await timed(entry, "date", () => setDate(entry.element, entry.result.value as string)); continue; }
    // Focus and blur around a plain field: Workday, among others, only
    // commits what was typed when the field loses focus.
    await timed(entry, "text", () => {
      entry.element.focus();
      const ok = setValue(entry.element, entry.result.value as string);
      entry.element.blur();
      return ok;
    });
  }
  // 3. Menus open one at a time. Read each; a plain match is clicked on
  //    the spot, anything else is sent to Jev while the next is read.
  const menus: MenuRecord[] = [];
  for (const entry of todo) {
    if (!isMenu(entry)) continue;
    const want = entry.result.value as string;
    const t = performance.now();
    if (detached(live(entry))) { skipped++; continue; }
    const texts = entry.widget === "listbox"
      ? await surveyListbox(entry.element, want) : await surveyPrompt(entry.element as HTMLInputElement, want);
    // What the menu showed, for the console table: a failed dropdown is
    // then diagnosable from one paste ("read 0" = it never opened).
    const read = `${texts.length}: ${texts.slice(0, 4).join(" | ")}`.slice(0, 120);
    if (texts.done) {
      timeline.push({ field: entry.label, kind: entry.widget, ms: Math.round(performance.now() - t), ok: true, read });
      filled++;
      continue;
    }
    menus.push({ entry, texts, read, decision: texts.length ? chooseAmong(entry.label, want, texts) : Promise.resolve(-1) });
  }
  // 4. Autocompletes type and wait on suggestions; they go after the rest.
  for (const entry of todo) {
    if (isTyped(entry)) await timed(entry, "typed", () => setValue(entry.element, entry.result.value as string));
    if (isSkills(entry)) await timed(entry, "skills", () => setMultiPrompt(entry.element as HTMLInputElement, entry.result.value as string));
  }
  // 5. Click in Jev's decisions as they arrive.
  for (const [entry, decision] of pending) {
    await timed(entry, entry.buttons ? "toggle (jev)" : "select (jev)", () => entry.buttons
      ? setToggle(entry, entry.result.value as string, decision)
      : setSelect(entry.element as HTMLSelectElement, entry.result.value as string, decision));
  }
  for (const { entry, texts, decision, read } of menus) {
    const before = timeline.length;
    await timed(entry, `${entry.widget} (jev)`, async () => {
      const index = await decision;
      return entry.widget === "listbox"
        ? applyListbox(entry.element, texts, index)
        : applyPrompt(entry.element as HTMLInputElement, entry.result.value as string, texts, index);
    });
    if (timeline[before]) {
      timeline[before].read = read;
      timeline[before].wanted = String(entry.result.value).slice(0, 40);
      if (!timeline[before].ok) menus.find((m) => m.entry === entry)!.failed = true;
    }
  }
  // Where the time went, for when a page feels slow.
  if (timeline.length) {
    console.info(`smartpaste: filled in ${Math.round(performance.now() - started)}ms`);
    console.table(timeline);
    reportGaps(menus);
  }
  if (window.__smartpasteTest) window.__smartpasteTest.timeline = timeline;

  const parts = [`${prefix}filled ${filled} in ${((performance.now() - started) / 1000).toFixed(1)}s`];
  if (attached) parts.push(`attached ${attached} file${attached === 1 ? "" : "s"}`);
  if (skipped) parts.push(`left ${skipped} for you`);
  // Name the slow fields right in the note, so a slow page can be
  // diagnosed from a screenshot.
  const slow = timeline.filter((t) => t.ms >= 700).sort((a, b) => b.ms - a.ms).slice(0, 3);
  const why = slow.map((t) => `${t.field.slice(0, 28)} ${(t.ms / 1000).toFixed(1)}s${t.ok ? "" : " ✗"}`);
  const summary = parts.join(", ") + (why.length ? ` · slowest: ${why.join(", ")}` : "");
  // A follow-up round adds to the fill's summary rather than replacing it.
  state.lastSummary = only && state.lastSummary ? `${state.lastSummary} · ${summary}` : summary;
  note(state.lastSummary, false, why.length || only ? 12000 : 4000);
}

/**
 * For diagnosing a page from one console paste: questions on it that
 * smartpaste found no field in, with a trimmed copy of their markup, and
 * for each dropdown that failed, what it wanted and every option offered.
 */
function reportGaps(menus: MenuRecord[] = []): void {
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
