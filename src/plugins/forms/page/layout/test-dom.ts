// The DOM surface the forms kits, cards and panes use, for tests that run in
// `node`: `installFakeDom` stubs `document` and `HTMLElement` with it. A
// string appended becomes a text node.
export class FakeElement {
  tagName: string;
  childNodes: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  hidden = false;
  title = '';
  type = '';
  tabIndex = 0;
  innerHTML = '';
  private ownText = '';
  private classes = new Set<string>();

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

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  addEventListener() {}

  scrollIntoView() {}
}

function textNode(text: string): FakeElement {
  const node = new FakeElement('#text');
  node.textContent = text;
  return node;
}

// Stubs the globals through `stubGlobal`, as `vi.stubGlobal`, so the test's
// `vi.unstubAllGlobals` removes them.
export function installFakeDom(
  stubGlobal: (name: string, value: unknown) => void,
) {
  stubGlobal('HTMLElement', FakeElement);
  stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
  });
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
