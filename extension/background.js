/**
 * The only place that talks to Jev.
 *
 * Content scripts inherit the page's origin, so a fetch from one would be a
 * cross-origin request from whatever company you are applying to -- and would
 * hand that page's context your API key. The key never leaves here.
 */

import { asCriteria, buildOptions, extraSnippets, NONE, unwrap } from "./lib/profile.js";
import { FIELDS, ORDINALS, REPEATABLE } from "./lib/schema.js";
import {
  assemble, cleanGpa, DEGREES, sectionByVocabulary, readSkills, readListEntries, readProjects,
  readHomeLocation, EDUCATION_KINDS, EXPERIENCE_KINDS, headingCandidates, isBullet,
  parseDates, SECTION_KINDS, sectionise, splitDegreeField, splitPieces,
} from "./lib/draft.js";
import { AUTO, MENU, isYesNo, maxTicks, resolve, yesNoFromEntry } from "./lib/resolve.js";
import { ASK_HISTORY, isPriorEmploymentQuestion, workHistory } from "./lib/history.js";
import { fillPlaceholders, hasPlaceholders, pageCandidates } from "./lib/answers.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const BATCH = 24;

const ASK_TEXT =
  "Which entry from the applicant's profile answers this job application " +
  "field? Most entries are labelled with the field they hold; match on that " +
  "label. An unlabelled entry is a line from the resume and may merely " +
  "contain the answer. Choose the escape option only if nothing fits.";

const ASK_SELECT =
  "This form field is a dropdown. Given the applicant's profile, which of " +
  "these options should be selected? Choose the escape option only if the " +
  "profile does not say.";

async function loadOptions() {
  const { apiKey, profile = {}, extraText = "", settings = {} } = await chrome.storage.local.get([
    "apiKey",
    "profile",
    "extraText",
    "settings",
  ]);
  const options = buildOptions(profile, extraText, settings);
  // A "Date" beside a signature wants today's date, which no profile holds.
  // Worded for that field: plain "Today's date" lost "Date signed" to the
  // escape option, while start and graduation dates keep their own answers.
  const now = new Date();
  options.today = {
    field: "Today's date (for a 'Date' or 'Date signed' field next to a signature)",
    value: [now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("/") +
      `/${now.getFullYear()}`,
  };
  return { apiKey, profile, options };
}

// A normal answer takes well under a second, but the API occasionally leaves a
// request hanging with no response at all -- once for five minutes, which
// froze a whole draft. Give up on a request after REQUEST_TIMEOUT and retry.
const REQUEST_TIMEOUT = 20000;
const ATTEMPTS = 3;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

async function callJev(apiKey, state, questions) {
  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: MODEL, questions }),
        signal: controller.signal,
      });
      if (response.ok) return (await response.json()).answers;
      const detail = (await response.text()).slice(0, 200);
      lastError = new Error(`TypeSafe API ${response.status}: ${detail}`);
      // A request that is simply too big will not succeed on retry.
      if (!RETRYABLE.has(response.status)) throw lastError;
    } catch (error) {
      if (error === lastError) throw error;
      lastError = error.name === "AbortError"
        ? new Error(`TypeSafe API did not answer within ${REQUEST_TIMEOUT / 1000}s`)
        : error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Send one chunk; if the API says it is too large, halve it and try again.
 *
 * A request's size is questions x options, and a long resume offered as the
 * options of every question blows past the limit ("max_tokens_exceeded") at
 * a batch size that is fine for a one-page resume. Splitting on demand keeps
 * short documents at one round trip and lets long ones through at all. A
 * single question that is still too large is skipped rather than failing the
 * whole draft.
 */
async function askChunk(apiKey, state, chunk) {
  try {
    return await callJev(apiKey, state, chunk);
  } catch (error) {
    const ids = Object.keys(chunk);
    if (!/max_tokens_exceeded/.test(error.message)) throw error;
    if (ids.length === 1) return {};
    const half = Math.ceil(ids.length / 2);
    const [left, right] = [ids.slice(0, half), ids.slice(half)].map((part) =>
      Object.fromEntries(part.map((id) => [id, chunk[id]]))
    );
    return {
      ...(await askChunk(apiKey, state, left)),
      ...(await askChunk(apiKey, state, right)),
    };
  }
}

async function askBatched(apiKey, state, questions) {
  const ids = Object.keys(questions);
  const chunks = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = {};
    for (const id of ids.slice(i, i + BATCH)) chunk[id] = questions[id];
    chunks.push(chunk);
  }
  // In parallel: a page with a 33-box "check all that apply" is several
  // batches, and one after another they added a round trip each.
  const replies = await Promise.all(chunks.map((chunk) => askChunk(apiKey, state, chunk)));
  return Object.assign({}, ...replies);
}

