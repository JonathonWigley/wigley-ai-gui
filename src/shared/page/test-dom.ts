// The DOM surface the page builders and plugin views use, for tests that run
// in `node`: `installFakeDom` stubs `document` and `HTMLElement` with it. A
// string appended becomes a text node; `click` and `fire` run the listeners.
// An element is connected while it or an ancestor has `isPageRoot` set.
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
  title = '';
  type = '';
  tabIndex = 0;
  scrollTop = 0;
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

  click() {
    this.fire('click');
  }

  // Runs the `type` listeners with one event and returns it, so a test reads
  // whether a listener called `preventDefault`.
  fire(type: string): FakeEvent {
    const event: FakeEvent = {
      target: this,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    return event;
  }

  // An empty client rect at the client's origin, as an element with no
  // layout box reports.
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  scrollIntoView() {}
}

// The event `fire` hands each listener.
export interface FakeEvent {
  target: FakeElement;
  defaultPrevented: boolean;
  preventDefault(): void;
}

// An element's inline style; `setProperty` sets a custom property too.
class FakeStyle {
  [name: string]: string | ((name: string, value: string) => void);

  setProperty(name: string, value: string) {
    this[name] = value;
  }
}

function textNode(text: string): FakeElement {
  const node = new FakeElement('#text');
  node.textContent = text;
  return node;
}

// Stubs the DOM globals, a ResizeObserver that never reports included, through
// `stubGlobal`, as `vi.stubGlobal`, so the test's `vi.unstubAllGlobals`
// removes them.
export function installFakeDom(
  stubGlobal: (name: string, value: unknown) => void,
) {
  stubGlobal('HTMLElement', FakeElement);
  stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
  });
  stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
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
  const found: FakeElement[] = [];
  const pending = [...root.children].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.classList.contains(className)) {
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
}

function focusDocument(): FocusFakeDocument {
  return (globalThis as unknown as { document: FocusFakeDocument }).document;
}

// The fake DOM with what focus and text boxes use: an `activeElement` that
// `focus` sets, and that leaves an element as it or an ancestor is removed (as
// a browser blurs a detached element); an input's value and selection; and a
// client rect whose `top` is `rectTop`.
export class FocusFakeElement extends FakeElement {
  value = '';
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  selectionDirection: string | null = null;
  rectTop = 0;

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

  override getBoundingClientRect() {
    return { ...super.getBoundingClientRect(), top: this.rectTop };
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
  };
  stubGlobal('document', doc);
  return doc;
}
