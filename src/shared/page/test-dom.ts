// The DOM surface the page builders and plugin views use, for tests that run
// in `node`: `installFakeDom` stubs `document` and `HTMLElement` with it. A
// string appended becomes a text node; `click` runs the click listeners. An
// element is connected while it or an ancestor has `isPageRoot` set.
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

  // Places `node` before `reference`, a child of this element.
  insertBefore(node: FakeElement, reference: FakeElement) {
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
    for (const listener of this.listeners.get('click') ?? []) {
      listener({ target: this, preventDefault: () => undefined });
    }
  }

  scrollIntoView() {}
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
