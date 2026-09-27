/**
 * Workday's search prompts ("How did you hear about us?", School, Skills):
 * a text box whose typed text is not an answer. It searches on Enter, the
 * answer is a picked result, and a prompt with no match is walked through
 * its categories instead. Surveyed and applied in two passes like
 * widgets/listbox.ts, and held to a time and question budget.
 *
 * Depends on: answer/ask.ts (chooseAmong, localMatch), discover/labels.ts,
 * discover/selectors.ts (FIELD_ENTRY), dom/query.ts, dom/text.ts,
 * widgets/combobox.ts (narrowingToken), widgets/menus.ts,
 * widgets/text.ts (nativeSet).
 *
 * ATS quirks: Workday's prompt list is never empty -- an empty one says "0
 * items selected" -- so a choice is read from its selected items or that
 * count. A category ("Job Board" > "LinkedIn Jobs") opens its children in
 * place. A click that never took, re-asked 3 searches x 3 levels deep, froze
 * the page for ~20s, hence PROMPT_BUDGET and PROMPT_ASKS. Skills takes many
 * picks, each searched on its own.
 */
import { chooseAmong, localMatch } from "../answer/ask.ts";
import { labelFor } from "../discover/labels.ts";
import { FIELD_ENTRY } from "../discover/selectors.ts";
import { click, press, sleep } from "../dom/query.ts";
import { normalize, optionText } from "../dom/text.ts";
import { narrowingToken } from "./combobox.ts";
import { closeMenu, findOption, optionPicked, optionsNear, pickOption, readMenu, waitForOptions } from "./menus.ts";
import type { MenuTexts } from "./menus.ts";
import { nativeSet } from "./text.ts";

/** Put a search into a prompt at once; it only searches on Enter anyway. */
function searchPrompt(input: HTMLInputElement, text: string): void {
  input.focus();
  nativeSet(input, text);
  press(input, "Enter", 13);
}

/** Search a prompt for `want` and read the results, then close it. */
export async function surveyPrompt(input: HTMLInputElement, want: string): Promise<MenuTexts> {
  searchPrompt(input, want);
  const found = (await waitForOptions(input, 2500)).length > 0;
  const texts: MenuTexts = found ? await readMenu(input, want) : [];
  const exact = localMatch(texts, want);
  if (exact >= 0) {
    const node = await findOption(input, texts[exact], texts.at?.get(texts[exact]));
    if (node) {
      await pickOption(node);
      if (promptChosen(input) || optionPicked(node)) { closeMenu(input); texts.done = true; return texts; }
    }
  }
  closeMenu(input);
  nativeSet(input, "");
  await sleep(40);
  return texts;
}

export async function applyPrompt(input: HTMLInputElement, want: string, texts: MenuTexts, index: number): Promise<boolean> {
  if (index >= 0) {
    searchPrompt(input, want);
    if ((await waitForOptions(input, 2500)).length) {
      const node = await findOption(input, texts[index], texts.at?.get(texts[index]));
      if (node) {
        await pickOption(node);
        if (promptChosen(input) || optionPicked(node)) { closeMenu(input); return true; }
        // Clicked and nothing took: retrying is what froze the page.
        if (sameMenu(input, texts)) { closeMenu(input); nativeSet(input, ""); return false; }
      }
    }
    closeMenu(input);
  }
  // No hit by searching, or a category: the slow, step-by-step path.
  return setPrompt(input, want);
}

/**
 * Whether a prompt holds a choice. Its list is never empty -- an empty one
 * says "0 items selected" -- so count selected items, or read that count.
 */
export function promptChosen(input: Element): boolean {
  const box = input.closest('[data-automation-id="multiSelectContainer"]') || input.parentElement!;
  if (box.querySelector('[data-automation-id="selectedItem"]')) return true;
  const count = (input.closest(FIELD_ENTRY) || box).textContent!.match(/(\d+)\s+items?\s+selected/i);
  return count ? Number(count[1]) > 0 : false;
}

// How long one picker may hold the page, and how many Jev questions it
// may ask. Without a cap a click that never takes meant 3 searches x 3
// levels of re-asking with the menu open -- the page froze for ~20s.
const PROMPT_BUDGET = 6000;

const PROMPT_ASKS = 2;

/** Whether the menu still shows exactly `texts`: a click changed nothing. */
function sameMenu(anchor: Element, texts: string[]): boolean {
  const now = optionsNear(anchor).map(optionText);
  return now.length > 0 && now.every((t) => texts.includes(t));
}

/**
 * A Workday search prompt ("How did you hear about us?", School). Typed
 * text is not an answer; it only searches, on Enter. Pick from the results,
 * and when nothing matches, open the prompt empty and walk its categories
 * ("Job Board" > "LinkedIn Jobs") instead.
 */
export async function setPrompt(input: HTMLInputElement, want: string): Promise<boolean> {
  if (promptChosen(input)) return true;
  const label = labelFor(input);
  const deadline = Date.now() + PROMPT_BUDGET;
  let asks = 0;
  const done = (ok: boolean) => { closeMenu(input); if (!ok) nativeSet(input, ""); return ok; };
  for (const probe of [want, narrowingToken(want), ""]) {
    if (Date.now() > deadline || asks >= PROMPT_ASKS) break;
    if (probe) searchPrompt(input, probe);
    else { nativeSet(input, ""); click(input); }
    for (let depth = 0; depth < 3 && Date.now() < deadline; depth++) {
      if (!(await waitForOptions(input, 2500)).length) break;
      const texts = await readMenu(input, want);
      const exact = texts.findIndex((t) => normalize(t) === normalize(want));
      if (exact < 0 && asks >= PROMPT_ASKS) return done(false);
      if (exact < 0) asks++;
      const index = exact >= 0 ? exact : await chooseAmong(label, want, texts);
      if (index < 0) return done(false); // Jev saw the options: none fits
      const node = await findOption(input, texts[index], texts.at?.get(texts[index]));
      if (!node) break;
      await pickOption(node);
      if (promptChosen(input) || optionPicked(node)) return done(true);
      // A category opens its children in place; anything else means the
      // click did not take, and asking again would only click again.
      if (sameMenu(input, texts)) return done(false);
    }
    closeMenu(input);
    await sleep(100);
  }
  return done(false);
}

/** "Languages: Python, Java\nFrameworks: React" -> ["Python", "Java", "React"]. */
function listItems(text: string, max = 10): string[] {
  const items: string[] = [];
  for (const line of String(text).split(/\n+/)) {
    for (const piece of line.replace(/^[^:,]{1,30}:\s*/, "").split(/\s*[,;•|]\s*/)) {
      const item = piece.replace(/\s*\([^)]*\)/g, "").trim();
      if (item && item.length <= 40 && !items.some((i) => i.toLowerCase() === item.toLowerCase())) items.push(item);
    }
  }
  return items.slice(0, max);
}

/**
 * Workday's Skills box is a search prompt that holds many picks: add each
 * skill on its own -- search, then take the result that is that skill.
 * A skill with no plain match is skipped rather than guessed.
 */
export async function setMultiPrompt(input: HTMLInputElement, value: string): Promise<boolean> {
  let added = 0;
  for (const item of listItems(value)) {
    searchPrompt(input, item);
    if (!(await waitForOptions(input, 1500)).length) { closeMenu(input); continue; }
    const texts = await readMenu(input, item);
    const index = localMatch(texts, item);
    const node = index >= 0 && (await findOption(input, texts[index], texts.at?.get(texts[index])));
    if (node) { await pickOption(node); added++; }
    closeMenu(input);
    nativeSet(input, "");
    await sleep(80);
  }
  return added > 0;
}
