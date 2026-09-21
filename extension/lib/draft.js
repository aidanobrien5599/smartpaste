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
const YEAR = "(?:(?:19|20)(?:\\d{2}|xx)|['\u2019]\\d{2})";
// Word boundaries matter: without them "Now" matches inside "Snowflake" and
// the company is cut in two around a date that is not there.
const ONE_DATE =
  `(?<![A-Za-z0-9])(?:(?:${MONTH}|${SEASON})\\s*${YEAR}|Q[1-4]\\s*${YEAR}|(?:19|20)\\d{2}\\s*[/.-]\\s*(?:0?[1-9]|1[0-2])(?![0-9])|\\d{1,2}\\s*[/.]\\s*${YEAR}|${YEAR})(?![A-Za-z0-9])`;
// "Present" and "Now" are dates only at the end of a range. On their own they
// are words: "Momentum Solutions (now Apex Systems)" was being cut at "now".
const RANGE_END = `(?:${ONE_DATE}|(?<![A-Za-z])(?:Present|Current|Now|Today)(?![A-Za-z]))`;
const BARE_MONTH = `(?<![A-Za-z])${MONTH}(?=\\s*(?:[-\\u2012-\\u2015]|to)\\s*${MONTH}\\s*${YEAR})`;
const DATE_RANGE = new RegExp(
  `(?:Expected\\s+|Class\\s+of\\s+|Graduat(?:ed|ing|ion):?\\s+)?(?:${ONE_DATE}|${BARE_MONTH})(?:\\s*(?:[-\\u2012-\\u2015]|to|until)\\s*${RANGE_END})?`,
  "gi"
);
const DATE_SPLIT = new RegExp(`\\s*(?:[-\\u2012-\\u2015]|\\bto\\b|\\buntil\\b)\\s*(?=${RANGE_END})`, "i");
const HAS_DATE = /\d|present|current|now|today/i;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_INDEX = (word) => MONTH_NAMES.findIndex((m) => word.toLowerCase().startsWith(m.toLowerCase()));

/**
 * One date, in one form: "Feb 2019", "2019", "Summer 2015", "Present".
 * Code, not the model -- "Feb ’19", "Dec. 2020", "2013/09" and "09.2013" are
 * spellings of a date, and a form wants the date.
 */
export function normalizeDate(raw, borrowYear = "") {
  const t = raw.trim().replace(/\s+/g, " ");
  if (/^(?:present|current|now|today)$/i.test(t)) return "Present";
  const fullYear = (y) => (y.length === 2 || /^['\u2019]/.test(y)
    ? (Number(y.replace(/\D/g, "")) > 50 ? "19" : "20") + y.replace(/\D/g, "")
    : y);
  let m = t.match(/^((?:19|20)\d{2})\s*[/.-]\s*(\d{1,2})$/); // 2013/09
  if (m) return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
  m = t.match(/^(\d{1,2})\s*[/.]\s*((?:19|20)\d{2})$/); // 09/2013, 09.2013
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${MONTH_NAMES[Number(m[1]) - 1]} ${m[2]}`;
  m = t.match(/^([A-Za-z]+)\.?\s*((?:19|20)\d{2}|['\u2019]\d{2})?$/); // Feb ’19, Dec. 2020, March
  if (m) {
    const i = MONTH_INDEX(m[1]);
    const year = m[2] ? fullYear(m[2]) : borrowYear;
    if (i >= 0 && m[1].length >= 3) return year ? `${MONTH_NAMES[i]} ${year}` : MONTH_NAMES[i];
    if (/^(?:spring|summer|fall|autumn|winter)$/i.test(m[1])) return year ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${year}` : t;
  }
  return t.replace(/['\u2019](\d{2})$/, (_, yy) => fullYear(yy));
}

/** "May 2026 – August 2026" -> { start, end }. A lone date is an end date. */
export function parseDates(text) {
  const clean = text.replace(/^(?:Expected|Class\s+of|Graduat(?:ed|ing|ion):?)\s+/i, "").trim();
  const parts = clean.split(DATE_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const end = normalizeDate(parts[parts.length - 1]);
    const endYear = (end.match(/(?:19|20)\d{2}/) || [""])[0];
    return { start: normalizeDate(parts[0], endYear), end };
  }
  return { start: "", end: parts[0] ? normalizeDate(parts[0]) : "" };
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
      // A heading starts with a capital; "career." is a wrapped sentence's tail.
      // Look past a leading icon first: "[BRIEFCASE] Work History", "💼 Work".
      const word = t.replace(/^(?:\[[A-Z_ ]+\]\s*|[^\p{L}]+)/u, "");
      if (!/^[A-Z\u00c0-\u00de]/.test(word)) return false;
      const letters = t.replace(/[^A-Za-zÀ-ɏ]/g, "");
      const shouting = letters.length >= 4 && letters === letters.toUpperCase();
      return shouting || SECTION_WORDS.test(t) || /:\s*$/.test(text);
    });
}

