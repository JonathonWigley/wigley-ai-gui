// The DOM surface the page builders and plugin views use, for tests that run
// in `node`: `installFakeDom` stubs `document`, `window` and `HTMLElement` with
// it. A string appended becomes a text node; `click` and `fire` run the
// listeners, and `bubble` runs them up the parent chain. An element is
// connected while it or an ancestor has `isPageRoot` set.
// `installFocusFakeDom` opts into focus, text selection and scroll resets.
export class FakeElement {
  tagName: string;
  childNodes: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  isPageRoot = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style = new FakeStyle();
  hidden = false;
  inert = false;
  title = '';
  type = '';
  tabIndex = 0;
  scrollTop = 0;
  // Whether `getClientRects` reports a layout box.
  hasLayoutBox = false;
  innerHTML = '';
  private ownText = '';
  private classes = new Set<string>();
  private listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get className(): string {
    return [...this.classes].join(' ');
  }

  set className(value: string) {
    this.classes = new Set(value.split(' ').filter((name) => name !== ''));
  }

  get classList() {
    const classes = this.classes;
    return {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) =>
        names.forEach((name) => classes.delete(name)),
      contains: (name: string) => classes.has(name),
      toggle(name: string, force?: boolean) {
        const isOn = force ?? !classes.has(name);
        if (isOn) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return isOn;
      },
    };
  }

  get isConnected(): boolean {
    if (this.isPageRoot) {
      return true;
    }
    let node = this.parentNode;
    while (node !== null && !node.isPageRoot) {
      node = node.parentNode;
    }
    return node !== null;
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node) => node.tagName !== '#TEXT');
  }

  get lastElementChild(): FakeElement | null {
    return this.children.at(-1) ?? null;
  }

  get nextElementSibling(): FakeElement | null {
    const siblings = this.parentNode?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousElementSibling(): FakeElement | null {
    const siblings = this.parentNode?.children ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  get textContent(): string {
    return (
      this.ownText + this.childNodes.map((node) => node.textContent).join('')
    );
  }

  set textContent(value: string) {
    this.replaceChildren();
    this.ownText = value;
  }

  append(...nodes: (FakeElement | string)[]) {
    for (const node of nodes) {
      const child = typeof node === 'string' ? textNode(node) : node;
      child.remove();
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }

  prepend(...nodes: (FakeElement | string)[]) {
    const made = nodes.map((node) =>
      typeof node === 'string' ? textNode(node) : node,
    );
    for (const node of made) {
      node.remove();
    }
    const rest = this.childNodes;
    this.childNodes = [];
    this.append(...made);
    this.childNodes.push(...rest);
  }

  // Puts `node` in this element's place in its parent.
  replaceWith(node: FakeElement) {
    const parent = this.parentNode;
    if (parent !== null) {
      parent.insertBefore(node, this);
      this.remove();
    }
  }

  // Places `node` before `reference`, a child of this element; at the end
  // when `reference` is null.
  insertBefore(node: FakeElement, reference: FakeElement | null) {
    if (reference === null) {
      this.append(node);
      return;
    }
    node.remove();
    node.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(reference), 0, node);
  }

  replaceChildren(...nodes: (FakeElement | string)[]) {
    for (const child of this.childNodes) {
      child.remove();
    }
    this.ownText = '';
    this.append(...nodes);
  }

  remove() {
    const parent = this.parentNode;
    if (parent !== null) {
      parent.childNodes = parent.childNodes.filter((node) => node !== this);
      this.parentNode = null;
    }
  }

  // True for this element and each element under it.
  contains(node: unknown): boolean {
    let current = node instanceof FakeElement ? node : null;
    while (current !== null && current !== this) {
      current = current.parentNode;
    }
    return current === this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((held) => held !== listener),
    );
  }

  // Takes only class selectors such as `.ui-row.is-selected`.
  querySelector(selector: string): FakeElement | null {
    const classes = selector.split('.').filter((name) => name !== '');
    const [first, ...rest] = classes;
    return (
      findAll(this, first).find((node) =>
        rest.every((name) => node.classList.contains(name)),
      ) ?? null
    );
  }

  // Takes one tag name such as `details`, one class selector such as
  // `.md-fence` or one data attribute selector such as `[data-md-lines]`, read
  // from `dataset`; every match under this element, depth first.
  querySelectorAll(selector: string): FakeElement[] {
    return collectUnder(this, (node) => matchesSelector(node, selector));
  }

  // Where `other` sits from this element, as the DOM's position bits: 4 when it
  // follows, 2 when it precedes, with 16 when this element contains it and 8
  // when it contains this element; 1 in another tree, 0 for this element.
  compareDocumentPosition(other: FakeElement): number {
    if (other === this) {
      return 0;
    }
    if (this.contains(other)) {
      return 16 | 4;
    }
    if (other.contains(this)) {
      return 8 | 2;
    }
    const mine = ancestry(this);
    const theirs = ancestry(other);
    if (mine[0] !== theirs[0]) {
      return 1;
    }
    let depth = 1;
    while (mine[depth] === theirs[depth]) {
      depth++;
    }
    const siblings = mine[depth - 1].childNodes;
    return siblings.indexOf(theirs[depth]) > siblings.indexOf(mine[depth])
      ? 4
      : 2;
  }

  // Takes a comma list of tag names, class selectors and data attribute
  // selectors; this element or the nearest one over it matching any of them.
  closest(selector: string): FakeElement | null {
    const alternatives = selector.split(',').map((part) => part.trim());
    const isMatch = (node: FakeElement) =>
      alternatives.some((part) => matchesSelector(node, part));
    if (isMatch(this)) {
      return this;
    }
    let node = this.parentNode;
    while (node !== null && !isMatch(node)) {
      node = node.parentNode;
    }
    return node;
  }

  click() {
    this.fire('click');
  }

  // Runs the `type` listeners with one event, carrying `fields` too (a `target`
  // among them stands for a bubbled event), and returns it, so a test reads
  // whether a listener called `preventDefault`.
  fire(type: string, fields: Record<string, unknown> = {}): FakeEvent {
    const event = fakeEvent(this, fields);
    this.runListeners(type, event);
    return event;
  }

  // Dispatches a bubbling `type` event at this element: the listeners of this
  // element, then of each element over it as the dispatch found them, so a
  // listener that detaches this element still lets the event reach its old
  // ancestors.
  bubble(type: string): FakeEvent {
    const event = fakeEvent(this, {});
    for (const node of event.composedPath()) {
      node.runListeners(type, event);
    }
    return event;
  }

  private runListeners(type: string, event: FakeEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  // An empty client rect at the client's origin, as an element with no
  // layout box reports.
  getBoundingClientRect(): FakeRect {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  // One rect while `hasLayoutBox` is set, else none, as an element with no
  // layout box (`display: none` on it or an ancestor) reports.
  getClientRects(): FakeRect[] {
    return this.hasLayoutBox ? [this.getBoundingClientRect()] : [];
  }

  scrollIntoView() {}
}

// A client rect; a fake that sets its own may leave out `right` and `bottom`.
export interface FakeRect {
  left: number;
  top: number;
  right?: number;
  bottom?: number;
  width: number;
  height: number;
}

// The event `fire` and `bubble` hand each listener. `composedPath` is the
// target and each element over it at dispatch, as a real event fixes it.
export interface FakeEvent {
  target: FakeElement;
  defaultPrevented: boolean;
  preventDefault(): void;
  composedPath(): FakeElement[];
}

// An event at `origin`, or at a `target` among `fields`, carrying the rest of
// `fields` too; a stand-in `target` that is no element has an empty path.
function fakeEvent(
  origin: FakeElement,
  fields: Record<string, unknown>,
): FakeEvent {
  const path: FakeElement[] = [];
  const event: FakeEvent = {
    target: origin,
    ...fields,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    composedPath: () => [...path],
  };
  const pathStart = event.target instanceof FakeElement ? event.target : null;
  for (let node = pathStart; node !== null;) {
    path.push(node);
    node = node.parentNode;
  }
  return event;
}

// An element's inline style; `setProperty` sets a custom property too.
class FakeStyle {
  [name: string]: string | ((name: string, value: string) => void);

  setProperty(name: string, value: string) {
    this[name] = value;
  }
}

// Whether `node` matches one tag name, class selector or data attribute selector.
function matchesSelector(node: FakeElement, selector: string): boolean {
  if (selector.startsWith('.')) {
    return node.classList.contains(selector.slice(1));
  }
  const dataName = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1];
  if (dataName === undefined) {
    return node.tagName === selector.toUpperCase();
  }
  const key = dataName.replace(/-([a-z])/g, (_dash, letter: string) =>
    letter.toUpperCase(),
  );
  return node.dataset[key] !== undefined;
}

// `node` and every element over it, the root first.
function ancestry(node: FakeElement): FakeElement[] {
  const chain: FakeElement[] = [];
  for (let at: FakeElement | null = node; at !== null; at = at.parentNode) {
    chain.unshift(at);
  }
  return chain;
}

function textNode(text: string): FakeElement {
  const node = new FakeElement('#text');
  node.textContent = text;
  return node;
}

// The fake `window`: `getSelection` reports whether the selection is collapsed,
// which a test sets through `isSelectionCollapsed`.
export class FakeWindow extends FakeElement {
  isSelectionCollapsed = true;

  getSelection() {
    return { isCollapsed: this.isSelectionCollapsed };
  }
}

// The `window` `installFakeDom` stubbed.
export function fakeWindow(): FakeWindow {
  return (globalThis as unknown as { window: FakeWindow }).window;
}

// Stubs the DOM globals, a ResizeObserver that never reports included, through
// `stubGlobal`, as `vi.stubGlobal`, so the test's `vi.unstubAllGlobals`
// removes them.
export function installFakeDom(
  stubGlobal: (name: string, value: unknown) => void,
) {
  stubGlobal('HTMLElement', FakeElement);
  stubGlobal('window', new FakeWindow('window'));
  stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_namespace: string, tag: string) => new FakeElement(tag),
  });
  stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

