/**
 * The only place that talks to Jev.
 *
 * Content scripts inherit the page's origin, so a fetch from one would be a
 * cross-origin request from whatever company you are applying to -- and would
 * hand that page's context your API key. The key never leaves here.
 */

import { asCriteria, buildOptions, NONE } from "./lib/profile.js";
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  if (message.type === "fill-page") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) chrome.tabs.sendMessage(tab.id, { type: "fill-page" });
      sendResponse({ ok: true });
    });
    return true;
  }
});
