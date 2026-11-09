import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShowLayoutOptions } from '../../../../contracts/plugin';
import { noLayoutState } from '../../../../shared/page/layout-host/fake-layout-state.test-support';
import { fakeKitCommandsOf } from '../../../../shared/page/layout-host/fake-kit-commands.test-support';
import { recordingAnchors } from '../../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import type {
  ChipInput,
  CompleteLayout,
  Layout,
  PagePluginApi,
  WorkflowDrawOptions,
} from '../../contract';
import { workflowManifest } from '../../manifest';
import { readWorkflowLayout } from './read-workflow-layout';
import { createWorkflowDraw } from './workflow-draw';

const CHIP_INPUT = { stage: 'build' } as ChipInput;

const DEFAULT_LAYOUT = {
  chip: (parent, _input, kit) => ({ element: kit.el(parent, 'div', 'd') }),
} as CompleteLayout;

// A draw over the manifest `workflow-small` whose api records the show's options.
function setUp() {
  const shows: ShowLayoutOptions<Layout>[] = [];
  const api: PagePluginApi = {
    layouts: {
      show(options) {
        shows.push(options as unknown as ShowLayoutOptions<Layout>);
        return { refresh: () => undefined, dispose: () => undefined };
      },
    },
  };
  const options: WorkflowDrawOptions = {
    manifest: { id: 'workflow-small', commands: {} },
    defaultLayout: DEFAULT_LAYOUT,
    defaultStylesheet: 'small.css',
    userLayout: () => 'mine',
    sideTitle: 'List',
  };
  const redraw = vi.fn();
  const draw = createWorkflowDraw(
    {
      kit: {
        markdown: {
          block: (text) => text,
          inline: (text) => text,
          document: async (text) => text,
          ...NO_FENCES,
        },
        keys: recordingAnchors().keys,
        commands: fakeKitCommandsOf(workflowManifest),
        platform: 'macos',
        state: noLayoutState,
      },
      log: () => undefined,
      clock: { now: () => 0 },
      redraw,
    },
    api,
    options,
  );
  return { draw, shows, redraw };
}

beforeEach(() => installFakeDom(vi.stubGlobal));
afterEach(() => vi.unstubAllGlobals());

describe('createWorkflowDraw', () => {
  it('CreateWorkflowDraw_ShowsThroughTheCallersApi', () => {
    const { shows } = setUp();

    expect(shows).toHaveLength(1);
    expect(shows[0].read).toBe(readWorkflowLayout);
    expect(shows[0].defaultLayout).toBe(DEFAULT_LAYOUT);
    expect(shows[0].defaultStylesheet).toBe('small.css');
    expect(shows[0].userLayout()).toBe('mine');
  });

  it('CreateWorkflowDraw_SetLayouts_StoresAndRedraws', () => {
    const { draw, shows, redraw } = setUp();
    const parent = new FakeElement('div');
    const mine: Layout = {
      chip: (slot, _input, kit) => ({ element: kit.el(slot, 'div', 'x') }),
    };

    shows[0].setLayouts({
      layouts: new Map<string, Layout>([
        ['default', DEFAULT_LAYOUT],
        ['mine', mine],
      ]),
      user: 'mine',
    });
    draw.chip(asHtml(parent), CHIP_INPUT, 's1');

    expect(redraw).toHaveBeenCalledTimes(1);
    expect(findAll(parent, 'x')).toHaveLength(1);
  });

  it('Draw_Root_CarriesOwner', () => {
    const { draw } = setUp();

    const drawn = draw.chip(asHtml(new FakeElement('div')), CHIP_INPUT, 's1');

    expect(asFake(drawn.element).dataset.layoutOwner).toBe('workflow-small');
  });

  it('SideTitle_ComesFromOptions', () => {
    expect(setUp().draw.sideTitle).toBe('List');
  });

  it('Drawn_Dispose_RemovesTheElement', () => {
    const { draw } = setUp();
    const parent = new FakeElement('div');

    draw.chip(asHtml(parent), CHIP_INPUT, 's1').dispose();

    expect(parent.children).toEqual([]);
  });
});