/**
 * "Check all that apply": each box is its own yes/no question. One pick-one
 * question over all of them would split its probability across every right
 * answer (English and Spanish both), so none would clear the bar.
 */
const ASK_MULTI =
  "This application question lets the applicant tick several options. Going " +
  "only by the applicant's profile, should this one option be ticked? Tick " +
  "it only if the profile supports it: a language they speak, a place on " +
  "their list of places they would work, and so on. Do not tick 'prefer not " +
  "to say' or 'other' when a real answer is available.";
const TICK = { yes: "Yes, tick it", no: "No, leave it unticked" };



/**
 * Answer every field on the page in one round trip.
 *
 * Text fields ask which profile entry holds the answer. A dropdown asks a
 * different question entirely -- which of ITS OWN options to pick -- because
 * "Yes" and "I am authorized to work" are the same answer in different words,
 * and only the select knows which words it accepts.
 */
const YES_NO = { yes: "Yes", no: "No" };

/** The boxes to tick, most certain first, capped by what the question allows. */
function ticked(field, i, answers) {
  const yes = field.options
    .map((text, j) => {
      const a = answers[`f${i}_m${j}`];
      const p = a && a.choice === "yes"
        ? Math.min(Number(a.probabilities?.yes ?? 0), Number(a.confidence ?? 0)) : 0;
      return { value: text, p };
    })
    .filter((o) => o.p >= MENU)
    .sort((a, b) => b.p - a.p)
    .slice(0, maxTicks(field.label));
  if (!yes.length) return { label: field.label, status: "none", value: null, confidence: 0, alternatives: [] };
  const confidence = Math.min(...yes.map((o) => o.p));
  return {
    label: field.label,
    status: yes.some((o) => o.p >= AUTO) ? "auto" : "pick",
    value: yes.filter((o) => o.p >= AUTO).map((o) => o.value),
    confidence,
    multi: true,
    alternatives: yes,
  };
}

