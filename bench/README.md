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
