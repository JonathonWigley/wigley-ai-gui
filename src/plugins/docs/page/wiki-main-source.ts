import type { PluginLog } from '../../../contracts/log';
import type { PageChannel } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { DocChange, DocsChannel } from '../contract';
import { parseWikiMain, type WikiShelf } from '../wiki-main';

export interface WikiMainSourceDeps {
  viewId: string;
  channel: PageChannel<DocsChannel>;
  log: PluginLog;
  // Hears each read that found another text than the last one, the first
  // settled read among them, present or absent.
  changed(): void;
}

// The wiki's `Main.md` as shelves, read and watched through the channel. A
// failed read, or no path from main, is no `Main.md`. A watch or path that
// failed is tried again at each `reread`.
export interface WikiMainSource {
  // Finds the path, watches it, then reads it. Resolves once the first read
  // settles and never rejects; a second call returns the same promise.
  start(): Promise<void>;
  // The real path of `Main.md`; null until main has given it.
  path(): string | null;
  shelves(): readonly WikiShelf[];
  // Whether a first read has settled, present or absent.
  isRead(): boolean;
  exists(): boolean;
  // Rereads on a change to this source's own watch id.
  diskChanged(change: DocChange): void;
  // Reads the file again, after `start` when it has not run or not settled;
  // never rejects.
  reread(): Promise<void>;
  // Stops the watch; nothing read after it calls `changed`.
  dispose(): void;
}

export function createWikiMainSource(deps: WikiMainSourceDeps): WikiMainSource {
  const { channel, log } = deps;
  const watchId = `${deps.viewId}:main`;
  let mainPath: string | null = null;
  // Undefined until the first read settles; null while the file is absent.
  let lastText: string | null | undefined;
  let shelves: readonly WikiShelf[] = [];
  let isWatching = false;
  let isDisposed = false;
  let started: Promise<void> | null = null;
  let connecting: Promise<void> | null = null;
  // Each read's number; a read older than the one shown is dropped.
  let startedReads = 0;
  let shownRead = 0;

  const settleAbsent = (error: unknown) => {
    if (isDisposed || lastText === null) {
      return;
    }
    lastText = null;
    shelves = [];
    log(`no Main.md: ${errorText(error)}`);
    deps.changed();
  };

  const settleText = (text: string) => {
    if (isDisposed || text === lastText) {
      return;
    }
    lastText = text;
    shelves = parseWikiMain(text);
    log(`read Main.md: ${shelves.length} shelves`);
    deps.changed();
  };

  const findPath = async () => {
    try {
      mainPath = await channel.invoke('wikiMainPath');
    } catch (error) {
      settleAbsent(error);
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
    const settle = await channel.invoke('readDoc', path).then(
      (text) => () => settleText(text),
      (error: unknown) => () => settleAbsent(error),
    );
    if (number >= shownRead) {
      shownRead = number;
      settle();
    }
  };

  const connectAndRead = async () => {
    await connectOnce();
    if (mainPath !== null && !isDisposed) {
      await read(mainPath);
    }
  };

  const source: WikiMainSource = {
    start() {
      started ??= connectAndRead();
      return started;
    },
    path: () => mainPath,
    shelves: () => shelves,
    isRead: () => lastText !== undefined,
    exists: () => typeof lastText === 'string',
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
