# Benchmarking autofill tools

Time smartpaste against other tools (Simplify, …) the same way.

## Stopwatch extension (use this one)

`stopwatch-extension/` is a separate unpacked extension that starts with the
page, so it survives hard and soft reloads and splits the page's time from
the tool's:

- **fill**: the tool's number. It runs from the form appearing, or from your
  click on the tool's button if that came later, to the last field changed.
  It should barely move between a hard and a soft refresh.
- **form shown**: the page's number. It runs from navigation (or from your
  click on Next, for a Workday step) to the form existing. This is what the
  cache changes: a hard refresh re-downloads megabytes of Workday's scripts.
- **load**: whether the page loaded fresh or from cache ("reload, 3/41
  scripts cached" means a hard refresh).

Setup: go to `chrome://extensions`, choose **Load unpacked**, and pick
`bench/stopwatch-extension`. In its popup, type the tool you are timing
(e.g. `simplify`). Then load the application page, let the tool fill it, and
read the badge at the bottom-left. Every run is listed in the popup, with
**Copy all as JSON**. Each Workday step is recorded as its own run.

Turn it off in the popup when you're not benchmarking. It runs on every page.

## Console snippet

`stopwatch.js` is the paste-into-DevTools version. It dies on reload, so it
can only time a click or a later step of a single-page app.

## Sweeping from a worktree

An unpacked extension's id is a hash of its path, so a worktree's copy gets a
different id from the main checkout's -- and `bench/.sweep-template`, whose
stored profile lives under the main checkout's id, does not apply: every page
comes back `no-pill`. sweep.mjs copies the stored
profile to whatever id its own path gives, so a worktree run works as-is.

## Mutation check

`node bench/mutation-check.mjs [name-filter]` (or `npm run mutation`) proves
each live-found fix has a test that sees it. Every entry names the fixed code
and the code before the fix. For each entry the check:

1. finds the one file under `extension/src/` that holds the fixed code;
2. undoes the fix in a temporary copy of `src/`;
3. bundles that copy;
4. runs the content tests against the bundle.

An entry whose fourth element is `"lib"` guards a fix outside `content/` --
in `lib/` or `background.js`, which decide *what* to fill in rather than
*how*. Nothing to bundle there, so the check copies `extension/test/` beside
the mutant `src/` (every `../src/...` import then lands in the mutant) and
runs the suites that import `src/` directly, `content.test.mjs` aside.

It reports each entry as one of:

| result | meaning |
|---|---|
| `CAUGHT` | a test failed |
| `MISSED` | the fix is unguarded |
| `STALE` | the fixed code is no longer anywhere |
| `AMBIGUOUS` | it is in more than one file |
| `BROKEN` | the mutant does not build |

The real source is only ever read. When a refactor moves or re-indents
guarded code, change the entry's fixed and before text the same way. Run it
on its own: a hung run kills every `smartpaste-chrome-` process, so
concurrent runs manufacture false hangs.
