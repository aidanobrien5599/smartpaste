/**
 * Resume text -> structured profile, the Jev way.
 *
 * The first drafter asked Jev "which line is the company of role 2?" -- a
 * search, with the whole resume as options, one line per answer. That cannot
 * split a line holding four fields, cannot combine a role's bullets, and
 * cannot turn "B.S." into "Bachelor of Science". Measured on resumes I did not
 * write, it got 27-32% of fields.
 *
 * This asks Jev what it is actually good at: classification over a short,
 * fixed set of labels. Code cuts the resume into sections and pieces; Jev
 * says what each heading and each piece is; code assembles entries from the
 * labels. Every value is still a substring of the resume -- nothing invented --
 * except degree names, which are chosen from a fixed list.
 *
 * Everything in this file is pure, so it is tested without the API.
 */

export const SECTION_KINDS = {
  education: "Education, academic background, qualifications, degrees",
  experience: "Work experience, employment, professional history, internships, jobs",
  projects: "Projects, personal or academic projects",
  skills: "Skills, technical skills, languages, tools",
  summary: "Summary, profile, objective, about",
  activities: "Leadership, activities, volunteering, affiliations, extracurriculars",
  awards: "Awards, honors, certifications, publications",
  other: "Some other section heading",
  __none__: "Not a section heading -- ordinary content",
};

export const EXPERIENCE_KINDS = {
  company: "The employer or organisation name",
  title: "The job title or position held",
  location: "Where the job was: a city, region, country, or Remote",
  dates: "When: a date or a date range",
  description: "A description of the work, such as a bullet point or a sentence",
  other: "Something else",
};

export const EDUCATION_KINDS = {
  school: "The school, college or university name",
  degree: "The degree only, such as 'Bachelor of Science' or 'B.S.' or 'MBA'",
  field: "The field of study or major only, such as 'Computer Science'",
  degree_field: "A degree together with its field, such as 'B.S. in Computer Science'",
  gpa: "A GPA, grade or class of degree",
  location: "Where the school is: a city, region or country",
  dates: "When: a date or a date range",
  detail: "Coursework, honours, thesis, activities or other detail",
  other: "Something else",
};

// A fixed list for "B.S." -> "Bachelor of Science": a choice, not a rewrite.
export const DEGREES = [
  "Associate of Arts", "Associate of Science", "Bachelor of Arts", "Bachelor of Science",
  "Bachelor of Science in Engineering", "Bachelor of Engineering", "Bachelor of Applied Science",
  "Bachelor of Technology", "Bachelor of Mathematics", "Bachelor of Business Administration",
  "Bachelor of Fine Arts", "Master of Arts", "Master of Science", "Master of Engineering",
  "Master of Business Administration", "Master of Fine Arts", "Master of Public Health",
  "Doctor of Philosophy", "Doctor of Medicine", "Juris Doctor", "High School Diploma",
];

// ------------------------------------------------------------------ dates

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|" +
  "Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const SEASON = "(?:Spring|Summer|Fall|Autumn|Winter)";
const YEAR = "(?:19|20)(?:\\d{2}|xx)";
// Word boundaries matter: without them "Now" matches inside "Snowflake" and
// the company is cut in two around a date that is not there.
const ONE_DATE =
  `(?<![A-Za-z])(?:(?:${MONTH}|${SEASON})\\s+${YEAR}|\\d{1,2}\\s*/\\s*${YEAR}|${YEAR}|Present|Current|Now|Today)(?![A-Za-z])`;
const DATE_RANGE = new RegExp(
  `(?:Expected\\s+|Graduat(?:ed|ing|ion):?\\s+)?${ONE_DATE}(?:\\s*(?:[-\\u2012-\\u2015]|to|until)\\s*${ONE_DATE})?`,
  "gi"
);
const DATE_SPLIT = new RegExp(`\\s*(?:[-\\u2012-\\u2015]|\\bto\\b|\\buntil\\b)\\s*(?=${ONE_DATE})`, "i");

