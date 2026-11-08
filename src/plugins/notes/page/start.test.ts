import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, TextEditor } from '../../../contracts/editor';
import type {
  PageCommandContext,
  PageServices,
} from '../../../contracts/plugin';
import {
  noCounts,
  startPagePart,
  type PartCounts,
} from '../../../shared/plugin-part-harness.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import type { SessionRow } from '../../sessions/contract';
import { emptyDraft } from '../draft';
import { noteSessions, notesPagePart } from './start';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';

const NONE_LIVE: PartCounts = noCounts;

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Notes' page part over a keys fake that files each anchor under the part, with
// a main that answers the popup's first reads. `changeBody` types in the body
// box.
function startNotes() {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  let bodyEvents: EditorEvents | null = null;
  const editor = {
    create(_parent: HTMLElement, _doc: string, events: EditorEvents) {
      bodyEvents ??= events;
      return {
        text: () => '',
        setText: () => undefined,
        focus: () => undefined,
        blur: () => undefined,
        destroy: () => undefined,
      } as unknown as TextEditor;
    },
  } as unknown as PageServices['editor'];
  const harness = startPagePart(notesPagePart, {
    services: { editor, picker: fakeListPickerService({ editor }) },
    invoke(method) {
      return Promise.resolve(
        method === 'loadDraft'
          ? { ...emptyDraft(1), fresh: false }
          : { homes: [], message: null },
      );
    },
  });
  return {
    harness,
    changeBody: (text: string) => bodyEvents?.changed(text),
  };
}

describe('notes page part', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {
      state: 'fresh start',
      act: () => Promise.resolve(),
    },
    {
      state: 'an edit waiting on autosave',
      act: async ({ harness, changeBody }: ReturnType<typeof startNotes>) => {
        harness.started().commands.open({} as PageCommandContext);
        await settle();
        changeBody('an edit');
        expect(harness.counts().timers).toBeGreaterThan(0);
      },
    },
  ])('stop_LeavesNoLiveRegistration ($state)', async ({ act }) => {
    const notes = startNotes();
    await act(notes);
    expect(notes.harness.counts().registrations).toBeGreaterThan(0);

    await notes.harness.stop();

    expect(notes.harness.counts()).toEqual(NONE_LIVE);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startNotes();

    await harness.restart();

    expect(Object.keys(harness.started().commands)).toContain('open');
    await harness.stop();
    expect(harness.counts()).toEqual(NONE_LIVE);
  });
});

describe('noteSessions', () => {
  const row = (
    sessionId: string,
    hostSessionId: string | null,
  ): SessionRow => ({
    sessionId,
    label: sessionId,
    project: 'project',
    harness: 'claude',
    marked: false,
    projectDir: `/${sessionId}`,
    hostSessionId,
    titles: { user: null, agent: null, firstMessage: null },
    profileDir: null,
  });
  const noteSession = (sessionId: string, hostSessionId: string) => ({
    sessionId,
    harness: 'claude',
    hostSessionId,
    projectDir: `/${sessionId}`,
  });
  const HELD = new Map([
    ['with-host', row('with-host', 'host-1')],
    ['no-host', row('no-host', null)],
    ['also-host', row('also-host', 'host-2')],
  ]);
  const ROWS = { get: (id: string) => HELD.get(id), all: () => HELD };

  it.each([
    {
      case: 'a row with a host id',
      active: 'also-host',
      selected: noteSession('also-host', 'host-2'),
    },
    { case: 'a row with no host id', active: 'no-host', selected: null },
    { case: 'a row no longer listed', active: 'gone', selected: null },
    { case: 'no active row', active: null, selected: null },
    { case: 'an unwritten active slot', active: undefined, selected: null },
  ])('selectedSession: $case', ({ active, selected }) => {
    const sessions = noteSessions(ROWS, {
      get: () => active as string | null,
    });

    expect(sessions.selectedSession()).toEqual(selected);
  });

  it('sessionRows_RowsWithAHostId_InRowOrder', () => {
    const sessions = noteSessions(ROWS, { get: () => null });

    expect(sessions.sessionRows()).toEqual([
      noteSession('with-host', 'host-1'),
      noteSession('also-host', 'host-2'),
    ]);
  });
});
