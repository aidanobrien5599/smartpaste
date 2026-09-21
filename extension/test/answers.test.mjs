// Your own answers, and test scores. Run: node --test extension/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerOptions, fillPlaceholders, hasPlaceholders, normalizeAnswers, pageCandidates } from "../lib/answers.js";
import { buildOptions } from "../lib/profile.js";

test("normalizeAnswers keeps complete question/answer pairs only", () => {
  assert.deepEqual(
    normalizeAnswers([{ question: " Why us? ", answer: " Because. " }, { question: "Q", answer: "" }, { answer: "orphan" }, null]),
    [{ question: "Why us?", answer: "Because." }]
  );
});

test("answerOptions: the question is the label a form field is matched on", () => {
  assert.deepEqual(answerOptions([{ question: "Why {company}?", answer: "At {company}." }]),
    { custom1: { field: "Why {company}?", value: "At {company}." } });
  assert.equal(buildOptions({ custom_answers: [{ question: "Why us?", answer: "Because." }] }).custom1.value, "Because.");
});

test("fillPlaceholders fills what it knows, and refuses a half-filled answer", () => {
  assert.equal(fillPlaceholders("{role} at {Company}.", { company: "Figma", role: "Intern" }), "Intern at Figma.");
  assert.equal(fillPlaceholders("At {company}, as {role}.", { company: "Figma" }), null);
  assert.equal(fillPlaceholders("No placeholders.", {}), "No placeholders.");
  assert.ok(hasPlaceholders("x {company}") && !hasPlaceholders("x {other}"));
});

test("pageCandidates: company and role pieces from Greenhouse, Lever, Ashby and Workday pages", () => {
  const has = (page, ...want) => {
    const got = pageCandidates(page);
    for (const w of want) assert.ok(got.includes(w), `${w} not in ${JSON.stringify(got)}`);
  };
  has({ url: "https://job-boards.greenhouse.io/figma/jobs/6131089004?gh_jid=6131089004",
    title: "Job Application for Software Engineer Intern (Winter 2027) at Figma" }, "Figma", "Software Engineer Intern (Winter 2027)");
  has({ url: "https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c/apply",
    title: "Palantir Technologies - Forward Deployed Software Engineer" }, "Palantir Technologies", "Forward Deployed Software Engineer");
  has({ url: "https://jobs.ashbyhq.com/ellipsislabs/02136b22-35b1-4b3d-8bef-567c3380a849/application",
    title: "Software Engineer @ Ellipsis Labs" }, "Ellipsis Labs", "Software Engineer");
  has({ url: "https://wd1.myworkdaysite.com/en-US/recruiting/wf/WellsFargoJobs/job/CHARLOTTE%2C-NC/XMLNAME-2027-Technology-Summer-Internship---Early-Careers--Software-Engineering-_R-574285/apply/applyManually",
    title: "Careers" }, "Wells Fargo", "2027 Technology Summer Internship Early Careers Software Engineering");
  // ids and plumbing are never offered as names
  const ids = pageCandidates({ url: "https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c/apply" });
  assert.deepEqual(ids, ["Palantir"]);
});

test("test scores are labelled by their test, not by position", () => {
  const o = buildOptions({ tests: [{ test: "SAT", score: "1550", date: "March 2022" }, { test: "AP Calculus BC", score: "5" }] });
  assert.equal(o.tests1_score.field, "SAT score");
  assert.equal(o.tests1_date.field, "SAT date taken");
  assert.equal(o.tests2_score.field, "AP Calculus BC score");
  assert.equal(o.tests1_test.field, "Test (SAT)");
});
