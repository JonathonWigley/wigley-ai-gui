import {
  type Files,
  type FileWatch,
  isMissingFile,
} from '../../contracts/files';
import {
  DEFAULT_LAYOUT_NAME,
  type LayoutEntry,
  type LayoutSet,
} from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import { callEach } from '../call-each';
import { errorText } from '../error-text';
import { createSerialQueue } from '../serial-queue';

// The layouts in an owner's layouts folder, each at the revision the page
// loads it at, after the owner's `default`. A save of a code, style, data,
// image or font file in any layout's folder lists the layouts again and sends
// the new set: a `.css` save raises that layout's `styleRevision`, a `.js`,
// `.mjs` or `.json` save its `revision`, and an image or font save both.
// Renaming, moving or deleting a layout's whole folder, and a layout joining
// or leaving the set, raise both. `default` is live while the owner's default
// folder holds `layout.js`, and built in otherwise; a save of its `layout.css`
// raises its `styleRevision`, of its `layout.js` its `revision`, and its going
// live or built in both. When a watch may have dropped changes, each layout
// folder whose files' paths or modified times differ from its last listing,
// and a default whose `layout.js` or `layout.css` does, lists again as a
// reported save of the differing files would. A watch failure
// is logged, and saves then go unseen until the next start; a default watch
// that fails to start leaves the user layouts listed and watched.
export interface LayoutRegistry {
  current(): LayoutSet;
  names(): string[];
  dispose(): void;
}

export interface LayoutRegistryDeps {
  // Scoped to the owner's layouts folder, `layouts/<owner>/`.
  folder: Files;
  // Scoped to the owner's default folder in the repo clone; null with no
  // clone. Watched only when the folder exists at start, and never made.
  defaultFolder: Files | null;
  send(set: LayoutSet): void;
  log: Log;
  // The source name every log line carries: the owner's id, which the lines
  // about a user `default` folder and the default-folder watch name too.
  logSource: string;
  // The text of the owner's `layout.d.ts`, written to the folder's root at
  // start with its repo kit specifier rewritten to `'../kit'`.
  layoutTypes: string;
}

// The folder's root, as its scoped `Files` names it.
const ROOT = '';
// The files directly in the default folder that make and style a live
// default; any other file there changes nothing.
const DEFAULT_CODE = 'layout.js';
const DEFAULT_STYLE = 'layout.css';
const BUILT_IN_DEFAULT: LayoutEntry = {
  name: DEFAULT_LAYOUT_NAME,
  revision: 1,
  styleRevision: 1,
  hasCss: false,
  builtIn: true,
};
// How an owner's repo `layout.d.ts` names the shared kit types, and how its
// copy in the user's folder names them, beside `layouts/kit.d.ts`.
const REPO_KIT_SPECIFIER = "'../../../shared/page/layout-host/kit'";
const USER_KIT_SPECIFIER = "'../kit'";
// The files a layout can load: code, style, data, images and fonts. Saves of
// any other file, such as an editor's swap or backup file, change nothing.
const LAYOUT_FILE =
  /\.(js|mjs|css|json|svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf)$/;
// The files the stylesheet link loads, and the files the module loads; an
// image or font can be reached from either.
const STYLE_FILE = /\.css$/;
const CODE_FILE = /\.(js|mjs|json)$/;

// Which revision a change raises: `style` the `styleRevision`, `code` the
// `revision`, `both` both.
type ChangeKind = 'code' | 'style' | 'both';

// Whether a save of `fileName` can change what a layout loads: a code, style,
// data, image or font file whose name does not start with `.`.
export function isLayoutFileName(fileName: string): boolean {
  return LAYOUT_FILE.test(fileName) && !fileName.startsWith('.');
}

// The kind of a change to the layout file `fileName`.
function changeKindOf(fileName: string): ChangeKind {
  if (STYLE_FILE.test(fileName)) {
    return 'style';
  }
  return CODE_FILE.test(fileName) ? 'code' : 'both';
}

// One kind for changes of `kinds`: theirs when they all share one, else
// `both`.
function foldChangeKinds(kinds: ChangeKind[]): ChangeKind {
  return kinds.every((kind) => kind === kinds[0]) ? kinds[0] : 'both';
}

function raisesRevision(kind: ChangeKind): boolean {
  return kind !== 'style';
}

function raisesStyleRevision(kind: ChangeKind): boolean {
  return kind !== 'code';
}

