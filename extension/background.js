/**
 * The only place that talks to Jev.
 *
 * Content scripts inherit the page's origin, so a fetch from one would be a
 * cross-origin request from whatever company you are applying to -- and would
 * hand that page's context your API key. The key never leaves here.
 */

import { asCriteria, buildOptions, extraSnippets, NONE, unwrap } from "./lib/profile.js";
import { FIELDS, ORDINALS, REPEATABLE } from "./lib/schema.js";
import { resolve } from "./lib/resolve.js";

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
  const { apiKey, profile = {}, extraText = "" } = await chrome.storage.local.get([
    "apiKey",
    "profile",
    "extraText",
  ]);
  return { apiKey, options: buildOptions(profile, extraText) };
}

async function callJev(apiKey, state, questions) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: MODEL, questions }),
  });
  if (!response.ok) {
    throw new Error(`TypeSafe API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()).answers;
}

async function askBatched(apiKey, state, questions) {
  const ids = Object.keys(questions);
  const answers = {};
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = {};
    for (const id of ids.slice(i, i + BATCH)) chunk[id] = questions[id];
    Object.assign(answers, await callJev(apiKey, state, chunk));
  }
  return answers;
}

/**
 * Answer every field on the page in one round trip.
 *
 * Text fields ask which profile entry holds the answer. A dropdown asks a
 * different question entirely -- which of ITS OWN options to pick -- because
 * "Yes" and "I am authorized to work" are the same answer in different words,
 * and only the select knows which words it accepts.
 */
async function answerFields(fields) {
  const { apiKey, options } = await loadOptions();
  if (!apiKey) throw new Error("No API key — open smartpaste settings.");
  if (!Object.keys(options).length) {
    throw new Error("Profile is empty — open smartpaste settings.");
  }

  const criteria = asCriteria(options);
  const questions = {};
  fields.forEach((field, i) => {
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
    } else {
      questions[`f${i}`] = {
        type: "choice",
        instructions: { field: field.label, ask: ASK_TEXT },
        criteria,
      };
    }
  });

  const answers = await askBatched(apiKey, { applicant_profile: options }, questions);

  return fields.map((field, i) => {
    const answer = answers[`f${i}`];
    if (!answer) {
      return { label: field.label, status: "none", value: null, confidence: 0, alternatives: [] };
    }
    if (field.options && field.options.length) {
      const index = Number(String(answer.choice).replace("o", ""));
      const confidence = Math.min(
        Number(answer.probabilities?.[answer.choice] ?? 0),
        Number(answer.confidence ?? 0)
      );
      const picked = field.options[index];
      if (answer.choice === NONE || picked === undefined || confidence < 0.4) {
        return { label: field.label, status: "none", value: null, confidence, alternatives: [] };
      }
      return {
        label: field.label,
        status: confidence >= 0.85 ? "auto" : "pick",
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
  });
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
  const answers = await askBatched(apiKey, { resume_lines: snippets }, questions);

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "profile-from-resume") {
    profileFromResume(message.text)
      .then((draft) => sendResponse({ ok: true, ...draft }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "answer-fields") {
    answerFields(message.fields)
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
