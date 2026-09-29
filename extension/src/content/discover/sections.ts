/**
 * Which repeated entry a field belongs to, and the prefix that names it:
 * "Work Experience 2: ", so a panel asked once per entry does not read as
 * the same question twice.
 *
 * ATS quirks:
 * - Workday numbers a repeat panel by its own aria-labelledby heading, or by
 *   the ids of its fields / its data-automation-id container
 *   ("workExperience-2--startDate-…" / "workExperience-2"); its own numbers
 *   ("workExperience-20" for the first job) are remapped to page order by
 *   entryNumbers.
 * - Ashby marks an entry with data-field-path
 *   ("_systemfield_education_history") instead, with no per-field number.
 * - Workable draws Education and Experience as groups it names itself,
 *   headed by a <p id="…_label"> rather than a heading; both groups' date
 *   boxes carry the same name and the same label, so unprefixed the page
 *   asked "Start date" twice and a required "Title" bare.
 * - ByteDance draws a repeated entry as a card under a titled section
 *   (CARD / SECTION_TITLE) rather than a labelled group, numbered by
 *   position in that section, and named by the matching profile entry
 *   (titledSection, ENTRY_SECTIONS) -- and splits roles into Work and
 *   Internship sections by title, so an internship's entries must be
 *   counted separately (splitsInternships, isIntern).
 * - Hermeus (Lever) writes a card's own question as "Select One" for all
 *   fifteen of its radios; a question whose own text is nameless is named
 *   by the card's heading instead (cardQuestion).
 *
 * Depends on: dom/text.ts, state.ts (state.profileCache), lib/schema.ts.
 */
import { clean } from "../dom/text.ts";
import { state } from "../state.ts";
import type { Profile, ProfileEntry } from "../../lib/schema.ts";

/**
 * Which entry of a repeated section a field sits in. Workday asks "Job
 * Title" once per "Work Experience 1", "Work Experience 2"...; without the
 * panel's heading every one of them reads as the same question.
 */
export function sectionPrefix(element: Element): string {
  const group = element.closest('[role="group"][aria-labelledby]');
  const heading = group && document.getElementById(group.getAttribute("aria-labelledby")!);
  const text = heading ? clean(heading.textContent) : "";
  if (/\d/.test(text) && text.length < 60) return `${text}: `;
  // Otherwise the entry's own ids name it: "workExperience-2--startDate-…"
  // or a container marked data-automation-id="workExperience-2".
  const input = element.matches("input, textarea, select, button") ? element : element.querySelector("input, textarea, select, button");
  const byId = (input?.id || "").match(/^([a-zA-Z]+)-(\d+)--/);
  const box = element.closest('[data-automation-id]:is([data-automation-id^="workExperience-"], [data-automation-id^="education-"], [data-automation-id^="websitePanelSet-"], [data-automation-id^="certification-"], [data-automation-id^="language-"])');
  const byBox = box?.getAttribute("data-automation-id")!.match(/^([a-zA-Z]+)-(\d+)$/);
  const [, stem, n] = byId || byBox || [];
  if (!stem) {
    // Ashby: data-field-path="_systemfield_education_history" around the
    // entry, whose own fields are just "Start Date", "Degree"...
    const path = element.closest("[data-field-path]")?.getAttribute("data-field-path") || "";
    const section = path.replace(/^_systemfield_/, "").replace(/_/g, " ").trim();
    if (/\b(education|experience|employment|work) history\b/i.test(section)) {
      return `${section.replace(/\b\w/g, (c) => c.toUpperCase())}: `;
    }
    // Workable draws Education and Experience as groups it names itself,
    // headed by a <p> rather than a heading, around boxes that say only
    // "School", "Title", "Start date". Both groups' date boxes carry the
    // same name and the same label, so unprefixed the page asks "Start
    // date" twice and "Title" bare -- and Title is required.
    const group = element.closest?.('[data-ui="education"], [data-ui="experience"]');
    const named = group && clean(group.querySelector('p[id$="_label"]')?.textContent || "");
    if (named) return `${named}: `;
    // A card in a titled section: its number, and the profile entry it is
    // for, since ByteDance's Work Experience 1 is my 2nd most recent role.
    const card = element.closest?.(CARD);
    const titled = card && titledSection(card);
    if (titled) {
      const n = [...titled.root.querySelectorAll(CARD)].indexOf(card) + 1;
      const kind = ENTRY_SECTIONS.find((k) => k.test.test(titled.name));
      const entry = kind?.entries(state.profileCache, splitsInternships())[n - 1];
      const subject = entry && kind.summary ? String((entry as ProfileEntry)[kind.summary] || "").trim() : "";
      return `${titled.name} ${n}${subject ? ` (${subject})` : ""}: `;
    }
    // Greenhouse's education block: no heading of its own, but every part
    // of it is under .education--form. Its boxes say only "Start date month"
    // / "Start date year", which read as the date I could start a job
    // (June 2027) rather than when I started school.
    if (element.closest?.(".education--form")) return "Education: ";
    // A section headed "Education" around bare "School" / "Start" boxes.
    for (let node = element.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
      const heading = node.querySelector(":scope > h2, :scope > h3, :scope > h4");
      const text = heading ? clean(heading.textContent) : "";
      if (/^(education|work experience|experience|employment)$/i.test(text)) return `${text}: `;
    }
    return "";
  }
  const name = ENTRY_NAMES[stem] || stem.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  // Workday's ids number entries its own way (the first job is
  // workExperience-20); a form's "Work Experience 1" is the first on the page.
  const order = entryNumbers(stem);
  return `${name} ${order.indexOf(n) + 1 || n}: `;
}

