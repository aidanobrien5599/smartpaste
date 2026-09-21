# smartpaste — Chrome extension

Click **Autofill**, or press **⌘V** in a single field, and Jev picks the entry
from your profile that answers it.

Jev never writes anything. It only chooses. If your profile does not answer a
field the field is left alone, and ⌘V falls through to an ordinary paste — it
never invents a value and never eats the keystroke.

## Setup

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → this folder.
2. Click the icon → **Open settings**.
3. Paste your API key from `console.typesafe.ai/keys`.
4. Store your resume under **Documents** (first section), press **Fill profile
   from this**, then check what it drafted. ⌘S saves. **Clear all fields**
   empties the profile if you want to start over; it keeps your API key and
   stored documents.

Chrome does not reload an unpacked extension by itself. After pulling changes,
press **Reload** on `chrome://extensions` or you are running the old code.

## Use

On an application form a pill appears bottom-right: **Autofill N fields +
N files**. One click fills everything the model was confident about, attaches
your documents, and leaves alone anything you have already typed.

For one-offs, click a field and press **⌘V**. Press it **again** in the same
field to cycle to the next most likely answer — that is how a low-confidence
pick gets corrected, with no menu. A green left-edge marker means high
confidence, amber means worth a look.

When your profile has no answer for a field, ⌘V does an ordinary paste and
says so — *"no answer in your profile — normal paste"*. Without that, whatever
was on your clipboard lands in the box and looks exactly like smartpaste put
it there.

## What Jev decides

One `Choice` per field on the page, batched into a single call. The options are
every entry in your profile, each carrying its own label, plus an escape
option. The question is literally *"which entry from the applicant's profile
answers this field?"* — the match is the model's job, not a per-field rule
anywhere in code.

| probability | behaviour |
|---|---|
| `≥ 0.85` | filled silently |
| `0.40 – 0.85` | filled, flagged as worth checking, alternatives kept |
| `< 0.40`, or the escape option wins | **no value offered at all** |

Thresholds live in `lib/resolve.js`.

**Jev selects; it never composes.** Asked for `Name` with only a first and last
name stored it correctly returns nothing — handing back `Aidan` for a full-name
box would be wrong. Joining them is code's job, so `lib/profile.js` derives the
composed answers (`full_name` from first + last, first and last back out of a
full name, `location` from city + state) and offers each as an option in its
own right. Anything typed explicitly beats a derived value.

That split runs through everything: **the model judges, code composes and
extracts.** It decides *which*; `refine()` cuts the substring out,
`setCombobox` clicks the menu item, `derived()` joins the strings.

## The profile

41 fields across Identity, Location, Links, Work authorization, Flexibility,
Logistics, Demographics and Written answers, plus **Education** and
**Experience**, which take as many entries as you like, newest first. Blank
fields are never offered.

Each repeated entry's options carry an ordinal and their subject — *"Job title
of the 2nd most recent role (Intelligible AI)"* — so a Workday form asking for
`Employer 2` gets the right one. Against a numbered form with three roles, two
sharing the title "Software Engineer Intern": **16 of 16 correct in 0.66s**.

### Why a form and not a resume

The first version parsed the resume into snippets and let Jev pick among them.
It was unreliable, and the reason is worth stating: a parsed resume line is an
**unlabelled fragment**. Adding a bare `June 2027` for a start date stole the
answer to *Expected graduation date*, because nothing said which was which.
Wrapped bullets arrived as half sentences. Icon fonts arrived as `/gtbGithub`.

A profile field carries its own name into the question, so Jev matches on the
label rather than inferring from content, and the value you typed is returned
**verbatim** with no regex between it and the box. On the same form: parsed
resume 13–16 of 19 with several picks at 0.75–0.89; structured profile **21 of
21, every one at 0.99–1.00, in 0.81s**.

The resume survives as optional **Extra lines**, for essay answers where an
unlabelled bullet is genuinely what you want quoted back.

### Fill profile from this

Typing 41 fields is a lot, so the button beside your stored resume drafts them.
It reads the PDF with a vendored pdf.js, splits it into lines, and asks Jev one
Choice per field: *which line contains this*. That is the old
extraction-by-selection trick, kept where it belongs — run **once**, in
settings, on something you read before saving. Fields you have already filled
are never touched.

