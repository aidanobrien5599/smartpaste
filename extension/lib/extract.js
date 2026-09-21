/**
 * Resume PDF -> text, in the browser.
 *
 * This runs once, in settings, under your eye -- not on the hot path. The
 * profile form is what every application actually reads from, so imperfect
 * extraction here is a draft you correct, never an answer typed into a form.
 *
 * pdf.js hands back positioned fragments, not lines. The work here is
 * rebuilding lines the way a reader sees them: grouping fragments by height,
 * splitting where a wide gap marks a second column, and dropping icon glyphs
 * by the font they are set in rather than by what the characters look like.
 */

import { fromBase64 } from "./documents.js";

// Icon fonts map their glyphs onto ordinary codepoints -- FontAwesome's phone
// and envelope arrive as "Ó" and "R" -- so no character test can catch them.
// The font name can.
export const ICON_FONT = /fontawesome|icons?\b|glyph|dingbat|wingding|material|fa-?(?:solid|regular|brands)/i;

// Anything wider than this between two fragments on one line is a column
// break, not a word space. A space here is ~3pt; a right-aligned date sits
// 250pt away.
const COLUMN_GAP = (height) => Math.max(15, 1.5 * height);

const MONTHS =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|" +
  "April|June|July|August|September|October|November|December";
const GLUED_DATE = new RegExp(`(?<=[a-z])(?=(?:${MONTHS})\\b)`, "g");
const GLUED_NAME = /(?<=[A-Z]{2})(?=[A-Z][’'][A-Z])/g;
const PRIVATE_USE = /[-]+/g;

function repair(line) {
  return line
    .normalize("NFKC")
    .replace(PRIVATE_USE, " ")
    .replace(/\(cid:\d+\)/g, "")
    .replace(GLUED_DATE, " ")
    .replace(GLUED_NAME, " ")
    .replace(/\s*\|\s*(?=\||$)/g, "") // separators orphaned by a dropped icon
    .replace(/^\s*\|\s*/, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Items -> lines. Pure, so it runs under node:test as well as in the page.
 *
 * `isIcon(item)` says whether an item is set in an icon font.
 */
export function linesFromItems(items, isIcon = () => false) {
  const visible = items.filter((item) => item.str !== undefined);

  // Rows: fragments within a small tolerance of the same baseline. Exact
  // matching splits a small-caps heading ("A" + "IDAN") into two lines.
  const rows = [];
  for (const item of [...visible].sort((a, b) => b.transform[5] - a.transform[5])) {
    const y = item.transform[5];
    const tolerance = Math.max(2, 0.3 * (item.height || 10));
    const row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y, items: [item] });
  }

  const lines = [];
  for (const row of rows) {
    const cells = row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let segment = "";
    let end = null; // right edge of the last visible fragment
    let height = 10;
    for (const item of cells) {
      const x = item.transform[4];
      // An icon is dropped from the text but still occupies its place on the
      // line. Removing it outright leaves a hole wide enough to read as a
      // column break, which split "908-216-0389" off its own contact row.
      if (isIcon(item)) {
        if (segment && !segment.endsWith(" ")) segment += " ";
        end = x + (item.width || 0);
        continue;
      }
      const blank = !item.str.trim();
      if (item.height) height = item.height;
      if (blank) {
        // A whitespace item as wide as a column gap is the gap itself.
        if (item.width > COLUMN_GAP(height) && segment.trim()) {
          lines.push(segment);
          segment = "";
          end = null;
        } else if (segment && !segment.endsWith(" ")) {
          segment += " ";
        }
        continue;
      }
      if (end !== null) {
        const gap = x - end;
        if (gap > COLUMN_GAP(height)) {
          lines.push(segment);
          segment = "";
        } else if (gap > 0.15 * height && !segment.endsWith(" ")) {
          // A visible gap with no space item: the PDF dropped the space.
          segment += " ";
        }
      }
      segment += item.str;
      end = x + (item.width || 0);
    }
    if (segment.trim()) lines.push(segment);
  }
  return lines.map(repair).filter(Boolean);
}

let pdfjs = null;
async function library() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("../vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.mjs");
  return pdfjs;
}

/** Real font names ("VOXUTP+FontAwesome") live on the page's loaded fonts. */
export async function iconTester(page) {
  await page.getOperatorList(); // loads the fonts into commonObjs
  const cache = new Map();
  return (item) => {
    if (!cache.has(item.fontName)) {
      let name = "";
      try {
        name = page.commonObjs.get(item.fontName)?.name || "";
      } catch {
        name = "";
      }
      cache.set(item.fontName, ICON_FONT.test(name));
    }
    return cache.get(item.fontName);
  };
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

export async function textFromPdfBytes(bytes, lib) {
  const { getDocument } = lib;
  const pdf = await getDocument({ data: bytes }).promise;
  const lines = [];
  const links = new Set();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    lines.push(...linesFromItems(items, await iconTester(page)));
    (await pageLinks(page)).forEach((url) => links.add(url));
  }
  return [...lines, ...links].join("\n");
}

export async function textFromStoredPdf(stored) {
  return textFromPdfBytes(fromBase64(stored.data), await library());
}