export function asHtml(node: FakeElement): HTMLElement {
  return node as unknown as HTMLElement;
}

export function asFake(node: HTMLElement): FakeElement {
  return node as unknown as FakeElement;
}

// Every element under `root`, depth first, whose classes include `className`.
export function findAll(root: FakeElement, className: string): FakeElement[] {
  return collectUnder(root, (node) => node.classList.contains(className));
}

function collectUnder(
  root: FakeElement,
  isMatch: (node: FakeElement) => boolean,
): FakeElement[] {
  const found: FakeElement[] = [];
  const pending = [...root.children].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (isMatch(node)) {
      found.push(node);
    }
    pending.push(...[...node.children].reverse());
  }
  return found;
}

// The fake document `installFocusFakeDom` stubs.
export interface FocusFakeDocument {
  activeElement: FakeElement | null;
  createElement(tag: string): FakeElement;
  createElementNS(namespace: string, tag: string): FakeElement;
}

function focusDocument(): FocusFakeDocument {
  return (globalThis as unknown as { document: FocusFakeDocument }).document;
}

// The fake DOM with what focus and text boxes use: an `activeElement` that
// `focus` sets, and that leaves an element as it or an ancestor is removed (as
// a browser blurs a detached element); an input's value and selection; and a
// client rect whose `top` is `rectTop` and whose height is `rectHeight`.
export class FocusFakeElement extends FakeElement {
  value = '';
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  selectionDirection: string | null = null;
  rectTop = 0;
  rectHeight = 0;