**Reading the PDF.** pdf.js returns positioned fragments, not lines, so
`lib/extract.js` rebuilds them. Three things matter on a real resume:

- **Columns.** A right-aligned date sits on the same baseline as the job title,
  so grouping by height alone produced `Software Engineer Intern May 2026 -
  August 2026`. pdf.js emits the gap between them as a single 250pt-wide space
  where a word space is ~3pt; anything wider than `max(15pt, 1.5 × font
  size)` now starts a new line.
- **Icons are identified by font, not by character.** FontAwesome maps its
  phone and envelope glyphs onto ordinary letters — they arrive as `Ó` and `R`
  — so no character-level cleanup could catch them. The page's loaded fonts
  carry real names (`VOXUTP+FontAwesome`), so anything set in an icon font is
  dropped. A dropped icon still occupies its place on the line; deleting it
  outright left a hole wide enough to read as a column break.
- **Spaces.** Fragments are grouped with a tolerance rather than exact
  heights (a small-caps `A` + `IDAN` sits on a slightly different baseline),
  and a visible gap with no space fragment gets its space back.

The fragment-to-line logic is a pure function with its own tests
(`test/extract.test.mjs`), built from fragments measured off a real resume.

Four things the first real run got wrong, each fixed in code rather than by
nudging the prompt:

- Asked for a home city it answered `Los Gatos, CA` — where Netflix is, the
  only city on the page. Resume questions are now limited to what a resume
  states. Work authorisation, salary and availability are not on one.
- Every experience end date equalled its start date. The JS port of `refine()`
  had dropped `end` from its end-of-range words, so `May 2026 - August 2026`
  returned the first date.
- `Netflix` vanished: the splitter dropped lines under eight characters, and
  that is seven.
- Link fields got the whole contact line, which says the word "LinkedIn" but
  carries no URL. Link questions now see only link-shaped options, so they get
  the real URLs recovered from the PDF's annotations.
- Bullets arrived as half sentences, because a bullet that runs past the page
  width continues on the next line. They are rejoined before splitting — only
  bullets, and only up to a full stop, since joining every unterminated line
  would weld "University of Wisconsin" onto the date beneath it.
- `Company` came back as `Netflix Los Gatos, CA` and `Job title` as `Software
  Engineer Intern May 2026 - August 2026`. A resume packs the employer, the
  place and the dates onto one line, so each field now takes its own reading of
  it: a Company wants the name with the place stripped, a Location wants the
  place, and only knowing that Netflix is a company tells you where the
  boundary falls — so a Company insists on a name being left over, while a
  Location takes the longest place it can find.
- Every role showed the same location, picked off a neighbouring role's line. A
  company or location repeated across entries is now dropped as an echo.

### The flexibility catch-all

Applications ask the same logistics question endlessly differently — *"willing
and able to relocate to New York City"*, *"in the office 3 days a week"*, *"can
you work Pacific hours"*. The **Flexibility** group holds explicit stances plus
a deliberately scoped catch-all:

> **Default answer on any other question about location, office attendance,
> travel or schedule** — *"Yes, I am flexible and open to whatever the role
> requires."*

The scoping is the design. A blanket "say yes to anything unanswered" would
also agree to *"are you willing to work unpaid during a trial period?"* and
*"do you agree to a background check?"*. Because the catch-all names its own
domain, the escape option still wins outside it. Across ten questions: five
logistics answered, and unpaid work, background checks, graduation date,
sponsorship and salary all declined or answered from their own fields.

## Forms in the wild

Every ATS builds its controls differently, and each one broke something.

### Greenhouse — React Select

No `<select>` elements at all. Every dropdown is a text input with
`role="combobox"` whose menu exists only while open, linked by `aria-controls`.

- **Scope the menu.** A bare `[role="option"]` query sweeps up every open menu
  on the page; a phone widget's 244 countries will swamp a Yes/No.
- **Do not type the value in.** The menu's wording is its own. An expected
  graduation of `May 2027` has to become `Spring 2027`, and typing the literal
  value filters the menu to zero options — deleting the list the decision
  needs. Open it, read it whole, let Jev choose. Typing survives only to narrow
  a paged menu (a school list opens on *Aalborg University*), and then with one
  distinctive word.
- **Skip the hidden twin.** React Select renders a second, empty input for form
  submission; it otherwise becomes a field labelled `Select...`.

