// background.js against a fake Jev: what it ASKS for a page of fields, and
// what it makes of the answers. bench/probe-answers.mjs is the same harness
// pointed at the real API; this one cans the replies so the wiring is
// testable offline.
import { test } from "node:test";
import assert from "node:assert/strict";

let listener;
let sent = {};
let reply = {};
globalThis.chrome = {
  storage: { local: { get: async (keys) => Object.fromEntries(keys.map((k) => [k, STORE[k]])) } },
  runtime: { onMessage: { addListener: (f) => { listener = f; } }, onInstalled: { addListener() {} } },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {}, onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  contextMenus: { create() {}, onClicked: { addListener() {} } },
  tabs: { query: async () => [] },
};
const STORE = {
  apiKey: "apikey_test",
  profile: { first_name: "Aidan", last_name: "O'Brien", referral: "Other", relocate: "Yes",
    flexibility_default: "Yes I am flexible",
    education: [{ school: "University of Wisconsin - Madison", end_date: "May 2027" }] },
  extraText: "",
  settings: {},
};
globalThis.fetch = async (_url, init) => {
  sent = JSON.parse(init.body).questions;
  return new Response(JSON.stringify({ answers: reply }), { headers: { "content-type": "application/json" } });
};

await import("../src/background.js");

/** One "answer-fields" round trip: what went out, and what came back. */
async function ask(fields, answers) {
  reply = answers;
  const got = await new Promise((resolve) =>
    listener({ type: "answer-fields", fields, page: { url: "", title: "" } }, {}, resolve));
  assert.ok(got.ok, got.error);
  return got.results;
}

const box = (choice, p) => ({ choice, confidence: p, probabilities: { [choice]: p } });

// Relay Pro (job-boards.greenhouse.io/relaypro/jobs/8176774), live: five
// checkboxes, none of them the profile's May 2027. Asked one box at a time
// Jev said no to all five, including Other, and the required group stayed
// blank. It is asked the pick-one question too, which live answers Other.
const GRADUATION = {
  label: "What is your expected Month and Date of graduation from your undergrad or graduate degree?",
  options: ["December 2027", "May 2028", "Summer 2028", "December 2028", "Other"],
  multi: true,
};

test("a check-all-that-apply group is asked per option AND as a pick-one", async () => {
  await ask([GRADUATION], {});
  assert.deepEqual(Object.keys(sent).sort(),
    ["f0_m0", "f0_m1", "f0_m2", "f0_m3", "f0_m4", "f0_pick"]);
  // Per option: this one box, yes or no, with the whole list for context.
  assert.equal(sent.f0_m4.instructions.option, "Other");
  assert.deepEqual(Object.keys(sent.f0_m4.criteria).sort(), ["__none__", "no", "yes"]);
  // Pick-one: every option as a choice of its own, as a dropdown is asked.
  assert.equal(sent.f0_pick.instructions.option, undefined);
  assert.deepEqual(sent.f0_pick.criteria.o4, "Other");
  assert.equal(Object.keys(sent.f0_pick.criteria).length, 6);
});

test("no box ticked: the pick-one answer fills the group", async () => {
  const no = Object.fromEntries(GRADUATION.options.map((_, j) => [`f0_m${j}`, box("no", 0.98)]));
  const [result] = await ask([GRADUATION], { ...no, f0_pick: box("o4", 0.74) });
  assert.equal(result.status, "auto");
  assert.deepEqual(result.value, ["Other"]);
  assert.equal(result.multi, true);
});

test("a box that cleared the bar keeps the group; a blank pick-one leaves it", async () => {
  const no = Object.fromEntries(GRADUATION.options.map((_, j) => [`f0_m${j}`, box("no", 0.98)]));
  const [ticked] = await ask([GRADUATION], { ...no, f0_m1: box("yes", 0.9), f0_pick: box("o4", 0.95) });
  assert.deepEqual(ticked.value, ["May 2028"]);
  // Rocket Lab's fellowships, live: the pick-one ask returns the escape
  // option, so the question stays the applicant's.
  const [blank] = await ask([GRADUATION], { ...no, f0_pick: box("__none__", 0.83) });
  assert.equal(blank.status, "none");
  assert.equal(blank.value, null);
});

