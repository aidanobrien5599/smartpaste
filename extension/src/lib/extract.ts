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

import { fromBase64 } from "./documents.ts";
import type { StoredDocument } from "./documents.ts";

/** A pdf.js text-content item, typed for only what this file reads from it. */
export type Item = {
  str?: string;
  transform: number[];
  width?: number;
  height?: number;
  fontName?: string;
};

/** A line fragment built out of one or more items on the same baseline. */
type Segment = { text: string; x0: number; x1: number; h: number; y: number };
/** A segment while still being assembled: not yet placed on its row's y. */
type OpenSegment = Omit<Segment, "y">;

// Icon fonts map their glyphs onto ordinary codepoints -- FontAwesome's phone
// and envelope arrive as "Ó" and "R" -- so no character test can catch them.
// The font name can.
export const ICON_FONT = /fontawesome|icons?\b|glyph|dingbat|wingding|material|fa-?(?:solid|regular|brands)/i;

// Anything wider than this between two fragments on one line is a column
// break, not a word space. A space here is ~3pt; a right-aligned date sits
// 250pt away.
const COLUMN_GAP = (height: number): number => Math.max(15, 1.5 * height);

const MONTHS =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|" +
  "April|June|July|August|September|October|November|December";
const GLUED_DATE = new RegExp(`(?<=[a-z])(?=(?:${MONTHS})\\b)`, "g");
const GLUED_NAME = /(?<=[A-Z]{2})(?=[A-Z][’'][A-Z])/g;
const PRIVATE_USE = /[\ue000-\uf8ff]+/g;

// LaTeX's T1 ("Cork") and TS1 encodings put dashes, quotes, ligatures and the
// bullet in slots that are control characters in Unicode. A PDF made without
// the vector cm-super fonts embeds bitmap fonts with no Unicode map, so pdf.js
// hands back the raw slot: "Aug 2022 \u0015 May 2026", "\u001daky-test".
// Control characters are never real text, so mapping them back is safe.
const CORK: Record<string, string> = {
  "\u000d": "‚", "\u0010": "“", "\u0011": "”", "\u0012": "„",
  "\u0015": "–", "\u0016": "—", "\u001b": "ff", "\u001c": "fi", "\u001d": "fl",
  "\u001e": "ffi", "\u001f": "ffl", "\u0088": "•",
};
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const decodeCork = (text: string): string => text.replace(CONTROL, (c) => CORK[c] ?? "");

function repair(line: string): string {
  return decodeCork(line)
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

const SECTION_WORD =
  /^(?:education|experience|work experience|professional experience|employment|skills|technical skills|projects|summary|profile|contact|awards|certifications|leadership|activities|languages|interests)$/i;
// Only a section word counts here: a name set in capitals ("FIRSTNAME
// LASTNAME") is not a heading, and treating it as one let a centred header
// pass for a sidebar.
const headingish = (text: string): boolean => SECTION_WORD.test(text.trim().replace(/:$/, ""));

/**
 * Segments in reading order: top to bottom, except that a real second column
 * is read after the first instead of being woven into it line by line.
 *
 * A column is told apart from two things that look like one:
 *  - right-aligned dates on the title line: they END at a common x, but start
 *    wherever their width puts them -- so a gutter must be a common START x,
 *    with ENDS that vary;
 *  - a narrow date column in front of every entry (the content does start at
 *    a common x) -- but only one side has section headings. A sidebar has
 *    headings in both columns.
 */
export function readingOrder(segments: Segment[]): Segment[] {
  if (segments.length < 8) return segments;
  // Where lines start. A second column is a large cluster of starts well to
  // the right of the page margin. Columns rarely share baselines -- their line
  // heights differ -- so this looks at every line, not at rows holding two.
  const margin = Math.min(...segments.map((seg) => seg.x0));
  // The gutter sits at the right column's leftmost start. Its biggest cluster
  // is usually the indented bullets, and a gutter there files the column's own
  // headings ("EXPERIENCE", 13pt further left) under the left column.
  const beyond = segments.filter((seg) => seg.x0 >= margin + 60);
  if (beyond.length < 8) return segments;
  const gutter = Math.min(...beyond.map((seg) => seg.x0)) - 4;
  // A column is left-aligned: most of its lines start at one x. Centred
  // headers and right-aligned dates start all over the place.
  const aligned = beyond.filter((seg) => seg.x0 - gutter <= 20).length;
  if (aligned < 0.5 * beyond.length) return segments;
  const ends = beyond.map((seg) => seg.x1);
  if (Math.max(...ends) - Math.min(...ends) < 40) return segments; // right-aligned
  const left = segments.filter((seg) => seg.x0 < gutter);
  const right = segments.filter((seg) => seg.x0 >= gutter);
  if (!left.some((seg) => headingish(seg.text)) || !right.some((seg) => headingish(seg.text))) {
    return segments; // a date column, not a sidebar
  }
  return [...left, ...right];
}

const PAGE_NUMBER = /^(?:(?:page|seite|p\.?)\s*)?\d{1,3}(?:\s*(?:of|\/|von|de)\s*\d{1,3})?$|^-\s*\d{1,3}\s*-$/i;

const BULLET_MARK = /^\s*[\u2022\u00b7\u25aa\u25cf\u2023\u25e6\u2043*-]\s*/;

/**
 * Rejoin a line the page wrapped, using where it sits rather than what it says.
 *
 * A wrapped bullet continues on the very next line, indented under the
 * bullet's text; the next entry starts back at the margin. Text alone cannot
 * tell those apart -- most bullets have no full stop, and a Word entry line
 * ("Teaching Assistant, Department of Computer and Information Science,
 * Towson, MD") is as long as a sentence -- but position can.
 */
export function joinContinuations(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    const text = seg.text.trim();
    const adjacent = prev && prev.y - seg.y > 0 && prev.y - seg.y <= 1.8 * Math.max(prev.h || 10, seg.h || 10);
    const underBullet = prev && BULLET_MARK.test(decodeCork(prev.text)) && seg.x0 >= prev.x0 + 3;
    // Lower case mid-sentence -- but an email, handle or URL also starts in
    // lower case and is never the rest of a sentence.
    const midSentence = /^[a-z(,;]/.test(text) && /\s/.test(text) && !/@|https?:|www\./.test(text) &&
      prev && seg.x0 >= prev.x0 - 2;
    // A line that stops on "to", "of", "and"... runs on to the next one, even
    // when that starts with a capital: "…seconded to" / "Tokyo HQ (…)".
    const dangling = prev && /\b(?:to|of|and|the|for|with|in|at|by|from|a|an|or|as|via|including)$/i.test(prev.text.trim()) &&
      /^[A-Z(]/.test(text) && seg.x0 >= prev.x0 - 2;
    // A date range wrapped at its end: "September 2016 – December" / "2021".
    const wrappedRange = prev && /(?:[-\u2012-\u2015]|\bto)\s*(?:[A-Z][a-z]{2,8}\.?)?\s*$/.test(prev.text.trim()) &&
      /\d{4}/.test(prev.text) && /^(?:(?:19|20)\d{2}|[A-Z][a-z]{2,8}\.?\s+(?:19|20)\d{2}|Present)\b/.test(text);
    // A word hyphenated across the line break: "Busi-" + "ness".
    const hyphenated = /[a-z]-\s*$/.test(prev?.text || "") && /^[a-z]/.test(text);
    if (adjacent && hyphenated) {
      // adjacent is truthy only when prev is defined (adjacent = prev && …).
      prev!.text = prev!.text.trimEnd().replace(/-$/, "") + text;
      prev!.y = seg.y;
      prev!.x1 = Math.max(prev!.x1, seg.x1);
      continue;
    }
    if (adjacent && !BULLET_MARK.test(decodeCork(seg.text)) && (underBullet || midSentence || dangling || wrappedRange)) {
      prev!.text = `${prev!.text.trimEnd()} ${text}`;
      prev!.y = seg.y;
      prev!.x1 = Math.max(prev!.x1, seg.x1);
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

/**
 * Items -> lines. Pure, so it runs under node:test as well as in the page.
 *
 * `isIcon(item)` says whether an item is set in an icon font.
 */
export function linesFromItems(
  items: Item[],
  isIcon: (item: Item & { str: string }) => boolean = () => false
): string[] {
  const visible = items.filter((item): item is Item & { str: string } => item.str !== undefined);

  // Rows: fragments within a small tolerance of the same baseline. Exact
  // matching splits a small-caps heading ("A" + "IDAN") into two lines.
  const rows: { y: number; items: (Item & { str: string })[] }[] = [];
  for (const item of [...visible].sort((a, b) => b.transform[5] - a.transform[5])) {
    const y = item.transform[5];
    const tolerance = Math.max(2, 0.3 * (item.height || 10));
    const row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y, items: [item] });
  }

  const segments: Segment[] = [];
  for (const row of rows) {
    const cells = row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let segment: OpenSegment | null = null;
    let end: number | null = null; // right edge of the last visible fragment
    let height = 10;
    const close = () => {
      if (segment && segment.text.trim()) segments.push({ ...segment, y: row.y });
      segment = null;
      end = null;
    };
    for (const item of cells) {
      const x = item.transform[4];
      // An icon is dropped from the text but still occupies its place on the
      // line. Removing it outright leaves a hole wide enough to read as a
      // column break, which split "908-216-0389" off its own contact row.
      if (isIcon(item)) {
        if (segment && !segment.text.endsWith(" ")) segment.text += " ";
        end = x + (item.width || 0);
        continue;
      }
      const blank = !item.str.trim();
      if (item.height) height = item.height;
      if (blank) {
        // A whitespace item as wide as a column gap is the gap itself.
        if ((item.width || 0) > COLUMN_GAP(height) && segment && segment.text.trim()) close();
        else if (segment && !segment.text.endsWith(" ")) segment.text += " ";
        continue;
      }
      if (end !== null) {
        const gap = x - end;
        if (gap > COLUMN_GAP(height)) close();
        else if (gap > 0.15 * height && segment && !segment.text.endsWith(" ")) segment.text += " ";
      }
      if (!segment) segment = { text: "", x0: x, x1: x, h: height };
      segment.h = Math.max(segment.h, item.height || 0);
      segment.text += item.str;
      end = x + (item.width || 0);
      segment.x1 = end;
    }
    close();
  }
  const lines = joinContinuations(readingOrder(segments)).map((seg) => seg.text);
  // Page numbers and "Page 1 of 2" footers are not content. On a two-page CV
  // a lone "1" was labelled a company and split an entry in two.
  return lines.map(repair).filter((line) => line && !PAGE_NUMBER.test(line));
}

/**
 * A pdf.js Page, Document and library module, typed only for what this file
 * reads from them; the vendored pdf.js ships no types of its own.
 */
type PdfPage = {
  getOperatorList(): Promise<unknown>;
  commonObjs: { get(name?: string): { name?: string } | undefined };
  getAnnotations(): Promise<{ url?: string; unsafeUrl?: string }[]>;
  getTextContent(): Promise<{ items: Item[] }>;
  view: number[];
};
type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage> };
type PdfLib = { getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocument> } };

let pdfjs: any = null; // vendored pdf.js ships no types
async function library() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(chrome.runtime.getURL("vendor/pdf.mjs"));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.mjs");
  return pdfjs;
}

/** Real font names ("VOXUTP+FontAwesome") live on the page's loaded fonts. */
export async function iconTester(page: PdfPage): Promise<(item: Item) => boolean> {
  await page.getOperatorList(); // loads the fonts into commonObjs
  const cache = new Map<string | undefined, boolean>();
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
    return cache.get(item.fontName) ?? false;
  };
}

/**
 * Page furniture is not content. A footer ("Updated October 2024") was being
 * read as a job's date, and page 2's running header ("Priya Sharma · Current
 * Employer: TechNova Inc.") as a company that opened a phantom entry. The
 * bottom margin of every page, and the top margin of every page after the
 * first, are dropped; page 1's top is where the name is, so it stays.
 */
export function inBody(item: Pick<Item, "transform">, height: number, pageNumber: number): boolean {
  const y = item.transform[5];
  if (y < 0.04 * height) return false;
  if (pageNumber > 1 && y > 0.94 * height) return false;
  return true;
}

/** Hyperlinks live in annotations and never in the text layer. */
async function pageLinks(page: PdfPage): Promise<string[]> {
  const found: string[] = [];
  for (const annotation of await page.getAnnotations()) {
    const url = annotation.url || annotation.unsafeUrl;
    if (url && !url.startsWith("mailto:")) found.push(url);
  }
  return found;
}

export async function textFromPdfBytes(bytes: Uint8Array, lib: PdfLib): Promise<string> {
  const { getDocument } = lib;
  const pdf = await getDocument({ data: bytes }).promise;
  const lines: string[] = [];
  const links = new Set<string>();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    const height = page.view[3] - page.view[1];
    lines.push(...linesFromItems(items.filter((item) => inBody(item, height, n)), await iconTester(page)));
    (await pageLinks(page)).forEach((url) => links.add(url));
  }
  return [...lines, ...links].join("\n");
}

export async function textFromStoredPdf(stored: StoredDocument): Promise<string> {
  return textFromPdfBytes(fromBase64(stored.data), await library());
}
