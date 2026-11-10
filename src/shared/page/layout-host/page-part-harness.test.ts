import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DrawnLayoutPart,
  PagePart,
  ShownLayouts,
} from '../../../contracts/plugin';
import { definePlugin } from '../../define-plugin';
import { asHtml, FakeElement, installFakeDom } from '../test-dom';
import type { BaseKit } from './kit';
import { startDrawingPagePart } from './page-part-harness.test-support';

interface Layout {
  row?(
    parent: HTMLElement,
    input: { text: string },
    kit: BaseKit,
  ): { element: HTMLElement };
}

const manifest = definePlugin({
  id: 'drawn',
  label: 'drawn',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: { hello: { label: 'Hello', group: 'Drawn', runsIn: 'page' } },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

// A layout whose `row` draws a `div` reading `<label> <text>` and hints
// `hello` in it.
function drawsRow(label: string): Layout {
  return {
    row(parent, input, kit) {
      const root = kit.el(parent, 'div', '', `${label} ${input.text}`);
      kit.keyHint(root, 'hello');
      return { element: root };
    },
  };
}

const defaultLayout = drawsRow('default');

// A part whose start shows `defaultLayout`; `draw` draws `row` into `parent`.
function drawingPart() {
  let draw: (
    parent: HTMLElement,
  ) => DrawnLayoutPart<{ element: HTMLElement }> = () => {
    throw new Error('part not started');
  };
  const part: PagePart<typeof manifest> = {
    manifest,
    start(api) {
      const show = api.layouts.show<Layout>({
        defaultLayout,
        defaultStylesheet: null,
        read: () => ({}),
        userLayout: () => 'mine',
        setLayouts: () => undefined,
      });
      draw = (parent) => show.draw('row', parent, { text: 't' });
      return { commands: { hello() {} } };
    },
  };
  return { part, draw: (parent: HTMLElement) => draw(parent) };
}

beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
afterEach(() => vi.unstubAllGlobals());

describe('startDrawingPagePart', () => {
  it.each<{ row: string; shown: ShownLayouts<Layout> | null; layout: string }>([
    { row: 'no set shown', shown: null, layout: 'default' },
    {
      row: 'a set picking mine',
      shown: {
        layouts: new Map([
          ['default', defaultLayout],
          ['mine', drawsRow('mine')],
        ]),
        user: 'mine',
      },
      layout: 'mine',
    },
  ])(
    'startDrawingPagePart draws a layout part with the layout the show picks: $row',
    ({ shown, layout }) => {
      const { part, draw } = drawingPart();
      const harness = startDrawingPagePart(part);
      const parent = new FakeElement('section');
      if (shown !== null) {
        harness.showLayouts(shown);
      }

      const { layoutName } = draw(asHtml(parent));

      expect([layoutName, parent.children[0].dataset]).toEqual([
        layout,
        expect.objectContaining({ layout, layoutOwner: 'drawn' }),
      ]);
    },
  );

  it('startDrawingPagePart puts the drawn kit key hint in the harness anchors', () => {
    const { part, draw } = drawingPart();
    const harness = startDrawingPagePart(part);

    draw(asHtml(new FakeElement('section')));

    expect(harness.anchors.map(({ command }) => command)).toEqual([
      'drawn.hello',
    ]);
  });
});
