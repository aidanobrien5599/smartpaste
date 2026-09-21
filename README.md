# smartpaste

Autofill job applications from a profile you control.

The product is the **Chrome extension** in [`extension/`](extension/) — click
Autofill, or press ⌘V in a single field, and it fills in your answer. Start
there.

What is left at the repo root is a small Python CLI with two commands the
browser has no equivalent for:

- **`sp doctor`** — read your resume PDF the way an applicant tracking system
  will, and report what does not survive the trip.
- **`sp triage`** — score a copied job posting and route it: apply, find a warm
  intro, or skip.

`sp` itself, which filled a form from the clipboard, is superseded by the
extension.

## Built on a model that cannot write

Both halves run on [Jev](https://docs.typesafe.ai), TypeSafe's System One
model. It returns only a typed decision — `Choice`, `Score` or `Noul` — plus a
calibrated probability. **It cannot emit a string.**

That constraint is the whole design. Jev never writes an answer; it picks which
of *your own* entries answers a field, or which of a dropdown's own options to
select. Code does the rest: composing a full name from a first and last,
cutting a date out of a line, clicking the menu item.

And because every question carries an escape option, it declines cleanly:

```
$ sp doctor            # asked for a salary expectation you never gave it
  What are your salary expectations?   — no snippet —   1.00
```

Ask a chat model the same thing and you get a confident `$120,000`. For
something that types into a real application on your behalf, refusing well
matters more than fluency.

## sp doctor

A resume can look right in Preview and still arrive at a parser with its links
missing or its contact line scrambled. The rejection looks like any other
rejection.

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

That `✗` is real. A typo in an `\href` had been shipping in every PDF for three
months, sending anyone who clicked the email icon to an inbox that does not
exist. It is invisible in a viewer, because the visible text is correct and
only the link target is wrong.

Six checks: text layer present, contact details readable, `mailto` agreeing
with the visible address, links that exist as text and not only as annotations,
standard headings intact, unmapped icon glyphs.

## sp triage

```
$ sp triage
  new-grad eligible    yes        0.82
  work auth blocked    no         0.10
  stage                seed       0.91
  fit                  4/4        0.88
  applicant volume     2/4        0.74

  → WARM INTRO  (you know 1 person here)
```

The weights are plain code in `smartpaste/triage.py`, not a prompt: the model
supplies calibrated facts, your code decides what to do with them. High
applicant volume routes to *warm intro* rather than *apply*, and a known
contact at the company always does.

Context matters more than it looks. `needs_sponsorship` swings the
work-authorisation verdict from 0.05 to 0.96 on the same posting — before it
was passed in, the question returned 0.64 for everybody, which is worse than
useless.

## Setup

```bash
ln -s "$PWD/bin/sp" ~/.local/bin/sp
python3 -m venv .venv && .venv/bin/pip install -e . pypdf pdfminer.six
printf 'TYPESAFE_API_KEY=apikey_...\n' > ~/.config/smartpaste/env
chmod 600 ~/.config/smartpaste/env          # or export it
```

`sp doctor --file resume.pdf`, or omit `--file` to reuse the last one.
`sp triage` reads the posting from your clipboard.

## Do not judge a PDF by pypdf

Building this, pypdf produced `AIDANO'BRIEN`, `MadisonSep 2023` and
`Drove$15M+in`, which looked like a badly broken resume. pdfminer.six extracts
all three correctly. The damage was the library's, not the document's — a whole
repair layer in `source.py` exists only to cope with it, and `sp doctor` uses
pdfminer so its verdict reflects what a real parser sees.

## Tests

```bash
python3 -m unittest discover -s tests      # 56 tests, no network
```

The API client is injected, so every stage is testable against recorded answer
shapes.

They did not, however, catch the bugs that mattered. Almost every real defect
surfaced only by running against an actual PDF, an actual form, or an actual
page — and each lived in a seam: a regex whose length bound excluded real
inputs, a PDF's text layer losing what its annotations held, a detection call
passing the *resume* as context while asking whether a line of the *form* was a
field. A mocked boundary only ever tests your idea of the boundary.
