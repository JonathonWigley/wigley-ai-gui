import type { ShownLayouts } from '../../../contracts/plugin';
import { createBaseKit } from '../../../shared/page/layout-host/base-kit';
import { FakeElement, installFakeDom } from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { createDocsParts } from './layout/docs-parts';

// The fake DOM of `test-dom` with what the docs views' focus and text boxes
// use: an `activeElement` that `focus` sets and that leaves an element as it
// or an ancestor is removed (as a browser blurs a detached element), an
// input's value and selection, `prepend`, a client rect at the top, and
// `dispatch`, which runs an event's listeners.
export class DocsFakeElement extends FakeElement {
  value = '';
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  private heard = new Map<string, ((event: unknown) => void)[]>();

  override addEventListener(type: string, listener: (event: unknown) => void) {
    super.addEventListener(type, listener);
    this.heard.set(type, [...(this.heard.get(type) ?? []), listener]);
  }

  dispatch(type: string) {
    for (const listener of this.heard.get(type) ?? []) {
      listener({ target: this, preventDefault: () => undefined });
    }
  }

  focus() {
    fakeDocument().activeElement = this;
  }

  blur() {
    if (fakeDocument().activeElement === this) {
      fakeDocument().activeElement = null;
    }
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  prepend(node: FakeElement) {
    node.remove();
    node.parentNode = this;
    this.childNodes.unshift(node);
  }

  getBoundingClientRect() {
    return { top: 0 };
  }

  override remove() {
    const doc = fakeDocument();
    if (doc.activeElement !== null && this.contains(doc.activeElement)) {
      doc.activeElement = null;
    }
    super.remove();
  }
}

interface FakeDocument {
  activeElement: FakeElement | null;
  createElement(tag: string): FakeElement;
}

function fakeDocument(): FakeDocument {
  return (globalThis as unknown as { document: FakeDocument }).document;
}

// Stubs the DOM globals through `stubGlobal`, as `vi.stubGlobal`, with
// `document` making DocsFakeElements.
export function installDocsFakeDom(
  stubGlobal: (name: string, value: unknown) => void,
) {
  installFakeDom(stubGlobal);
  const document: FakeDocument = {
    activeElement: null,
    createElement: (tag: string) => new DocsFakeElement(tag),
  };
  stubGlobal('document', document);
}

// The set a page shows with `user` as the setting's layout, holding
// `default` and each of `layouts`.
export function shownLayouts(
  user: string,
  layouts: Record<string, Layout> = {},
): ShownLayouts<Layout> {
  return {
    layouts: new Map<string, Layout>([
      ['default', defaultLayout],
      ...Object.entries(layouts),
    ]),
    user,
  };
}

// One key anchor a fake kit named.
export interface FakeAnchor {
  command: string;
  isDisposed: boolean;
}

// A part drawer over the layouts `layouts` returns at each draw, whose kits
// name every short command as `docs.<name>`. `anchors` holds each anchor a
// draw named and `logs` each line logged.
export function fakeDocsParts(layouts: () => ShownLayouts<Layout>) {
  const anchors: FakeAnchor[] = [];
  const logs: string[] = [];
  const parts = createDocsParts({
    layouts,
    defaultLayout,
    baseKit: (scope, rollback) =>
      createBaseKit({
        markdown: {
          block: (text) => text,
          inline: (text) => text,
          document: async (text) => text,
        },
        keys: {
          anchor(_element, command) {
            const named: FakeAnchor = { command, isDisposed: false };
            anchors.push(named);
            const anchor = {
              dispose: () => {
                named.isDisposed = true;
              },
            };
            rollback.recordAnchor(anchor);
            return anchor;
          },
          keysFor: () => null,
        },
        commands: { exists: () => true, run: () => undefined },
        scope: `docs.${scope}`,
        commandNamed: (short) => `docs.${short}`,
        platform: 'macos',
      }),
    log: (_source, message) => logs.push(message),
  });
  return { parts, anchors, logs };
}

// A view anchor that names nothing.
export const noAnchor = () => ({ dispose: () => undefined });

// A scope push that pops and hears nothing.
export const fakePushedScope = () => ({
  pop: () => undefined,
  onBaseChanged: () => undefined,
});
