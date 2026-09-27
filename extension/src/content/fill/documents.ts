/**
 * Attaching stored documents (resume, transcript, cover letter) to the
 * page's upload fields, each to the one input that names it best, and
 * counting how many a fill would attach (for the pill's label).
 *
 * Depends on: discover/files.ts (fileHintTiers, documentFor),
 * discover/selectors.ts (FILE_SELECTOR), dom/query.ts (deepAll).
 *
 * ATS quirks: a file input's `files` is read-only, but it takes a FileList
 * from a DataTransfer, the way a drag-and-drop delivers it. SmartRecruiters
 * keeps its inputs in shadow roots, hence deepAll. Ashby's unlabelled
 * "Autofill from resume" dropzone is never handed a file (fileHintTiers
 * ranks an input's own evidence first); some hosts wrap uploads in a widget
 * that rejects this, and that input is simply skipped.
 */
import { documentFor, fileHintTiers } from "../discover/files.ts";
import { FILE_SELECTOR } from "../discover/selectors.ts";
import { deepAll } from "../dom/query.ts";

/** A stored document, as options.js saves it in chrome.storage.local.documents. */
interface StoredDocument { name: string; type?: string; data: string }

/** Assign each stored document to the one input that names it best. */
function planAttachments(inputs: HTMLInputElement[], documents: Record<string, StoredDocument>): Map<HTMLInputElement, string> {
  const plan = new Map<HTMLInputElement, string>();
  for (const tier of [0, 1]) {
    for (const input of inputs) {
      if (plan.has(input)) continue;
      const key = documentFor(fileHintTiers(input)[tier]);
      if (!key || !documents[key]) continue;
      if ([...plan.values()].includes(key)) continue; // already placed
      plan.set(input, key);
    }
  }
  return plan;
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A file input's `files` is read-only, but it accepts a FileList taken from
 * a DataTransfer -- which is how a drag-and-drop would have delivered it.
 */
export async function attachDocuments(): Promise<number> {
  const inputs = (deepAll(FILE_SELECTOR) as HTMLInputElement[]).filter(
    (el) => !el.disabled && !el.files!.length
  );
  if (!inputs.length) return 0;
  const { documents = {} } = await chrome.storage.local.get("documents") as { documents?: Record<string, StoredDocument> };
  const plan = planAttachments(inputs, documents);
  let attached = 0;
  for (const [input, key] of plan) {
    const stored = documents[key];
    if (!stored) continue;
    try {
      const file = new File([decode(stored.data)], stored.name, {
        type: stored.type || "application/pdf",
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      attached++;
    } catch (error) {
      // Some hosts wrap uploads in a custom widget that rejects this.
    }
  }
  return attached;
}

export async function countAttachable(): Promise<number> {
  const inputs = (deepAll(FILE_SELECTOR) as HTMLInputElement[]).filter(
    (el) => !el.disabled && !el.files!.length
  );
  if (!inputs.length) return 0;
  const { documents = {} } = await chrome.storage.local.get("documents") as { documents?: Record<string, StoredDocument> };
  return planAttachments(inputs, documents).size;
}