// A strong section word decides the section when Jev declines a creative
// heading: "Career Journey" is experience whatever else it is.
const VOCABULARY = [
  [/\b(?:experience|employment|career|work history|professional history|positions|berufserfahrung|exp[eé]rience professionnelle|experiencia)\b/i, "experience"],
  [/\b(?:education|academic|credentials|qualifications|studies|ausbildung|formation|educaci[oó]n)\b/i, "education"],
  [/\bprojects?\b/i, "projects"],
  [/\b(?:skills|competenc|technical|kenntnisse|comp[eé]tences|habilidades)/i, "skills"],
];

export function sectionByVocabulary(text) {
  const hit = VOCABULARY.find(([re]) => re.test(text));
  return hit ? hit[1] : null;
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

// "Stripe, Inc." is one company. Split at the comma, the suffix was labelled a
// second company and opened a phantom entry, shifting every later role.
const COMPANY_SUFFIX =
  /^(?:Inc|Incorporated|LLC|L\.L\.C|Ltd|Limited|Corp|Corporation|Co|Company|PLC|LLP|LP|GmbH|AG|SE|SA|S\.A|SAS|S\.A\.S|SARL|BV|B\.V|NV|N\.V|AB|AS|A\/S|Oy|KK|K\.K|Pty(?: Ltd)?|Pvt(?: Ltd)?|SpA|S\.p\.A|Srl|S\.r\.l)\.?$/i;

const PLACE_CODE =
  /^(?:[A-Z]{2}|UK|U\.K\.|USA|U\.S\.A?\.|US|UAE|India|Canada|Germany|France|Spain|Italy|Ireland|Australia|Singapore|Japan|China|Netherlands|Switzerland|Sweden)$/;

/**
 * Cut one line into pieces that each hold a single field.
 *
 * "Master of Science, Computer Science, Towson University, Towson, MD" is four
 * fields on one line, and the standard student format. Date ranges are kept
 * whole (they contain dashes), commas split, and a trailing place code is put
 * back on its city: "Towson" + "MD" -> "Towson, MD".
 */
export function splitPieces(line) {
  // Prose is one piece. Length cannot tell it from an entry line -- "Bachelor
  // of Science, Computer Information Systems (CIS), Towson University,
  // Towson, MD" is eleven words and must be split -- but its words can: prose
  // is mostly lower case, an entry line mostly capitalised names.
  const words = line.trim().split(/\s+/);
  const lower = words.filter((w) => /^[a-z]/.test(w) && !/^(?:of|and|the|in|at|for|to|&)$/.test(w)).length;
  if (words.length > 8 && lower / words.length >= 0.4) return [line.replace(BULLET, "").trim()];
  if (isBullet(line)) return [line.replace(BULLET, "").trim()];
  const dates = [];
  // A bracket is one unit: "(Remote from Jan 2019 - 2020)" holds a date range
  // and "[Stealth Startup - NDA in effect]" a dash, and neither is a boundary.
  const brackets = [];
  const bracketed = line.replace(/\([^()]*\)|\[[^\[\]]*\]/g, (m) => {
    brackets.push(m);
    return `\u0003${brackets.length - 1}\u0003`;
  });
  const guarded = bracketed.replace(DATE_RANGE, (m) => {
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
      pieces.push(dates[Number(piece)].replace(/\u0003(\d+)\u0003/g, (_, i) => brackets[Number(i)]));
      continue;
    }
    piece = piece.replace(/\u0003(\d+)\u0003/g, (_, i) => brackets[Number(i)]);
    // A separator stranded next to a date range: "· Toronto".
    piece = piece.replace(/^[\s|\u2022\u00b7\u2014\u2013;,]+|[\s|\u2022\u00b7\u2014\u2013;,]+$/g, "");
    if (!piece) continue;
    const prev = pieces[pieces.length - 1];
    if (prev && COMPANY_SUFFIX.test(piece)) {
      pieces[pieces.length - 1] = `${prev}, ${piece}`;
      continue;
    }
    // Put a city's state or country back: "Towson" + "MD".
    // Ignore a trailing bracket when checking for a state code: "NY (Remote from ...)".
    if (prev && PLACE_CODE.test(piece.replace(/\s*[(\[].*$/, "")) && /^[A-Z][A-Za-z.' -]+$/.test(prev) && prev.split(" ").length <= 3) {
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
  let last = null; // the previous labelled piece: { field, line }
  for (const { text, label, bullet, index } of pieces) {
    if (bullet || label === "description" || label === "detail") {
      if (!entry) open();
      if (label !== "detail") entry.description.push(text);
      last = null;
      continue;
    }
    const field = FIELD[label];
    if (!field) continue;
    if (field === "dates" && !HAS_DATE.test(text)) continue; // a "Dates" column header
    // Two neighbouring pieces of one line with the same label are one field
    // that held a comma: "Senior Director" + "International Business
    // Development". Without this the second opened a phantom entry.
    if (entry && last && last.field === field && index !== undefined && last.line === index) {
      entry[field] = `${entry[field]}, ${text}`;
      continue;
    }
    last = { field, line: index };
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