Live: **16 of 16 fields plus the resume**, including `May 2027` → `Spring 2027`
and `University of Wisconsin-Madison` → `University of Wisconsin - Madison`
(note the spaced hyphen — exact matching could never have found it).

### Ashby — buttons over a hidden checkbox

Yes/No is two `<button aria-pressed>` over an invisible checkbox. Neither half
is a visible form control, so three of eight questions were never seen. A
container holding one `<label>` and two-to-eight toggle buttons is now read as
a choice field and answered by clicking.

Ashby also puts an unlabelled **"Autofill from resume"** dropzone above the
real Resume field. Handing it the PDF makes Ashby parse it and re-render the
form, wiping everything already filled — so file matching ranks evidence: what
an input says about *itself* (id, name, aria-label, `label[for]`) beats
surrounding text, and autofill dropzones are skipped outright.

Live: **8 of 8 fields**, resume on `_systemfield_resume`, dropzone untouched.

### Lever — labels full of status text, native radios, a hidden location

- **Labels.** Lever wraps each input in a `<label>` that also holds status
  text, so the label read *"Current location No location found. Try entering
  a different location"*; its custom questions have no label at all. The
  question's own text lives in `.application-label`, which is now looked up
  first. It also marks required fields with `✱`, which is now stripped.
- **Radio groups.** Sponsorship is a set of native `<input type=radio>`. A
  radio is neither a text field nor a toggle button, so the question was never
  collected. Radios are now grouped by name and answered by clicking.
- **The location field** is a custom autocomplete, and the value Lever
  submits lives in a hidden `selectedLocation` that is set only by *clicking a
  suggestion*. Typed text alone looks filled and submits empty. Worse, the
  widget ignores a synthetic `input` event entirely — it keys off `keydown`'s
  `keyCode`, which a constructed `KeyboardEvent` leaves at 0 — so the text is
  typed one character at a time with a real key code, and the suggestion
  nearest the field is clicked.
- **Documents go first.** Attaching a resume makes Lever parse it, and parsers
  re-render forms. So Autofill now attaches, waits, re-finds the fields by
  label, and only then fills them.

Live: **10 of 10**, both radios answered, GPA `3.9` chosen from the native
select's options for a profile value of `3.9/4.00`, and `selectedLocation`
populated. Greenhouse and Ashby re-run clean afterwards.

### Autocompletes

A field whose placeholder says *"Start typing…"* has an empty menu until you
type, so opening it yields nothing. There, typing is the only way to get any
options at all. If no menu ever appears, a plain autocomplete keeps the typed
text — while a React Select is cleared, because there it would only *look*
filled.

### Native dropdowns

A real `<select>` gets a different question again: not "which profile entry
answers this" but "which of **these** options should be selected", with the
select's own option list as the choices. "Yes" and "I am authorized to work in
the US" are the same answer in different words, and only the dropdown knows
which words it accepts.

## Documents

Store your resume, transcript and cover letter once. Autofill attaches them to
the form's upload fields and leaves any other file input — a headshot, a work
sample — alone.

Nothing is uploaded anywhere. The file lives in this browser and is handed
straight to the page through a `DataTransfer`, exactly as a drag-and-drop would
deliver it.

## Notes

- The API key lives in `chrome.storage.local` and is read only by the
  background worker. Content scripts inherit the page's origin, so a fetch from
  one would hand the company you are applying to your key.
- The content script is scoped to known ATS hosts rather than every site, so
  field labels from unrelated pages are never sent anywhere. Add hosts to
  `matches` in `manifest.json`.
- React tracks its own value on the DOM node, so `el.value = x` reverts on
  blur. Insertion goes through the native setter and dispatches an `input`
  event, which is what React listens for.
- `refine()` applies only to unlabelled **Extra lines** and to resume drafting.
  Labelled profile values bypass it — no regex can improve a value you typed
  yourself, and every regex can spoil one.
- It is a port of `smartpaste/answer.py`. They drift: the JS copy silently lost
  `end` from its end-of-range words. If you change one, change the other.

## Tests

```bash
node --test extension/test/      # the lib: refine, resolve, buildOptions, unwrap
```

The DOM half is verified against live Greenhouse, Ashby and Lever pages rather
than fixtures, because every real defect so far lived in how a specific site
built its controls.