// Raises `name`'s counter by one, starting a first-seen name at 1.
function raiseCounter(counters: Map<string, number>, name: string): void {
  const seen = counters.get(name);
  counters.set(name, seen === undefined ? 1 : seen + 1);
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// The kind of the changes between a layout folder's stamps at its last
// listing and now, by path; null when they match. A folder in only one of the
// two is `both`.
function stampChangeKind(
  last: ReadonlyMap<string, string> | undefined,
  now: ReadonlyMap<string, string> | undefined,
): ChangeKind | null {
  if (last === undefined || now === undefined) {
    return last === now ? null : 'both';
  }
  const paths = new Set([...last.keys(), ...now.keys()]);
  const differing = [...paths].filter(
    (path) => last.get(path) !== now.get(path),
  );
  return differing.length === 0
    ? null
    : foldChangeKinds(differing.map((path) => changeKindOf(fileNameOf(path))));
}

// An owner's repo `layout.d.ts` text as the user's folder holds it: its kit
// specifier rewritten to name `layouts/kit.d.ts`.
export function userLayoutTypes(layoutTypes: string): string {
  return layoutTypes.replaceAll(REPO_KIT_SPECIFIER, USER_KIT_SPECIFIER);
}

interface ListedLayout {
  name: string;
  hasCss: boolean;
}

// What the default folder holds: whether it makes a live default, and whether
// that default has a stylesheet.
interface DefaultFiles {
  hasCode: boolean;
  hasCss: boolean;
}

async function listDefaultFiles(defaultFolder: Files): Promise<DefaultFiles> {
  const names = new Set(
    (await defaultFolder.list(ROOT))
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path),
  );
  return { hasCode: names.has(DEFAULT_CODE), hasCss: names.has(DEFAULT_STYLE) };
}

