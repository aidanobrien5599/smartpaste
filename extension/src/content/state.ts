/**
 * The content script's session: what this frame has learned about the page.
 *
 * Every other module is stateless; anything that must survive between one
 * scan and the next lives here. The reassigned values sit on `state`
 * because an ES module cannot reassign another module's `let`.
 *
 * Depends on: lib/schema.ts, for the `Profile` type of `state.profileCache`.
 */
import type { Profile } from "../lib/schema.ts";

type KnownField = any; // replaced by shared/types in Task 4
type Result = any; // replaced by shared/types in Task 4

export const dateWrappers = new WeakSet<Element>();
export const answers = new WeakMap<Element, Result>(); // field element -> resolved answer
export const asked = new WeakSet<Element>(); // fields sent to Jev, answered or not
export const cycle = new WeakMap<Element, number>(); // field element -> index into alternatives

export const state = {
  known: [] as KnownField[], // [{element, result}] for the autofill button
  scanning: false,
  lastSignature: "",
  filling: false,
  lastSummary: "",
  profileCache: {} as Profile,
};

export const staleMenus = new WeakMap<Element, Set<Element>>(); // field -> menus already open when it opened
