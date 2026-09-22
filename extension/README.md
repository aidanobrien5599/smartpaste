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

### The ties-and-history catch-all

The same idea, pointing the other way. *"Close personal relationship with a
partner?"*, *"worked with an engagement team as a client?"*, *"third-party
labor or contractor to us?"*, *"hold an active CPA license?"* are all No for
almost everyone. **Work authorization** holds:

> **Default answer on any other yes/no question about my past or present ties
> to the company, my prior work, certifications or licenses held, or conflicts
> and restrictions** — *"No."*

It, `related_employee` and `non_compete` default to "No" when left blank (in
`derived()`), so they work without being filled in; anything typed wins. Work
authorization, sponsorship and age keep their own fields, and a background
check or unpaid trial still gets no answer.

Asked to pick Yes or No straight off a dropdown, Jev rarely leans on a
catch-all (0.35–0.46 on the PwC questions). Asked which profile entry answers
the question, it picks this one at 0.9+. So a Yes/No dropdown asks both in
the same batch, and a confident entry that starts with Yes or No selects the
matching option (`yesNoFromEntry`). Entries that say the same Yes or No pool
their probability, since only the answer matters, and a place preference
reads as Yes when you are open to any location ("relocate to the NYC area?"
picks your top city). Two answers are composed from facts you gave: a citizen
or permanent resident is on no visa ("in a period of OPT?" → No), and an
education list whose degrees are all undergraduate has no graduate degree
("Graduate GPA" → Not Applicable).

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

### C3 AI — its own form over the Greenhouse API

Not Greenhouse's markup: every question is `<label>Question</label>` beside
the input's own `<div>`, with no `for=` and no id. Only School and Degree
(label and input in one div) were read — 0 of 16 fields filled.

- **Labels by ownership.** The label of the smallest wrapper holding this
  field and no other control is its label. A wrapper with a second control
  stops the climb, since its label may be the neighbour's.
- **A bare "I Accept" under a privacy notice was ticked.** The box's own text
  passed the consent filter, so the question around it is checked too.
- **Month dropdown + Year number box** is a split date. The wrapper is the
  smallest holding one month and one year; the nearest id'd ancestor was the
  whole page, which merged both dates into one field labelled with the job
  description.
- Site search and cookie-banner toggles are page chrome, not questions.

Live: **15 fields plus the resume**, consent left for you.

### ByteDance — Universe Design widgets, signed in

Each input sits in an **empty** `<label>`, with the question 7–11 levels up
(sometimes in a plain `div.ud-formily-item-label`). One field was read.

- **Menus have no role and no `aria-controls`.** Rows are
  `.ud__select__list__item`, each in a wrapper of its own — reading the row's
  parent as the menu saw one option, and the one-option shortcut clicked
  **"No" for "authorized to work?"**. The menu is the whole `.ud__select__list`,
  and a lone row is taken only when it is a search's result.
- **Read-only comboboxes** (Degree, Yes/No) are dropdowns, not disabled boxes.
- **Location is a tree** of country / state / city checkbox rows. Only
  leaves are options, named by path — "San Jose" is in Costa Rica too.
- **Start & end date** is one label over two boxes; each gets `(start)` /
  `(end)`, and a calendar picker's box takes `YYYY-MM` — anything else is
  dropped on blur.
- The resume input is hidden and labelled "Attachment"; its dropzone saying
  "Drag your resume here" is the evidence. ByteDance then offers to parse it
  and overwrite the form — left unanswered.

- **A failed pick left its menu open**, and the next dropdown read it: Degree
  read the location list, and sponsorship clicked "No" in the *authorization*
  menu. Every ByteDance dropdown now closes whatever is open first, remembers
  which menus were already showing, and closes its own afterwards.
- **"Add" sections are bare "Add" buttons** beside a section title. The title
  names the section, the cards in it are counted, and Add is clicked up to one
  card per profile entry. Roles whose title says intern go under Internship
  Experience, the rest under Work Experience; projects and awards have
  sections too. Each card's fields carry the entry they are for — *"Work
  Experience 1 (Intelligible AI): Company name"* — because the first work card
  is not my most recent role, and Jev would otherwise answer it as if it were.
- **"Mobile"** alone on a text box is the number; Jev read it as the phone
  *type* and typed "Mobile" in. It is asked as "Mobile phone number".