async function answerFields(fields, page = {}) {
  const { apiKey, profile, options } = await loadOptions();
  const history = workHistory(profile);
  if (!apiKey) throw new Error("No API key — open smartpaste settings.");
  if (!Object.keys(options).length) {
    throw new Error("Profile is empty — open smartpaste settings.");
  }

  const criteria = asCriteria(options);
  const questions = {};
  fields.forEach((field, i) => {
    if (field.multi) {
      field.options.forEach((text, j) => {
        questions[`f${i}_m${j}`] = {
          type: "choice",
          instructions: { field: field.label, option: text, all_options: field.options, ask: ASK_MULTI },
          criteria: { ...TICK, [NONE]: "The profile does not say" },
        };
      });
      return;
    }
    // "Have you worked for us before?" is a judgement over the whole work
    // history, which no single profile entry holds.
    if (isPriorEmploymentQuestion(field.label)) {
      const own = field.options && field.options.length;
      const choices = { [NONE]: "Cannot tell which employer is meant" };
      if (own) field.options.forEach((text, j) => { choices[`o${j}`] = text; });
      else Object.assign(choices, YES_NO);
      questions[`f${i}`] = {
        type: "choice",
        instructions: {
          field: field.label, ask: ASK_HISTORY,
          work_history: history.length ? history : "No jobs listed",
          application_page: { url: page.url || "", title: page.title || "" },
        },
        criteria: choices,
      };
      return;
    }
    if (field.options && field.options.length) {
      const choices = { [NONE]: "The profile does not say" };
      field.options.forEach((text, j) => {
        choices[`o${j}`] = text;
      });
      questions[`f${i}`] = {
        type: "choice",
        instructions: { field: field.label, ask: ASK_SELECT },
        criteria: choices,
      };
      // See yesNoFromEntry: the same question, answered by profile entry.
      if (isYesNo(field.options)) {
        questions[`f${i}_entry`] = {
          type: "choice",
          instructions: { field: field.label, ask: ASK_TEXT },
          criteria,
        };
      }
    } else {
      questions[`f${i}`] = {
        type: "choice",
        instructions: { field: field.label, ask: ASK_TEXT },
        criteria,
      };
    }
  });

  // Your own answers may say {company} or {role}. Code cuts candidate names
  // out of the page's title, heading and URL; Jev says which is which, in
  // the same batch as everything else.
  const candidates = Object.values(options).some((o) => hasPlaceholders(o.value))
    ? pageCandidates(page) : [];
  if (candidates.length) {
    const criteria = { [NONE]: "None of these", ...Object.fromEntries(candidates.map((c, j) => [`c${j}`, c])) };
    const where = { url: page.url || "", title: page.title || "", heading: page.heading || "" };
    questions.page_company = { type: "choice", criteria,
      instructions: { page: where, ask: "Which of these is the name of the company this job application is for?" } };
    questions.page_role = { type: "choice", criteria,
      instructions: { page: where, ask: "Which of these is the job title of the role being applied for?" } };
  }

  const answers = await askBatched(apiKey, { applicant_profile: options }, questions);
  const named = (id) => {
    const a = answers[id];
    const p = a ? Math.min(Number(a.probabilities?.[a.choice] ?? 0), Number(a.confidence ?? 0)) : 0;
    return a && a.choice !== NONE && p >= 0.6 ? candidates[Number(String(a.choice).slice(1))] : null;
  };
  const known = candidates.length ? { company: named("page_company"), role: named("page_role") } : {};

  return fields.map((field, i) => withPlaceholders(answerFor(field, i), known));

  function answerFor(field, i) {
    if (field.multi) return ticked(field, i, answers);
    const answer = answers[`f${i}`];
    if (!answer) {
      return { label: field.label, status: "none", value: null, confidence: 0, alternatives: [] };
    }
    if (isPriorEmploymentQuestion(field.label) && !(field.options && field.options.length)) {
      const confidence = Math.min(
        Number(answer.probabilities?.[answer.choice] ?? 0),
        Number(answer.confidence ?? 0)
      );
      const value = YES_NO[answer.choice];
      if (!value || confidence < 0.4) {
        return { label: field.label, status: "none", value: null, confidence, alternatives: [] };
      }
      return { label: field.label, status: confidence >= AUTO ? "auto" : "pick", value, confidence, alternatives: [] };
    }
    if (field.options && field.options.length) {
      const index = Number(String(answer.choice).replace("o", ""));
      const confidence = Math.min(
        Number(answer.probabilities?.[answer.choice] ?? 0),
        Number(answer.confidence ?? 0)
      );
      const picked = field.options[index];
      if (answer.choice === NONE || picked === undefined || confidence < AUTO) {
        const entry = yesNoFromEntry(field.options, answers[`f${i}_entry`], options);
        if (entry >= 0) {
          const a = answers[`f${i}_entry`];
          return {
            label: field.label,
            status: "auto",
            value: field.options[entry],
            confidence: Math.min(Number(a.probabilities?.[a.choice] ?? 0), Number(a.confidence ?? 0)),
            isSelect: true,
            alternatives: [],
          };
        }
      }
      if (answer.choice === NONE || picked === undefined || confidence < 0.4) {
        return { label: field.label, status: "none", value: null, confidence, alternatives: [] };
      }
      return {
        label: field.label,
        status: confidence >= AUTO ? "auto" : "pick",
        value: picked,
        confidence,
        isSelect: true,
        alternatives: Object.entries(answer.probabilities || {})
          .filter(([k]) => k !== NONE)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([k, p]) => ({ value: field.options[Number(k.replace("o", ""))], p }))
          .filter((a) => a.value !== undefined),
      };
    }
    return resolve(field.label, answer, options);
  }
}

/**
 * Fill {company} / {role} in an answer. One that cannot be filled is not
 * typed in unasked: it drops to "pick", so Cmd-V shows it for you to finish.
 */
