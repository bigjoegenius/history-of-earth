/** Tiny DOM helpers shared by the UI modules (vanilla TypeScript, no framework). */

export type Child = Node | string | number | false | null | undefined;
export type Props = Record<string, unknown>;

/**
 * Hyperscript-style element factory: h('button', { class: 'x', onclick, 'aria-label': 'Play' }, 'Play').
 *  - `class` sets className; `style` takes an object of CSS properties (custom properties like `--cat` allowed);
 *  - `on<event>` functions become listeners;
 *  - `true` becomes an empty attribute, while `false`, null and undefined are skipped (so `0` still renders);
 *  - everything else is set as an attribute.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) for (const key of Object.keys(props)) setProp(el, key, props[key]);
  el.append(...toNodes(children));
  return el;
}

function setProp(el: HTMLElement, key: string, value: unknown): void {
  if (value === undefined || value === null || value === false) return;
  if (key.startsWith('on') && typeof value === 'function') {
    el.addEventListener(key.slice(2), value as EventListener);
  } else if (key === 'class') {
    el.className = String(value);
  } else if (key === 'style' && typeof value === 'object') {
    for (const [prop, v] of Object.entries(value as Record<string, string>)) el.style.setProperty(prop, v);
  } else {
    el.setAttribute(key, value === true ? '' : String(value));
  }
}

/** Flattens children into appendable nodes, dropping empty values. */
function toNodes(children: (Child | Child[])[]): (Node | string)[] {
  const out: (Node | string)[] = [];
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    out.push(typeof c === 'number' ? String(c) : c);
  }
  return out;
}

/**
 * Makes `parent`'s children exactly `wanted`, in order, touching only nodes that are out of place.
 * Unlike replaceChildren, untouched nodes keep keyboard focus and running CSS animations.
 */
export function reconcile(parent: Element, wanted: readonly Node[]): void {
  const keep = new Set(wanted);
  for (const child of Array.from(parent.childNodes)) if (!keep.has(child)) child.remove();
  wanted.forEach((node, i) => {
    const at = parent.childNodes[i];
    if (at !== node) parent.insertBefore(node, at ?? null);
  });
}

/** Collects teardown callbacks (store subscriptions, listeners, observers) and runs them in reverse. */
export class Disposer {
  private readonly fns: (() => void)[] = [];

  add(fn: () => void): void {
    this.fns.push(fn);
  }

  listen<E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    opts?: AddEventListenerOptions | boolean,
  ): void {
    const listener = fn as unknown as EventListener;
    target.addEventListener(type, listener, opts);
    this.add(() => target.removeEventListener(type, listener, opts));
  }

  dispose(): void {
    while (this.fns.length) this.fns.pop()!();
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Fraction → CSS percentage (4 decimals keeps sub-pixel precision on wide screens). */
export function pct(p: number): string {
  return `${(p * 100).toFixed(4)}%`;
}

/** Sets textContent only when it differs (cheap enough to call every animation frame). */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** True for text inputs and other controls that own the keyboard (shortcuts must not fire there). */
export function isFormField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

/** True when Space/Enter would natively activate the focused element. */
export function isActivatable(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest('button, a[href], summary, [role="button"]') !== null;
}

/**
 * Click handler helper: after a mouse/touch click (detail > 0; keyboard activation has detail 0)
 * drop focus from the clicked button, so that Space goes back to meaning play/pause.
 */
export function blurAfterPointerClick(e: MouseEvent): void {
  if (e.detail > 0 && e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
}

/**
 * Whether the user is currently driving the UI from the keyboard. Panels use it when they close:
 * keyboard users get focus back on whatever opened the panel, while for mouse and touch users focus
 * is simply dropped, so that Space keeps meaning play/pause instead of re-pressing the opener.
 */
let keyboardModality = false;

export function trackInputModality(d: Disposer): void {
  d.listen(window, 'keydown', () => { keyboardModality = true; }, true);
  d.listen(window, 'pointerdown', () => { keyboardModality = false; }, true);
}

export function isKeyboardModality(): boolean {
  return keyboardModality;
}

/**
 * Call when `panel` closes: if focus is inside it, hand focus back to `opener` (captured when the panel
 * opened, only for keyboard users) or drop it, rather than leaving it on a now-inert element.
 */
export function releaseFocus(panel: HTMLElement, opener: HTMLElement | null): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !panel.contains(active)) return;
  if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
  else active.blur();
}

/** localStorage can throw (private mode, blocked cookies); these wrappers degrade to "not stored". */
export function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference simply is not remembered */
  }
}