  focus() {
    focusDocument().activeElement = this;
  }

  blur() {
    const doc = focusDocument();
    if (doc.activeElement === this) {
      doc.activeElement = null;
    }
  }

  select() {
    this.setSelectionRange(0, this.value.length);
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  override getBoundingClientRect(): FakeRect {
    return {
      ...super.getBoundingClientRect(),
      top: this.rectTop,
      bottom: this.rectTop + this.rectHeight,
      height: this.rectHeight,
    };
  }

  override remove() {
    const doc = focusDocument();
    if (doc.activeElement !== null && this.contains(doc.activeElement)) {
      doc.activeElement = null;
    }
    super.remove();
  }
}

// A FocusFakeElement whose `scrollTop`, and that of every scroller under it,
// goes back to 0 as it is detached, as a browser drops a removed box's
// scroll.
export class ScrollerFakeElement extends FocusFakeElement {
  override remove() {
    const wasAttached = this.parentNode !== null;
    super.remove();
    if (wasAttached) {
      resetScroll(this);
    }
  }
}

// A ScrollerFakeElement whose leaving also sets the scroll of every element
// over it back to 0, as a browser clamps a scroller's scroll when its content
// shrinks; it catches a scroll lost while the scroller itself stays attached.
export class ShrinkingScrollerFakeElement extends ScrollerFakeElement {
  override remove() {
    for (let node = this.parentNode; node !== null; node = node.parentNode) {
      node.scrollTop = 0;
    }
    super.remove();
  }
}

function resetScroll(root: FakeElement): void {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node instanceof ScrollerFakeElement) {
      node.scrollTop = 0;
    }
    pending.push(...node.children);
  }
}

// Stubs the DOM globals as `installFakeDom` does, with `document` making
// `Element`s (FocusFakeElement unless given; pass ScrollerFakeElement or
// ShrinkingScrollerFakeElement for scroll resets) and holding the
// `activeElement` they set.
export function installFocusFakeDom(
  stubGlobal: (name: string, value: unknown) => void,
  Element: new (tag: string) => FocusFakeElement = FocusFakeElement,
): FocusFakeDocument {
  installFakeDom(stubGlobal);
  const doc: FocusFakeDocument = {
    activeElement: null,
    createElement: (tag) => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
  };
  stubGlobal('document', doc);
  return doc;
}
