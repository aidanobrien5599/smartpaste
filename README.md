# smartpaste

`sp` fills a job application from your own resume. Copy the application page,
run `sp`, paste the answers back.

It is built on [Jev](https://docs.typesafe.ai), TypeSafe's System One model,
which does not generate text at all — it returns a typed decision plus a
calibrated probability. That constraint is the point:

> **Jev never writes an answer. It picks which of your own lines contains one.**

Ask a chat model for a salary expectation you never gave it and you get a
confident `$120,000`. Asked the same thing, Jev returns *"none of the snippets
answers this"* at p = 1.00. For something that types into a real job
application on your behalf, refusing cleanly matters more than fluency.

## What it looks like

```
$ sp
  ● First name                    Aidan                                   1.00
  ● Last name                     O'Brien                                 1.00
  ● Email                         aob55992@example.com                    1.00
  ● Phone                         555-0142                                1.00
  ○ Resume/CV                     — no snippet —                          0.30
  ● GitHub                        github.com/aidanexample                 1.00
  ● School                        University of Wisconsin-Madison         0.99
  ● Degree                        BS Computer Science                     0.99
  ● Expected graduation date      May 2027                                1.00
  ● Are you legally authorized…   Yes, I am authorized to work in the US  0.99
  ● Will you now or in future…    No, I will not require visa sponsor…    0.98
  ● Why do you want to work here? I want to work somewhere small eno…     0.99
  ○ What are your salary expect…  — no snippet —                          1.00
  ● What pronouns do you use?     he/him                                  1.00

  ✓ 12 filled, 2 need you → copied as a block
```

14 fields, two API calls, **1.1 seconds**, about $0.0002.

## How it works

Four stages, and only two of them involve the model.

1. **Split** (code). Your resume becomes ~20-40 atomic snippets, split on lines,
   bullets and inline `|` separators. A resume is already a list of atomic
   facts, so this needs no extraction model. A Choice takes up to 255 options,
   which is far more headroom than a resume needs.
2. **Detect** (code + Jev). Local heuristics propose candidate label lines from
   the pasted page; a Noul fan-out asks Jev which are really fields an
   applicant fills in, discarding headings, buttons and marketing copy.
3. **Select** (Jev). One Choice per field over the whole snippet library, plus
   an escape option. All fields go in one call — questions are evaluated in
   parallel, so twenty cost about the same wall time as one.
4. **Extract** (code). Regexes pull the exact substring out of the chosen
   snippet: the email from a contact line, the surname from a name header, the
   date from `BS Computer Science, expected May 2027`. Jev locates; code
   transcribes. Regexes do not hallucinate.

### The confidence gate is the product

| probability | behaviour |
|---|---|
| `≥ 0.85` | filled silently |
| `0.40 – 0.85` | filled, flagged as worth checking, alternatives kept |
| `< 0.40`, or the escape option wins | **no value offered at all** |

Thresholds live in `smartpaste/answer.py`.

## Triage

`sp triage` scores a copied posting against your criteria and routes it. The
weights are plain code in `smartpaste/triage.py`, not a prompt — the model
supplies calibrated facts, your code decides what to do with them.

```
$ sp triage
  new-grad eligible    yes        0.82
  work auth blocked    no         0.10
  stage                seed       0.91
  fit                  4/4        0.88
  applicant volume     2/4        0.74

  → WARM INTRO  (you know 1 person here)
```

Cold-applying into a posting that draws thousands is the expensive mistake this
is meant to catch, so a high applicant volume routes to *warm intro* rather
than *apply*, and a known contact at the company always does.

## Doctor

`sp doctor` reads your resume the way a parser does and reports what does not
survive the trip. A resume that looks right in Preview can arrive at an ATS
with its links missing or its contact line scrambled, and nothing tells you —
the rejection looks like any other rejection.

```
$ sp doctor
  AIDAN_OBRIEN_RESUME.pdf  as a parser sees it

  ✓ text layer     4355 characters extracted
  ✓ contact        email and phone both in the text
  ✗ email link     the mailto link points to aob59922@gmail.com but the
                   page reads aidanobrien5599@gmail.com
  ! links          4 link(s) exist only as annotations: linkedin.com/…
  ✓ sections       all standard headings present
  ! glyphs         3 icon glyph(s) extract as junk
```

That `✗` is a real finding from the first run: a typo in an `\href` had been
shipping in every PDF for three months, sending anyone who clicked the email
icon to an inbox that does not exist. It is invisible in a PDF viewer, because
the visible text is correct and only the link target is wrong.

It uses **pdfminer.six**, not pypdf, deliberately — pypdf's weaker layout
analysis invents problems that no real parser has (see below).

## Setup

```bash
ln -s "$PWD/bin/sp" ~/.local/bin/sp
python3 -m venv .venv && .venv/bin/pip install -e . pypdf   # pypdf is optional
printf 'TYPESAFE_API_KEY=apikey_...\n' > ~/.config/smartpaste/env
chmod 600 ~/.config/smartpaste/env                          # or just export it

sp init --file ~/Desktop/resume.pdf   # or copy the text and: sp init
```

`sp init --file` reads `.pdf`, `.txt` and `.md`. PDFs need two repairs, both
handled: a resume's links live in **annotations**, never in the text layer, so
they are parsed separately — without that, `github.com/...` is lost and only an
icon glyph remains. And PDF kerning drops spaces, producing `AIDANO'BRIEN` and
`MadisonSep 2023`, which are repaired without touching `PostgreSQL` or
`Next.js`.

`sp init` writes `~/.config/smartpaste/profile.json` (mode 600) and lists the
fields a resume never contains but applications always ask for — work
authorization, sponsorship, start date, pronouns, a "why us" blurb. Fill those
in and re-run `sp init`. Add contacts under `network` to sharpen triage:

```json
{ "network": { "Marble": ["a friend from BJJ"] } }
```

Then, on any application: select the page text, copy, `sp`.

A fill **overwrites the clipboard** with its answers, so re-running reads those
back. `sp --again` re-runs against the last form instead.

## Tests

```bash
python3 -m unittest discover -s tests
```

39 tests, no network — the API client is injected, so every stage is testable
against recorded answer shapes.

They did not, however, catch the bugs that mattered. Five of the six real
defects surfaced only by running it against an actual PDF and an actual form,
and every one lived in a seam: a regex whose length bound excluded real inputs,
a PDF's text layer losing what its annotations held, and — the worst one —
the detection call passing the *resume* as context while asking whether a line
of the *form* was a field. That last one collapsed detection from 21 fields to
6, and no unit test could have seen it, because the mock answered whatever it
was asked.

## Known rough edges

- **Free-text essay fields are only as good as your blurbs.** "Tell us about a
  project you're proud of" resolves to whatever you wrote into `supplementary`;
  with nothing there it correctly declines. This is a selection tool, so it can
  only ever hand back prose you wrote yourself.
- **Triage criteria matter.** `needs_sponsorship` swings the work-authorization
  verdict from 0.05 to 0.96 on the same posting. The model is calibrated
  against the context you give it; give it none and the number is meaningless.
- **macOS only** (`pbpaste`/`pbcopy`).
- **Do not judge a PDF by pypdf.** Building this, pypdf produced
  `AIDANO'BRIEN`, `MadisonSep 2023` and `Drove$15M+in`, which looked like a
  badly broken resume. pdfminer.six extracts all three correctly. The damage
  was the library's, not the document's, and the repairs in `source.py` exist
  only to cope with it. `sp doctor` uses pdfminer so its verdict reflects what
  an ATS actually sees.
- **Text-only.** File upload fields are detected and then correctly declined.
