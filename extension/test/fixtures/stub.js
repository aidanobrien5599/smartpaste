// Stands in for chrome.* in the page, so content.js runs outside the
// extension. Answers are canned by label; choose-option plays Jev's part
// with a fixed table, then word overlap. Records every message it gets.
window.__smartpasteTest = {};
window.__messages = [];
// Set __jevDelay (ms) to give choose-option Jev's latency; __maxInFlight
// then shows whether the page asked about several fields at once.
window.__jevDelay = 0;
window.__inFlight = 0;
window.__maxInFlight = 0;
window.__model = window.__model || {};
const ANSWERS = [
  // My Experience (workday-experience.html); specific ones first.
  [/Work Experience 1: Location/, "Los Gatos, CA"], [/Work Experience 2: Location/, "Remote"],
  [/Work Experience 2: I currently work here/, "Yes"], [/Work Experience \d: I currently work here/, "No"],
  [/Work Experience 1: To/, "August 2026"], [/Work Experience 2: From/, "Dec 2025"], [/Work Experience 2: To/, "May 2026"],
  [/Work Experience 1: Role Description/, "Drove $15M+ in projected savings."], [/Work Experience 2: Role Description/, "Built data ingestion pipelines."],
  [/Education 1: Overall Result/, "3.9"], [/Education 1: From/, "2023"],
  [/Websites 1: URL/, "https://www.linkedin.com/in/aidanobrien5599"], [/Websites 2: URL/, "https://github.com/aidanobrien5599"],
  [/Add Skills/, "Languages: Python, TypeScript, Java\nFrameworks: React, Next.js"],
  [/hear about/i, "LinkedIn"],
  [/first see this job/i, "Career Site"],
  [/^date$/i, "09/21/2026"], [/available start/i, "May 15, 2027"],
  [/address line 1/i, "123 State St"], [/^city$/i, "Madison"], [/postal code/i, "53703"],
  [/^country$/i, "United States"],
  [/^(first name)$/i, "Aidan"], [/^last name$/i, "O'Brien"],
  [/^(full )?name$/i, "Aidan O'Brien"],
  [/e-?mail/i, "aidanobrien5599@gmail.com"],
  [/device type/i, "Mobile"], [/phone number|^phone$/i, "9082160389"],
  [/previously worked/i, "No"],
  [/Work Experience 1: Job Title/, "Software Engineer Intern"],
  [/Work Experience 1: Company/, "Netflix"],
  [/Work Experience 1: From/, "May 2026"],
  [/Work Experience 2: Job Title/, "Founding Engineer"],
  [/Work Experience 2: Company/, "Intelligible AI"],
  [/Education 1: School/, "University of Wisconsin - Madison"],
  [/Education 1: Degree/, "Undergraduate science degree"],
  [/Education 1: To/, "May 2027"],
  [/authori[sz]ed/i, "Yes"],
  [/sponsorship/i, "No"],
  [/relocat/i, "Yes"],
  [/gender/i, "Prefer not to say"],
  [/hispanic/i, "No"], [/identify your race/i, "White"],
  [/linkedin/i, "https://www.linkedin.com/in/aidanobrien5599"],
  [/graduat/i, "May 2027"],
  [/location/i, "Madison, WI"],
  [/gpa/i, "3.9"],
];
const JEV = { "B.S.": "Bachelor of Science", "Undergraduate science degree": "Bachelor of Science", "May 2027": "Spring 2027", "Prefer not to say": "I do not wish to answer",
  "Yes": /^yes/i, "Madison, WI": "Madison, Wisconsin, United States" };
const words = (t) => t.toLowerCase().match(/[a-z0-9]+/g) || [];
window.chrome = {
  runtime: {
    onMessage: { addListener() {} },
    async sendMessage(m) {
      window.__messages.push(m);
      if (m.type === "answer-fields") {
        return { ok: true, results: m.fields.map((f) => {
          if (f.multi) {
            // What real Jev ticks for these two Lever questions.
            const pick = /language/i.test(f.label) ? ["English (ENG)"]
              : /office/i.test(f.label) ? ["New York, NY", "Washington, DC", "Seattle, WA"] : [];
            const value = f.options.filter((o) => pick.includes(o));
            return value.length
              ? { status: "auto", value, confidence: 0.98, multi: true, alternatives: [] }
              : { status: "none", value: null, confidence: 0, alternatives: [] };
          }
          const hit = ANSWERS.find(([re]) => re.test(f.label));
          if (!hit) return { status: "none", value: null, confidence: 0, alternatives: [] };
          let value = hit[1];
          if (f.options) value = f.options.find((o) => words(o)[0] === words(value)[0]) || value;
          return { status: "auto", value, confidence: 0.95, alternatives: [] };
        }) };
      }
      if (m.type === "choose-option") {
        window.__maxInFlight = Math.max(window.__maxInFlight, ++window.__inFlight);
        await new Promise((r) => setTimeout(r, window.__jevDelay));
        window.__inFlight--;
        const known = JEV[m.want];
        let index = known ? m.options.findIndex((o) => (known instanceof RegExp ? known.test(o) : o === known)) : -1;
        if (index < 0) {
          const want = new Set(words(m.want));
          let best = 0;
          m.options.forEach((o, i) => { const s = words(o).filter((w) => want.has(w)).length; if (s > best) { best = s; index = i; } });
        }
        // Like Jev: an answer listed twice splits its probability between
        // the copies, and neither clears background.js's 0.5 bar. Live,
        // "Madison, Wisconsin, United States" twice came back at 0.36.
        if (index >= 0 && m.options.filter((o) => o === m.options[index]).length > 1) {
          return { ok: true, index: -1, confidence: 0.36 };
        }
        return { ok: true, index };
      }
      return { ok: false };
    },
  },
  storage: { local: { async get() {
    return {
      profile: {
        experience: [{ company: "Netflix", title: "Software Engineer Intern" }, { company: "Intelligible AI", title: "Founding Engineer" }],
        education: [{ school: "University of Wisconsin - Madison" }],
        linkedin: "https://www.linkedin.com/in/aidanobrien5599", github: "https://github.com/aidanobrien5599",
      },
      documents: { resume: { name: "resume.pdf", type: "application/pdf", data: btoa("%PDF-1.4 resume") },
                          transcript: { name: "transcript.pdf", type: "application/pdf", data: btoa("%PDF-1.4 transcript") } } };
  } } },
};
