import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coreScopeSlot } from '../../../contracts/core-state';
import type { Keymap } from '../../../contracts/keymap';
import type { PagePart } from '../../../contracts/plugin';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import { PLACEMENT_CHECK_EVENT } from '../../../shared/placement-check';
import {
  dataEmitted,
  noCounts,
  providerManifest,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { keysManifest } from '../manifest';
import { keysPagePart } from './start';

// Help's panel as a scroller that clamps `scrollTop` as an element does, set
// back to 100 of 1000 before each case.
const helpScroller = vi.hoisted(() => {
  let top = 100;
  return {
    scrollHeight: 1000,
    clientHeight: 400,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.min(Math.max(value, 0), 600);
    },
  };
});

vi.mock('./help-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./help-view')>();
  return {
    mountHelpView: (...args: Parameters<typeof actual.mountHelpView>) => ({
      ...actual.mountHelpView(...args),
      scroller: helpScroller,
    }),
  };
});

vi.mock('../../../shared/page/text-line', () => ({
  textLineHeightPx: () => 20,
}));

const KEYMAP: Keymap = {
  editor: { leader: ' ', remaps: [], binds: [] },
  page: [],
  app: [],
  intercept: [],
  global: [],
  groups: {},
};

// The keys part under the harness, over a fake list picker.
function startKeys(
  options: Parameters<typeof startPagePart<typeof keysManifest>>[1] = {},
) {
  return startPagePart(keysPagePart, {
    ...options,
    services: { picker: fakeListPickerService(), ...options.services },
  });
}

// A part whose `pick` command takes a number, recording each arg it runs with.
function pickPart(ran: unknown[]): PagePart {
  return {
    manifest: {
      ...providerManifest('probe'),
      commands: {
        pick: { label: 'pick', group: 'test', runsIn: 'page', arg: 'number' },
      },
    },
    start: () => ({
      commands: { pick: ({ arg }: { arg: unknown }) => ran.push(arg) },
    }),
  };
}

describe('keys page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stops with nothing live and starts again', async () => {
    const harness = startKeys();

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    await harness.restart();
    await harness.stop();
  });

  it('toggleHelp_OpenAndClose_FiresOnOpenOnly', async () => {
    const harness = startKeys();
    const { toggleHelp } = harness.started().commands;

    toggleHelp({ arg: undefined });
    expect(dataEmitted(harness, 'keys.helpOpened')).toEqual([null]);

    toggleHelp({ arg: undefined });
    expect(dataEmitted(harness, 'keys.helpOpened')).toEqual([null]);

    toggleHelp({ arg: undefined });
    expect(dataEmitted(harness, 'keys.helpOpened')).toEqual([null, null]);
    await harness.stop();
  });

  it('stop removes the placement-check listener', async () => {
    const harness = startKeys();
    // The harness stubs its own `document` as it starts, so the spies go on that
    // one and the restart is the start they watch.
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    await harness.restart();
    const listener = added.mock.calls.find(
      ([type]) => type === PLACEMENT_CHECK_EVENT,
    )?.[1];
    removed.mockClear();

    await harness.stop();

    expect(listener).toBeDefined();
    expect(removed).toHaveBeenCalledWith(PLACEMENT_CHECK_EVENT, listener);
  });

  it('start_ScopeSlotChanges_RecordsTheScopeForThePlacementCheck', async () => {
    const harness = startKeys();
    // The harness stubs its own `document` as it starts, so the spy goes on that
    // one and the restart is the start it watches.
    const added = vi.spyOn(document, 'addEventListener');
    await harness.restart();
    const checkPlacement = added.mock.calls.find(
      ([type]) => type === PLACEMENT_CHECK_EVENT,
    )?.[1] as () => void;
    harness.pushKeymap({
      ...KEYMAP,
      page: [{ keys: ['x'], scope: 'other.view', command: 'keys.closeHelp' }],
    });

    harness.state.publish(coreScopeSlot).set('other.view');
    checkPlacement();

    expect(harness.logs.map(({ message }) => message)).toEqual(
      expect.arrayContaining([expect.stringContaining('other.view')]),
    );
    await harness.stop();
  });

  it.each([
    { name: 'on at start, off by a change', start: true, changed: false },
    { name: 'off at start, on by a change', start: false, changed: true },
  ])(
    'start_ShowHintsOff_CallsSetHintsShownFalse ($name)',
    async ({ start, changed }) => {
      const harness = startKeys({
        settings: { ...keysManifest.settings, showHints: start },
      });
      expect(harness.hintsShown()).toBe(start);

      harness.pushSettings({ ...keysManifest.settings, showHints: changed });

      expect(harness.hintsShown()).toBe(changed);
      await harness.stop();
      expect(harness.hintsShown()).toBe(true);
    },
  );

  it.each([
    { command: 'lineDown', line: 'scrolled the key help down a line' },
    { command: 'lineUp', line: 'scrolled the key help up a line' },
    {
      command: 'halfPageDown',
      line: 'scrolled the key help down half a page',
    },
    {
      command: 'halfPageUp',
      line: 'scrolled the key help up half a page to the top',
    },
    { command: 'scrollTop', line: 'scrolled the key help to the top' },
    { command: 'scrollEnd', line: 'scrolled the key help to the end' },
  ] as const)('helpScroll_LogsItsLine ($command)', async ({ command, line }) => {
    helpScroller.scrollTop = 100;
    const harness = startKeys();

    harness.started().commands[command]({ arg: undefined });

    expect(harness.logs.map(({ message }) => message)).toContain(line);
    await harness.stop();
  });

  it('searchLeader_Chosen_RunsTheCommandWithItsArg', async () => {
    const ran: unknown[] = [];
    const harness = startKeys({ parts: [pickPart(ran)] });
    harness.pushKeymap({
      ...KEYMAP,
      editor: { ...KEYMAP.editor, leader: '<Space>' },
      page: [{ keys: [' ', 'p'], scope: 'any', command: 'probe.pick', arg: 2 }],
    });
    const { searchLeader, pickerChoose, pickerCancel } =
      harness.started().commands;

    searchLeader({ arg: undefined });
    pickerChoose({ arg: undefined });
    await vi.waitFor(() => expect(ran).toEqual([2]));
    searchLeader({ arg: undefined });
    pickerCancel({ arg: undefined });

    expect(harness.logs.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        'leader search ran probe.pick 2',
        'picker closed: Leader actions',
      ]),
    );
    await harness.stop();
  });
});