Live, real Jev and my real profile (`bench/dogfood-real.mjs`): **36 fields,
7 entries added, resume attached, in 9.9s**; left alone: Faculty, and dates
the profile has no ISO form for ("Present").

### Vercel — its own form, questions in a `<p>`

Vercel builds its careers form from its own Geist components over the
Greenhouse API. Every question is a plain `<p>` beside a `role="radiogroup"`:
no legend, no label, no `aria-labelledby`.

- **Five questions were asked as "First Name".** With no label of its own
  in reach, the walk up from the options found the First Name box's
  `<label>`. A label that holds or names another control now belongs to that
  control, and the text block just before the options is the question.
- **"Where did you first hear about this role?" was never asked.** It has 14
  options, and radio groups were capped at 12. The cap is now 20.
- **Every option starts with a zero-width space**, so `​Yes` never equalled
  `Yes`. `clean()` strips them.
- **Link boxes take a handle.** The LinkedIn box shows `linkedin.com/in/`
  before it, as an `aria-hidden` label, and a full URL typed in would read
  `linkedin.com/in/https://www.linkedin.com/in/…`. A URL whose start matches
  the shown prefix has the prefix cut off, so the box gets `aidanobrien5599`.
  That hidden prefix is also left out of the label.
- **The two acknowledgements are one-option radios**, so they aren't
  questions. See *Acknowledgements* below.

Live, real Jev and my real profile: **12 fields + resume in 0.9s**, 5 of the
6 radio questions answered (none were reached before). Jev left "work from
our London office 3 days a week?" alone at 0.14. It answers the same question
about "our office" Yes at 0.93, but every place in my profile is in the US.

## Acknowledgements

Most forms end with *"I have read the privacy notice"* or *"I confirm this
information is accurate"*. These are off by default and left for you. Turn on
**Settings → Autofill → Tick acknowledgements for me** and Autofill ticks
them, whether they are a lone checkbox or a one-option radio. Code makes the
call from the wording. Jev is never asked.

Wording that is a marketing opt-in, SMS, a talent community, job alerts or
do-not-sell is **never** ticked, even with the setting on and even when it
also says "I acknowledge". The setting lives in `chrome.storage.local.settings`,
not the profile, so it is never offered to Jev as an answer, and **Clear all
fields** keeps it.

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
- It runs on every site, so an application hosted on a company's own domain,
  or embedded in its careers page, works without anyone adding that domain to
  a list. But it only talks to Jev on a page that is plainly a job
  application, decided locally with no network call: a resume upload field,
  or at least four application-type questions (three on a page whose URL or
  title says "apply", "careers", "jobs"…), one of which goes beyond name,
  email and phone. A contact form, a login, a checkout or a newsletter
  signup has fields too, and their labels never leave the machine. On those
  pages nothing is sent and no button appears.
- React tracks its own value on the DOM node, so `el.value = x` reverts on
  blur. Insertion goes through the native setter and dispatches an `input`
  event, which is what React listens for.
- `refine()` applies only to unlabelled **Extra lines** and to resume drafting.
  Labelled profile values bypass it — no regex can improve a value you typed
  yourself, and every regex can spoil one.

## Tests

```bash
node --test extension/test/          # lib + content script in headless Chrome
node bench/mutation-check.mjs        # does each live-found fix have a test that sees it?
node bench/dogfood-live.mjs <url>    # a live page, the stub playing Jev
node bench/dogfood-real.mjs <url>    # a live page, real Jev and my real profile
```

Every real defect so far lived in how a specific site built its controls, so
the content tests run against fixtures shaped like each site
(`test/fixtures/`): Greenhouse, Ashby, Lever, Workday, and the two
company-built forms found live — `c3.html` (C3's markup as served) and
`bytedance.html` (a working fake of ByteDance's widgets, each quirk drawn the
way it broke smartpaste).

**A live bug is fixed when it has a test and a mutation entry.** The test
reproduces it in a fixture; the entry in `bench/mutation-check.mjs` undoes
the fix and checks that the test goes red. A `MISSED` there means the fixture
is kinder than the site: `bytedance.html`'s menus once closed each other,
which the real page never does, and the stale-menu bug that answered No to
work authorization passed every test until the fake stopped being polite.

The stub cannot judge. Whether Jev picks the right San Jose or reads
"Mobile" as a number needs `dogfood-real.mjs` now and then.
