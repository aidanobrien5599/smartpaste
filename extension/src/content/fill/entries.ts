/**
 * Repeated entries ("Add" sections): find each section with an Add button,
 * count the entries it already holds, and click Add until it holds one per
 * profile entry -- before anything fills, since the new cards' fields need
 * answers too.
 *
 * Depends on: discover/sections.ts (ENTRY_SECTIONS, titledSection, CARD,
 * entryNumbers, splitsInternships), dom/controls.ts, dom/query.ts,
 * state.ts (profileCache), lib/schema.ts (Profile).
 *
 * ATS quirks: Workday's My Experience step starts as empty labelled groups
 * ("Work-Experience-section") whose Add button is relabelled "Add Another"
 * after the first click; entries are counted by panel label or by numbered
 * ids. ByteDance's are bare "Add" buttons beside a section title, its
 * entries drawn as cards, with roles split into Work and Internship
 * Experience. At most MAX_ENTRIES per section.
 */
import type { Profile } from "../../lib/schema.ts";
import { CARD, ENTRY_SECTIONS, entryNumbers, splitsInternships, titledSection } from "../discover/sections.ts";
import { nodeVisible } from "../dom/controls.ts";
import { fire, sleep } from "../dom/query.ts";
import { state } from "../state.ts";

type EntryKind = (typeof ENTRY_SECTIONS)[number];
interface EntryPlan { section: Element; add?: HTMLButtonElement; panels: () => number; want: number }

/** Entries already on the page for a section: panels, marked boxes, or ids. */
function countEntries(kind: EntryKind, prefix: string, root: Element): number {
  const cards = root && !prefix ? root.querySelectorAll(CARD).length : 0;
  if (cards) return cards;
  // One entry can carry both a panel label and ids; count one or the other.
  const panels = prefix ? document.querySelectorAll(
    `[role="group"][aria-labelledby^="${CSS.escape(prefix)}"][aria-labelledby$="-panel"]`).length : 0;
  return panels || Math.max(0, ...kind.stems.map((stem) => entryNumbers(stem).length));
}

const addButtonIn: (root: Element) => HTMLButtonElement | undefined = (root) => [...root.querySelectorAll("button")].find((b) =>
  b.getAttribute("data-automation-id") === "add-button" ||
  /^add\b/i.test(b.getAttribute("aria-label") || b.textContent!.trim()));

const MAX_ENTRIES = 4;

/** Sections with an Add button, and how many panels each should hold. */
async function entryPlan(): Promise<EntryPlan[]> {
  // A section is a labelled group ("Work-Experience-section") or, failing
  // that, wherever a button says "Add Work Experience" / "Add Another …".
  const found: { root: Element; name: string; prefix: string; button?: HTMLButtonElement }[] = [];
  for (const group of document.querySelectorAll('[role="group"][aria-labelledby$="-section"]')) {
    if (!nodeVisible(group)) continue;
    const id = group.getAttribute("aria-labelledby")!;
    found.push({ root: group, name: `${id} ${document.getElementById(id)?.textContent || ""}`, prefix: id.replace(/section$/, "") });
  }
  for (const button of document.querySelectorAll("button")) {
    const name = button.getAttribute("aria-label") || button.textContent!.trim();
    if (!/^add\b/i.test(name) || !nodeVisible(button) || found.some((f) => f.root.contains(button))) continue;
    if (/^add(?: another)?$/i.test(name.trim())) {
      // A bare "Add" says nothing about its section, but a title beside
      // it can: ByteDance's "Work Experience  [Add]".
      const section = titledSection(button);
      if (section && !found.some((f) => f.root === section.root)) found.push({ ...section, prefix: "", button });
      continue;
    }
    found.push({ root: button.parentElement!, name, prefix: "", button });
  }
  if (!found.length) return [];
  let profile: Profile = {};
  try { ({ profile = {} } = await chrome.storage.local.get("profile")); } catch { return []; }
  state.profileCache = profile;
  const split = splitsInternships();
  const plan: EntryPlan[] = [];
  const taken = new Set<EntryKind>();
  for (const { root, name, prefix, button } of found) {
    const kind = ENTRY_SECTIONS.find((k) => k.test.test(name));
    if (!kind || taken.has(kind)) continue;
    taken.add(kind);
    const panels = () => countEntries(kind, prefix, root);
    const want = Math.min(kind.entries(profile, split).length, MAX_ENTRIES);
    if (panels() < want) plan.push({ section: root, add: button, panels, want });
  }
  return plan;
}

/** How many entries a fill would add: counted on the button. */
export async function entriesToAdd(): Promise<number> {
  return (await entryPlan()).reduce((sum, p) => sum + p.want - p.panels(), 0);
}

/** Click Add until each section holds one panel per profile entry. */
export async function addEntries(): Promise<number> {
  let added = 0;
  for (const { section, add: first, panels, want } of await entryPlan()) {
    for (let guard = 0; panels() < want && guard < MAX_ENTRIES; guard++) {
      // The button may be relabelled "Add Another" after the first click.
      const add = (first && first.isConnected && first) || addButtonIn(section);
      if (!add) break;
      const before = panels();
      fire(add, "click");
      for (let i = 0; i < 40 && panels() === before; i++) await sleep(50);
      if (panels() === before) break;
      added++;
    }
  }
  return added;
}