/** "May 2026 – August 2026" -> { start, end }. A lone date is an end date. */
export function parseDates(text) {
  const clean = text.replace(/^(?:Expected|Graduat(?:ed|ing|ion):?)\s+/i, "").trim();
  const parts = clean.split(DATE_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { start: parts[0], end: parts[parts.length - 1] };
  return { start: "", end: parts[0] || "" };
}

// ---------------------------------------------------------------- sections

const BULLET = /^\s*[-*•·▪●‣⁃◦]\s*/;

export const isBullet = (line) => BULLET.test(line);

const SECTION_WORDS =
  /\b(?:education|academic|experience|employment|work|history|background|career|professional|skills?|competenc|technical|projects?|summary|profile|objective|about|leadership|activities|involvement|volunteer|awards?|honou?rs|certifications?|licen[cs]es|publications?|research|languages?|interests|qualifications|coursework|affiliations|memberships|contact|references|training|achievements|extracurricular|teaching|service|ausbildung|berufserfahrung|kenntnisse|formation|exp[eé]rience|comp[eé]tences|educaci[oó]n|experiencia|habilidades)/i;

/**
 * Lines that might be headings; Jev decides which ones are.
 *
 * A candidate must look like a heading: all capitals, a known section word,
 * or a trailing colon. Short title-case lines alone are not enough -- given
 * "Michigan Hackers" and "Embedded Software Intern", Jev called both
 * headings and split one job's entries into the wrong sections.
 */
export function headingCandidates(lines) {
  return lines
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => {
      const t = text.replace(/[:—–-]+\s*$/, "").trim();
      if (!t || isBullet(t) || t.length > 42) return false;
      if (/@|\d{3}|https?:|www\./i.test(t)) return false;
      if (t.split(/\s+/).length > 5) return false;
      const letters = t.replace(/[^A-Za-zÀ-ɏ]/g, "");
      const shouting = letters.length >= 4 && letters === letters.toUpperCase();
      return shouting || SECTION_WORDS.test(t) || /:\s*$/.test(text);
    });
}

/**
 * Assign every line a section, from the headings Jev confirmed.
 * Lines before the first heading are the header: name and contact details.
 */
export function sectionise(lines, headingKinds) {
  let current = "header";
  return lines.map((text, index) => {
    if (headingKinds.has(index)) {
      current = headingKinds.get(index);
      return { text, index, section: current, heading: true };
    }
    return { text, index, section: current, heading: false };
  });
}

// ------------------------------------------------------------------ pieces

const PLACE_CODE =
  /^(?:[A-Z]{2}|UK|U\.K\.|USA|U\.S\.A?\.|US|UAE|India|Canada|Germany|France|Spain|Italy|Ireland|Australia|Singapore|Japan|China|Netherlands|Switzerland|Sweden|Remote)$/;

/**
 * Cut one line into pieces that each hold a single field.
 *
 * "Master of Science, Computer Science, Towson University, Towson, MD" is four
 * fields on one line, and the standard student format. Date ranges are kept
 * whole (they contain dashes), commas split, and a trailing place code is put
 * back on its city: "Towson" + "MD" -> "Towson, MD".
 */