function withPlaceholders(result, known) {
  if (!result || typeof result.value !== "string" || !hasPlaceholders(result.value)) return result;
  const filled = fillPlaceholders(result.value, known);
  const alternatives = (result.alternatives || []).map((a) =>
    typeof a.value === "string" ? { ...a, value: fillPlaceholders(a.value, known) ?? a.value } : a);
  return filled
    ? { ...result, value: filled, alternatives }
    : { ...result, status: result.status === "auto" ? "pick" : result.status, alternatives };
}

// A resume states who you are and what you have done. It does not state your
// work authorization, your salary expectation, or when you could start.
const RESUME_FIELDS = new Set([
  "full_name", "first_name", "last_name", "preferred_name",
  "email", "phone", "linkedin", "github", "portfolio", "other_link",
]);

const LINK_FIELDS = new Set(["linkedin", "github", "portfolio", "other_link"]);
// A URL is one token with a dot in it. "…@gmail.com | fl LinkedIn | Github"
// contains ".com" and would otherwise pass.
const looksLikeUrl = (v) =>
  typeof v === "string" && !/\s|@/.test(v) && /\.[a-z]{2,}/i.test(v);

const ASK_RESUME =
  "Which line of the applicant's resume contains this piece of information? " +
  "The line need not equal it exactly -- a contact line containing the email, " +
  "or a header containing the surname, is the right pick, because code " +
  "extracts the exact substring afterwards. Choose the escape option if the " +
  "resume does not state it.";

/** The questions worth asking of a resume. */
function resumeQuestions(criteria) {
  const questions = {};
  const plan = [];

  // Ask only what a resume actually states. Everything else invites a
  // confident wrong pick: asked for a home city, the model offered "Los Gatos,
  // CA" -- which is where Netflix is, the only city on the page.
  for (const field of FIELDS) {
    if (!RESUME_FIELDS.has(field.key)) continue;
    plan.push({ id: `p_${field.key}`, target: { key: field.key }, label: field.label });
  }
  for (const section of REPEATABLE) {
    if (section.named) continue; // test scores are rarely on a resume
    const count = section.key === "education" ? 2 : 3;
    for (let i = 0; i < count; i++) {
      for (const [key, label] of section.fields) {
        plan.push({
          id: `r_${section.key}_${i}_${key}`,
          target: { section: section.key, index: i, key },
          label: `${label} of the ${ORDINALS[i]} ${section.singular}`,
        });
      }
    }
  }
  // A link question gets only link-shaped options. Offered everything, the
  // model picks the contact line -- it says the word "LinkedIn" -- over the
  // actual URL recovered from the PDF's annotations.
  const linkCriteria = Object.fromEntries(
    Object.entries(criteria).filter(([key, v]) => key === NONE || looksLikeUrl(v))
  );

  for (const item of plan) {
    questions[item.id] = {
      type: "choice",
      instructions: { wanted: item.label, ask: ASK_RESUME },
      criteria:
        LINK_FIELDS.has(item.target.key) && Object.keys(linkCriteria).length > 1
          ? linkCriteria
          : criteria,
    };
  }
  return { questions, plan };
}

/**
 * Turn a resume into a draft profile.
 *
 * This is the original extraction-by-selection trick, kept where it belongs:
 * run once, in settings, on something you review. Resume lines are unlabelled,
 * so a pick is a guess at which line holds a value and refine() still has to
 * cut the substring out -- exactly the unreliability that made this a bad
 * basis for filling live forms. As a first draft you correct, it is ideal.
 */
