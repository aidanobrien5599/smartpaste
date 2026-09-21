/**
 * The profile form.
 *
 * Parsing a resume produced unlabeled fragments, and an unlabeled option is
 * one Jev has to guess at -- a bare "June 2027" is indistinguishable from a
 * graduation date. Every field here carries its own name into the Choice, so
 * the model picks by label rather than by inference, and the value is returned
 * verbatim instead of being re-extracted with a regex.
 */

export const GROUPS = [
  {
    title: "Identity",
    fields: [
      ["full_name", "Full name", "Aidan O'Brien"],
      ["first_name", "First name", "Aidan"],
      ["last_name", "Last name", "O'Brien"],
      ["preferred_name", "Preferred name", "Aidan"],
      ["pronouns", "Pronouns", "he/him"],
      ["email", "Email", "you@gmail.com"],
      ["phone", "Phone", "908-216-0389"],
    ],
  },
  {
    title: "Location",
    fields: [
      ["address", "Street address", "123 Example St"],
      ["city", "City", "Madison"],
      ["state", "State", "Wisconsin"],
      ["zip", "Postal code", "53703"],
      ["country", "Country", "United States"],
      ["location", "Current location", "Madison, WI"],
      ["hometown", "Hometown", "Little Silver, New Jersey"],
      ["relocate", "Willing to relocate", "Yes, happy to relocate"],
      ["work_preference", "Remote / hybrid / onsite", "Onsite or hybrid"],
    ],
  },
  {
    title: "Links",
    fields: [
      ["linkedin", "LinkedIn", "https://www.linkedin.com/in/…"],
      ["github", "GitHub", "https://github.com/…"],
      ["portfolio", "Personal website / portfolio", "https://…"],
      ["other_link", "Other link", ""],
    ],
  },
  {
    title: "Work authorization",
    fields: [
      ["work_auth", "Authorized to work in the US", "Yes"],
      ["sponsorship", "Requires visa sponsorship", "No"],
      ["visa_status", "Visa status", "US citizen"],
      ["clearance", "Security clearance", "None"],
    ],
  },
  {
    title: "Logistics",
    fields: [
      ["start_date", "Earliest start date", "June 2027"],
      ["salary", "Salary expectation", "Negotiable / open to discussion"],
      ["notice", "Notice period", "None"],
      ["referral", "How did you hear about us", "Company website"],
    ],
  },
  {
    title: "Demographics (optional)",
    fields: [
      ["gender", "Gender", "Prefer not to say"],
      ["race", "Race / ethnicity", "Prefer not to say"],
      ["veteran", "Veteran status", "I am not a protected veteran"],
      ["disability", "Disability status", "Prefer not to answer"],
    ],
  },
  {
    title: "Written answers",
    long: true,
    fields: [
      ["why_us", "Why do you want to work here", "Two or three sentences you are happy to reuse."],
      ["proud_project", "A project you're proud of", "A short paragraph you would happily be asked about."],
      ["strength", "Greatest strength", ""],
      ["challenge", "A hard problem you solved", ""],
      ["additional", "Anything else", ""],
    ],
  },
];

/**
 * Sections you can have more than one of.
 *
 * Each entry's options are labelled with an ordinal -- "most recent", "2nd
 * most recent" -- because a form that asks for "Employer 2" needs Jev to know
 * which employer is which, and because two entries with identical field names
 * are otherwise indistinguishable options.
 */
export const REPEATABLE = [
  {
    key: "education",
    title: "Education",
    singular: "school",
    summary: "school",
    fields: [
      ["school", "School", "University of Wisconsin - Madison"],
      ["degree", "Degree", "Bachelor of Science"],
      ["major", "Major / discipline", "Computer Science"],
      ["minor", "Minor", ""],
      ["gpa", "GPA", "3.9/4.00"],
      ["start_date", "Start date", "September 2023"],
      ["end_date", "Graduation date", "May 2027"],
      ["location", "Location", "Madison, WI"],
      ["coursework", "Relevant coursework", "Algorithms, Operating Systems, …"],
    ],
  },
  {
    key: "experience",
    title: "Experience",
    singular: "role",
    summary: "company",
    fields: [
      ["company", "Company", "Netflix"],
      ["title", "Job title", "Software Engineer Intern"],
      ["location", "Location", "Los Gatos, CA"],
      ["start_date", "Start date", "May 2026"],
      ["end_date", "End date", "August 2026"],
      ["manager", "Manager / reference", ""],
      ["salary", "Compensation", ""],
      ["reason_for_leaving", "Reason for leaving", "End of internship"],
      ["description", "What you did", "Drove $15M+ in projected savings by …", true],
    ],
  },
];

export const ORDINALS = [
  "most recent",
  "2nd most recent",
  "3rd most recent",
  "4th most recent",
  "5th most recent",
];

/** Files the extension keeps and attaches to a form's upload fields. */
export const DOCUMENTS = [
  ["resume", "Resume / CV", ["resume", "cv", "curriculum"]],
  ["transcript", "Transcript", ["transcript", "academic record"]],
  ["cover_letter", "Cover letter", ["cover letter", "coverletter"]],
];

export const FIELDS = GROUPS.flatMap((g) =>
  g.fields.map(([key, label, placeholder]) => ({
    key,
    label,
    placeholder,
    long: Boolean(g.long),
    group: g.title,
  }))
);

export const LABELS = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
