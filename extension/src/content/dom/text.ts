/**
 * Reading and normalizing the text a page shows: labels, option text, and
 * the loose formatting a label carries that a comparison should ignore.
 *
 * ATS quirks: `shownText` strips aria-hidden text because Vercel's labels
 * hold decorative aria-hidden content alongside the real text. `clean`
 * drops Vercel's leading zero-width spaces, Workday's "current value is
 * MM/YYYY" screen-reader text, Lever's heavy asterisk ("✱"), and Workable's
 * star that comes *before* a required question instead of after it.
 *
 * Depends on nothing else in content/.
 */

// A label's text without what it hides from screen readers: Vercel's
// "LinkedIn" label also holds the box's decorative "linkedin.com/in/".
export function shownText(node: Element): string | null {
  if (!node.querySelector('[aria-hidden="true"]')) return node.textContent;
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return copy.textContent;
}

export function clean(text: string | null | undefined): string {
  if (!text) return "";
  return text
    // Zero-width spaces: Vercel starts every radio option with one.
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    // Screen-reader text inside a label: Workday's "current value is MM/YYYY".
    .replace(/\s*current value is\b.*$/i, "")
    // "*", and Lever's heavy asterisk "✱"
    .replace(/\s*(?:[*\u2731\u2217]+|\(required\)|\(optional\)|required|optional)\s*$/i, "")
    .replace(/[:*]\s*$/, "")
    // Workable stars a required field *before* the question, in a <strong>
    // of its own: "*Phone", "*Are you currently able to work in the U.S.…".
    .replace(/^\s*[*\u2731\u2217]+\s*/, "")
    .trim()
    .slice(0, 200);
}

export const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

export const optionText = (node: Element): string =>
  (node.getAttribute("data-automation-label") || node.textContent)!.trim();
