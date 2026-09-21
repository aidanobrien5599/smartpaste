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