// The modified time of `path` in `files`, as a stamp; null when it is missing.
async function stampOf(files: Files, path: string): Promise<string | null> {
  try {
    return String(await files.modified(path));
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

// The default folder's `layout.js` and `layout.css` stamps, each null when the
// file is missing.
interface DefaultStamp {
  code: string | null;
  style: string | null;
}

// The default folder's stamps; null when either cannot be read, so the next
// rescan lists it again.
async function defaultStampOf(
  defaultFolder: Files,
): Promise<DefaultStamp | null> {
  try {
    const [code, style] = await Promise.all(
      [DEFAULT_CODE, DEFAULT_STYLE].map((file) => stampOf(defaultFolder, file)),
    );
    return { code, style };
  } catch {
    return null;
  }
}

// The kind of the changes between the default's stamps at its last listing
// and now; null when they match. A read that failed is `both` against a
// readable last stamp, and nothing against a failed one.
function defaultChangeKind(
  last: DefaultStamp | null,
  now: DefaultStamp | null,
): ChangeKind | null {
  if (last === null || now === null) {
    return last === now ? null : 'both';
  }
  const isCodeChanged = last.code !== now.code;
  const isStyleChanged = last.style !== now.style;
  if (isCodeChanged && isStyleChanged) {
    return 'both';
  }
  if (isCodeChanged) {
    return 'code';
  }
  return isStyleChanged ? 'style' : null;
}

async function isFolder(files: Files): Promise<boolean> {
  return (await files.stat(ROOT))?.isFolder === true;
}

export async function startLayoutRegistry(
  deps: LayoutRegistryDeps,
): Promise<LayoutRegistry> {
  const { folder, defaultFolder, send, log, logSource } = deps;
  let defaultSkipLogged = false;
  // Each user layout's revision and style revision, kept for the life of the
  // process so a layout that goes and comes back never reuses either.
  const revisions = new Map<string, number>();
  const styleRevisions = new Map<string, number>();
  // The live default's revision and style revision: each rises on every
  // default change of its kind the registry announces and never resets, so a
  // default that goes built in and comes back live takes numbers above every
  // earlier one.
  let defaultRevision = 1;
  let defaultStyleRevision = 1;
  // Two listings never interleave.
  const listings = createSerialQueue();

  const listLayouts = async (): Promise<ListedLayout[]> => {
    const entries = await folder.list(ROOT, { recursive: true });
    const files = new Set(
      entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.path),
    );
    const userNames = entries
      .filter((entry) => entry.kind === 'folder' && !entry.path.includes('/'))
      .map((entry) => entry.path)
      .filter((name) => files.has(`${name}/layout.js`));
    if (userNames.includes(DEFAULT_LAYOUT_NAME) && !defaultSkipLogged) {
      defaultSkipLogged = true;
      log(
        logSource,
        `layouts/${logSource}/default is ignored; the app's default layout wins`,
      );
    }
    return userNames
      .filter((name) => name !== DEFAULT_LAYOUT_NAME)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, hasCss: files.has(`${name}/layout.css`) }));
  };

  // Each layout folder's layout files' modified times by path, by folder
  // name, `default` left out. A folder with a file whose time cannot be read
  // is left out too, so the next rescan lists it again.
  const readStamps = async (): Promise<Map<string, Map<string, string>>> => {
    const byName = new Map<string, Map<string, string>>();
    const unreadable = new Set<string>();
    for (const entry of await folder.list(ROOT, { recursive: true })) {
      const slash = entry.path.indexOf('/');
      const fileName = fileNameOf(entry.path);
      const name = entry.path.slice(0, slash);
      const isLayoutFile =
        entry.kind === 'file' &&
        slash !== -1 &&
        name !== DEFAULT_LAYOUT_NAME &&
        isLayoutFileName(fileName);
      if (!isLayoutFile) {
        continue;
      }
      try {
        const stamp = await stampOf(folder, entry.path);
        if (stamp !== null) {
          const folderStamps = byName.get(name) ?? new Map<string, string>();
          folderStamps.set(entry.path, stamp);
          byName.set(name, folderStamps);
        }
      } catch {
        unreadable.add(name);
      }
    }
    for (const name of unreadable) {
      byName.delete(name);
    }
    return byName;
  };

  // Gives every listed user layout the registry has not seen revision and
  // style revision 1.
  const holdListing = (layouts: ListedLayout[]): ListedLayout[] => {
    for (const layout of layouts) {
      if (!revisions.has(layout.name)) {
        revisions.set(layout.name, 1);
      }
      if (!styleRevisions.has(layout.name)) {
        styleRevisions.set(layout.name, 1);
      }
    }
    return layouts;
  };

  const defaultEntryOf = (files: DefaultFiles): LayoutEntry =>
    files.hasCode
      ? {
          name: DEFAULT_LAYOUT_NAME,
          revision: defaultRevision,
          styleRevision: defaultStyleRevision,
          hasCss: files.hasCss,
          builtIn: false,
        }
      : BUILT_IN_DEFAULT;

  await folder.write('layout.d.ts', userLayoutTypes(deps.layoutTypes));
  // Read before the listing, so a save during it differs from them.
  const stamps = await readStamps();
  let listed = holdListing(await listLayouts());
  // `Files.watch` makes a missing folder, so a default folder missing at start
  // stays unwatched until the next start.
  const watchedDefault =
    defaultFolder !== null && (await isFolder(defaultFolder))
      ? defaultFolder
      : null;
  let defaultStamp =
    watchedDefault === null ? null : await defaultStampOf(watchedDefault);
  let defaultEntry =
    watchedDefault === null
      ? BUILT_IN_DEFAULT
      : defaultEntryOf(await listDefaultFiles(watchedDefault));

  const entry = (layout: ListedLayout): LayoutEntry => ({
    name: layout.name,
    revision: revisions.get(layout.name) ?? 1,
    styleRevision: styleRevisions.get(layout.name) ?? 1,
    hasCss: layout.hasCss,
    builtIn: false,
  });

  const setOf = (): LayoutSet => ({
    layouts: [defaultEntry, ...listed.map(entry)],
  });

  // Lists again after a change of `kind` in the layout folder `name` and
  // announces it when `name` is a layout now or was one before, raising the
  // revisions `kind` keys, or both when `name` joins or leaves the set; a
  // folder that never held a layout sends nothing.
  const relist = async (name: string, kind: ChangeKind): Promise<void> => {
    const stamp = (await readStamps()).get(name);
    if (stamp === undefined) {
      stamps.delete(name);
    } else {
      stamps.set(name, stamp);
    }
    const layouts = await listLayouts();
    const wasListed = listed.some((layout) => layout.name === name);
    const isListed = layouts.some((layout) => layout.name === name);
    if (!wasListed && !isListed) {
      return;
    }
    const raised = wasListed === isListed ? kind : 'both';
    if (raisesRevision(raised)) {
      raiseCounter(revisions, name);
    }
    if (raisesStyleRevision(raised)) {
      raiseCounter(styleRevisions, name);
    }
    listed = holdListing(layouts);
    send(setOf());
  };

  // Lists the default folder again after a change of `kind` and announces
  // `default` when it is live now or was before, raising the revisions `kind`
  // keys, or both when it goes live or built in; a change while it stays built
  // in sends nothing.
  const relistDefault = async (
    watched: Files,
    kind: ChangeKind,
  ): Promise<void> => {
    defaultStamp = await defaultStampOf(watched);
    const files = await listDefaultFiles(watched);
    if (defaultEntry.builtIn && !files.hasCode) {
      return;
    }
    const isLivenessChanged = defaultEntry.builtIn !== !files.hasCode;
    const raised = isLivenessChanged ? 'both' : kind;
    if (raisesRevision(raised)) {
      defaultRevision += 1;
    }
    if (raisesStyleRevision(raised)) {
      defaultStyleRevision += 1;
    }
    defaultEntry = defaultEntryOf(files);
    send(setOf());
  };

  const relistInTurn = (name: string, kind: ChangeKind) => {
    listings
      .run(() => relist(name, kind))
      .catch((error: unknown) =>
        log(logSource, `layout ${name} not reloaded: ${errorText(error)}`),
      );
  };

  // A path with no slash names a whole entry in the folder, as a watch reports
  // a folder renamed, moved or deleted; `relist` sends nothing for a name that
  // never was a layout, `layout.d.ts` included.
  const onChange = (changed: string) => {
    const slash = changed.indexOf('/');
    if (slash === -1) {
      if (changed !== DEFAULT_LAYOUT_NAME) {
        relistInTurn(changed, 'both');
      }
      return;
    }
    const name = changed.slice(0, slash);
    const fileName = fileNameOf(changed);
    if (name === DEFAULT_LAYOUT_NAME || !isLayoutFileName(fileName)) {
      return;
    }
    relistInTurn(name, changeKindOf(fileName));
  };

  // Lists again each layout folder whose stamps differ from its last listing,
  // as a change of the kind its differing files make.
  const relistChanged = async (): Promise<void> => {
    const now = await readStamps();
    const names = new Set([...stamps.keys(), ...now.keys()]);
    for (const name of names) {
      const kind = stampChangeKind(stamps.get(name), now.get(name));
      if (kind !== null) {
        await relist(name, kind);
      }
    }
  };

  const watch = folder.watch(ROOT, onChange, {
    onError: (error) =>
      log(logSource, `layouts watch failed: ${errorText(error)}`),
    onMissed: () =>
      listings
        .run(relistChanged)
        .catch((error: unknown) =>
          log(logSource, `layouts not rescanned: ${errorText(error)}`),
        ),
  });

  const logDefaultWatchFailed = (error: unknown) =>
    log(logSource, `default layout watch failed: ${errorText(error)}`);

  // Not recursive: a change in a subfolder reports the subfolder's name, which
  // is neither file a default loads.
  const watchDefault = (watched: Files): FileWatch | null => {
    // `kindOf` gives the kind of the change, null for none, once the
    // listing's turn comes.
    const relistDefaultInTurn = (kindOf: () => Promise<ChangeKind | null>) =>
      listings
        .run(async () => {
          const kind = await kindOf();
          if (kind !== null) {
            await relistDefault(watched, kind);
          }
        })
        .catch((error: unknown) =>
          log(logSource, `layout default not reloaded: ${errorText(error)}`),
        );
    try {
      return watched.watch(
        ROOT,
        (changed) => {
          if (changed === DEFAULT_CODE) {
            relistDefaultInTurn(async () => 'code');
          }
          if (changed === DEFAULT_STYLE) {
            relistDefaultInTurn(async () => 'style');
          }
        },
        {
          recursive: false,
          onError: logDefaultWatchFailed,
          onMissed: () =>
            relistDefaultInTurn(async () =>
              defaultChangeKind(defaultStamp, await defaultStampOf(watched)),
            ),
        },
      );
    } catch (error) {
      logDefaultWatchFailed(error);
      return null;
    }
  };

  const defaultWatch =
    watchedDefault === null ? null : watchDefault(watchedDefault);

  return {
    current: setOf,
    names: () => [DEFAULT_LAYOUT_NAME, ...listed.map((layout) => layout.name)],
    dispose: () => {
      callEach<() => void>(
        [() => watch.dispose(), () => defaultWatch?.dispose()],
        (step) => step(),
      );
    },
  };
}
