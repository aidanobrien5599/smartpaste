/**
 * The opt-in acknowledgements (Settings -> "Tick acknowledgements for me"):
 * the "I have read the privacy notice" / "I confirm this is accurate" boxes
 * most forms end with. Decided here from the wording, never by Jev, and only
 * with the setting on.
 *
 * Depends on: discover/ (groupCheckboxes, pageChrome, labelFor, ownerLabel,
 * questionFor), dom/controls.ts, dom/query.ts (click), dom/text.ts (clean),
 * lib/schema.ts (Settings).
 *
 * ATS quirks: Vercel asks both acknowledgements as one-option radio groups,
 * so a lone radio counts as a box to tick. C3's bare "I Accept" under a
 * privacy notice is an acknowledgement. Marketing, SMS, talent-community,
 * job-alert and do-not-sell wording is never ticked, even alongside
 * "I acknowledge".
 */
import type { Settings } from "../../lib/schema.ts";
import { groupCheckboxes } from "../discover/collect/checkboxes.ts";
import { pageChrome } from "../discover/gate.ts";
import { labelFor, ownerLabel, questionFor } from "../discover/labels.ts";
import { nodeVisible } from "../dom/controls.ts";
import { click } from "../dom/query.ts";
import { clean } from "../dom/text.ts";

// Opt-in (Settings -> "Tick acknowledgements for me"): the "I have read the
// privacy notice" and "I confirm this is accurate" boxes most forms end
// with. Vercel asks both as a radio group with one option, so they are not
// questions at all -- there is nothing to choose, only something to tick.
// Decided here, never by Jev, and only on wording that is an acknowledgement:
// marketing, texts, talent pools and do-not-sell stay the applicant's even
// with the setting on, whatever else the label says.
const ACKNOWLEDGEMENT = /acknowledg|have read|read and understood?|reviewed and confirm|confirm(?:ed)? that|accurate and complete|true and (?:correct|complete)|certify|attest|i accept|privacy (?:notice|policy|statement)|terms (?:and|&) conditions/i;

const NEVER_ACKNOWLEDGE = /marketing|newsletter|subscribe|promotion|special offers|\bsms\b|text messages?|contact me|do not sell|share my personal|remember me|talent (?:community|network|pool)|future (?:roles|opportunities|openings)|job alerts/i;

export function acknowledgements(): HTMLInputElement[] {
  const found: HTMLInputElement[] = [];
  const consider = (box: HTMLInputElement, ...texts: string[]) => {
    if (box.disabled || box.checked || pageChrome(box)) return;
    const text = texts.filter(Boolean).join(" ");
    if (!ACKNOWLEDGEMENT.test(text) || NEVER_ACKNOWLEDGE.test(text)) return;
    const shown = box.closest("label") || box;
    if (nodeVisible(shown) || nodeVisible(box)) found.push(box);
  };
  const radios = new Map<string, HTMLInputElement[]>();
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    if (radio.name) radios.set(radio.name, [...(radios.get(radio.name) || []), radio]);
  }
  for (const group of radios.values()) {
    if (group.length === 1) consider(group[0], clean(group[0].closest("label")?.textContent), questionFor(group));
  }
  for (const [box, ...rest] of groupCheckboxes()) {
    if (!rest.length) consider(box, labelFor(box), ownerLabel(box));
  }
  return found;
}

/** Tick every acknowledgement, if the setting is on. Returns how many. */
export async function acknowledge(): Promise<number> {
  let settings: Settings = {};
  try { ({ settings = {} } = await chrome.storage.local.get("settings")); } catch { return 0; }
  if (!settings.acknowledge) return 0;
  let ticked = 0;
  for (const box of acknowledgements()) {
    click(box);
    if (!box.checked) box.click();
    if (box.checked) ticked++;
  }
  return ticked;
}