async function profileFromResume(text) {
  const { apiKey } = await loadOptions();
  if (!apiKey) throw new Error("No API key — open smartpaste settings.");
  const snippets = extraSnippets(unwrap(text), 0, 3);
  if (Object.keys(snippets).length < 4) {
    throw new Error("Could not read enough text out of that PDF.");
  }
  const { questions, plan } = resumeQuestions(asCriteria(snippets));
  const answers = await askBatched(
    apiKey,
    "The options of each question are the lines of one resume, in order.",
    questions
  );

  const fields = {};
  const sections = {};
  for (const item of plan) {
    const answer = answers[item.id];
    if (!answer) continue;
    const resolved = resolve(item.label, answer, snippets);
    if (resolved.status === "none" || !resolved.value) continue;
    if (item.target.section) {
      const { section, index, key } = item.target;
      sections[section] = sections[section] || [];
      sections[section][index] = sections[section][index] || {};
      sections[section][index][key] = resolved.value;
    } else {
      // A link field must hold a link. Asked for "LinkedIn" the model picks
      // the contact line, which says the word but carries no URL -- the real
      // ones live in the PDF's annotations and arrive as separate lines.
      if (LINK_FIELDS.has(item.target.key)) {
        if (!looksLikeUrl(resolved.value)) continue;
        // Two link fields holding the same URL means one of them guessed.
        if (Object.values(fields).includes(resolved.value)) continue;
      }
      fields[item.target.key] = resolved.value;
    }
  }
  // A duplicated company or location across entries means one of them was
  // picked off the wrong role's line. Keep the first, drop the echo.
  for (const key of Object.keys(sections)) {
    const seen = { company: new Set(), location: new Set(), school: new Set() };
    sections[key] = sections[key]
      .filter((e) => e && Object.keys(e).length >= 2)
      .map((entry) => {
        for (const field of Object.keys(seen)) {
          if (!entry[field]) continue;
          if (seen[field].has(entry[field])) delete entry[field];
          else seen[field].add(entry[field]);
        }
        return entry;
      });
  }
  return { fields, sections, lines: Object.keys(snippets).length };
}

/* ------------------------------------------------------------------------
 * Drafting by classification ("segments" engine). See lib/draft.js for why.
 * ---------------------------------------------------------------------- */

const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
const label = (answer, floor = 0) =>
  answer && Math.min(answer.confidence ?? 0, answer.probabilities?.[answer.choice] ?? 0) >= floor
    ? answer.choice
    : null;

/**
 * Contact details. An email address, a phone number and a URL have fixed
 * shapes, so code reads them -- asking Jev which line held the email let a
 * flat distribution return nothing, and once returned a LinkedIn URL as a
 * surname. Jev is asked the one thing that has no fixed shape: which line is
 * the person's name. First and last names are then cut from it in code.
 */
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;

async function contactFields(apiKey, lines) {
  if (globalThis.SP_DEBUG) console.log('CONTACT LINES', lines.slice(0, 4));
  const fields = {};
  for (const line of lines) {
    const email = !fields.email && line.match(EMAIL_RE);
    if (email) fields.email = email[0].replace(/[.,;]+$/, "");
    for (const m of line.matchAll(new RegExp(PHONE_RE, "g"))) {
      if (fields.phone) break;
      const digits = m[0].replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 15 && !/^(?:19|20)\d{2}/.test(m[0].trim())) fields.phone = m[0].trim();
    }
  }
  const candidates = lines.slice(0, 8).filter((l) => l.length <= 60 && !EMAIL_RE.test(l) && !/https?:|www\.|\d{3}/.test(l));
  if (candidates.length) {
    const criteria = { ...Object.fromEntries(candidates.map((l, i) => [`n${i}`, l])), [NONE]: "None of these is a name" };
    const { name } = await callJev(apiKey, "Lines from the top of one resume.", {
      name: choice({ ask: "Which line is the person's own full name?" }, criteria),
    });
    const pick = label(name, 0.4);
    if (pick && pick !== NONE) {
      const raw = candidates[Number(pick.slice(1))].replace(/\s*[|,].*$/, "").trim();
      const parts = raw.split(/\s+/).filter((w) => !/^(?:Dr|Mr|Ms|Mrs|Prof)\.?$/i.test(w));
      const cased = raw === raw.toUpperCase()
        ? parts.map((w) => w.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, a, c) => a + c.toUpperCase()))
        : parts;
      if (cased.length >= 2) {
        fields.full_name = cased.join(" ");
        fields.first_name = cased[0];
        fields.last_name = cased[cased.length - 1].replace(/,$/, "");
      }
    }
  }
  return { ...fields, ...linksByDomain(lines) };
}

/**
 * A URL's domain already says what it is. Asked which of two near-identical
 * URL lines is the LinkedIn one, Jev's confidence swung between 0.29 and 0.77
 * on wording alone; the domain answers it with certainty. So links are read by
 * code, from every URL-shaped token -- including ones that exist only as text,
 * as in a Word export without hyperlinks -- and Jev is not asked.
 */
