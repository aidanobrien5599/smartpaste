/**
 * After the main fill: answer and fill questions the page only revealed
 * once others were answered, and refill the form if attaching a resume
 * made the site rebuild it.
 *
 * Depends on: answer/ (answer, rebind), discover/collect/fields.ts,
 * dom/query.ts (sleep), fill/fill-fields.ts (fillFields, isFilled), state.ts.
 *
 * ATS quirks: Greenhouse asks "Please identify your race" only after "Are
 * you Hispanic/Latino?" is No, so the page is looked at again, a few rounds
 * deep. Lever parses an attached resume and re-renders the form, wiping what
 * was filled; rather than wait 2.5s on every upload page (most of an Ashby
 * fill, where nothing re-renders), the fill runs at once and a wipe within
 * REPARSE_WINDOW triggers a refill.
 */
import { answer } from "../answer/ask.ts";
import { rebind } from "../answer/known.ts";
import { collectFields } from "../discover/collect/fields.ts";
import { sleep } from "../dom/query.ts";
import { fillFields, isFilled } from "./fill-fields.ts";
import { state } from "../state.ts";

/**
 * Questions that only appear once another is answered: Greenhouse asks
 * "Please identify your race" after "Are you Hispanic/Latino?" is No.
 * They were not on the page when the fill began, so after it, look again;
 * answer and fill whatever is new, a few rounds deep.
 */
export async function fillRevealed(): Promise<void> {
  const seen = new Set(state.lastSignature.split("|"));
  for (let round = 0; round < 3; round++) {
    await sleep(250); // let the page reveal what the last answers unlock
    const fields = collectFields();
    const fresh = fields.filter((f) => !seen.has(f.label));
    state.lastSignature = fields.map((f) => f.label).join("|");
    if (!fresh.length) return;
    fresh.forEach((f) => seen.add(f.label));
    const answered = await answer(fresh);
    if (!answered || !answered.length) continue;
    state.known = state.known.concat(answered);
    await fillFields(performance.now(), 0, "then new questions: ",
      new Set(answered.map((k) => k.label)));
  }
}

// How long a site may take to parse an attached resume and rebuild the form.
const REPARSE_WINDOW = 3000;

/**
 * Some sites (Lever) parse an attached resume and re-render the form,
 * wiping what was filled. This used to be a flat 2.5s wait before filling
 * on every page with an upload -- most of a 3s Ashby fill, where nothing
 * re-renders. Now: fill at once, then watch; refill only if it happened.
 */
export async function refillIfReparsed(): Promise<void> {
  const filledNow = state.known.filter((k) => k.result.status === "auto" && isFilled(k));
  if (!filledNow.length) return;
  const deadline = Date.now() + REPARSE_WINDOW;
  while (Date.now() < deadline) {
    await sleep(150);
    const wiped = filledNow.some((k) => !k.element.isConnected || !isFilled(k));
    if (!wiped) continue;
    await sleep(500); // let the re-render finish
    rebind();
    await fillFields(performance.now(), 0, "refilled after the page rebuilt the form: ");
    return;
  }
}
