import type { PluginLog } from '../../../contracts/log';
import type { PageChannel } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { DocChange, DocsChannel } from '../contract';
import { parseWikiMain, type WikiShelf } from '../wiki-main';

export interface WikiMainSourceDeps {
  viewId: string;
  channel: PageChannel<DocsChannel>;
  log: PluginLog;
  // The binding's skill link prefixes, read at each parse.
  linkPrefixes(): Readonly<Record<string, string>>;
  // Hears the first settled read, a rejection included, and each read after it
  // that says another thing of the file than the last answer did.
  changed(): void;
  // Hears each read that answers, text or absent, whatever it says: after `changed`
  // when both run, and never for a rejection or a read dropped as older.
  answered(): void;
}

// What the newest settled read says of `Main.md`: `unreadable` is a rejected read
// or no path from main, which says nothing of whether the file is there.
// `absent` is also main's answer that no contribution names a wiki page.
export type MainFileState = 'exists' | 'absent' | 'unreadable';

// What the reads that answered say of the file. A rejection answers nothing.
type KnownFile =
  | { type: 'neverKnown' }
  | { type: 'absent' }
  | { type: 'text'; text: string };

// The wiki's `Main.md` as shelves, read and watched through the channel. Only an
// absent file drops the shelves: a rejection keeps those it has. A watch or path
// that failed is tried again at each `reread`.
export interface WikiMainSource {
  // Finds the path, watches it, then reads it. Resolves once the first read
  // settles and never rejects; a second call returns the same promise.
  start(): Promise<void>;
  // The real path of `Main.md`; null until main has given it, and while main
  // answers that no contribution names one.
  path(): string | null;
  shelves(): readonly WikiShelf[];
  // Whether a first read has settled, present, absent or rejected.
  isRead(): boolean;
  // Holds once `isRead` does.
  fileState(): MainFileState;
  // Rereads on a change to this source's own watch id.
  diskChanged(change: DocChange): void;
  // Reads the file again, after `start` when it has not run or not settled;
  // never rejects.
  reread(): Promise<void>;
  // Stops the watch; nothing read after it calls `changed` or `answered`.
  dispose(): void;
}

export function createWikiMainSource(deps: WikiMainSourceDeps): WikiMainSource {
  const { channel, log } = deps;
  const watchId = `${deps.viewId}:main`;
  let mainPath: string | null = null;
  // True while main's latest answer is that no contribution names a page.
  let isUnnamed = false;
  let known: KnownFile = { type: 'neverKnown' };
  // True from a rejection until a read answers.
  let isUnreadable = false;
  let shelves: readonly WikiShelf[] = [];
  let isWatching = false;
  let isDisposed = false;
  let started: Promise<void> | null = null;
  let connecting: Promise<void> | null = null;
  // Each read's number; a read older than the one shown is dropped.
  let startedReads = 0;
  let shownRead = 0;

  const settleAbsent = () => {
    isUnreadable = false;
    if (known.type === 'absent') {
      return;
    }
    known = { type: 'absent' };
    shelves = [];
    log('no Main.md: the file is absent');
    deps.changed();
  };

  // Only a first read has anything to tell `changed`: a later rejection changes no
  // text.
  const settleUnreadable = (reason: string) => {
    if (isDisposed || isUnreadable) {
      return;
    }
    isUnreadable = true;
    log(`no Main.md: ${reason}`);
    if (known.type === 'neverKnown') {
      deps.changed();
    }
  };

  const settleText = (text: string) => {
    isUnreadable = false;
    if (known.type === 'text' && known.text === text) {
      return;
    }
    known = { type: 'text', text };
    shelves = parseWikiMain(text, deps.linkPrefixes());
    log(`read Main.md: ${shelves.length} shelves`);
    deps.changed();
  };

  const settleAnswer = (text: string | null) => {
    if (isDisposed) {
      return;
    }
    if (text === null) {
      settleAbsent();
    } else {
      settleText(text);
    }
    deps.answered();
  };

  const findPath = async () => {
    try {
      mainPath = await channel.invoke('wikiMainPath');
      isUnnamed = mainPath === null;
    } catch (error) {
      settleUnreadable(errorText(error));
    }
  };

  const watch = async (path: string) => {
    try {
      await channel.invoke('watchDoc', watchId, path);
      isWatching = true;
    } catch (error) {
      log(`not watching Main.md: ${errorText(error)}`);
    }
  };

  // Gets what an earlier try failed to, one try at a time, so no repeat of a
  // watch is sent while another runs.
  const connect = async () => {
    if (mainPath === null) {
      await findPath();
    }
    if (mainPath !== null && !isWatching && !isDisposed) {
      await watch(mainPath);
    }
  };

  const connectOnce = () => {
    connecting ??= connect().finally(() => {
      connecting = null;
    });
    return connecting;
  };

  const read = async (path: string) => {
    const number = ++startedReads;
    const settle = await channel.invoke('readDocIfPresent', path).then(
      (text) => () => settleAnswer(text),
      (error: unknown) => () => settleUnreadable(errorText(error)),
    );
    if (number >= shownRead) {
      shownRead = number;
      settle();
    }
  };

  // A page no contribution names reads as an absent file, asked again at
  // each read.
  const connectAndRead = async () => {
    await connectOnce();
    if (mainPath !== null && !isDisposed) {
      await read(mainPath);
    } else if (isUnnamed) {
      settleAnswer(null);
    }
  };

  const source: WikiMainSource = {
    start() {
      started ??= connectAndRead();
      return started;
    },
    path: () => mainPath,
    shelves: () => shelves,
    isRead: () => known.type !== 'neverKnown' || isUnreadable,
    fileState() {
      if (isUnreadable) {
        return 'unreadable';
      }
      return known.type === 'text' ? 'exists' : 'absent';
    },
    diskChanged(change) {
      if (change.viewId === watchId) {
        void source.reread();
      }
    },
    async reread() {
      if (started === null) {
        return source.start();
      }
      await started;
      return connectAndRead();
    },
    dispose() {
      isDisposed = true;
      channel.invoke('watchDoc', watchId, null).catch((error: unknown) => {
        log(`not watching Main.md: ${errorText(error)}`);
      });
    },
  };
  return source;
}