export function splitPieces(line) {
  if (isBullet(line)) return [line.replace(BULLET, "").trim()];
  const dates = [];
  const guarded = line.replace(DATE_RANGE, (m) => {
    dates.push(m.trim());
    return `\u0001${dates.length - 1}\u0001`;
  });
  const raw = guarded
    // A GPA always starts its own field: "BSE Computer Engineering GPA: 3.91".
    .split(/\s*\u0001(\d+)\u0001\s*|\s+[|•·—]\s+|\s+–\s+(?=[A-Z])|;\s+|,\s+|\s+(?=(?:Cumulative\s+|Overall\s+|Major\s+)?C?GPA\b)/)
    .filter((p) => p !== undefined);
  const pieces = [];
  for (let i = 0; i < raw.length; i++) {
    let piece = raw[i];
    if (piece === undefined || piece === "") continue;
    // A captured index is a protected date range.
    if (/^\d+$/.test(piece) && guarded.includes(`\u0001${piece}\u0001`)) {
      pieces.push(dates[Number(piece)]);
      continue;
    }
    // A separator stranded next to a date range: "· Toronto".
    piece = piece.replace(/^[\s|\u2022\u00b7\u2014\u2013;,]+|[\s|\u2022\u00b7\u2014\u2013;,]+$/g, "");
    if (!piece) continue;
    const prev = pieces[pieces.length - 1];
    // Put a city's state or country back: "Towson" + "MD".
    if (prev && PLACE_CODE.test(piece) && /^[A-Z][A-Za-z.' -]+$/.test(prev) && prev.split(" ").length <= 3) {
      pieces[pieces.length - 1] = `${prev}, ${piece}`;
      continue;
    }
    // "University of California" + "Berkeley" is one school, not two fields.
    if (prev && /^University of [A-Z][A-Za-z]+$/.test(prev) && /^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/.test(piece)) {
      pieces[pieces.length - 1] = `${prev}, ${piece}`;
      continue;
    }
    // A lower-case start continues the previous clause.
    if (prev && /^[a-z]/.test(piece)) {
      pieces[pieces.length - 1] = `${prev}, ${piece}`;
      continue;
    }
    pieces.push(piece);
  }
  return pieces;
}

// ---------------------------------------------------------------- assembly

const EXP_FIELD = { company: "company", title: "title", location: "location", dates: "dates" };
const EDU_FIELD = {
  school: "school", degree: "degree", field: "major", degree_field: "degree_field",
  gpa: "gpa", location: "location", dates: "dates",
};

/**
 * Pieces with labels -> entries. A new entry starts when a field that the
 * current entry already holds turns up again, or when a heading field
 * (company, title, school, degree) follows a description. That works whether
 * a layout leads with the date, the title or the company.
 */
export function assemble(pieces, kind) {
  const FIELD = kind === "education" ? EDU_FIELD : EXP_FIELD;
  const HEAD = kind === "education"
    ? new Set(["school", "degree", "degree_field"])
    : new Set(["company", "title"]);
  const entries = [];
  let entry = null;
  const open = () => {
    entry = { description: [] };
    entries.push(entry);
  };
  for (const { text, label, bullet } of pieces) {
    if (bullet || label === "description" || label === "detail") {
      if (!entry) open();
      if (label !== "detail") entry.description.push(text);
      continue;
    }
    const field = FIELD[label];
    if (!field) continue;
    const collides = entry && (entry[field] !== undefined ||
      (HEAD.has(label) && entry.description.length > 0));
    if (!entry || collides) open();
    entry[field] = text;
  }
  return entries.filter((e) => Object.keys(e).length > 1 || e.description.length);
}

const DEGREE_PREFIX =
  /^\s*(?:(?:Bachelor|Master|Associate|Doctor)(?:'s)?(?:\s+of\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?(?:\s+in\s+Engineering)?|Ph\.?D\.?|MBA|B\.?Tech|B\.?Eng|M\.?Eng|MEng|BEng|BSE|B\.?Sc?\.?|B\.?A\.?|M\.?Sc?\.?|M\.?A\.?|A\.?[AS]\.?)(?=[\s,(-]|$)\s*(?:\(Hons?\)\s*)?(?:in\s+|,\s*|-\s*|:\s*)?/;

/** "B.S. in Computer Science" -> { degree: "B.S.", field: "Computer Science" } */
export function splitDegreeField(text) {
  const match = text.match(DEGREE_PREFIX);
  if (!match || !match[0].trim()) return { degree: "", field: text.trim() };
  const degree = match[0].replace(/\s+(?:in|,|-|:)\s*$/i, "").replace(/[,:-]\s*$/, "").trim();
  return { degree, field: text.slice(match[0].length).trim() };
}

/** Cut the number out of "GPA: 3.82/4.00" or "Cumulative GPA 3.6/4.0". */
export function cleanGpa(text) {
  const m = text.match(/\d+(?:\.\d+)?\s*(?:\/\s*\d+(?:\.\d+)?)?/);
  return m ? m[0].replace(/\s+/g, "") : text;
}
