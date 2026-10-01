/**
 * The page moving under a fill: a step change, an unload, or a submit.
 *
 * Depends on: ui (note is the caller's), nothing else.
 *
 * Workday feels, in the user's words, as if "the page is forced to reload"
 * partway through a fill. Nothing here can say why that happens on its own,
 * so this says WHEN: which field was in flight the moment the page moved,
 * printed at once and carried into the fill's summary. An anecdote becomes a
 * line in the log that names a field.
 *
 * A submit during a fill is also cancelled. smartpaste never submits an
 * application, so one in this window came from the page -- Workday's Enter
 * key reaching the step's primary button is the usual way -- and it is
 * cancelled and said out loud rather than allowed to take the form away. A
 * page's own form.submit() call fires no event and cannot be stopped from
 * here (a content script runs in its own world), so it is only reported.
 */

/** What moved, and what was being filled at the time. */
export type Moved = { what: string; field: string } | null;

// How often the URL is compared: a Workday step change is a pushState, which
// fires no event of its own.
const URL_POLL = 250;

// A fill that throws never calls stop(), so the watch gives up on its own
// rather than poll the URL for the life of the page.
const WATCH_CAP = 120000;

export function watchNavigation(inFlight: () => string): { stop: () => Moved } {
  const was = location.href;
  let moved: Moved = null;
  const say = (what: string) => {
    const field = inFlight() || "(between fields)";
    if (!moved) moved = { what, field };
    console.warn(`smartpaste: the page ${what} while filling ${field}`);
  };
  const onHide = () => say("started to unload");
  const onPop = () => say("went back or forward");
  const onSubmit = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    say("tried to submit (cancelled)");
  };
  addEventListener("pagehide", onHide);
  addEventListener("beforeunload", onHide);
  addEventListener("popstate", onPop);
  document.addEventListener("submit", onSubmit, true);
  const timer = setInterval(() => {
    if (location.href !== was) say(`changed page to ${location.href.slice(0, 120)}`);
  }, URL_POLL);
  const cap = setTimeout(() => clearInterval(timer), WATCH_CAP);
  return {
    stop() {
      removeEventListener("pagehide", onHide);
      removeEventListener("beforeunload", onHide);
      removeEventListener("popstate", onPop);
      document.removeEventListener("submit", onSubmit, true);
      clearInterval(timer);
      clearTimeout(cap);
      return moved;
    },
  };
}
