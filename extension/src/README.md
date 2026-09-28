# extension/src — what lives where

Everything Chrome runs is built from here into `extension/dist/` by
`extension/build.mjs`. The manifest stays one level up in `extension/`, so
**Load unpacked → `extension/`** keeps the same folder, the same extension id,
and the same stored profile.

| path | what it is |
|---|---|
| `background.js` | The service worker, and the only thing that talks to Jev. Holds the API key; content scripts never see it. Still JavaScript. |
| `options.js` | The settings page: the profile form, stored documents, "Fill profile from this". Still JavaScript. |
| `popup.js` | The toolbar popup: status, and a Fill button that messages the page. Still JavaScript. |
| `shared/` | Types both sides agree on. `types.ts` is a field on the page and what the background decided for it; `messages.ts` is every message between content and background, with a typed `send()`. |
| `lib/` | Pure logic used by the background and the settings page: the profile schema, turning a profile into options, resolving Jev's answer, drafting a profile from a resume PDF. No DOM. |
| `content/` | The content script: reads the application page, asks the background for answers, and fills them in. Everything below is about this folder. |

## The content script's layers

```
dom  <-  state, ui/marks, ui/note  <-  discover  <-  answer  <-  widgets  <-  widgets/set-value
     <-  fill  <-  session, ui/keys  <-  index
```

An import may point down or across a layer, never up, and never in a
circle; `shared/` and `lib/` can be imported from anywhere.
`extension/test/structure.test.mjs` enforces all of it. The rule is what
keeps a fix local. A widget driver cannot reach up into the fill loop, so
changing how a dropdown is driven cannot change the order a page fills in.

## Module map (`content/`)

| file | its one job |
|---|---|
| `index.ts` | Entry point: starts the scan after the page settles, wires ⌘V and the `fill-page` message, exposes the test hook. |
| `state.ts` | The session: answered fields, what was asked, ⌘V cycling, whether a scan or fill is running, the cached profile. |
| `session.ts` | The lifecycle loop: `scan` → `showButton` → click → `fillPage` → `scan`. |
| `dom/query.ts` | DOM primitives: shadow-root-aware queries, real pointer clicks, key presses, sleeping, scroll containers. |
| `dom/text.ts` | Text cleanup: a label's shown text, `clean`, `normalize`, an option's text. |
| `dom/controls.ts` | What a control is: `visible`, `nodeVisible`, `isCombobox`, React Select's selectors. |
| `discover/selectors.ts` | Selectors shared across modules (a selector used by one module lives in it). |
| `discover/labels.ts` | How a field gets its question: `labelFor`, `ownerLabel`, `questionFor`, `listboxLabel`, `dateLabel`, ... |
| `discover/sections.ts` | Section and card context: "Education 1 (UW–Madison): Degree", Add sections, intern vs. work roles. |
| `discover/gate.ts` | Is this page a job application? Decided locally, before anything is sent anywhere. |
| `discover/files.ts` | Which upload input wants which document (resume, transcript, cover letter). |
| `discover/collect/fields.ts` | `collectFields()`: every question on the page, as `Field`s. |
| `discover/collect/choices.ts` | Toggle-button groups and radio groups. |
| `discover/collect/checkboxes.ts` | Check-all-that-apply groups and lone yes/no boxes. |
| `discover/collect/widgets.ts` | Workday listbox buttons, split dates, month + year pairs. |
| `answer/ask.ts` | Asking the background: the batched `answer()` for a scan, and `chooseAmong` / `askChoice` for one menu. |
| `answer/known.ts` | Keeping answered fields bound to live elements when the page rebuilds (`rebind`, `forget`, `detached`). |
| `widgets/set-value.ts` | `setValue`: picks the driver for a field and puts the value in. |
| `widgets/text.ts` | Typing: the native setter React listens to, key-by-key typing, shown URL prefixes. |
| `widgets/menus.ts` | Reading any open menu: finding it, waiting for it, scrolling it, clicking an option, closing it. |
| `widgets/select.ts` | Native `<select>`. |
| `widgets/toggle.ts` | Clicking toggle/radio groups and ticking checkbox groups. |
| `widgets/autocomplete.ts` | Plain-text autocompletes that only count once a suggestion is clicked. |
| `widgets/combobox.ts` | React Select and other searchable comboboxes. |
| `widgets/listbox.ts` | Workday's button dropdowns. |
| `widgets/prompt.ts` | Workday's search prompts, including the multi-pick Skills box. |
| `widgets/date.ts` | Date parsing, formatting for a box, and split month/day/year boxes. |
| `fill/fill-fields.ts` | The fill itself, fastest first, with the console timeline and the summary note. |
| `fill/entries.ts` | Clicking "Add" until each repeated section holds one entry per profile entry. |
| `fill/documents.ts` | Attaching stored documents to upload inputs. |
| `fill/acknowledge.ts` | The opt-in "I have read / I confirm" boxes. |
| `fill/revealed.ts` | Questions revealed by earlier answers, and refilling after a resume re-parse. |
| `ui/marks.ts` | Confidence markers on fields and the badges ⌘V flashes. |
| `ui/note.ts` | The corner the pill and notes are drawn in (the top document for a framed form). |
| `ui/keys.ts` | ⌘V: insert the answer, press again to cycle, or paste normally. |

