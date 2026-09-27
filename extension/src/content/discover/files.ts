/**
 * What a file input is for: resume, transcript or cover letter, read from
 * the strongest evidence first so a resume upload never gets mistaken for
 * the site's own resume parser.
 *
 * ATS quirks:
 * - Greenhouse labels its resume upload "Attach" and hides the clue in the
 *   id instead.
 * - SmartRecruiters draws the input inside a component (<spl-dropzone>)
 *   whose data-test names it ("resume-upload").
 * - Ashby puts an unlabelled "Autofill from resume" dropzone above the real
 *   Resume field; letting surrounding text count this high would outrank
 *   the real field, which hands the file to the site's own parser and
 *   wipes everything already filled (AUTOFILL_DROPZONE).
 * - Workday wraps a bare input in a <div data-automation-id="resumeUpload">.
 * - ByteDance labels a bare input "Attachment", inside a dropzone that says
 *   "Drag your resume here".
 *
 * Depends on: discover/labels.ts, discover/selectors.ts.
 */
import { labelFor } from "./labels.ts";
import { FIELD_ENTRY } from "./selectors.ts";

const DOC_KEYWORDS: [string, string[]][] = [
  ["resume", ["resume", "cv", "curriculum"]],
  ["transcript", ["transcript", "academic record"]],
  ["cover_letter", ["cover letter", "coverletter"]],
];

/**
 * What names a file input, strongest evidence first.
 *
 * The element's own label, id and name are reliable -- Greenhouse labels its
 * resume upload "Attach" and hides the clue in the id. Surrounding text is a
 * last resort and must stay that way: Ashby puts an unlabelled "Autofill
 * from resume" dropzone above the real Resume field, and its container text
 * says "resume" too. Ranking keeps the document on the right input.
 */
export function fileHintTiers(input: HTMLInputElement): [string, string] {
  const explicit = input.id
    ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent || ""
    : "";
  // Inside a component (SmartRecruiters' <spl-dropzone>) the component's
  // data-test names it: "resume-upload". Not "apply-with-resume-container":
  // that one is the site's own resume parser, for the reason below.
  const host = (input.getRootNode() as ShadowRoot).host;
  const named = host?.getAttribute("data-test") || "";
  const hostName = /apply-with|autofill|parse/i.test(named) ? "" : named;
  return [
    // Only evidence the element states about itself. labelFor()'s sibling
    // walk is deliberately excluded: an unlabelled dropzone sits next to the
    // words "Autofill from resume", and letting that count outranks the real
    // Resume field -- which hands the file to the site's own parser, which
    // re-renders the form and wipes everything already filled.
    [explicit, hostName, input.id || "", input.name || "",
     input.getAttribute("aria-label") || "",
     // Workday: <div data-automation-id="resumeUpload"> around a bare input
     input.closest('[data-automation-id*="resume" i], [aria-labelledby*="resume" i], [data-fkit-id*="resume" i]')
       ?.getAttribute("data-automation-id") || "",
     input.closest('[data-fkit-id*="resume" i]') ? "resume" : ""].join(" "),
    [labelFor(input),
     (input.closest(FIELD_ENTRY) || input.closest("[class*='field'], fieldset"))
       ?.textContent?.slice(0, 140) || "",
     // ByteDance: a bare input labelled "Attachment", inside a dropzone
     // that says "Drag your resume here".
     input.closest("[class*='upload' i]")?.textContent?.slice(0, 140) || ""].join(" "),
  ];
}

const AUTOFILL_DROPZONE = /autofill|auto-fill|parse (?:your )?resume/i;

export function documentFor(label: string): string | null {
  const low = (label || "").toLowerCase();
  if (AUTOFILL_DROPZONE.test(low)) return null;
  for (const [key, words] of DOC_KEYWORDS) {
    if (words.some((word) => low.includes(word))) return key;
  }
  return null;
}
