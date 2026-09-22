/**
 * Questions answered by reading your work history, not by copying a line of
 * your profile: "Have you ever worked for Wells Fargo?", "Are you a current
 * or former employee?". No profile entry says "No" -- the answer is a
 * judgement over every job you list, so Jev makes it from the whole list.
 */

// Asks whether you work or worked for someone. The "for / at / by" or
// "employee" wording is what separates it from "years of work experience".
const PRIOR_EMPLOYMENT = new RegExp(
  [
    String.raw`\b(?:currently|previously|ever|formerly|before|past|prior)\b.{0,40}\b(?:work(?:ed|ing)?|employed|intern(?:ed)?|contract(?:ed)?)\s+(?:for|at|by|with)\b`,
    // "Are you currently employed as an Associate at Broadridge?"
    String.raw`\b(?:currently|previously|ever|formerly)\b.{0,20}\b(?:work(?:ed|ing)?|employed)\s+as\s+an?\s+.{1,40}?\s+(?:at|by|with|for)\b`,
    String.raw`\b(?:work(?:ed)?|employed|intern(?:ed)?)\s+(?:for|at|by|with)\b.{0,60}\b(?:before|previously|in the past|ever)\b`,
    String.raw`\b(?:current|former|previous|past)\s+(?:or\s+(?:current|former|previous|past)\s+)?(?:employee|intern|contractor|worker)\b`,
  ].join("|"),
  "i"
);

export function isPriorEmploymentQuestion(label) {
  return PRIOR_EMPLOYMENT.test(label || "");
}

/** Every job in the profile, as the few facts the question turns on. */
export function workHistory(profile) {
  const jobs = Array.isArray(profile?.experience) ? profile.experience : [];
  return jobs
    .filter((job) => job && (job.company || "").trim())
    .map((job) => ({
      company: job.company.trim(),
      title: (job.title || "").trim(),
      dates: [job.start_date, job.end_date].filter(Boolean).join(" - "),
    }));
}

export const ASK_HISTORY =
  "This application question asks whether the applicant works or has worked " +
  "for an employer. Answer it from the applicant's work history alone. The " +
  "employer may be named in the question, or be the company this application " +
  "is for (see the page it is on). A subsidiary or a different company with " +
  "a similar name is not the same employer. If the history lists no job " +
  "there, the answer is No. Choose the escape option only if the question " +
  "cannot be tied to any employer.";
