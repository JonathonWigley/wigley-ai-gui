import { describe, expect, it, vi } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type BacklogMainExports,
  backlogMainKey,
  type BacklogRead,
} from '../../backlog/contract';
import type { ChatMainExports } from '../../chat/contract';
import { emptyDraft, fieldsOf } from '../draft';
import type { NoteDraft, NoteSendResult } from '../contract';
import type { NotesSelfTestDeps } from './selftest-script';
import { notesMainPart } from './start';

// The deps start last handed the self-test script.
const selfTest = vi.hoisted(() => ({
  deps: null as NotesSelfTestDeps | null,
}));
vi.mock('./selftest-script', async (importOriginal) => {
  const original = await importOriginal<typeof import('./selftest-script')>();
  return {
    ...original,
    notesSelfTestScript: (deps: NotesSelfTestDeps) => {
      selfTest.deps = deps;
      return original.notesSelfTestScript(deps);
    },
  };
});

const CAPTURED = new Uint8Array([137, 80, 78, 71, 42]);

const READ: BacklogRead = {
  homes: [
    {
      repo: 'repo',
      root: '/home/me/repo/docs/features',
      isCreateTarget: true,
      gitRoot: '/home/me/repo',
      uncommitted: false,
      repoFolder: '/home/me/repo',
      followupFiles: [],
      plans: [],
      features: [],
    },
  ],
  message: 'index stale',
};

const chat: Pick<ChatMainExports, 'launch' | 'defaultProfile'> = {
  launch: () => Promise.resolve('row-1'),
  defaultProfile: () => 'default',
};

// Notes' main part started over a fake `MainApi` whose window capture
// resolves `CAPTURED` and whose chat launches every session; `invoke` calls
// the channel handler for `name`.
function startNotesPart() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const data = createMemoryFiles();
  const backlog: BacklogMainExports = {
    load: () => Promise.resolve(READ),
    tags: () => ['ui', 'bug'],
    fileNote: () => Promise.reject(new Error('not reached')),
  };
  const api = {
    channel: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
      send: () => undefined,
    },
    events: { emit: () => undefined },
    settings: () => ({ launchBrief: 'Fix it.', autosaveDelayMs: 400 }),
    services: {
      files: data,
      log: () => undefined,
      homeDir: '/home/me',
      paths: posixPaths,
      window: { capture: () => Promise.resolve(CAPTURED) },
      images: { encode: () => Promise.reject(new Error('not reached')) },
      selfTest: { run: () => undefined },
    },
    dependency: (key: { id: string }) =>
      key.id === 'backlog' ? backlog : key.id === 'chat' ? chat : {},
    data,
    drive: null,
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof notesMainPart.start>[0];
  notesMainPart.start(api);
  const invoke = (name: string, ...args: unknown[]) => {
    const handler = handlers.get(name);
    if (handler === undefined) {
      throw new Error(`notes handles no ${name}`);
    }
    return handler(...args);
  };
  return { data, invoke };
}

describe('notes main part', () => {
  it('capture_AddsImageHoldingCapturedBytes', async () => {
    const notes = startNotesPart();

    const draft = (await notes.invoke('capture')) as NoteDraft;

    expect(draft.images).toEqual([{ id: 1, hasMarkup: false }]);
    expect(await notes.invoke('image', 1)).toEqual(CAPTURED);
  });

  it('homes_MapsBacklogRead', async () => {
    const notes = startNotesPart();

    expect(await notes.invoke('homes')).toEqual({
      homes: [
        {
          repo: 'repo',
          root: '/home/me/repo/docs/features',
          folder: '/home/me/repo',
          followups: [],
        },
      ],
      message: 'index stale',
    });
  });

  it('tags_PassesBacklogListThrough', () => {
    const notes = startNotesPart();

    expect(notes.invoke('tags')).toEqual(['ui', 'bug']);
  });

  it('nextSessionSend_ResolvesOnSentNotOnRefused', async () => {
    const notes = startNotesPart();
    let resolved = false;
    void selfTest.deps?.nextSessionSend().then(() => {
      resolved = true;
    });

    const refused = (await notes.invoke(
      'sendToSession',
      '/home/me/repo',
      [],
    )) as NoteSendResult;
    await new Promise((settle) => setImmediate(settle));
    expect(refused.type).toBe('refused');
    expect(resolved).toBe(false);

    await notes.invoke('saveDraft', {
      ...fieldsOf(emptyDraft(1)),
      target: '/home/me/repo/docs/features',
    });
    const sent = (await notes.invoke(
      'sendToSession',
      '/home/me/repo',
      [],
    )) as NoteSendResult;
    await new Promise((settle) => setImmediate(settle));
    expect(sent.type).toBe('sent');
    expect(resolved).toBe(true);
  });

  it.each([{ drive: false }, { drive: true }])(
    'stop_LeavesNoLiveRegistration (drive $drive)',
    async ({ drive }) => {
      const harness = startMainPart(notesMainPart, { drive });
      expect(harness.counts().registrations).toBeGreaterThan(0);

      await harness.stop();

      expect(harness.counts()).toEqual(noCounts);
    },
  );

  it('stopThenStart_StartsAgain', async () => {
    const harness = startMainPart(notesMainPart, {
      dependencies: [
        fakeDependency(
          backlogMainKey,
          () => ({ tags: () => ['ui'] }) as unknown as BacklogMainExports,
        ),
      ],
    });

    await harness.restart();

    expect(harness.invoke('tags')).toEqual(['ui']);
  });
});
