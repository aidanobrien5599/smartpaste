/**
 * Whether the page is even worth reading: page chrome to leave alone
 * (search boxes, cookie banners), and the local, no-network check that
 * decides whether a page is a job application before any label leaves it.
 *
 * ATS quirks:
 * - A search form's action says "search" as a word of its own
 *   ("/search", "/job-search?q=", "search.php", "?search="). A "search"
 *   inside a word is not one: HPR's Greenhouse form posts to
 *   "/hyannisportresearch/jobs/…", and a substring match made its whole
 *   application page chrome -- no fields, no button.
 * - A Workday step of nothing but questions ("Are you at least 18?",
 *   salary, sponsorship) names too few kinds of field to pass on its own,
 *   so an ATS's own application-flow markup or hostname settles it instead
 *   (ATS_FLOW / ATS_HOST / inApplicationFlow).
 * - Name, email and phone alone are a contact form, not an application
 *   (IDENTITY, in looksLikeApplication).
 *
 * Depends on: dom/query.ts, dom/controls.ts, discover/selectors.ts, discover/files.ts,
 * shared/types.ts.
 */
import { deepAll } from "../dom/query.ts";
import { nodeVisible } from "../dom/controls.ts";
import { FILE_SELECTOR } from "./selectors.ts";
import { fileHintTiers, documentFor } from "./files.ts";
import type { Field } from "../../shared/types.ts";

// Page chrome that is not the application: a site's search box, a cookie
// banner's "Do Not Sell" toggle.
export const PAGE_CHROME = '[role="search"], ' +
  '[id*="cookie" i], [class*="cookie" i], [id*="onetrust" i], [class*="cky-"], [id^="cky"]';
// A search form's action says "search" as a word of its own: "/search",
// "/job-search?q=", "search.php", "?search=". A "search" inside a word
// is not one -- HPR's Greenhouse form posts to
// "/hyannisportresearch/jobs/…", and a substring match made its whole
// application page chrome: no fields, no button.
const SEARCH_ACTION = /(?:^|[/?&=._-])search(?:$|[/?&=.#_-])/i;
export const pageChrome: (element: Element) => boolean = (element) => element.closest(PAGE_CHROME) !== null ||
  SEARCH_ACTION.test(element.closest("form")?.getAttribute("action") || "");

// The script runs on every site, like any autofill tool -- but it only talks
// to Jev on a page that is plainly a job application. Login, checkout and
// newsletter forms have fields too, and their labels have no business
// leaving the machine. This check is local: no network, no model.
const APPLICATION_TERMS: [string, RegExp][] = [
  ["name", /\b(?:first|last|full|legal|preferred|given|family)\s*name\b|^name$/i],
  ["email", /\be-?mail\b/i],
  ["phone", /\b(?:phone|mobile|telephone|cell)\b/i],
  ["resume", /\b(?:resume|r\u00e9sum\u00e9|cv|curriculum vitae|cover letter)\b/i],
  ["links", /\b(?:linkedin|github|portfolio|personal website)\b/i],
  ["authorization", /\b(?:authori[sz]ed to work|work authori[sz]ation|sponsorship|visa|right to work|legally (?:eligible|authori[sz]ed))\b/i],
  ["eeo", /\b(?:veteran|disability|gender|race|ethnicity|hispanic|latino|pronouns)\b/i],
  ["education", /\b(?:graduat\w*|degree|school|university|college|gpa|major|discipline)\b/i],
  ["logistics", /\b(?:salary|compensation|start date|notice period|relocat\w*|how did you hear|referr\w*|years of experience)\b/i],
  ["employment", /\b(?:current (?:company|employer|title)|employer|job title|most recent)\b/i],
];
const IDENTITY = new Set(["name", "email", "phone"]);
const APPLY_PAGE = /\b(?:apply|application|careers?|jobs?|position|opening|recruit\w*|talent)\b/i;

// An applicant tracking system's own application flow says what it is.
// A Workday step of nothing but questions -- "Are you at least 18?",
// "Salary expectations?", sponsorship -- names too few kinds of field to
// pass the check below, and got no button at all.
const ATS_HOST = /(?:^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com|greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com|bamboohr\.com)$/i;
const ATS_FLOW = '[data-automation-id="applyFlowPage"], [data-automation-id="progressBar"], ' +
  '#application-form, #application_form, .application-form, form[action*="apply" i]';

export function inApplicationFlow(): boolean {
  return document.querySelector(ATS_FLOW) !== null ||
    (ATS_HOST.test(location.hostname) && /\/appl(?:y|ication)\b/i.test(location.pathname));
}

export function looksLikeApplication(fields: Field[]): boolean {
  // A resume upload settles it; so does the ATS's own application flow.
  const uploads = deepAll(FILE_SELECTOR).filter(nodeVisible);
  if (uploads.some((input) => documentFor(fileHintTiers(input as HTMLInputElement).join(" ")) === "resume")) return true;
  if (fields.length && inApplicationFlow()) return true;
  const kinds = new Set<string>();
  for (const { label } of fields) {
    for (const [kind, pattern] of APPLICATION_TERMS) if (pattern.test(label)) kinds.add(kind);
  }
  // Name, email and phone alone are a contact form, not an application.
  const beyondIdentity = [...kinds].filter((k) => !IDENTITY.has(k)).length;
  if (!beyondIdentity) return false;
  const onApplyPage = APPLY_PAGE.test(location.href) || APPLY_PAGE.test(document.title);
  return kinds.size >= (onApplyPage ? 3 : 4);
}
