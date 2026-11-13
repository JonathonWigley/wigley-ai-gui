import type { Clock } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import { type Files, isMissingFile } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type {
  MainApi,
  MainChannel,
  MainPart,
  MainServices,
  PluginEvents,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
import {
  type FollowupDraft,
  type FollowupItem,
  followupTitleProblem,
  parseFollowups,
} from '../../../shared/followups/followup-file';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import {
  type DocsMainEvents,
  type DocsMainExports,
  docsMainKey,
  MACHINE_SOURCE_ID,
  type SourceRead,
} from '../../docs/contract';
import { scopedAgentsMainKey } from '../../scoped-agents/contract';
import { sessionsMainKey } from '../../sessions/contract';
import {
  type BacklogChannel,
  type BacklogFollowupFile,
  type BacklogHome,
  type BacklogMainEvents,
  type BacklogMainExports,
  type BacklogRead,
  type BacklogWriteResult,
  backlogPlaceSlot,
  type NoteTarget,
  type RepoFolderSetting,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { backlogManifest } from '../manifest';
import {
  ASSISTANT_ID,
  ASSISTANT_INSTRUCTIONS,
  ASSISTANT_SCOPE,
  ASSISTANT_TITLE,
  createAssistantStore,
  sweepMessage,
} from './assistant';
import {
  assistantPlace,
  READ_BACKLOG_STATE_TOOL,
  SET_BACKLOG_CHUNKS_TOOL,
  startBacklogTools,
} from './backlog-tools';
import { createChunkStarter } from './chunk-start';
import { createChunkStore, titlesByRepo } from './chunk-store';
import { addDriveActions } from './drive-actions';
import {
  type NoteEdit,
  readFollowupText,
  writeFollowupEdit,
} from './followup-writes';
import { groupHomes, type HomeShape, markCreateTargets } from './homes';
import {
  appendedBody,
  IMAGES_FOLDER,
  imageFolderName,
  imageLink,
  imageLinkPrefix,
  type LinkedImage,
  linkedImages,
  noteBody,
} from './note-images';
import { repoFolderOf } from './repo-folder';
import { backlogRows } from './rows';
import { hasBacklogFixture, writeBacklogFixture } from './selftest-fixture';
import { backlogSelfTestScript } from './selftest-script';
import { createStalenessReader } from './staleness';

type BacklogApi = MainApi<
  typeof backlogManifest,
  BacklogChannel,
  BacklogMainEvents,
  QualifiedEvents<'docs', DocsMainEvents> &
    QualifiedEvents<'chat', ChatMainEvents>
>;

// The file a home's new follow-ups go to.
const CREATE_TARGET_FILE = 'followups.md';
// A clone's own home in git; a project folder's is the same path under that
// folder.
const FEATURES_FOLDER = 'docs/features';
const IMAGE_FILE = /^(\d+)\.png$/;

interface BacklogDeps {
  docs: DocsMainExports;
  git: Git;
  files: Pick<Files, 'list' | 'realPath'>;
  paths: Paths;
  clock: Clock;
  log: PluginLog;
  channel: Pick<MainChannel<BacklogChannel>, 'send'>;
  emit: PluginEvents<BacklogMainEvents>['emit'];
  homeDir: string;
  // The `repoFolders` setting as the user config now sets it.
  repoFolders(): readonly RepoFolderSetting[];
}

// `isInClone`: `git.topLevel` found a clone holding the home.
type LocatedHome = HomeShape & {
  gitRoot: string | null;
  isInClone: boolean;
};

type MarkedHome = LocatedHome & { isCreateTarget: boolean };

// A load's read, and the repos it left a follow-up file out of because the
// file did not read: their titles in the read are not all of their titles.
interface LoadedRead {
  read: BacklogRead;
  reposWithUnreadFile: ReadonlySet<string>;
}

function logSkipped(log: PluginLog, path: string, error: unknown): void {
  log(`${path}: ${errorText(error)}`);
}

// The real path; null when nothing is there.
async function realPathOrNull(
  files: Pick<Files, 'realPath'>,
  path: string,
): Promise<string | null> {
  try {
    return await files.realPath(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

// The folders of a clone at `topLevel` that may be `root`: the clone's own
// `docs/features`, and the `docs/features` of the project folder directly
// under the clone that `root` names, which the docs index lists as a home
// only when that folder holds its own `AGENTS.md`.
function clonesFeaturesFolders(
  paths: Paths,
  topLevel: string,
  root: string,
): string[] {
  const projectFolder = paths.parent(paths.parent(root));
  return [
    paths.join(topLevel, FEATURES_FOLDER),
    paths.join(topLevel, paths.base(projectFolder), FEATURES_FOLDER),
  ];
}

// The home with its `gitRoot`: the clone whose `docs/features` folder it is,
// its own or a project folder's, else null; and whether any clone holds it, a
// `topLevel` that throws counting as none. Null in place of the home when it
// is such a folder of a linked worktree.
async function locateHome(
  deps: BacklogDeps,
  home: HomeShape,
): Promise<LocatedHome | null> {
  let topLevel: string | null = null;
  try {
    topLevel = await deps.git.topLevel(home.root);
    if (topLevel === null) {
      return { ...home, gitRoot: null, isInClone: false };
    }
    const folders = clonesFeaturesFolders(deps.paths, topLevel, home.root);
    const [homeReal, ...featuresReals] = await Promise.all(
      [home.root, ...folders].map((path) => realPathOrNull(deps.files, path)),
    );
    const isClonesFeaturesFolder =
      homeReal !== null &&
      featuresReals.some(
        (featuresReal) =>
          featuresReal !== null && deps.paths.samePath(homeReal, featuresReal),
      );
    if (!isClonesFeaturesFolder) {
      return { ...home, gitRoot: null, isInClone: true };
    }
    if (await deps.git.isLinkedWorktree(topLevel)) {
      return null;
    }
    return { ...home, gitRoot: topLevel, isInClone: true };
  } catch (error) {
    logSkipped(deps.log, home.root, error);
    return { ...home, gitRoot: null, isInClone: topLevel !== null };
  }
}

// The paths of the home's follow-up files: the index's, and for the create
// target its `followups.md` too, which the index may not list yet.
function followupPathsOf(home: MarkedHome, paths: Paths): string[] {
  const listed = home.followupFiles.map((file) => file.path);
  if (!home.isCreateTarget) {
    return listed;
  }
  const createPath = paths.join(home.root, CREATE_TARGET_FILE);
  const isListed = listed.some((path) => paths.samePath(path, createPath));
  return isListed ? listed : [...listed, createPath];
}

// The file and its items; null for a create target file the index does not
// list and the disk lacks; `unread`, logged, when any other file does not
// read.
async function readFollowupFile(
  deps: BacklogDeps,
  path: string,
  isListed: boolean,
): Promise<BacklogFollowupFile | 'unread' | null> {
  try {
    return { path, items: parseFollowups(await deps.docs.readDoc(path)).items };
  } catch (error) {
    if (!isListed && isMissingFile(error)) {
      return null;
    }
    logSkipped(deps.log, path, error);
    return 'unread';
  }
}

// The home's follow-up files that read, and whether one did not.
async function readFollowupFiles(
  deps: BacklogDeps,
  home: MarkedHome,
): Promise<{ files: BacklogFollowupFile[]; hasUnreadFile: boolean }> {
  const listedCount = home.followupFiles.length;
  const read = await Promise.all(
    followupPathsOf(home, deps.paths).map((path, index) =>
      readFollowupFile(deps, path, index < listedCount),
    ),
  );
  return {
    files: read.filter((file) => file !== null && file !== 'unread'),
    hasUnreadFile: read.includes('unread'),
  };
}

// The home, and whether one of its follow-up files did not read. `homeDir`
// is the home folder with its links resolved, which a `~` in the
// `repoFolders` setting expands to.
async function readHome(
  deps: BacklogDeps,
  home: MarkedHome,
  homeDir: string,
): Promise<{ home: BacklogHome; hasUnreadFile: boolean }> {
  const { files, hasUnreadFile } = await readFollowupFiles(deps, home);
  return {
    home: {
      repo: home.repo,
      root: home.root,
      isCreateTarget: home.isCreateTarget,
      gitRoot: home.gitRoot,
      repoFolder: repoFolderOf(
        home,
        home.isInClone,
        deps.repoFolders(),
        deps.paths,
        homeDir,
      ),
      followupFiles: files,
    },
    hasUnreadFile,
  };
}

async function readHomes(
  deps: BacklogDeps,
  read: SourceRead,
): Promise<LoadedRead> {
  if (read.document === null) {
    return {
      read: { homes: [], message: read.message },
      reposWithUnreadFile: new Set(),
    };
  }
  const located = await Promise.all(
    groupHomes(read.document.entries).map((home) => locateHome(deps, home)),
  );
  const homeDir =
    (await realPathOrNull(deps.files, deps.homeDir)) ?? deps.homeDir;
  const homes = await Promise.all(
    markCreateTargets(located.filter((home) => home !== null)).map((home) =>
      readHome(deps, home, homeDir),
    ),
  );
  return {
    read: { homes: homes.map(({ home }) => home), message: read.message },
    reposWithUnreadFile: new Set<string>(
      homes.flatMap(({ home, hasUnreadFile }) =>
        hasUnreadFile ? [home.repo] : [],
      ),
    ),
  };
}

// Why an edited item's title, as the file already holds it, would not read
// back once rewritten; null when it would, or for a create.
function existingTitleProblem(edit: NoteEdit): string | null {
  if (edit.type !== 'edit') {
    return null;
  }
  const problem = followupTitleProblem(edit.title);
  return problem === null
    ? null
    : `${edit.title} cannot be rewritten as it stands: ${problem}. Edit it in Docs.`;
}

// Why the edit's item would not read back from the file once written: its
// existing title, or a create's title or an edit's new title; null when it
// would.
function titleProblem(edit: NoteEdit): string | null {
  const existingProblem = existingTitleProblem(edit);
  if (existingProblem !== null) {
    return existingProblem;
  }
  const isNewTitle =
    edit.type === 'create' ||
    (edit.type === 'edit' && edit.draft.title !== edit.title);
  return isNewTitle ? followupTitleProblem(edit.draft.title) : null;
}

// Where a note goes: a new item in the create target file at `path`, or the
// end of `item` in the follow-up file at `path`; `blocked` holds why it
// cannot go there.
type NotePlace =
  | { type: 'blocked'; result: BacklogWriteResult }
  | {
      type: 'create';
      path: string;
      title: string;
      oneLine: string;
      tags: string[];
    }
  | { type: 'append'; path: string; title: string; item: FollowupItem };

// The images one note wrote: `numbers` in `folder` under the home's images
// folder, which the note made when `isNewFolder`.
interface SavedImages {
  folder: string;
  isNewFolder: boolean;
  numbers: number[];
}

function emitFollowupEvent(
  emit: PluginEvents<BacklogMainEvents>['emit'],
  homeRoot: string,
  edit: NoteEdit,
): void {
  switch (edit.type) {
    case 'create':
      emit('followupCreated', { homeRoot, title: edit.draft.title });
      return;
    case 'edit':
      emit('followupEdited', { homeRoot, title: edit.draft.title });
      return;
  }
}

// Serves the channel and the exports: the last load's homes answer
// `fileNote`, and its follow-up files are the ones watched.
function createBacklogMain(deps: BacklogDeps) {
  const { docs, files, paths, clock, log, channel, emit } = deps;
  let last: LoadedRead | null = null;
  let watches: Disposable[] = [];
  // Counts loads, so only the newest load keeps its watches.
  let loads = 0;

  function homeAt(homeRoot: string): BacklogHome {
    const home = last?.read.homes.find((candidate) =>
      paths.samePath(candidate.root, homeRoot),
    );
    if (home === undefined) {
      throw new Error(`No Backlog home ${homeRoot}`);
    }
    return home;
  }

  async function watchFile(
    path: string,
    homeRoot: string,
  ): Promise<Disposable | null> {
    try {
      return await docs.watchDoc(path, () =>
        channel.send('changed', { homeRoot }),
      );
    } catch (error) {
      logSkipped(log, path, error);
      return null;
    }
  }

  async function watchHomes(read: BacklogRead, load: number): Promise<void> {
    const fileWatches = await Promise.all(
      read.homes.flatMap((home) =>
        home.followupFiles.map((file) => watchFile(file.path, home.root)),
      ),
    );
    const next = fileWatches.filter((watch) => watch !== null);
    const superseded = load !== loads ? next : watches;
    for (const watch of superseded) {
      watch.dispose();
    }
    if (load === loads) {
      watches = next;
    }
  }

  async function serve(index: () => Promise<SourceRead>): Promise<LoadedRead> {
    loads += 1;
    const load = loads;
    const loaded = await readHomes(deps, await index());
    if (load === loads) {
      last = loaded;
    }
    await watchHomes(loaded.read, load);
    return loaded;
  }

  // One load runs at a time: every call made while one runs shares the single
  // load that starts once it ends, so a burst of `changed` events costs two
  // loads, and each caller still gets a read begun after its call.
  let runningLoad: Promise<LoadedRead> | null = null;
  let queuedLoad: Promise<LoadedRead> | null = null;

  function startLoad(): Promise<LoadedRead> {
    const started = serve(() => docs.machineIndex());
    runningLoad = started;
    const settle = () => {
      if (runningLoad === started) {
        runningLoad = null;
      }
    };
    void started.then(settle, settle);
    return started;
  }

  function loadAll(): Promise<LoadedRead> {
    if (queuedLoad !== null) {
      return queuedLoad;
    }
    if (runningLoad === null) {
      return startLoad();
    }
    const settled = () => undefined;
    queuedLoad ??= runningLoad.then(settled, settled).then(() => {
      queuedLoad = null;
      return startLoad();
    });
    return queuedLoad;
  }

  async function load(): Promise<BacklogRead> {
    return (await loadAll()).read;
  }

  function imagesRootOf(home: BacklogHome): string {
    return paths.join(home.root, IMAGES_FOLDER);
  }

  // The images `body` in the follow-ups file `file` links that lie in a
  // folder of the home's images folder, each with that folder's path; a
  // hand-written link elsewhere is left out.
  function homeImages(
    home: BacklogHome,
    file: string,
    body: string,
  ): (LinkedImage & { folderPath: string })[] {
    const imagesRoot = imagesRootOf(home);
    return linkedImages(body).flatMap((image) => {
      const folderPath = paths.parent(
        paths.join(paths.parent(file), image.relative),
      );
      const isImagesSubfolder =
        paths.segmentsBelow(folderPath, imagesRoot)?.length === 1;
      return isImagesSubfolder ? [{ ...image, folderPath }] : [];
    });
  }

  // Trashes `path` through Docs; a failure is logged, not thrown.
  async function trashLogged(path: string): Promise<void> {
    try {
      const { error } = await docs.trashDoc(path);
      if (error !== null) {
        log(`${path}: ${error}`);
      }
    } catch (error) {
      logSkipped(log, path, error);
    }
  }

  function notFollowupFileOf(
    home: BacklogHome,
    path: string,
  ): BacklogWriteResult | null {
    const isHomeFile = home.followupFiles.some((file) =>
      paths.samePath(file.path, path),
    );
    return isHomeFile
      ? null
      : {
          type: 'refused',
          reason: `${path} is not a follow-up file of ${home.root}`,
        };
  }

  function notCreateTarget(home: BacklogHome): BacklogWriteResult | null {
    return home.isCreateTarget
      ? null
      : {
          type: 'refused',
          reason: `${home.root} is not ${home.repo}'s create target`,
        };
  }

  // `path` null: the home's create target file, created when missing; else
  // one of the home's follow-up files.
  async function applyEdit(
    homeRoot: string,
    path: string | null,
    edit: NoteEdit,
  ): Promise<BacklogWriteResult> {
    const problem = titleProblem(edit);
    if (problem !== null) {
      return { type: 'refused', reason: problem };
    }
    const home = homeAt(homeRoot);
    const refusal =
      path === null ? notCreateTarget(home) : notFollowupFileOf(home, path);
    if (refusal !== null) {
      return refusal;
    }
    const file = path ?? paths.join(home.root, CREATE_TARGET_FILE);
    const result = await writeFollowupEdit(
      docs,
      file,
      edit,
      path === null ? home.repo : null,
    );
    if (result.type === 'applied') {
      emitFollowupEvent(emit, home.root, edit);
    }
    return result;
  }

  async function notePlace(
    home: BacklogHome,
    target: NoteTarget,
  ): Promise<NotePlace> {
    if (target.type === 'create') {
      const refusal = notCreateTarget(home);
      if (refusal !== null) {
        return { type: 'blocked', result: refusal };
      }
      const { title, oneLine, tags } = target;
      return {
        type: 'create',
        path: paths.join(home.root, CREATE_TARGET_FILE),
        title,
        oneLine,
        tags,
      };
    }
    const refusal = notFollowupFileOf(home, target.path);
    if (refusal !== null) {
      return { type: 'blocked', result: refusal };
    }
    const { items } = parseFollowups(await readFollowupText(docs, target.path));
    const item = items.find((candidate) => candidate.title === target.title);
    if (item === undefined) {
      return {
        type: 'blocked',
        result: { type: 'missing', title: target.title },
      };
    }
    return { type: 'append', path: target.path, title: item.title, item };
  }

  // `name`, or `name-2`, `name-3`, … : the first with nothing listed under it.
  async function freeFolderName(
    imagesRoot: string,
    name: string,
  ): Promise<string> {
    let candidate = name;
    for (let suffix = 2; ; suffix += 1) {
      const entries = await files.list(paths.join(imagesRoot, candidate));
      if (entries.length === 0) {
        return candidate;
      }
      candidate = `${name}-${suffix}`;
    }
  }

  // One above the highest image number `folder` holds on disk or its links
  // name.
  async function nextImageNumber(
    imagesRoot: string,
    folder: string,
    linked: readonly LinkedImage[],
  ): Promise<number> {
    const entries = await files.list(paths.join(imagesRoot, folder));
    const onDisk = entries.flatMap((entry) => {
      const match = entry.kind === 'file' ? IMAGE_FILE.exec(entry.path) : null;
      return match === null ? [] : [Number(match[1])];
    });
    const numbers = linked
      .filter((image) => image.folder === folder)
      .map((image) => image.number);
    return Math.max(0, ...numbers, ...onDisk) + 1;
  }

  // The folder a place's images go to: the item's first linked folder, else
  // a new one named for now and the title.
  async function imageFolderFor(
    home: BacklogHome,
    place: Exclude<NotePlace, { type: 'blocked' }>,
  ): Promise<Omit<SavedImages, 'numbers'> & { first: number }> {
    const imagesRoot = imagesRootOf(home);
    const linked =
      place.type === 'append'
        ? homeImages(home, place.path, place.item.body)
        : [];
    if (linked.length === 0) {
      const name = imageFolderName(clock.now(), place.title);
      return {
        folder: await freeFolderName(imagesRoot, name),
        isNewFolder: true,
        first: 1,
      };
    }
    const { folder } = linked[0];
    return {
      folder,
      isNewFolder: false,
      first: await nextImageNumber(imagesRoot, folder, linked),
    };
  }

  function imagePath(home: BacklogHome, folder: string, number: number) {
    return paths.join(imagesRootOf(home), folder, `${number}.png`);
  }

  // A new folder goes whole; in a reused one, only the files this note wrote.
  async function trashSaved(
    home: BacklogHome,
    saved: SavedImages,
  ): Promise<void> {
    if (saved.numbers.length === 0) {
      return;
    }
    if (saved.isNewFolder) {
      await trashLogged(paths.join(imagesRootOf(home), saved.folder));
      return;
    }
    for (const number of saved.numbers) {
      await trashLogged(imagePath(home, saved.folder, number));
    }
  }

  // Writes each image in order; a write that rejects trashes the ones before
  // it and refuses with its reason.
  async function saveImages(
    home: BacklogHome,
    place: Exclude<NotePlace, { type: 'blocked' }>,
    images: readonly Uint8Array[],
  ): Promise<SavedImages | { type: 'refused'; reason: string }> {
    const { first, ...folder } = await imageFolderFor(home, place);
    const saved: SavedImages = { ...folder, numbers: [] };
    for (const [index, bytes] of images.entries()) {
      const number = first + index;
      try {
        await docs.writeBytes(imagePath(home, saved.folder, number), bytes);
      } catch (error) {
        await trashSaved(home, saved);
        return { type: 'refused', reason: errorText(error) };
      }
      saved.numbers.push(number);
    }
    return saved;
  }

  function noteEdit(
    place: Exclude<NotePlace, { type: 'blocked' }>,
    text: string,
  ): NoteEdit {
    if (place.type === 'create') {
      const { title, oneLine, tags } = place;
      return { type: 'create', draft: { title, oneLine, tags, body: text } };
    }
    const { title, oneLine, tags, body } = place.item;
    const baseline: FollowupDraft = { title, oneLine, tags, body };
    return {
      type: 'edit',
      title,
      draft: { ...baseline, body: appendedBody(body, text) },
      baseline,
    };
  }

  async function fileNote(
    homeRoot: string,
    target: NoteTarget,
    text: string,
    images: readonly Uint8Array[],
  ): Promise<BacklogWriteResult> {
    if (last === null) {
      await load();
    }
    const home = homeAt(homeRoot);
    const place = await notePlace(home, target);
    if (place.type === 'blocked') {
      return place.result;
    }
    const problem = titleProblem(noteEdit(place, text));
    if (problem !== null) {
      return { type: 'refused', reason: problem };
    }
    let links: string[] = [];
    let saved: SavedImages | null = null;
    if (images.length > 0) {
      const written = await saveImages(home, place, images);
      if ('type' in written) {
        return written;
      }
      saved = written;
      const prefix = imageLinkPrefix(place.path, home.root, paths);
      links = written.numbers.map((number) =>
        imageLink(prefix, written.folder, number),
      );
    }
    let result: BacklogWriteResult;
    try {
      result = await applyEdit(
        home.root,
        place.type === 'create' ? null : place.path,
        noteEdit(place, noteBody(text, links)),
      );
    } catch (error) {
      result = { type: 'refused', reason: errorText(error) };
    }
    if (result.type !== 'applied') {
      if (saved !== null) {
        await trashSaved(home, saved);
      }
      return result;
    }
    channel.send('changed', { homeRoot: home.root });
    return result;
  }

  // The last load, so a caller reads the rows the page loaded last; a load
  // when there is none yet.
  async function lastLoaded(): Promise<LoadedRead> {
    return last ?? loadAll();
  }

  async function lastRead(): Promise<BacklogRead> {
    return (await lastLoaded()).read;
  }

  return {
    load,
    rescan: async () => (await serve(() => docs.rebuildMachineIndex())).read,
    lastLoaded,
    lastRead,
    fileNote,
  };
}

// Writes the fixture repo into a self-test or drive run's home that has none
// yet; a drive run's restart keeps the home, and its repo.
async function startFixture(
  services: Pick<
    MainServices,
    'files' | 'processes' | 'paths' | 'homeDir' | 'runMode'
  >,
): Promise<void> {
  if (services.runMode === 'live') {
    return;
  }
  const homeDir = await services.files.realPath(services.homeDir);
  if (!(await hasBacklogFixture(services, homeDir))) {
    await writeBacklogFixture(services, homeDir);
  }
}

// Registers backlog's layouts, and serves the page every features home on the
// machine, from the docs machine index, and exports the load, the tag list and
// note filing through Docs' guarded follow-up writes to dependent plugins;
// watches each listed follow-up file and hears the machine index reload, each
// sending `changed`, as a change to the `repoFolders` setting does. It serves
// each open follow-up's git staleness, cached in plugin data, and the commits
// since it was written. It keeps the chunks in plugin data, the one writer of
// them, starts them through chat's `launch`, and retires a chunk when chat
// closes its session. It registers the Backlog assistant with scoped-agents,
// its records in plugin data, sends it a repo's staleness sweep on `sweep`,
// and gives it the `read_backlog_state` and `set_backlog_chunks` tools; a
// drive run gets the `callTool` action. Outside a live run it writes the
// self-test's fixture repo at start, before Docs' self-test counts the files
// the index lists.
export const backlogMainPart: MainPart<typeof backlogManifest> = {
  manifest: backlogManifest,
  start(api: BacklogApi) {
    const { services, channel } = api;
    const docs = api.dependency(docsMainKey);
    const chat = api.dependency(chatMainKey);
    const fixture = startFixture(services);
    fixture.catch((error: unknown) =>
      services.log(`fixture not written: ${errorText(error)}`),
    );
    const backlog = createBacklogMain({
      docs,
      git: services.git,
      files: services.files,
      paths: services.paths,
      clock: services.clock,
      log: services.log,
      channel,
      emit: (event, data) => api.events.emit(event, data),
      homeDir: services.homeDir,
      repoFolders: () => api.settings().repoFolders,
    });
    const staleness = createStalenessReader({
      git: services.git,
      files: services.files,
      data: api.data,
      paths: services.paths,
      log: services.log,
      send: (entries) => channel.send('stalenessRead', { entries }),
    });
    const store = createChunkStore({
      data: api.data,
      randomHex: services.randomHex,
      clock: services.clock,
      restored: () => chat.restored(),
      isHeld: (sessionId) => chat.profileOf(sessionId) !== null,
      log: services.log,
      changed: (chunks) => channel.send('chunksChanged', { chunks }),
    });
    const lastRows = async () => backlogRows(await backlog.lastRead());
    // The last load's titles by repo, less each repo it left a file out of:
    // a prune by them keeps the titles of a file that did not read.
    const prunableTitles = async () => {
      const { read, reposWithUnreadFile } = await backlog.lastLoaded();
      const titles = titlesByRepo(backlogRows(read));
      for (const repo of reposWithUnreadFile) {
        titles.delete(repo);
      }
      return titles;
    };
    const starter = createChunkStarter({
      store,
      rows: lastRows,
      prunableTitles,
      chat,
      launchBrief: () => api.settings().launchBrief,
      log: services.log,
    });
    const assistant = api.dependency(scopedAgentsMainKey).addScopedAgent({
      owner: backlogManifest.id,
      agentId: ASSISTANT_ID,
      folder: () => services.homeDir,
      instructions: () => Promise.resolve(ASSISTANT_INSTRUCTIONS),
      title: () => Promise.resolve(ASSISTANT_TITLE),
      store: createAssistantStore(api.data, services.log),
    });
    const place = api.state.read(backlogPlaceSlot);
    const tools = startBacklogTools({
      scopeOf: (session) => assistant.scopeOf(session),
      rows: lastRows,
      loadRows: async () => backlogRows(await backlog.load()),
      staleness: () => staleness.entries(),
      chunks: store,
      place: () => assistantPlace(place.get()),
    });
    const sessions = api.dependency(sessionsMainKey);
    sessions.contributeTools(
      [READ_BACKLOG_STATE_TOOL, SET_BACKLOG_CHUNKS_TOOL],
      tools,
    );
    if (api.drive !== null) {
      addDriveActions(api.drive, {
        assistantSession: () => assistant.sessionOf(ASSISTANT_SCOPE),
        tools,
      });
    }
    const exports: BacklogMainExports = {
      load: backlog.load,
      tags: () => api.settings().tags,
      fileNote: backlog.fileNote,
    };
    channel.handle('load', backlog.load);
    channel.handle('rescan', backlog.rescan);
    channel.handle('chunks', () => store.chunks());
    channel.handle('editChunks', async (edit) => {
      await store.prune(await prunableTitles());
      return store.edit(edit);
    });
    channel.handle('startChunks', (chunkIds) => starter.start(chunkIds));
    channel.handle('sweep', async (repo) => {
      const read = await backlog.lastRead();
      const homes = read.homes.filter((home) => home.repo === repo);
      if (homes.length === 0) {
        throw new Error(`No Backlog repo ${repo}`);
      }
      const files = homes.flatMap((home) =>
        home.followupFiles.map((file) => file.path),
      );
      const rows = backlogRows(read).filter((row) => row.repo === repo);
      return assistant.ask(
        ASSISTANT_SCOPE,
        sweepMessage(repo, files, rows, staleness.entries()),
      );
    });
    api.events.on('chat.sessionClosed', ({ sessionId }) => {
      store
        .retire(sessionId)
        .catch((error: unknown) =>
          services.log(
            `chunk of ${sessionId} not retired: ${errorText(error)}`,
          ),
        );
    });
    channel.handle('staleness', async () => staleness.read(await lastRows()));
    channel.handle('commitsSince', async (key) => {
      const rows = await lastRows();
      const row = rows.find((candidate) => candidate.key === key);
      if (row === undefined) {
        throw new Error(`No Backlog row ${key.replaceAll('\n', ' — ')}`);
      }
      return staleness.commitsSince(row);
    });
    api.events.on('docs.indexLoaded', ({ sourceId }) => {
      if (sourceId === MACHINE_SOURCE_ID) {
        channel.send('changed', { homeRoot: null });
      }
    });
    let repoFolders = api.settings().repoFolders;
    api.onSettingsChanged((settings) => {
      if (isSameJson(settings.repoFolders, repoFolders)) {
        return;
      }
      repoFolders = settings.repoFolders;
      channel.send('changed', { homeRoot: null });
    });
    services.selfTest?.run(
      backlogSelfTestScript({
        files: services.files,
        processes: services.processes,
        paths: services.paths,
        homeDir: services.homeDir,
        started: fixture,
        reload: () => channel.send('changed', { homeRoot: null }),
      }),
    );
    api.layouts.register({ layoutTypes });
    return {
      commands: {},
      exports: () => exports,
      dispose: () => staleness.dispose(),
    };
  },
};
