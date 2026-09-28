/**
 * The bottom-right corner smartpaste draws in: which document the Autofill
 * pill and the summary note go into, which pill is this frame's own, and the
 * transient note ("filled 12 fields", or an error) shown there.
 *
 * Depends on nothing else in content/. (The pill itself, which fills the
 * page on click, is session.ts's showButton.)
 *
 * ATS quirks: iCIMS puts the application in an iframe sized to its content
 * (#icims_content_iframe, ~2000px tall), so a pill fixed to that frame's
 * bottom sat off-screen; the pill and note go in the top document when it is
 * reachable. Several frames can each find a form, so a pill is tagged with
 * the frame that drew it (FRAME_TAG) and a frame only clears its own.
 */

/**
 * Where the pill and the summary note belong. Both are position: fixed,
 * which pins them to their own frame -- and an ATS inside an iframe has no
 * viewport of its own: iCIMS's wrapper sizes #icims_content_iframe to its
 * content (2075px tall on a live job page), so a pill "fixed" to the bottom
 * of that frame sat ~2000px down the page, where nobody scrolled to it.
 * The top document is the window the reader actually sees, so draw there
 * when the frame can reach it; a cross-origin parent is out of reach and
 * keeps its frame's own body. (Flash badges stay put: they are absolute,
 * placed over a field, and the field is here.)
 */
export function pillRoot(): Document {
  if (window.top === window) return document;
  try { return window.top!.document.body ? window.top!.document : document; } catch { return document; }
}

// Which frame drew a pill, so this one only ever clears away its own.
export const FRAME_TAG = Math.random().toString(36).slice(2);
export const ourPill: () => Element | null = () =>
  pillRoot().querySelector(`.smartpaste-button[data-smartpaste-frame="${FRAME_TAG}"]`);

export function note(text: string, isError = false, ms = 4000): void {
  const root = pillRoot();
  const existing = root.querySelector(".smartpaste-note");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "smartpaste-note" + (isError ? " smartpaste-error" : "");
  el.textContent = text;
  root.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
