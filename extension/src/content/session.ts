/**
 * The page's lifecycle loop: scan the page for an application and answer
 * its fields in one call, show the Autofill pill, fill on click, then scan
 * again. The three steps call each other (scan -> showButton -> click ->
 * fillPage -> scan), so they share this one module rather than a cycle.
 *
 * Depends on: answer/ (answer, forget, rebind), discover/ (collectFields,
 * looksLikeApplication, FILE_SELECTOR), dom/query.ts (sleep), every fill/
 * step, state.ts, ui/note.ts.
 *
 * ATS quirks: Workday's My Experience step opens as empty sections with Add
 * buttons -- few fields, a resume's worth of entries -- so a page with
 * entries to add counts even below MIN_FIELDS. Attaching a resume makes
 * Lever and Ashby's dropzone re-parse and re-render the form, so documents
 * go before fields and a re-parse is watched for afterwards. Several frames
 * can each find a form (a reCAPTCHA or proxy iframe has none); the frame
 * with more to do draws the pill and the other stays quiet.
 */
import { answer } from "./answer/ask.ts";
import { forget, rebind } from "./answer/known.ts";
import { collectFields } from "./discover/collect/fields.ts";
import { looksLikeApplication } from "./discover/gate.ts";
import { FILE_SELECTOR } from "./discover/selectors.ts";
import { sleep } from "./dom/query.ts";
import { acknowledge } from "./fill/acknowledge.ts";
import { attachDocuments, countAttachable } from "./fill/documents.ts";
import { addEntries, entriesToAdd } from "./fill/entries.ts";
import { fillFields } from "./fill/fill-fields.ts";
import { fillRevealed, refillIfReparsed } from "./fill/revealed.ts";
import { asked, state } from "./state.ts";
import { FRAME_TAG, note, ourPill, pillRoot } from "./ui/note.ts";

const MIN_FIELDS = 2;

export async function scan(): Promise<void> {
  // A fill opens menus and types into search boxes; scanning that churn
  // would re-ask Jev about a half-open page.
  if (state.scanning || state.filling) return;
  const fields = collectFields();
  // Workday's My Experience starts as empty sections with Add buttons: few
  // or no fields, but a whole resume's worth of entries to add.
  const entries = fields.length < MIN_FIELDS || !looksLikeApplication(fields) ? await entriesToAdd() : 0;
  if ((fields.length < MIN_FIELDS || !looksLikeApplication(fields)) && !entries) {
    if (state.known.length) forget();
    return;
  }
  const signature = fields.map((f) => f.label).join("|") + (entries ? `|+${entries}` : "");
  if (signature === state.lastSignature) {
    // Same questions, maybe new elements: keep hold of the live ones.
    if (rebind()) fields.forEach((f) => asked.add(f.element));
    return;
  }

  state.scanning = true;
  state.lastSignature = signature;
  try {
    const answered = fields.length ? await answer(fields) : [];
    if (!answered) return;
    state.known = answered;
    showButton(state.known.length);
  } catch (error) {
    // An extension reload orphans this script; staying quiet is correct.
  } finally {
    state.scanning = false;
  }
}

/** Fill everything the model was confident about, leaving the rest alone. */
/**
 * Documents go first. Attaching a resume makes some sites (Lever, Ashby's
 * dropzone) parse it and re-render the form, which throws away anything
 * already typed and replaces the elements we were holding. So attach, give
 * the parser a moment, then re-find the fields by label and fill those.
 */
export async function fillPage(): Promise<void> {
  // The fill command reaches every frame; one with no form (a reCAPTCHA or
  // proxy iframe) has nothing to do and nothing to report.
  if (!state.known.length && !document.querySelector(FILE_SELECTOR) &&
      !document.querySelector('[role="group"][aria-labelledby$="-section"]')) return;
  if (state.filling) return;
  state.filling = true;
  try {
    const started = performance.now();
    // New entries first: their fields need answers before anything fills.
    if (await addEntries()) {
      await sleep(300);
      const fields = collectFields();
      const answered = await answer(fields);
      if (answered) {
        state.known = answered;
        state.lastSignature = fields.map((f) => f.label).join("|");
      }
    }
    const attached = await attachDocuments();
    await fillFields(started, attached);
    const acknowledged = await acknowledge();
    if (acknowledged) {
      state.lastSummary += `, ${acknowledged} acknowledged`;
      note(state.lastSummary);
    }
    // Newly revealed questions first -- they are the user's to see now --
    // then keep watch for a resume re-parse, over those fields too.
    await fillRevealed();
    if (attached) await refillIfReparsed();
  } finally {
    state.filling = false;
    setTimeout(scan, 300);
  }
}

export async function showButton(count: number): Promise<void> {
  ourPill()?.remove();
  const files = await countAttachable();
  const entries = await entriesToAdd();
  // Nothing answered, nothing to attach, nothing to add: no button at all.
  if (!count && !files && !entries) return;
  const root = pillRoot();
  // Two frames with forms would stack two pills in the same corner. The
  // one that found more to do wins; the other stays quiet.
  const theirs = [...root.querySelectorAll<HTMLElement>(".smartpaste-button")]
    .find((b) => b.dataset.smartpasteFrame !== FRAME_TAG);
  if (theirs && Number(theirs.dataset.smartpasteCount || 0) >= count + files + entries) return;
  theirs?.remove();
  const button = document.createElement("button");
  button.className = "smartpaste-button";
  button.textContent =
    `Autofill ${count} field${count === 1 ? "" : "s"}` +
    (files ? ` + ${files} file${files === 1 ? "" : "s"}` : "") +
    (entries ? ` + ${entries} entr${entries === 1 ? "y" : "ies"}` : "");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    fillPage();
  });
  button.dataset.smartpasteFrame = FRAME_TAG;
  button.dataset.smartpasteCount = String(count + files + entries);
  root.body.appendChild(button);
}