const URL_TOKEN =
  /(?<![@\w.])(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s|,;)]*)?/gi;

export function linksByDomain(lines) {
  const found = [];
  for (const line of lines) {
    for (const match of line.matchAll(URL_TOKEN)) {
      // The part of an email before the "@" ("maya.chen") looks like a domain.
      if (line[match.index + match[0].length] === "@") continue;
      const url = match[0].replace(/[.)]+$/, "");
      if (!/[/.]/.test(url) || /^\d/.test(url)) continue;
      found.push(url);
    }
  }
  const bare = (u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
  // Prefer the full https:// form recovered from annotations over a bare
  // "linkedin.com/in/x" in the text.
  const best = (test) => {
    const hits = found.filter((u) => test(bare(u)));
    return hits.find((u) => /^https?:/i.test(u)) || hits[0];
  };
  const links = {};
  const linkedin = best((u) => /(^|\.)linkedin\.com\/in\//.test(u));
  const github = best((u) => /(^|\.)github\.com\/[^/]+/.test(u));
  if (linkedin) links.linkedin = linkedin;
  if (github) links.github = github;
  const taken = new Set([linkedin, github].filter(Boolean).map(bare));
  const personal = found.filter((u) => {
    const b = bare(u);
    // A personal site: not a profile we already have, not a bare mail host.
    return !taken.has(b) && !/linkedin\.com|github\.com/.test(b) && (b.includes("/") || b.split(".").length >= 2) &&
      !/^(gmail|yahoo|outlook|hotmail|icloud|example)\.(com|co\.uk)$/.test(b);
  });
  if (personal[0]) links.portfolio = personal[0];
  if (personal[1] && bare(personal[1]) !== bare(personal[0])) links.other_link = personal[1];
  return links;
}

const FIELD_LABEL =
  /^(?:company|employer|organi[sz]ation|title|job title|position|role|location|dates?|period|school|university|institution|degree|major|field of study|gpa|cgpa|cumulative gpa|grade)$/i;

const LABELS_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
const context = (lines, i) => ({ previous_line: lines[i - 1] || "", next_line: lines[i + 1] || "" });

async function profileBySegments(text) {
  const { apiKey } = await loadOptions();
  if (!apiKey) throw new Error("No API key — open smartpaste settings.");
  const lines = unwrap(text).split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) throw new Error("Could not read enough text out of that PDF.");

  // 1. Which short lines are section headings, and of what?
  const candidates = headingCandidates(lines);
  const headingQuestions = Object.fromEntries(candidates.map(({ text, index }) => [
    `h${index}`,
    choice({ line: text, previous_line: lines[index - 1] || "",
      following_lines: lines.slice(index + 1, index + 4),
      ask: "Is this line a section heading of a resume? Headings can be creative " +
        "('Career Journey', 'Academic Credentials'); judge by what follows it. " +
        "If it is a heading, which section does it open?" },
    SECTION_KINDS),
  ]));
  const headingAnswers = await askBatched(apiKey, "Lines of one resume, in order.", headingQuestions);
  const headings = new Map();
  for (const { index, text } of candidates) {
    const kind = label(headingAnswers[`h${index}`], 0.5);
    if (kind && kind !== NONE) headings.set(index, kind);
    else if (sectionByVocabulary(text)) headings.set(index, sectionByVocabulary(text));
  }
  const rows = sectionise(lines, headings);

  // 2. Contact details from the header, plus any recovered link lines.
  const header = rows.filter((r) => r.section === "header").map((r) => r.text);
  const contactLines = [...(header.length >= 3 ? header : lines.slice(0, 12)),
    ...lines.filter((l) => /^https?:\/\//.test(l))];
  const fieldsPromise = contactFields(apiKey, contactLines);

  // 3. Cut education and experience lines into single-field pieces; ask what each is.
  const pieces = { education: [], experience: [], volunteering: [], activities: [] };
  for (const row of rows) {
    if (row.heading || !(row.section in pieces)) continue;
    if (isBullet(row.text)) {
      const text = splitPieces(row.text)[0];
      // "• Cumulative GPA 3.6/4.0" is the GPA, bullet or not.
      if (row.section === "education" && /\bC?GPA\b/i.test(text)) {
        pieces.education.push({ text, label: "gpa", fixed: true });
        continue;
      }
      pieces[row.section].push({ text, bullet: true });
      continue;
    }
    // "Joint appointment: Stanford AI Lab …", "Reports to: …" describe the entry;
    // one labelled a company opened a phantom entry. A line that carries its
    // own label is detail -- unless the label is a field name.
    const labelled = row.text.match(/^([A-Z][\w ()&\/.-]{2,32}):\s+\S/);
    // Note labels are short ("Reports to", "Research Group"); a longer one, or
    // one ending in a field word, is the field itself: "BSE Computer
    // Engineering GPA: 3.91/4.00".
    if (labelled && labelled[1].split(/\s+/).length <= 3 && !FIELD_LABEL.test(labelled[1]) &&
        !/\b(?:c?gpa|grade|dates?|location)$/i.test(labelled[1])) {
      pieces[row.section].push({ text: row.text, bullet: true });
      continue;
    }
    for (const piece of splitPieces(row.text)) {
      pieces[row.section].push({ text: piece, line: row.text, index: row.index });
    }
  }
  const pieceQuestions = {};
  for (const [section, list] of Object.entries(pieces)) {
    const kinds = section === "education" ? EDUCATION_KINDS : EXPERIENCE_KINDS; // volunteering reads like a job
    list.forEach((p, i) => {
      if (p.bullet || p.fixed) return;
      pieceQuestions[`${section}_${i}`] = choice(
        { section, piece: p.text, whole_line: p.line, ...context(lines, p.index),
          ask: "Within this section of a resume, what is this piece of text?" },
        kinds);
    });
  }
  const pieceAnswers = await askBatched(apiKey, "Pieces of one resume.", pieceQuestions);
  for (const [section, list] of Object.entries(pieces)) {
    list.forEach((p, i) => {
      if (!p.bullet && !p.fixed) p.label = label(pieceAnswers[`${section}_${i}`]) || "other";
    });
  }

  // 4. Assemble entries from the labels.
  const assembledExperience = assemble(pieces.experience, "experience");
  const experience = assembledExperience.map((e) => {
    const { start, end } = e.dates ? parseDates(e.dates) : { start: "", end: "" };
    return prune({ company: e.company, title: e.title, location: e.location,
      start_date: start, end_date: end, description: e.description.join(" ") });
  });
  const education = assemble(pieces.education, "education").map((e) => {
    let degree = e.degree || "";
    let major = e.major || "";
    if (e.degree_field) {
      const split = splitDegreeField(e.degree_field);
      degree = degree || split.degree;
      major = major || split.field;
    }
    const { start, end } = e.dates ? parseDates(e.dates) : { start: "", end: "" };
    return prune({ school: e.school, degree, major, gpa: e.gpa ? cleanGpa(e.gpa) : "",
      start_date: start, end_date: end, location: e.location });
  });

  // 4b. The list-like sections are regular enough for code to read.
  const bodyOf = (kind) => rows.filter((r) => r.section === kind && !r.heading).map((r) => r.text);
  // An entry with neither an organisation nor a role is noise, and a
  // spurious entry costs as much as a missing one.
  const asRoles = (list) => assemble(list, "experience").map((e) => {
    const { start, end } = e.dates ? parseDates(e.dates) : { start: "", end: "" };
    return prune({ organization: e.company, role: e.title, location: e.location,
      start_date: start, end_date: end, description: e.description.join(" ") });
  }).filter((v) => v.organization || v.role);
  const volunteering = asRoles(pieces.volunteering);
  const activities = asRoles(pieces.activities);
  const skills = readSkills(bodyOf("skills"));
  const projects = readProjects(bodyOf("projects")).map((p) => {
    const { start, end } = p.dates ? parseDates(p.dates) : { start: "", end: "" };
    return prune({ name: p.name, url: p.url, start_date: start, end_date: end,
      description: p.description.join(" ") });
  });
  const certifications = readListEntries(bodyOf("certifications")).map((c) =>
    prune({ name: c.name, issuer: c.issuer, date: c.date ? parseDates(c.date).end : "" }));
  const awards = readListEntries(bodyOf("awards")).map((a) =>
    prune({ title: a.name, awarder: a.issuer, date: a.date ? parseDates(a.date).end : "" }));
  const publications = readListEntries(bodyOf("publications")).map((p) =>
    prune({ title: p.name, venue: p.issuer, date: p.date ? parseDates(p.date).end : "" }));
  const extras = prune({
    summary: bodyOf("summary").join(" "),
    skills: skills.map((g) => (g.category ? `${g.category}: ` : "") + g.skills.join(", ")).join("\n"),
    languages: bodyOf("languages").join(", "),
    ...(readHomeLocation(rows.filter((r) => r.section === "header").map((r) => r.text)) || {}),
  });

  // 5. Degree names from a fixed list: "B.S." -> "Bachelor of Science".
  const degreeQuestions = {};
  education.forEach((e, i) => {
    if (e.degree) {
      degreeQuestions[`d${i}`] = choice(
        { degree_as_written: e.degree, field_of_study: e.major || "",
          ask: "Which degree is this? Choose the escape option if none of these is it." },
        { ...Object.fromEntries(DEGREES.map((d, j) => [`g${j}`, d])), [NONE]: "None of these" });
    }
  });
  const degreeAnswers = await askBatched(apiKey, "Degrees from one resume.", degreeQuestions);
  education.forEach((e, i) => {
    const pick = label(degreeAnswers[`d${i}`], 0.6);
    if (pick && pick !== NONE) e.degree = DEGREES[Number(pick.slice(1))];
  });

  return {
    fields: { ...extras, ...(await fieldsPromise) },
    // The profile keeps one "Volunteering & leadership" list; the benchmark
    // counts only volunteer work, so the split is kept in debug.
    sections: { education, experience, projects, certifications, awards, publications,
      volunteering: [...volunteering, ...activities] },
    lines: lines.length,
    // What Jev decided, line by line -- for the corpus scorer, not the UI.
    debug: {
      // Each role's bullets as a list, for scorers that compare them one by one.
      experienceBullets: assembledExperience.map((e) => e.description),
      skillGroups: skills,
      volunteerOnly: volunteering,
      projectBullets: readProjects(bodyOf("projects")).map((p) => p.description),
      headings: [...headings].map(([i, kind]) => `${kind}: ${lines[i]}`),
      pieces: Object.fromEntries(Object.entries(pieces).map(([k, list]) =>
        [k, list.map((p) => `${p.bullet ? "bullet" : p.label}: ${p.text.slice(0, 50)}`)])),
    },
  };
}

function prune(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([, v]) => v && String(v).trim()));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "profile-from-resume") {
    (message.engine === "lines" ? profileFromResume : profileBySegments)(message.text)
      .then((draft) => sendResponse({ ok: true, ...draft }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "answer-fields") {
    answerFields(message.fields, message.page)
      .then((results) => {
        const filled = results.filter((r) => r.status !== "none").length;
        if (sender.tab) {
          chrome.action.setBadgeText({
            tabId: sender.tab.id,
            text: filled ? String(filled) : "",
          });
          chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#1f7a3d" });
        }
        sendResponse({ ok: true, results });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "choose-option") {
    (async () => {
      const { apiKey, options } = await loadOptions();
      const criteria = { [NONE]: "None of these is the intended answer" };
      message.options.slice(0, 200).forEach((text, i) => {
        criteria[`o${i}`] = text;
      });
      const answers = await callJev(
        apiKey,
        { applicant_profile: options, intended_answer: message.want },
        {
          pick: {
            type: "choice",
            instructions: {
              field: message.label,
              intended_answer: message.want,
              ask:
                "The applicant intends the answer above. Which of this " +
                "dropdown's options expresses it? The wording will differ.",
            },
            criteria,
          },
        }
      );
      const answer = answers.pick;
      const confidence = Math.min(
        Number(answer.probabilities?.[answer.choice] ?? 0),
        Number(answer.confidence ?? 0)
      );
      const index =
        answer.choice === NONE || confidence < 0.5
          ? -1
          : Number(String(answer.choice).replace("o", ""));
      sendResponse({ ok: true, index, confidence });
    })().catch(() => sendResponse({ ok: false, index: -1 }));
    return true;
  }
  if (message.type === "fill-page") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) chrome.tabs.sendMessage(tab.id, { type: "fill-page" });
      sendResponse({ ok: true });
    });
    return true;
  }
});
