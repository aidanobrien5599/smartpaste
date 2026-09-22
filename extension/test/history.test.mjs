// Questions answered from the work history. Run: node --test extension/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPriorEmploymentQuestion, workHistory } from "../lib/history.js";

test("prior-employment questions are recognised in their usual wordings", () => {
  for (const label of [
    "Have you previously worked for Wells Fargo?",
    "Have you ever worked at Netflix?",
    "Have you ever been employed by Stripe or any of its subsidiaries?",
    "Are you a current or former employee of Acme?",
    "Are you a former employee?",
    "Have you worked for us before?",
    "Have you ever interned at Google?",
    "Are you currently working for a Wells Fargo contractor?",
    "Have you previously been employed with the company?",
    "Are you currently employed as an Associate at Broadridge?",
  ]) assert.ok(isPriorEmploymentQuestion(label), label);
});

test("other work questions are not", () => {
  for (const label of [
    "How many years of work experience do you have?",
    "Are you legally authorized to work in the United States?",
    "Will you now or in the future require sponsorship?",
    "Are you willing to work in the office 3 days a week?",
    "Current employer",
    "Company of your most recent job",
    "Why do you want to work here?",
  ]) assert.ok(!isPriorEmploymentQuestion(label), label);
});

test("workHistory keeps the facts the question turns on", () => {
  assert.deepEqual(
    workHistory({
      experience: [
        { company: " Netflix ", title: "Software Engineer Intern", start_date: "May 2026", end_date: "August 2026", description: "…" },
        { company: "", title: "blank row" },
        { company: "CargoLabs", title: "Intern", start_date: "June 2025" },
      ],
    }),
    [
      { company: "Netflix", title: "Software Engineer Intern", dates: "May 2026 - August 2026" },
      { company: "CargoLabs", title: "Intern", dates: "June 2025" },
    ]
  );
  assert.deepEqual(workHistory({}), []);
});
