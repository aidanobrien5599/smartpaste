/**
 * Workday's dropdowns: a <button aria-haspopup="listbox"> that opens a
 * menu. Surveyed first (open, read every option, close) so a fill can ask
 * Jev about every menu at once, then applied (reopen, click the choice).
 *
 * Depends on: answer/ask.ts (chooseAmong, localMatch), discover/labels.ts
 * (listboxLabel), discover/selectors.ts (EMPTY_BUTTON), dom/query.ts,
 * dom/text.ts, widgets/menus.ts.
 *
 * ATS quirks: some Workday buttons (Phone Device Type) open on mousedown
 * and toggle again on click, so a plain click is tried before the full
 * pointer sequence. Rippling draws the same dropdown as a plain
 * <div role="combobox" aria-haspopup="listbox">. A button reading "Select
 * One" / "Select..." holds nothing (EMPTY_BUTTON).
 */
import { chooseAmong, localMatch } from "../answer/ask.ts";
import { listboxLabel } from "../discover/labels.ts";
import { EMPTY_BUTTON } from "../discover/selectors.ts";
import { click, fire, sleep } from "../dom/query.ts";
import { normalize } from "../dom/text.ts";
import { closeMenu, findOption, pickOption, readMenu, settlePopups, waitForOptions , popupsNow, rememberPopup} from "./menus.ts";
import type { MenuTexts } from "./menus.ts";

/**
 * Open a dropdown button. A plain click first, as Simplify's Workday rules
 * do: some of Workday's buttons (Phone Device Type) open on mousedown and
 * toggle again on click, so a full pointer-and-mouse sequence opened the
 * menu and shut it at once -- nothing to read, nothing picked. Only if a
 * plain click opens nothing is the full sequence tried.
 */
async function openListbox(button: HTMLElement): Promise<boolean> {
  await settlePopups(button);
  button.focus();
  // What was on screen before: whatever appears now is this button's.
  let before = popupsNow();
  fire(button, "click");
  if ((await waitForOptions(button, 600)).length) { rememberPopup(button, before); return true; }
  await settlePopups(button);
  before = popupsNow();
  click(button);
  const opened = (await waitForOptions(button)).length > 0;
  if (opened) rememberPopup(button, before);
  return opened;
}

/**
 * Read a dropdown's options, then close it. Filling a page reads every menu
 * first and asks Jev about all of them at once, instead of holding each
 * menu open through its own round trip.
 */
export async function surveyListbox(button: HTMLElement, want: string): Promise<MenuTexts> {
  const opened = await openListbox(button);
  const texts: MenuTexts = opened ? await readMenu(button, want) : [];
  // The answer is right there: click it now rather than close, decide and
  // reopen. Only menus that need Jev pay for a second visit.
  const exact = localMatch(texts, want);
  if (exact >= 0) {
    const node = await findOption(button, texts[exact], texts.at?.get(texts[exact]));
    if (node) {
      await pickOption(node);
      if (!EMPTY_BUTTON.test(button.textContent!.trim())) { texts.done = true; return texts; }
    }
  }
  closeMenu(button);
  await sleep(40);
  return texts;
}

export async function applyListbox(button: HTMLElement, texts: MenuTexts, index: number): Promise<boolean> {
  if (index < 0) return false;
  if (!(await openListbox(button))) { closeMenu(button); return false; }
  const node = await findOption(button, texts[index], texts.at?.get(texts[index]));
  if (!node) { closeMenu(button); return false; }
  await pickOption(node);
  return !EMPTY_BUTTON.test(button.textContent!.trim());
}

/** A Workday dropdown: a button that opens a listbox. */
export async function setListbox(button: HTMLElement, want: string): Promise<boolean> {
  if (normalize(button.textContent!) === normalize(want)) return true;
  if (!(await openListbox(button))) { closeMenu(button); return false; }
  const texts = await readMenu(button, want);
  const index = await chooseAmong(listboxLabel(button), want, texts);
  const node = index >= 0 && (await findOption(button, texts[index]));
  if (!node) { closeMenu(button); return false; }
  node.scrollIntoView({ block: "nearest" });
  click(node);
  await sleep(250);
  return !EMPTY_BUTTON.test(button.textContent!.trim());
}
