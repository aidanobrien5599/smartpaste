/**
 * The only place that talks to Jev.
 *
 * Content scripts inherit the page's origin, so a fetch from one would be a
 * cross-origin request from whatever site you are applying to -- and it would
 * hand that site's context your API key. The key never leaves here.
 */

import { asCriteria, NONE } from "./lib/snippets.js";
import { resolve } from "./lib/resolve.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
// No documented cap on questions per call; batch conservatively.
const BATCH = 24;

const ASK =
  "Which snippet from the applicant's resume contains the answer to this job " +
  "application field? The snippet need not equal the answer exactly -- a " +
  "contact line containing the email, or a full name containing the surname, " +
  "is the right pick, because code extracts the exact substring afterwards. " +
  "Choose the escape option only if no snippet contains it.";

async function settings() {
  const { apiKey, snippets } = await chrome.storage.local.get(["apiKey", "snippets"]);
  return { apiKey, snippets: snippets || {} };
}

async function callJev(apiKey, state, questions) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state, model: MODEL, questions }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`TypeSafe API ${response.status}: ${detail}`);
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
 * Answer every field on a page in one round trip. Questions are evaluated in
 * parallel, so twenty cost about the same wall time as one -- which is what
 * makes a synchronous Cmd-V possible at all: by the time you press it, the
 * answer is already cached.
 */
async function answerFields(labels) {
  const { apiKey, snippets } = await settings();
  if (!apiKey) throw new Error("No API key. Open the smartpaste options page.");
  if (!Object.keys(snippets).length) {
    throw new Error("No resume stored. Open the smartpaste options page.");
  }

  const criteria = asCriteria(snippets);
  const questions = {};
  labels.forEach((label, i) => {
    questions[`f${i}`] = {
      type: "choice",
      instructions: { field: label, ask: ASK },
      criteria,
    };
  });

  const answers = await askBatched(apiKey, { resume_snippets: snippets }, questions);
  return labels.map((label, i) =>
    answers[`f${i}`]
      ? resolve(label, answers[`f${i}`], snippets)
      : { label, status: "none", value: null, confidence: 0, alternatives: [] }
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "answer-fields") {
    answerFields(message.labels)
      .then((results) => {
        const filled = results.filter((r) => r.status !== "none").length;
        if (sender.tab) {
          chrome.action.setBadgeText({
            tabId: sender.tab.id,
            text: filled ? String(filled) : "",
          });
          chrome.action.setBadgeBackgroundColor({
            tabId: sender.tab.id,
            color: "#1f7a3d",
          });
        }
        sendResponse({ ok: true, results });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "split-resume") {
    import("./lib/snippets.js").then(({ snippetsFromResume }) =>
      sendResponse({ ok: true, snippets: snippetsFromResume(message.text) })
    );
    return true;
  }
});