// OnLogic (apply.workable.com/onlogic-inc), live 2026-09-28: "We expect this
// role to begin in January 2027 and run until June 2027. Does this align with
// your academic schedule?" is a required FREE-TEXT box asking a yes/no
// question. Asked only "which profile entry answers this?", Jev split the
// vote between the current-status entry (0.45), the graduation date (0.25)
// and the start date (0.20) -- entries that do not pool, because pooling is
// for entries whose value starts with Yes or No. The winner would have typed
// a whole sentence about being enrolled into the box; an earlier run typed
// the bare date "May 2027". So the box is asked both ways, as a Yes/No
// dropdown is, and what goes in is the word.
const SCHEDULE = {
  label: "We expect this role to begin in January 2027 and run until June 2027. " +
    "Does this align with your academic schedule?",
};
const OPEN = { label: "What academic year (junior, senior) will you be in January 2027?" };

test("a yes/no question in a text box is asked its own two answers, and by entry", async () => {
  await ask([SCHEDULE, OPEN], {});
  assert.deepEqual(Object.keys(sent).sort(), ["f0", "f0_entry", "f1"]);
  assert.deepEqual(Object.keys(sent.f0.criteria).sort(), ["__none__", "no", "yes"]);
  assert.match(sent.f0.instructions.ask, /yes\/no question/);
  // The whole question, preamble and all, goes out with both asks.
  assert.equal(sent.f0_entry.instructions.field, SCHEDULE.label);
  assert.ok(sent.f0_entry.criteria.relocate, "the entry ask offers the profile");
  // An open question in the same kind of box is untouched: one ask, entries.
  assert.equal(sent.f1.criteria.yes, undefined);
  assert.ok(sent.f1.criteria.relocate);
});

test("a yes/no text box is answered with the word, not with the entry or a date", async () => {
  const [result] = await ask([SCHEDULE], {
    f0: { choice: "no", confidence: 0.75, probabilities: { no: 0.86, yes: 0.09, __none__: 0.05 } },
    f0_entry: { choice: "current_status", confidence: 0.44,
      probabilities: { current_status: 0.45, education1_end_date: 0.25, start_date: 0.2 } },
  });
  assert.equal(result.value, "No");
  assert.equal(result.status, "auto");
  // Not the sentence that entry holds, and not the date inside it.
  assert.ok(!/May 2027|enrolled/.test(JSON.stringify(result)), JSON.stringify(result));
});

test("a yes/no text box: Yes-valued entries pool when the direct ask is unsure", async () => {
  const [result] = await ask([{
    label: "We are unable to offer any relocation assistance at this time. " +
      "Do you have the necessary resources available to work in South Burlington, VT?",
  }], {
    f0: { choice: "yes", confidence: 0.39, probabilities: { yes: 0.59, __none__: 0.4, no: 0.01 } },
    f0_entry: { choice: "relocate", confidence: 0.9,
      probabilities: { relocate: 0.5, flexibility_default: 0.4, __none__: 0.1 } },
  });
  assert.equal(result.value, "Yes");
  assert.equal(result.status, "auto");
});

test("a yes/no text box neither ask is sure about stays blank", async () => {
  const [result] = await ask([SCHEDULE], {
    f0: { choice: "no", confidence: 0.28, probabilities: { no: 0.52, yes: 0.32, __none__: 0.16 } },
    f0_entry: { choice: "current_status", confidence: 0.44, probabilities: { current_status: 0.45 } },
  });
  assert.equal(result.status, "none");
  assert.equal(result.value, null);
});
