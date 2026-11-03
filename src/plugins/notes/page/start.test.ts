import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, TextEditor } from '../../../contracts/editor';
import type {
  PageCommandContext,
  PageServices,
} from '../../../contracts/plugin';
import {
  fakeDependency,
  type PartCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import { type KeysPageExports, keysPageKey } from '../../keys/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import { emptyDraft } from '../draft';
import { notesPagePart } from './start';

const NONE_LIVE: PartCounts = {
  registrations: 0,
  timers: 0,
  listeners: 0,
  observers: 0,
  frames: 0,
};

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
    dependencies: [
      fakeDependency(sessionsPageKey, () => ({}) as SessionsPageExports),
      fakeDependency(
        keysPageKey,
        (consumer) =>
          ({
            anchor: () => consumer.track({ dispose: () => undefined }),
            keysFor: () => null,
          }) as unknown as KeysPageExports,
      ),
    ],
    services: { editor },
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
