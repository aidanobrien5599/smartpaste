# smartpaste — Chrome extension

Click **Autofill**, or press **⌘V** in a single field, and Jev picks the entry
from your profile that answers it.

Jev never writes anything. It only chooses. If your profile does not answer a
field, the field is left alone and ⌘V falls through to an ordinary paste — it
never invents a value and never eats the keystroke.

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

## Repeated sections

Education and Experience take as many entries as you like, newest first. Each
entry's options are labelled with an ordinal — *"Job title of the 2nd most
recent role (Intelligible AI)"* — so a Workday form asking for `Employer 2` and
`Job Title 2` gets the right one. Measured against a numbered Workday-shaped
form with three roles, two of which share the same job title: **16 of 16
correct in 0.66s**.

## Documents

Store your resume, transcript and cover letter once. Autofill attaches them to
the form's upload fields, matching on the field's label, and leaves any other
file input — a headshot, a work sample — alone.

Nothing is uploaded anywhere. The file is held in this browser and handed
straight to the page through a `DataTransfer`, exactly as a drag-and-drop
would deliver it.

## Dropdowns

A `<select>` gets a different question: not "which profile entry answers this"
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