// A question whose own text names nothing is named by the card it sits in.
// Hermeus (Lever) writes "How did you hear about us?" in the card's <h4>
// and labels all fifteen of its radios "Select One"; asked as "Select One",
// a required question no profile could answer was left blank.
const NAMELESS = /^(?:select|choose|pick)(?:\s+(?:one|an?\s+option|from(?:\s+the)?\s+(?:list|below)))?$/i;
export function cardQuestion(element: Element, label: string): string {
  if (!NAMELESS.test(label)) return label;
  for (let node = element?.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
    const heading = node.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend");
    const text = heading ? clean(heading.textContent) : "";
    if (text.length > 2) return text;
  }
  return label;
}

/** An entry stem's numbers ("20", "21"...) in page order. */
export function entryNumbers(stem: string): string[] {
  // Field ids first ("workExperience-20--jobTitle"); a container's own
  // marker ("workExperience-1") may number the same entry differently.
  const collect = (selector: string, pattern: RegExp, read: (el: Element) => string) => {
    const seen: string[] = [];
    for (const el of document.querySelectorAll(selector)) {
      const m = read(el).match(pattern);
      if (m && !seen.includes(m[1])) seen.push(m[1]);
    }
    return seen;
  };
  const byId = collect(`[id^="${stem}-"]`, /^[a-zA-Z]+-(\d+)--/, (el) => el.id);
  return byId.length ? byId
    : collect(`[data-automation-id^="${stem}-"]`, /^[a-zA-Z]+-(\d+)$/, (el) => el.getAttribute("data-automation-id") || "");
}

const ENTRY_NAMES: Record<string, string> = { workExperience: "Work Experience", education: "Education", websitePanelSet: "Websites",
  webAddress: "Websites", certification: "Certifications", language: "Languages" };

// Workday's My Experience step starts with empty sections: each job,
// school or website exists only once you click its section's Add button.
// Nothing to fill until then, so the whole step used to be skipped.
const LINK_KEYS = ["linkedin", "github", "portfolio", "other_link"];
// ByteDance splits roles into Work and Internship sections: a role whose
// title says intern goes under Internship, and then only there.
const isIntern: (role: ProfileEntry) => boolean = (role) => /\bintern(?:ship)?\b/i.test(role.title || "");
// Most specific first: "Internship Experience" and "Project Experience"
// would otherwise count as work experience.
export const ENTRY_SECTIONS: {
  test: RegExp;
  stems: string[];
  summary?: string;
  entries: (p: Profile, split?: boolean) => (ProfileEntry | string)[];
}[] = [
  { test: /intern/i, stems: [], summary: "company",
    entries: (p) => ((p.experience as ProfileEntry[] | undefined) || []).filter(isIntern) },
  { test: /project/i, stems: [], summary: "name", entries: (p) => (p.projects as ProfileEntry[] | undefined) || [] },
  { test: /award|hono(?:u)?r/i, stems: [], summary: "title", entries: (p) => (p.awards as ProfileEntry[] | undefined) || [] },
  { test: /experience|employment|work.?history|where.*worked/i, stems: ["workExperience"], summary: "company",
    entries: (p, split) => ((p.experience as ProfileEntry[] | undefined) || []).filter((role) => !split || !isIntern(role)) },
  { test: /education|school/i, stems: ["education"], summary: "school", entries: (p) => (p.education as ProfileEntry[] | undefined) || [] },
  { test: /website/i, stems: ["websitePanelSet", "webAddress"],
    entries: (p) => LINK_KEYS.filter((k) => String(p[k] || "").trim()) },
];
export const splitsInternships: () => boolean = () => [...document.querySelectorAll(SECTION_TITLE)].some((t) => /intern/i.test(t.textContent!));

// A repeated entry drawn as a card (ByteDance), under a section title
// rather than a labelled group.
export const CARD = '[class*="array-card-content"]';
export const SECTION_TITLE = 'h2, h3, h4, [class*="Wrapper-title"], [class*="section-title"], [class*="sectionTitle"]';

/** The titled section around a node: its root and its title's text. */
export function titledSection(node: Element): { root: Element; name: string } | null {
  for (let root = node.parentElement, depth = 0; root && depth < 8; root = root.parentElement, depth++) {
    const title = [...root.querySelectorAll(SECTION_TITLE)].find((t) => !t.contains(node) && clean(t.textContent));
    const text = title ? clean(title.textContent) : "";
    if (text && text.length < 40) return { root, name: text };
  }
  return null;
}