Every file opens with a header that says what it is for, what it depends
on, and which ATS quirks live in it.

## One Autofill click, traced

1. `index.ts` `start()` waits for the page to settle, then watches it with a
   MutationObserver that calls `session.scan()`.
2. `scan()` calls `discover/collect/fields.collectFields()` and
   `discover/gate.looksLikeApplication()`, then `answer/ask.answer()`. That
   sends one `answer-fields` message, and `background.js` asks Jev.
3. The answers land in `state`, `ui/marks` marks each field, and
   `session.showButton()` draws the pill through `ui/note`.
4. On click, `session.fillPage()` runs, in order:
   - `fill/entries.addEntries()`
   - `fill/documents.attachDocuments()`
   - `fill/fill-fields.fillFields()`, which sends each field to
     `widgets/set-value.setValue()` or a survey/apply driver
     (`widgets/listbox`, `widgets/prompt`), which in turn uses `widgets/menus`
   - `fill/acknowledge.acknowledge()`
   - `fill/revealed.fillRevealed()`, then `refillIfReparsed()`
   - finally, `scan()` again.

## One ⌘V, traced

`ui/keys.onKeyDown()` looks the field up in `state.answers`.
- **Answer found:** it calls `widgets/set-value.setValue()` and flashes the
  confidence via `ui/marks`. Pressing again cycles to the next alternative.
- **No answer:** the keystroke is left alone. If the field was asked about,
  a hint says so.

## Where does my fix go?

| symptom | file |
|---|---|
| A new kind of control (a widget no driver handles) | a new `widgets/<name>.ts`, plus a branch in `widgets/set-value.ts` |
| A field is read with the wrong question | `discover/labels.ts` (or `discover/sections.ts` for section/card prefixes) |
| A question is not collected at all | `discover/collect/` |
| An application page is not detected, or a non-application page is | `discover/gate.ts` |
| A menu opens but its options are misread or the click misses | `widgets/menus.ts` |
| The order or timing of a fill | `fill/` |
| A new message to the background | `shared/messages.ts` and `background.js` (the drift test checks both) |

A live bug is fixed when it has a test and a mutation entry. The test
reproduces it in a fixture (`extension/test/fixtures/`). The entry in
`bench/mutation-check.mjs` undoes the fix and checks that the test goes red.

## Building and testing

```bash
npm install                  # once: esbuild, typescript, @types/chrome
npm run build                # src/ -> dist/; then Reload on chrome://extensions
npm run watch                # rebuild on every save
npm test                     # build, typecheck, structure, lib, content (headless Chrome)
npm run mutation             # does each live-found fix have a test that sees it?
```

Content tests and the mutation check bundle the current `src/` themselves,
so a stale `dist/` is never what gets tested. Chrome still loads `dist/`, so
build before you press Reload.
