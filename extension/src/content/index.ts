/**
 * Cmd-V, made to know what box it is in.
 *
 * Reading labels from the DOM is the whole reason this belongs in a browser:
 * the CLI had to guess which lines of copied page text were fields, and that
 * was its weakest stage. Here the page simply says so.
 *
 * The keystroke has to decide synchronously whether to intercept, and a Jev
 * call takes about half a second, so every field on the page is answered in
 * one batched call up front. By the time you press Cmd-V the answer is already
 * sitting in a cache. If there is no confident answer, the keystroke is left
 * alone and you get an ordinary paste.
 *
 * Entry point: wires the modules below together; see src/README.md for the map.
 *
 * Depends on: session.ts (scan, fillPage), ui/keys.ts (onKeyDown),
 * ui/note.ts (ourPill), state.ts, and -- for the test hook only -- the
 * helpers it exposes.
 *
 * ATS quirks: Greenhouse's React throws its form away (error #418) if the
 * page is touched before it hydrates, so nothing starts until SETTLE_MS
 * after the load event. iCIMS navigates its iframe at every step, so a pill
 * this frame drew in the top document is removed on pagehide.
 */
import type { Profile } from "../lib/schema.ts";
import { state } from "./state.ts";
import { normalize } from "./dom/text.ts";
import { looksLikeApplication } from "./discover/gate.ts";
import { collectFields } from "./discover/collect/fields.ts";
import { localMatch } from "./answer/ask.ts";
import { looksLikeAutocomplete } from "./widgets/autocomplete.ts";
import { dateParts, formatForField } from "./widgets/date.ts";
import { setPrompt } from "./widgets/prompt.ts";
import { acknowledgements } from "./fill/acknowledge.ts";
import { scan, fillPage } from "./session.ts";
import { ourPill } from "./ui/note.ts";
import { onKeyDown } from "./ui/keys.ts";

declare global {
  interface Window { __smartpasteTest?: Record<string, unknown> }
}

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message.type === "fill-page") fillPage();
});

// After the page's load event: long enough for a server-rendered React app
// to take the page over ("hydrate").
const SETTLE_MS = 300;

function start(): void {
  document.addEventListener("keydown", onKeyDown, true);
  // A pill this frame left in the top document would outlive the frame:
  // iCIMS navigates its iframe at every step of an application.
  addEventListener("pagehide", () => ourPill()?.remove());
  try {
    chrome.storage.local.get("profile").then(({ profile = {} }: { profile?: Profile } = {}) => { state.profileCache = profile; }, () => {});
  } catch { /* not in the extension */ }
  // Touch nothing until the page's own app has taken over. On Greenhouse,
  // scanning at DOMContentLoaded put our marks and button into the page
  // before React hydrated it: React hit a mismatch (error #418), threw the
  // form away and rebuilt it, and a click that came that early reached no
  // handler and filled nothing.
  const begin = () => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(scan, 600);
    }).observe(document.documentElement, { childList: true, subtree: true });
    scan();
  };
  if (document.readyState === "complete") setTimeout(begin, SETTLE_MS);
  else addEventListener("load", () => setTimeout(begin, SETTLE_MS), { once: true });
}

// Tests (extension/test/content.test.mjs) reach the pure helpers here.
// The flag is only ever set by the test stub, never by a real page.
if (window.__smartpasteTest) {
  Object.assign(window.__smartpasteTest, { dateParts, formatForField, localMatch, looksLikeApplication, looksLikeAutocomplete, collectFields, normalize, setPrompt, acknowledgements });
}

// The manifest runs this at document_idle, but an injected or early copy can
// land before <html> exists, and observe() throws on a null root.
if (document.documentElement) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
