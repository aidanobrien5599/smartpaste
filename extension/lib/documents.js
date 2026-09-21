/**
 * The PDFs a form wants attached.
 *
 * chrome.storage holds JSON, so a file is kept as base64 alongside its name
 * and type. A resume is ~100KB and base64 costs a third more, which sits well
 * inside the 10MB local quota even with a transcript and cover letter.
 */

import { DOCUMENTS } from "./schema.js";

export const MAX_BYTES = 3 * 1024 * 1024;

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked, because spreading a large array into String.fromCharCode
  // overflows the argument limit on files of any real size.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Which stored document, if any, a file input is asking for. */
export function documentFor(label) {
  const low = (label || "").toLowerCase();
  for (const [key, , keywords] of DOCUMENTS) {
    if (keywords.some((word) => low.includes(word))) return key;
  }
  return null;
}

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
