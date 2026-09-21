# smartpaste — Chrome extension

Click **Autofill**, or press **⌘V** in a single field, and Jev picks the entry
from your profile that answers it.

Jev never writes anything. It only chooses. If your profile does not answer a
field, the field is left alone and ⌘V falls through to an ordinary paste — it
never invents a value and never eats the keystroke.

## What Jev actually decides

One `Choice` per field on the page, in a single batched call. The options are
every entry in your profile, each carrying its own label, plus an escape
option. The question is literally *"which entry from the applicant's profile
answers this field?"* — the meta-match, not a per-field rule anywhere in code.

**Jev selects; it never composes.** Asked for `Name` with only a first and last
name stored, it correctly returns nothing — handing back `Aidan` for a
full-name box would be wrong, and the escape option exists so it declines
rather than guesses. Joining them is code's job, so `lib/profile.js` derives
the composed answers (`full_name` from first + last, first/last back out of a
full name, `location` from city + state) and offers each as an option in its
own right. Anything you typed explicitly always wins over a derived value.

That split is the whole design: the model judges, code composes and extracts.

## The flexibility catch-all

Applications ask the same logistics question in endlessly different words —
*"willing and able to relocate to New York City"*, *"in the office 3 days a
week"*, *"can you work Pacific hours"*. The **Flexibility** group holds explicit
stances for the common ones plus a deliberately scoped catch-all:

> **Default answer on any other question about location, office attendance,
> travel or schedule** — *"Yes, I am flexible and open to whatever the role
> requires."*

Scoping is the whole point. A blanket "say yes to anything unanswered" would
also say yes to *"are you willing to work unpaid during a trial period?"* and
*"do you agree to a background check?"*. Because the catch-all names its own
domain, the escape option still wins outside it. Measured across ten
questions: five logistics answered, and unpaid work, background checks,
graduation date, sponsorship and salary all left alone or answered from their
own fields.

## Why a form and not a resume

The first version parsed your resume PDF into snippets and let Jev pick among
them. It was unreliable, and the reason is worth stating: a parsed resume line
is an **unlabelled fragment**. Adding a bare `June 2027` for a start date stole
the answer to *Expected graduation date*, because nothing said which was which.
Wrapped bullets arrived as half-sentences. Icon fonts arrived as `/gtbGithub`.

A profile field carries its own name into the question, so Jev matches on the
label rather than inferring from content — and the value you typed is returned
**verbatim**, with no regex between it and the box. Measured on the same form:
parsed resume 13–16 of 19 fields with several at 0.75–0.89; structured profile
**21 of 21, every one at 0.99–1.00, in 0.81s**.

The resume box is still there as *Extra lines*, for essay answers that want a
real bullet quoted back. It is optional.

## Ashby

A third shape again. No `<select>`, no combobox — yes/no questions are two
`<button aria-pressed>` over a hidden checkbox, so neither the buttons (not
form controls) nor the checkbox (invisible) were ever seen. A container holding
one `<label>` and two-to-eight toggle buttons is now read as a choice field and
answered by clicking.

Ashby also puts an **unlabelled "Autofill from resume" dropzone** above the real
Resume field. Handing it the PDF makes Ashby parse it and re-render the form,
wiping everything already filled — so file matching ranks evidence: what the
input says about itself (id, name, aria-label, `label[for]`) beats surrounding
text, and anything that looks like an autofill dropzone is skipped outright.

Live result: **8 of 8 fields**, resume on `_systemfield_resume`, all three
toggles set, dropzone untouched.

## Repeated sections

Education and Experience take as many entries as you like, newest first. Each
entry's options are labelled with an ordinal — *"Job title of the 2nd most
recent role (Intelligible AI)"* — so a Workday form asking for `Employer 2` and
`Job Title 2` gets the right one. Measured against a numbered Workday-shaped
form with three roles, two of which share the same job title: **16 of 16
correct in 0.66s**.

## Documents

