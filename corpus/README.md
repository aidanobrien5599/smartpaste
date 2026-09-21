# Resume drafter corpus

Measures **Fill profile from this** on resumes that are not mine. Every person
here is invented — `example.com` addresses, `555` phone numbers.

```bash
python3 corpus/build.py         # render the PDFs and write the answer key
node corpus/score.mjs <label>   # run the real drafter against live Jev, grade every field
```

`build.py` renders each persona through a different route, because each route
produces a different text layer: seven HTML layouts through Chrome's
print-to-PDF (as Google Docs and Canva exports are made), two through
`pdflatex` (one reusing my own resume's template), and one rasterised into an
image-only PDF, as a scanned resume is. My real resume is added from the
Desktop and kept out of git.

| Layout | What it stresses |
|---|---|
| classic | right-aligned dates on the title line |
| sidebar | two columns: contact and education left, experience right |
| dates-left | a date column in front of every entry |
| table | Word-style table cells |
| renamed | "Professional Experience", "Academic Background", emoji icons |
| experience-first | experience before education, "Expected" dates |
| stacked | company, title, dates on separate lines, four roles |
| latex-template | my own template, different person |
| latex-plain | `article` class, `\hfill` alignment |
| scanned | no text layer at all |

Variation inside the personas is deliberate too: `05/2025` and `Summer 2025`
dates, `Present`, `B.Tech` and `BSE` and `MEng`, a master's plus a bachelor's,
London and Bengaluru and Toronto, 1–4 roles, roles sharing a job title.

`score.mjs` treats formatting differences as correct — `05/2025` = `May 2025`,
`August` = `Aug`, phone numbers compared as digits — so a miss is a real miss.

## Baseline — selection plus regex (2026-09-20)

```
OVERALL fields 73% (223/306)   mean bullet recall 39%
my resume 89%   the other ten 78% average   scanned 0%

contact.*            92%   (only the scanned one misses)
education.degree      7%   education.major    21%   education.school  71%
experience.company   57%   experience.title   61%   experience.location 57%
experience.description 18% fully right
```

The misses sort into three kinds, all structural:

1. **One line, several fields** — `Wealthsimple — Backend Developer Intern`
   returned for both company and title; `08/2024 – 12/2025 Carnegie Mellon
   University` returned as the school.
2. **Needs rewriting** — `B.S. in Computer Science ·` for a degree whose answer
   is `Bachelor of Science`. Picking a line cannot produce that.
3. **Needs combining** — a role's description is every one of its bullets;
   picking one line returns one bullet.

My own resume scores 11 points above the rest: the regexes were fitted to it.

## Beyond my own test set

Synthetic resumes I wrote myself are still resumes I wrote myself. Two
independent sources, downloaded locally by `SET=... node corpus/score.mjs`
and kept out of git:

- **[ResumeExtractBench](https://huggingface.co/datasets/Careerflow/ResumeExtractBench)**
  (Careerflow, CC-BY-4.0) — 38 resumes of fictional people with human-verified
  answer keys: 28 handwritten scans and 10 LaTeX documents built to break
  parsers (chaotic dates, a German-format CV, trilingual, prose instead of
  bullets, hidden prompt-injection text, one company held four times).
  `python3 corpus/external/import_bench.py` converts its keys.
- **University career-centre samples** — real Word exports in the most common
  student format. Answer keys written by hand; template placeholders such as
  `5/20xx` are not graded.

| Set | Resumes | Fields right | Bullets recovered |
|---|---|---|---|
| my synthetic set (text) | 11 | 81% | 39% |
| career-centre Word sample | 1 | 27% | 0% |
| ResumeExtractBench, text layer | 10 | 32% | ~3% |
| ResumeExtractBench, image only | 28 | 0% | 0% |

The career-centre result is the one to notice. That format puts degree, major,
school and city on one comma-separated line — `Master of Science, Computer
Science, Towson University, Towson, MD` — and it is the standard student
layout, not an edge case. Picking one line cannot split it.

The benchmark also broke the drafter outright before it could be measured:
every question carried the whole resume as its options, 24 questions to a
request, so anything over ~120 lines hit `max_tokens_exceeded`. Requests now
split in half and retry when they are too large. It is also a point in favour
of classifying lines instead: that asks many small questions over one copy of
the document, rather than one large question per field.
