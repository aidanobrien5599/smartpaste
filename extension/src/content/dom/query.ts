/**
 * Low-level DOM plumbing: finding elements (including inside shadow roots),
 * synthetic input events, and the small timing helpers a fill waits on.
 *
 * ATS quirks: `deepAll` looks inside open shadow roots because
 * SmartRecruiters draws every control as a web component with one, which
 * `querySelectorAll` never enters on its own. `click` fires pointer events
 * before the mouse events because Workday's pickers act on pointerdown.
 *
 * Depends on nothing else in content/; every other module builds on this one.
 */

// SmartRecruiters draws every control as a web component with an open
// shadow root, and document.querySelectorAll never looks inside one: its
// one-click form read as a page with no fields at all.
export function deepAll(selector: string, root: ParentNode = document): Element[] {
  const out = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll("*")) if (el.shadowRoot) out.push(...deepAll(selector, el.shadowRoot));
  return out;
}

/* ------------------------------------------------------------- comboboxes */

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const fire: (node: Element, type: string) => boolean = (node, type) =>
  node.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
  );

/* ------------------------------------------------------- workday widgets */

export const frames = (n: number): Promise<void> => new Promise((resolve) => {
  const step = () => (--n > 0 ? requestAnimationFrame(step) : resolve());
  requestAnimationFrame(step);
});

export function press(field: Element, key: string, keyCode: number): void {
  for (const type of ["keydown", "keypress", "keyup"]) {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { get: () => keyCode });
    Object.defineProperty(event, "which", { get: () => keyCode });
    field.dispatchEvent(event);
  }
}

export function scroller(node: Element): Element | null {
  for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** A whole click, pointer events included: Workday's pickers act on pointerdown. */
export function click(node: Element): void {
  const pointer = (type: string) => node.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, view: window, pointerType: "mouse", isPrimary: true, button: 0,
  }));
  pointer("pointerdown");
  fire(node, "mousedown");
  pointer("pointerup");
  fire(node, "mouseup");
  fire(node, "click");
}
