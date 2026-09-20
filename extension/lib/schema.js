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
    title: "Education",
    fields: [
      ["school", "School", "University of Wisconsin - Madison"],
      ["degree", "Degree", "Bachelor of Science"],
      ["major", "Major / discipline", "Computer Science"],
      ["minor", "Minor", ""],
      ["gpa", "GPA", "3.9/4.00"],
      ["grad_date", "Expected graduation date", "May 2027"],
      ["education_start", "Education start date", "September 2023"],
      ["coursework", "Relevant coursework", "Algorithms, Operating Systems, …"],
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
