# smartpaste — Chrome extension

⌘V pastes the answer the field is asking for, chosen from your own resume.

Jev never writes anything. It picks which of your lines contains the answer,
and code extracts the substring. If no line of yours answers the field, ⌘V does
an ordinary paste instead — it never invents a value and never eats the
keystroke.

## Install

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   choose this `extension/` folder.
2. Click the extension icon → **Open settings**.
3. Paste your **API key** (`console.typesafe.ai/keys`) and the **text of your
   resume**, then fill in the answers a resume never contains.

## Use

Open any application form, click a field, press ⌘V.

A green left-edge marker means high confidence; amber means it is worth a look.
**Press ⌘V again** in the same field to cycle to the next most likely answer —
that is how a low-confidence pick gets corrected, with no menu.

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
- `refine()` here is a port of `smartpaste/answer.py`. Both are tested against
  the same cases; if you change one, change the other.
