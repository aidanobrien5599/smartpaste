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

## Setup

```bash
export TYPESAFE_API_KEY=...          # https://console.typesafe.ai/keys
ln -s "$PWD/bin/sp" ~/.local/bin/sp  # or: pipx install -e .

pbcopy < resume.txt && sp init       # build your snippet library
```

`sp init` writes `~/.config/smartpaste/profile.json` (mode 600) and lists the
fields a resume never contains but applications always ask for — work
authorization, sponsorship, start date, pronouns, a "why us" blurb. Fill those
in and re-run `sp init`. Add contacts under `network` to sharpen triage:

```json
{ "network": { "Marble": ["a friend from BJJ"] } }
```

Then, on any application: select the page text, copy, `sp`.

## Tests

```bash
python3 -m unittest discover -s tests
```

27 tests, no network — the API client is injected, so every stage is testable
against recorded answer shapes.

## Known rough edges

- **Field detection is the weakest stage.** The Noul filter sits at 0.5, and
  borderline rows like `LinkedIn Profile` or `Resume/CV` fall on either side of
  it between runs. Lowering the threshold trades false negatives for a few
  junk rows, which are cheap — an extra question costs tokens, not latency.
- **macOS only** (`pbpaste`/`pbcopy`).
- **Text-only.** File upload fields are detected and then correctly declined.