Store your resume, transcript and cover letter once. Autofill attaches them to
the form's upload fields and leaves any other file input — a headshot, a work
sample — alone.

Matching looks at more than the label, because Greenhouse labels its resume
upload **"Attach"** and puts the only real clue in the element's `id`. The id,
name, aria-label and surrounding container text all count.

Nothing is uploaded anywhere. The file is held in this browser and handed
straight to the page through a `DataTransfer`, exactly as a drag-and-drop
would deliver it.

## Dropdowns

Greenhouse has no `<select>` elements at all. Every dropdown is a React Select
combobox: a text input with `role="combobox"` whose menu exists only while
open, linked by `aria-controls`.

Three things this forces:

- **Scope the menu.** A bare `[role="option"]` query sweeps up every open menu
  on the page — a phone widget's 244 countries will swamp a Yes/No.
- **Do not type the value in.** The menu's wording is its own. An expected
  graduation of `May 2027` has to become `Spring 2027`, and typing the literal
  value filters the menu to zero options, destroying the list the decision
  needs. Open it, read it whole, and let Jev choose. Typing is a fallback only
  for a menu long enough to be paged — a school list opens on *Aalborg
  University* and will never reach Wisconsin — and then one distinctive word
  narrows it, never the whole value.
- **Skip the hidden twin.** React Select renders a second, empty input for
  form submission. It otherwise gets picked up as a field and labelled from the
  `Select...` placeholder, sending seven junk questions per page.

Measured on a live Greenhouse application: **15 of 15 fields plus the resume**,
including `May 2027` → `Spring 2027` and `University of Wisconsin-Madison` →
`University of Wisconsin - Madison` (note the spaced hyphen — exact matching
could never have found it).

## Native dropdowns

A native `<select>` gets a different question: not "which profile entry answers this"
but "which of **these** options should be selected", with the select's own
option list as the choices. "Yes" and "I am authorized to work in the US" are
the same answer in different words, and only the dropdown knows which words it
accepts.

## Install

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   choose this `extension/` folder.
2. Click the extension icon → **Open settings**.
3. Paste your **API key** (`console.typesafe.ai/keys`), then fill in the
   profile form — 43 fields across identity, location, links, education, work
   authorization, logistics, demographics and written answers. Blank fields are
   simply never offered. ⌘S saves.

## Use

Open any application form. A pill appears bottom-right: **Autofill N fields**.
Click it and every high-confidence field is filled at once — fields you have
already typed in are never overwritten, and anything below the confidence bar
is left for you.

For one-offs, click a field and press **⌘V**. Press it **again** in the same
field to cycle to the next most likely answer.

## How it works

The keystroke has to decide *synchronously* whether to intercept, and a Jev
call takes ~500ms. So every field on the page is answered in **one batched call
on page load** — questions are evaluated in parallel, so twenty cost about the
same wall time as one. By the time you press ⌘V the answer is already cached,
and the paste is instant.

Reading labels from the DOM is the whole reason this belongs in a browser. The
CLI had to guess which lines of copied page text were fields, and that was its
weakest stage by a wide margin. Here the page simply says so.

## Notes

- The API key lives in `chrome.storage.local` and is read only by the
  background worker. Content scripts inherit the page's origin, so a fetch from
  one would hand the site you are applying on your key. It never goes there.
- The content script is scoped to known ATS hosts (Greenhouse, Lever, Ashby,
  Workday, …) rather than every site, so field labels from unrelated pages are
  never sent anywhere. Add hosts to `matches` in `manifest.json` as needed.
- React tracks its own value on the DOM node, so `el.value = x` reverts on
  blur. Insertion goes through the native setter and dispatches an `input`
  event, which is what React listens for.
- `refine()` now applies only to unlabelled *Extra lines*. Labelled profile
  values bypass it entirely — no regex can improve a value you typed yourself,
  and every regex can spoil one.
- The Python CLI still uses the older resume-parsing path. `sp doctor` and
  `sp triage` have no browser equivalent and remain useful; `sp` itself is
  superseded by this.
