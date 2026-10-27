import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { BacklogMainExports, BacklogRead } from '../../backlog/contract';
import type { NoteDraft } from '../contract';
import { notesMainPart } from './start';

const CAPTURED = new Uint8Array([137, 80, 78, 71, 42]);

const READ: BacklogRead = {
  homes: [
    {
      repo: 'repo',
      root: '/home/me/repo/docs/features',
      isCreateTarget: true,
      gitRoot: '/home/me/repo',
      uncommitted: false,
      followupFiles: [],
      plans: [],
      features: [],
    },
  ],
  message: 'index stale',
};

// Notes' main part started over a fake `MainApi` whose window capture
// resolves `CAPTURED`; `invoke` calls the channel handler for `name`.
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
    settings: () => ({ launchBrief: 'Fix it.', autosaveDelayMs: 400 }),
    services: {
      files: data,
      log: () => undefined,
      homeDir: '/home/me',
      paths: posixPaths,
      window: { capture: () => Promise.resolve(CAPTURED) },
    },
    dependency: (pluginId: string) => (pluginId === 'backlog' ? backlog : {}),
    data,
    drive: null,
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
});
