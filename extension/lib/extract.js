/**
 * Resume PDF -> text, in the browser.
 *
 * This runs once, in settings, under your eye -- not on the hot path. The
 * profile form is what every application actually reads from, so imperfect
 * extraction here is a draft you correct, never an answer typed into a form.
 */

import { fromBase64 } from "./documents.js";

let pdfjs = null;

async function library() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("../vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.mjs");
  return pdfjs;
}

// PDF kerning drops the space before a date: "MadisonSep 2023".
const MONTHS =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|" +
  "April|June|July|August|September|October|November|December";
const GLUED_DATE = new RegExp(`(?<=[a-z])(?=(?:${MONTHS})\\b)`, "g");
// ...and inside all-caps names: "AIDANO'BRIEN".
const GLUED_NAME = /(?<=[A-Z]{2})(?=[A-Z][’'][A-Z])/g;
// Icon-font debris welded to a value: "/gtbGithub".
const GLYPH_RESIDUE =
  /\/(?:[a-z]{1,4}[-←-⯿☀-➿]?[a-z]{0,4}|[-←-⯿☀-➿][a-z]{1,4})(?=[A-Z0-9])/g;
const GLYPHS = /[-←-⯿☀-➿]+/g;

function repair(text) {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) =>
      line
        .replace(GLYPH_RESIDUE, "")
        .replace(GLYPHS, " ")
        .replace(/\(cid:\d+\)/g, "")
        .replace(GLUED_DATE, " ")
        .replace(GLUED_NAME, " ")
        .replace(/[ \t]{2,}/g, " ")
        .trim()
    )
    .join("\n");
}

/**
 * Group a page's text items into lines by their vertical position.
 *
 * pdf.js hands back positioned fragments, not lines. Concatenating them
 * blindly is what produces "AIDANO'BRIEN"; using the transform to see where
 * one line ends and the next begins keeps the resume's own structure.
 */
function pageLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str) continue;
    const y = Math.round(item.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0]) // top of the page downwards
    .map(([, row]) =>
      row
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str)
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

/** Hyperlinks live in annotations and never in the text layer. */
async function pageLinks(page) {
  const found = [];
  for (const annotation of await page.getAnnotations()) {
    const url = annotation.url || annotation.unsafeUrl;
    if (url && !url.startsWith("mailto:")) found.push(url);
  }
  return found;
}

export async function textFromStoredPdf(stored) {
  const { getDocument } = await library();
  const task = getDocument({ data: fromBase64(stored.data) });
  const pdf = await task.promise;

  const lines = [];
  const links = new Set();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    lines.push(...pageLines((await page.getTextContent()).items));
    (await pageLinks(page)).forEach((url) => links.add(url));
  }
  return repair([...lines, ...links].join("\n"));
}
