import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type {
  KeyHints,
  LayoutShow,
  PluginManifest,
  ShowLayoutOptions,
  ShownLayouts,
} from '../../../contracts/plugin';
import { NO_FENCES } from '../markdown-mount.test-support';
import { asHtml, FakeElement, installFakeDom } from '../test-dom';
import type { OwnerKitServices } from './base-kit';
import { noLayoutState } from './fake-layout-state.test-support';
import type { BaseKit } from './kit';
import { ownerLayoutShow } from './owner-show';
import { recordingAnchors, withUser } from './test-layouts';

interface Layout {
  view?(
    parent: HTMLElement,
    input: { text: string },
    kit: BaseKit,
  ): { element: HTMLElement };
}

const MANIFEST: Pick<PluginManifest, 'id' | 'commands' | 'scopes'> = {
  id: 'u',
  commands: { hello: { label: 'Hello', group: 'U', runsIn: 'page' } },
  scopes: { view: 'View' },
};

// A layout whose `view` draws a `div` reading `<label> <text>` and hints
// `hello` in it.
function drawsView(label: string): Layout {
  return {
    view(parent, input, kit) {
      const root = kit.el(parent, 'div', '', `${label} ${input.text}`);
      kit.keyHint(root, 'hello');
      return { element: root };
    },
  };
}

function kitServices(keys: Pick<KeyHints, 'anchor' | 'keysFor'>) {
  const services: OwnerKitServices = {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    keys,
    commands: {
      exists: () => true,
      argShape: () => undefined,
      run: () => undefined,
    },
    platform: 'macos',
    state: noLayoutState,
  };
  return services;
}

// An owner show of `u` over a fake inner show that records the options it
// was handed and its dispose in `steps`.
function setUp({
  keys = recordingAnchors().keys,
  setLayouts = () => undefined,
  steps = [],
}: {
  keys?: Pick<KeyHints, 'anchor' | 'keysFor'>;
  setLayouts?: (shown: ShownLayouts<Layout>) => void;
  steps?: string[];
} = {}) {
  const logged: string[] = [];
  const handed: ShowLayoutOptions<Layout>[] = [];
  const defaultLayout = drawsView('default');
  const show = ownerLayoutShow<Layout>({
    manifest: MANIFEST,
    kit: kitServices(keys),
    log: (message) => logged.push(message),
    options: {
      defaultLayout,
      defaultStylesheet: null,
      read: () => ({}),
      userLayout: () => 'mine',
      setLayouts,
    },
    show(options): LayoutShow {
      handed.push(options);
      return {
        refresh: () => undefined,
        dispose: () => steps.push('inner disposed'),
      };
    },
  });
  // Hands the show a set, as the inner show does on each load.
  const set = (shown: ShownLayouts<Layout>) => handed[0].setLayouts(shown);
  return { show, set, logged, steps, defaultLayout };
}

beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
afterEach(() => vi.unstubAllGlobals());

describe('ownerLayoutShow', () => {
  it.each([
    {
      row: 'before the first set',
      user: null,
      inSetLayouts: false,
      text: 'default t',
      layout: 'default',
      logged: [],
    },
    {
      row: 'a set whose user layout defines the part',
      user: drawsView('mine'),
      inSetLayouts: false,
      text: 'mine t',
      layout: 'mine',
      logged: [],
    },
    {
      row: 'a set whose user layout lacks the part',
      user: {},
      inSetLayouts: false,
      text: 'default t',
      layout: 'default',
      logged: [],
    },
    {
      row: 'a user part that throws',
      user: {
        view() {
          throw new Error('boom');
        },
      } as Layout,
      inSetLayouts: false,
      text: 'default t',
      layout: 'default',
      logged: ['layout mine view failed: boom'],
    },
    {
      row: 'a draw made inside the owners setLayouts',
      user: drawsView('mine'),
      inSetLayouts: true,
      text: 'mine t',
      layout: 'mine',
      logged: [],
    },
  ])(
    'ownerLayoutShow_Draw_PicksTheShownLayoutElseDefault: $row',
    ({ user, inSetLayouts, text, layout, logged }) => {
      const parent = new FakeElement('section');
      const drawn: { text: string | null; layout: string }[] = [];
      const draw = () => {
        const { built, layoutName } = setUpShow.show.draw(
          'view',
          asHtml(parent),
          { text: 't' },
        );
        drawn.push({ text: built.element.textContent, layout: layoutName });
      };
      const setUpShow = setUp({
        setLayouts: () => {
          if (inSetLayouts) {
            draw();
          }
        },
      });

      if (user !== null) {
        setUpShow.set(withUser<Layout>(setUpShow.defaultLayout, user));
      }
      if (!inSetLayouts) {
        draw();
      }

      expect([drawn, setUpShow.logged]).toEqual([[{ text, layout }], logged]);
      expect(parent.children[0].dataset).toMatchObject({
        layout,
        layoutOwner: 'u',
      });
    },
  );

  it.each([
    {
      row: 'scope view',
      scope: 'view',
      anchors: [{ command: 'u.hello', scope: 'u.view' }],
      error: null,
    },
    {
      row: 'no scope',
      scope: undefined,
      anchors: [{ command: 'u.hello', scope: undefined }],
      error: null,
    },
    {
      row: 'a scope the manifest does not declare',
      scope: 'nope',
      anchors: [],
      error: 'Plugin "u" declares no scope "nope"',
    },
  ])(
    'ownerLayoutShow_Draw_KitIsTheOwners: $row',
    ({ scope, anchors, error }) => {
      const recording = recordingAnchors();
      const { show } = setUp({ keys: recording.keys });
      const parent = new FakeElement('section');

      let thrown: string | null = null;
      try {
        show.draw('view', asHtml(parent), { text: 't' }, { scope });
      } catch (caught) {
        thrown = (caught as Error).message;
      }

      expect(thrown).toBe(error);
      expect(
        recording.anchors.map(({ command, scope: anchored }) => ({
          command,
          scope: anchored,
        })),
      ).toEqual(anchors);
      expect(parent.children).toHaveLength(error === null ? 1 : 0);
    },
  );

  it('ownerLayoutShow_Dispose_DisposesKeptDraws', () => {
    const steps: string[] = [];
    let made = 0;
    const keys: Pick<KeyHints, 'anchor' | 'keysFor'> = {
      anchor(_element, _command: CommandId) {
        made += 1;
        const number = made;
        return { dispose: () => steps.push(`anchor ${number} disposed`) };
      },
      keysFor: () => null,
    };
    const setUpShow = setUp({ keys, steps });
    const parent = asHtml(new FakeElement('section'));
    const first = setUpShow.show.draw('view', parent, { text: 'a' });
    setUpShow.show.draw('view', parent, { text: 'b' });
    first.dispose();

    setUpShow.show.dispose();

    expect(steps).toEqual([
      'anchor 1 disposed',
      'anchor 2 disposed',
      'inner disposed',
    ]);
  });

  // Breaks if a draw after the show's dispose is kept with no dispose ever
  // reaching it: its anchors outlive the show.
  it('ownerLayoutShow_DrawAfterDispose_ThrowsAndDrawsNothing', () => {
    const recording = recordingAnchors();
    const { show } = setUp({ keys: recording.keys });
    const parent = new FakeElement('section');
    show.dispose();

    expect(() => show.draw('view', asHtml(parent), { text: 't' })).toThrow(
      'Layout show of "u" is disposed',
    );
    expect([recording.anchors, parent.children]).toEqual([[], []]);
  });
});
