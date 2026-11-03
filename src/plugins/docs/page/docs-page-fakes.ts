import type { ShownLayouts } from '../../../contracts/plugin';
import {
  createBaseKit,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  type FakeElement,
  ScrollerFakeElement,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { docsManifest } from '../manifest';
import { createDocsParts } from './layout/docs-parts';

// A ScrollerFakeElement whose `querySelectorAll` also takes one data
// attribute selector (`[data-source-line]`), as the doc pane finds its source
// blocks.
export class SourceLineFakeElement extends ScrollerFakeElement {
  override querySelectorAll(selector: string): FakeElement[] {
    if (selector.startsWith('.')) {
      return super.querySelectorAll(selector);
    }
    const name = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1];
    if (name === undefined) {
      throw new Error(`unsupported selector ${selector}`);
    }
    const key = name.replace(/-([a-z])/g, (_dash, letter: string) =>
      letter.toUpperCase(),
    );
    const found: FakeElement[] = [];
    const pending = [...this.children].reverse();
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (Object.hasOwn(node.dataset, key)) {
        found.push(node);
      }
      pending.push(...[...node.children].reverse());
    }
    return found;
  }
}

// A part drawer over the layouts `layouts` returns, its base kits built as
// the page builds them. `anchors` holds each anchor a draw named and `logs`
// each line logged.
export function fakeDocsParts(layouts: () => ShownLayouts<Layout>) {
  const { anchors, keys } = recordingAnchors();
  const logs: string[] = [];
  const parts = createDocsParts({
    layouts,
    defaultLayout,
    baseKit: (scope, rollback) =>
      createBaseKit(
        ownerBaseKitDeps(
          docsManifest,
          {
            markdown: {
              block: (text) => text,
              inline: (text) => text,
              document: async (text) => text,
              ...NO_FENCES,
            },
            keys,
            commands: { exists: () => true, run: () => undefined },
            platform: 'macos',
          },
          scope,
          rollback,
        ),
      ),
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
