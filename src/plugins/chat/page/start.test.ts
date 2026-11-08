import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coreScopeSlot } from '../../../contracts/core-state';
import type { ChatEntry, ChatImage } from '../../../contracts/agent';
import type { EditorEvents, EditorHost } from '../../../contracts/editor';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { asFake, findAll, installFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  sessionsActiveSlot,
  type SessionRow,
  sessionsRowsSlot,
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  chatCommandsSlot,
  chatControlsSlot,
  chatDraftImagesSlot,
  chatEntriesSlot,
  type ChatPlace,
  chatPlaceSlot,
  type ChatPageExports,
  chatQueuedSlot,
  chatReturnedSlot,
  type ChatSessionInfo,
  type ChatSessionState,
  chatSessionSlot,
} from '../contract';
import { chatPagePart } from './start';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';

const ROW = sessionRow('s1', { label: 'row', hostSessionId: 'host-1' });

const SESSION: ChatSessionState = {
  sessionId: 's1',
  projectDir: '/p',
  profile: 'work',
  entries: [],
  controls: [],
  activity: 'idle',
  background: 0,
  activeTime: { totalMs: 0, since: null },
  commands: [],
  running: false,
  queued: [],
  compaction: null,
  returned: [],
  repo: 'p',
  branch: null,
  worktrees: [],
};

const notice = (id: string): ChatEntry => ({
  kind: 'notice',
  id,
  at: 1000,
  text: 'hi',
  tone: 'info',
  raw: [],
});

const PNG: ChatImage = { mediaType: 'image/png', data: 'cG5n' };

// One box an editor made: `type` changes its text as the user does.
interface FakeBox {
  text: string;
  type(text: string): void;
}

// Chat's page part on the part harness, over a sessions fake that files each tab
// with `consumer.track`, as its view does. `destroyEditor` is
// each editor's `destroy`, `setActivity` the fake's row activity call, and
// `tabAdded` hears each added tab's element. `boxes` gets each box made, in
// order, and `invoked` each call to main.
function startChatPage(
  destroyEditor: () => void = () => undefined,
  isTabVisible: () => boolean = () => false,
  setActivity: SessionsPageExports['setActivity'] = () => undefined,
  tabAdded: (element: HTMLElement) => void = () => undefined,
  {
    boxes = [],
    invoked = [],
  }: { boxes?: FakeBox[]; invoked?: unknown[][] } = {},
) {
  return startPagePart(chatPagePart, {
    invoke: (...args: unknown[]) => {
      invoked.push(args);
      return Promise.resolve();
    },
    services: {
      picker: fakeListPickerService(),
      editor: {
        create: (_parent: HTMLElement, text: string, events: EditorEvents) => {
          const box: FakeBox = {
            text,
            type(next) {
              box.text = next;
              events.changed(next);
            },
          };
          boxes.push(box);
          return {
            text: () => box.text,
            setText(next: string) {
              box.text = next;
            },
            destroy: destroyEditor,
            focus() {},
          };
        },
      } as unknown as EditorHost,
      markdown: {
        block: (text: string) => text,
        inline: (text: string) => text,
        document: (text: string) => Promise.resolve(text),
        ...NO_FENCES,
      },
    },
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addTab: (_sessionId: string, tab: { element: HTMLElement }) => {
              tabAdded(tab.element);
              return consumer.track({
                dispose() {},
                select() {},
                isVisible: isTabVisible,
              });
            },
            addRowPart: () => consumer.track({ dispose() {} }),
            activate() {},
            setActivity,
          }) as unknown as SessionsPageExports,
      ),
    ],
  });
}

// Writes `states` to chat's slots as main holds them, then tells the part the page
// is ready, so it draws a tab for each. Returns the writer of `chat.session`.
function loadSessions(
  harness: ReturnType<typeof startChatPage>,
  states: ChatSessionState[],
) {
  const session = harness.state.publish(chatSessionSlot);
  const entriesSlot = harness.state.publish(chatEntriesSlot);
  const controlsSlot = harness.state.publish(chatControlsSlot);
  const commandsSlot = harness.state.publish(chatCommandsSlot);
  const queuedSlot = harness.state.publish(chatQueuedSlot);
  const returnedSlot = harness.state.publish(chatReturnedSlot);
  for (const state of states) {
    const { entries, controls, commands, queued, returned, ...info } = state;
    entriesSlot.replace(state.sessionId, entries);
    controlsSlot.set(state.sessionId, controls);
    commandsSlot.set(state.sessionId, commands);
    queuedSlot.set(state.sessionId, queued);
    returnedSlot.set(state.sessionId, returned);
    session.set(state.sessionId, info);
  }
  harness.emit('core.pageReady', null);
  return session;
}

