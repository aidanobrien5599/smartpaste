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
  profile: { first_name: "Aidan", last_name: "O'Brien", referral: "Other",
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
