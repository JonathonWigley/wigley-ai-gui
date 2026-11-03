import { describe, expect, it } from 'vitest';
import type { ConnectedSession } from '../../sessions/contract';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { NoteDraft } from '../contract';
import { notesSelfTestScript } from './selftest-script';

// The notes script over fakes that count its fixture folders, connects and
// image adds;
// `sendGoesOut` resolves every waiting `nextSessionSend` at once, as main's
// sent session send does. With `holdsFolder` each `makeFolder` waits for
// `folderMade`.
function setUp(holdsFolder: boolean) {
  const madeFolders: string[] = [];
  const connected: unknown[] = [];
  const addedImages: Uint8Array[] = [];
  const sendWaiters: (() => void)[] = [];
  const folderWaiters: (() => void)[] = [];
  const draft = {} as NoteDraft;
  const script = notesSelfTestScript({
    homeDir: '/home/me',
    files: {
      read: () => Promise.resolve(''),
      realPath: (target) => Promise.resolve(target),
      makeFolder: (folder) => {
        madeFolders.push(folder);
        return holdsFolder
          ? new Promise<void>((resolve) => {
              folderWaiters.push(resolve);
            })
          : Promise.resolve();
      },
    },
    paths: posixPaths,
    sessions: {
      connect(info) {
        connected.push(info);
        return {
          session: { id: `s-${connected.length}` },
          end: () => undefined,
        } as unknown as ConnectedSession;
      },
      activate: () => undefined,
    },
    harnesses: [],
    store: {
      clear: () => Promise.resolve(draft),
      addImage(png) {
        addedImages.push(png);
        return Promise.resolve(draft);
      },
    },
    nextSessionSend: () =>
      new Promise<void>((resolve) => {
        sendWaiters.push(resolve);
      }),
  });
  const sendGoesOut = () => {
    for (const resolve of sendWaiters.splice(0)) {
      resolve();
    }
  };
  const folderMade = () => {
    for (const resolve of folderWaiters.splice(0)) {
      resolve();
    }
  };
  return {
    script,
    madeFolders,
    connected,
    addedImages,
    sendGoesOut,
    folderMade,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('notesSelfTestScript', () => {
  it.each([
    {
      name: 'BeforeItsDraftCleared',
      reopensAt: 'start',
      folders: 1,
      connects: 1,
    },
    { name: 'ParkedOnItsFolder', reopensAt: 'folder', folders: 2, connects: 1 },
    { name: 'ParkedOnItsSend', reopensAt: 'send', folders: 2, connects: 2 },
  ])(
    'open_ReplacedRunWritesNothingMore_$name',
    async ({ reopensAt, folders, connects }) => {
      const fixture = setUp(reopensAt === 'folder');
      const { script, madeFolders, connected, addedImages } = fixture;

      script.open(1);
      if (reopensAt !== 'start') {
        await settle();
      }
      script.open(2);
      await settle();
      fixture.folderMade();
      await settle();
      fixture.sendGoesOut();
      await settle();

      expect(madeFolders).toHaveLength(folders);
      expect(connected).toHaveLength(connects);
      expect(addedImages).toHaveLength(1);
    },
  );
});