// Stops the page, leaves `places` and `images` in chat's place slots as the last
// page's, and starts it again.
async function reloadWith(
  harness: ReturnType<typeof startChatPage>,
  places: Record<string, ChatPlace>,
  images: Record<string, readonly ChatImage[]>,
) {
  await harness.stop();
  const placeSeed = harness.state.publish(chatPlaceSlot);
  for (const [sessionId, place] of Object.entries(places)) {
    placeSeed.set(sessionId, place);
  }
  placeSeed.dispose();
  const imagesSeed = harness.state.publish(chatDraftImagesSlot);
  for (const [sessionId, held] of Object.entries(images)) {
    imagesSeed.set(sessionId, held);
  }
  imagesSeed.dispose();
  await harness.restart();
}

const placeWith = (draft: string): ChatPlace => ({
  draft,
  focus: { stopId: null, following: true, anchorId: null },
  openRuns: [],
  openExpanders: {},
});

// The session ids each place slot holds keys for.
const placeKeys = (harness: ReturnType<typeof startChatPage>) => ({
  places: [...harness.state.read(chatPlaceSlot, 'test').all().keys()],
  images: [...harness.state.read(chatDraftImagesSlot, 'test').all().keys()],
});

// Lets a command run's settling handlers go.
async function flushRuns() {
  for (let turn = 0; turn < 5; turn++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat page part', () => {
  it.each(['fresh start', 'one tab held'])(
    'stop_LeavesNoLiveRegistration: %s',
    async (row) => {
      const harness = startChatPage();
      if (row === 'one tab held') {
        loadSessions(harness, [SESSION]);
        expect(harness.counts().observers).toBeGreaterThan(0);
      }

      await harness.stop();

      expect(harness.counts()).toEqual(noCounts);
    },
  );

  it('stop_OneTabsDestroyThrows_TearsDownEveryTab', async () => {
    const destroyEditor = vi.fn<() => void>();
    destroyEditor.mockImplementationOnce(() => {
      throw new Error('box gone');
    });
    const harness = startChatPage(destroyEditor);
    loadSessions(harness, [SESSION, { ...SESSION, sessionId: 's2' }]);
    expect(harness.counts().observers).toBeGreaterThan(0);

    await expect(harness.stop()).rejects.toThrow('box gone');

    expect(harness.counts()).toEqual(noCounts);
  });

  it('sessionRemoved_HeldTab_DestroysItsBoxOnce', async () => {
    const destroyEditor = vi.fn<() => void>();
    const harness = startChatPage(destroyEditor);
    loadSessions(harness, [SESSION]);

    const rows = harness.state.publish(sessionsRowsSlot);
    rows.set(SESSION.sessionId, ROW);
    rows.delete(SESSION.sessionId);

    expect(destroyEditor).toHaveBeenCalledOnce();
    await harness.stop();
  });

  it.each<{
    case: string;
    act(
      harness: ReturnType<typeof startChatPage>,
      rows: KeyedSlotWriter<SessionRow>,
    ): void;
  }>([
    {
      case: 'the session becomes active',
      act: (harness) => harness.state.publish(sessionsActiveSlot).set('s1'),
    },
    {
      case: 'the row changes host id',
      act: (_harness, rows) =>
        rows.set('s1', { ...ROW, hostSessionId: 'host-2' }),
    },
  ])('unseenTurn_ClearsRowActivity: $case', async ({ act }) => {
    const words: (string | undefined)[] = [];
    const harness = startChatPage(
      () => undefined,
      () => false,
      (_sessionId, _source, activity) => words.push(activity?.word),
    );
    const rows = harness.state.publish(sessionsRowsSlot);
    rows.set('s1', ROW);
    const session = loadSessions(harness, [{ ...SESSION, running: true }]);
    const info = session.get('s1') as ChatSessionInfo;
    session.set('s1', { ...info, activity: 'working' });
    session.set('s1', { ...info, activity: 'idle' });
    expect(words.at(-1)).toBe('done');

    act(harness, rows);

    expect(words.at(-1)).toBeUndefined();
    await harness.stop();
  });

  it('start_ScopeSlotChanges_TellsTabStops', async () => {
    let isTabVisible = true;
    const harness = startChatPage(
      () => undefined,
      () => isTabVisible,
    );
    const leave = vi.fn<() => void>();
    const view = harness
      .started()
      .exports?.(createRegistrations()) as ChatPageExports;
    view.addComposerPart({
      id: 'part',
      build: () => ({}),
      stop: { enter: () => true, leave },
    });
    loadSessions(harness, [SESSION]);
    harness.started().commands.nextEntry({ arg: undefined });
    const scope = harness.state.publish(coreScopeSlot);

    scope.set('other.view');
    expect(leave).not.toHaveBeenCalled();

    isTabVisible = false;
    scope.set('another.view');
    expect(leave).toHaveBeenCalledOnce();
    await harness.stop();
  });

  it('sectionHead_Click_RunsToggleSectionAndCollapsesThePart', async () => {
    const tabs: HTMLElement[] = [];
    const harness = startChatPage(
      () => undefined,
      () => false,
      () => undefined,
      (element) => tabs.push(element),
    );
    loadSessions(harness, [SESSION]);
    const [head] = findAll(asFake(tabs[0]), 'chat-side-section-head');

    head.click();
    await flushRuns();

    expect(harness.logs).toContainEqual({
      source: 'chat',
      message: 'section Main agent collapsed',
    });
    await harness.stop();
  });

  it('reload_restores_draft_images_and_place', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingBottom: '0px' }));
    const boxes: FakeBox[] = [];
    const invoked: unknown[][] = [];
    const harness = startChatPage(
      () => undefined,
      () => true,
      () => undefined,
      () => undefined,
      { boxes, invoked },
    );
    harness.state.publish(sessionsRowsSlot).set('s1', ROW);
    const session = loadSessions(harness, [
      { ...SESSION, entries: [notice('n1'), notice('n2')] },
    ]);
    // The tab's box is the last made: the dialogs make theirs at start.
    boxes.at(-1)?.type('typed before the reload');
    harness.started().commands.prevEntry({ arg: undefined });

    await reloadWith(harness, {}, { s1: [PNG] });
    harness.emit('core.pageReady', null);
    const info = session.get('s1') as ChatSessionInfo;
    session.set('s1', { ...info, running: true });

    expect(
      harness.state.read(chatPlaceSlot, 'test').get('s1')?.focus.stopId,
    ).toBe('n1');
    invoked.length = 0;
    harness.started().commands.send({ arg: undefined });
    expect(invoked).toContainEqual([
      'send',
      's1',
      { text: 'typed before the reload', images: [PNG] },
    ]);
    await harness.stop();
  });

  it('row_removed_clears_the_place', async () => {
    const harness = startChatPage();
    await reloadWith(harness, { s1: placeWith('draft') }, { s1: [PNG] });
    const rows = harness.state.publish(sessionsRowsSlot);
    rows.set('s1', ROW);
    loadSessions(harness, [SESSION]);
    expect(placeKeys(harness)).toEqual({ places: ['s1'], images: ['s1'] });

    rows.delete('s1');

    expect(placeKeys(harness)).toEqual({ places: [], images: [] });
    await harness.stop();
  });

  it('row_gone_during_reload_is_pruned', async () => {
    const harness = startChatPage();
    await reloadWith(
      harness,
      { s1: placeWith('kept'), gone: placeWith('gone') },
      { s1: [PNG], gone: [PNG] },
    );
    harness.state.publish(sessionsRowsSlot).set('s1', ROW);

    harness.emit('core.pageReady', null);

    expect(placeKeys(harness)).toEqual({ places: ['s1'], images: ['s1'] });
    await harness.stop();
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startChatPage();

    await harness.restart();

    expect(harness.started().exports).toBeTypeOf('function');
  });

  it.each([
    {
      member: 'addSlashCommand',
      add: (view: ChatPageExports) =>
        view.addSlashCommand({ name: 'same', run: () => undefined } as never),
    },
    {
      member: 'addComposerPart',
      add: (view: ChatPageExports) =>
        view.addComposerPart({ id: 'same', build: () => ({}) }),
    },
    {
      member: 'addStatusPart',
      add: (view: ChatPageExports) =>
        view.addStatusPart({ id: 'same', build: () => ({}) }),
    },
  ])('exports_ConsumerDisposed_FreesTheName: $member', ({ add }) => {
    const harness = startChatPage();
    const viewOf = (consumer: ReturnType<typeof createRegistrations>) =>
      harness.started().exports?.(consumer) as ChatPageExports;
    const first = createRegistrations();
    add(viewOf(first));

    first.dispose();

    expect(() => add(viewOf(createRegistrations()))).not.toThrow();
  });
});
