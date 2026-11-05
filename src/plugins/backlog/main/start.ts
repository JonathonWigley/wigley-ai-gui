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
import {
  type FollowupDraft,
  type FollowupItem,
  followupTitleProblem,
  parseFollowups,
} from '../../../shared/followups/followup-file';
import {
  type DocsMainEvents,
  type DocsMainExports,
  docsMainKey,
  MACHINE_SOURCE_ID,
  type SourceRead,
} from '../../docs/contract';
import type {
  BacklogChannel,
  BacklogEdit,
  BacklogFollowupFile,
  BacklogHome,
  BacklogMainEvents,
  BacklogMainExports,
  BacklogPlan,
  BacklogRead,
  BacklogWriteResult,
  NoteTarget,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { backlogManifest } from '../manifest';
import { commitMessage } from './commit-message';
import { readFollowupText, writeFollowupEdit } from './followup-writes';
import {
  groupHomes,
  type HomeShape,
  markCreateTargets,
  type PlanShape,
} from './homes';
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
import { hasBacklogFixture, writeBacklogFixture } from './selftest-fixture';
import { backlogSelfTestScript } from './selftest-script';

type BacklogApi = MainApi<
  typeof backlogManifest,
  BacklogChannel,
  BacklogMainEvents,
  QualifiedEvents<'docs', DocsMainEvents>
>;

// The file a home's new follow-ups go to.
const CREATE_TARGET_FILE = 'followups.md';
// The one folder of a clone that is a home in git.
const FEATURES_FOLDER = 'docs/features';
// An in-git home's images folder, relative to its clone.
const IMAGES_PATHSPEC = `${FEATURES_FOLDER}/${IMAGES_FOLDER}`;
const IMAGE_FILE = /^(\d+)\.png$/;
const PLAN_TITLE_SUFFIX = ' — plan';
const PLAN_DATES_LINE = /^(Target|Written): /;

interface BacklogDeps {
  docs: DocsMainExports;
  git: Git;
  files: Pick<Files, 'realPath' | 'list'>;
  paths: Paths;
  clock: Clock;
  log: PluginLog;
  channel: Pick<MainChannel<BacklogChannel>, 'send'>;
  emit: PluginEvents<BacklogMainEvents>['emit'];
}

type MarkedHome = HomeShape & {
  gitRoot: string | null;
  isCreateTarget: boolean;
};

// `path` below `folder` as a `/`-separated relative path; null when outside.
function relativePath(
  path: string,
  folder: string,
  paths: Paths,
): string | null {
  return paths.segmentsBelow(path, folder)?.join('/') ?? null;
}

function logSkipped(log: PluginLog, path: string, error: unknown): void {
  log(`${path}: ${errorText(error)}`);
}

// `path` below an in-git home at `homeRoot`, relative to its clone: an in-git
// home is its clone's `docs/features` folder. Null when outside the home.
function clonePath(
  homeRoot: string,
  path: string,
  paths: Paths,
): string | null {
  const below = relativePath(path, homeRoot, paths);
  return below === null ? null : `${FEATURES_FOLDER}/${below}`;
}

// The folder a clone-relative path lies in under the images folder, for a
// path `followups-images/<folder>/…`; null for any other path, a file lying
// directly in the images folder included.
function imageFolderOf(path: string): string | null {
  const prefix = `${IMAGES_PATHSPEC}/`;
  if (!path.startsWith(prefix)) {
    return null;
  }
  const below = path.slice(prefix.length).split('/');
  return below.length >= 2 && below[0] !== '' ? below[0] : null;
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

// The home with its `gitRoot`: the clone whose `docs/features` folder it is,
// else null. Null in place of the home when it is a linked worktree's
// `docs/features` folder.
async function locateHome(
  deps: BacklogDeps,
  home: HomeShape,
): Promise<(HomeShape & { gitRoot: string | null }) | null> {
  try {
    const topLevel = await deps.git.topLevel(home.root);
    if (topLevel === null) {
      return { ...home, gitRoot: null };
    }
    const [homeReal, featuresReal] = await Promise.all([
      realPathOrNull(deps.files, home.root),
      realPathOrNull(deps.files, deps.paths.join(topLevel, FEATURES_FOLDER)),
    ]);
    const isClonesFeaturesFolder =
      homeReal !== null &&
      featuresReal !== null &&
      deps.paths.samePath(homeReal, featuresReal);
    if (!isClonesFeaturesFolder) {
      return { ...home, gitRoot: null };
    }
    if (await deps.git.isLinkedWorktree(topLevel)) {
      return null;
    }
    return { ...home, gitRoot: topLevel };
  } catch (error) {
    logSkipped(deps.log, home.root, error);
    return { ...home, gitRoot: null };
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

// The file and its items; null when unreadable, logged unless it is a create
// target file the index does not list and the disk lacks.
async function readFollowupFile(
  deps: BacklogDeps,
  path: string,
  isListed: boolean,
): Promise<BacklogFollowupFile | null> {
  try {
    return { path, items: parseFollowups(await deps.docs.readDoc(path)).items };
  } catch (error) {
    if (isListed || !isMissingFile(error)) {
      logSkipped(deps.log, path, error);
    }
    return null;
  }
}

async function readFollowupFiles(
  deps: BacklogDeps,
  home: MarkedHome,
): Promise<BacklogFollowupFile[]> {
  const listedCount = home.followupFiles.length;
  const read = await Promise.all(
    followupPathsOf(home, deps.paths).map((path, index) =>
      readFollowupFile(deps, path, index < listedCount),
    ),
  );
  return read.filter((file) => file !== null);
}

// The plan's title from its first `# ` heading (else the plan folder's name)
// and its target and written date from its `Target: … · Written: …` line.
function planHeader(
  text: string,
  folderName: string,
): Pick<BacklogPlan, 'title' | 'target' | 'written'> {
  const lines = text.split('\n').map((line) => line.trimEnd());
  const heading = lines.find((line) => line.startsWith('# '));
  const headingText = heading?.slice(2).trim();
  const title =
    headingText === undefined
      ? folderName
      : headingText.endsWith(PLAN_TITLE_SUFFIX)
        ? headingText.slice(0, -PLAN_TITLE_SUFFIX.length)
        : headingText;
  const dateParts =
    lines.find((line) => PLAN_DATES_LINE.test(line))?.split(' · ') ?? [];
  const partValue = (label: string) =>
    dateParts
      .find((part) => part.startsWith(label))
      ?.slice(label.length)
      .trim() ?? null;
  return {
    title,
    target: partValue('Target: '),
    written: partValue('Written: '),
  };
}

async function readPlan(
  deps: BacklogDeps,
  plan: PlanShape,
): Promise<BacklogPlan | null> {
  try {
    const text = await deps.docs.readDoc(plan.path);
    const folderName = deps.paths.base(deps.paths.parent(plan.path));
    return { ...plan, ...planHeader(text, folderName) };
  } catch (error) {
    logSkipped(deps.log, plan.path, error);
    return null;
  }
}

// Whether git lists any of the home's follow-up files, or any file in a
// folder of its images folder, as changed from HEAD.
async function isUncommitted(
  deps: BacklogDeps,
  home: MarkedHome,
  followupPaths: string[],
): Promise<boolean> {
  const { gitRoot } = home;
  if (gitRoot === null) {
    return false;
  }
  try {
    const changed = await deps.git.changedPaths(gitRoot, FEATURES_FOLDER);
    const changedSet = new Set(changed);
    const isFollowupChanged = followupPaths.some((path) =>
      changedSet.has(clonePath(home.root, path, deps.paths) ?? ''),
    );
    return (
      isFollowupChanged || changed.some((path) => imageFolderOf(path) !== null)
    );
  } catch (error) {
    logSkipped(deps.log, home.root, error);
    return false;
  }
}

async function readHome(
  deps: BacklogDeps,
  home: MarkedHome,
): Promise<BacklogHome> {
  const followupFiles = await readFollowupFiles(deps, home);
  const plans = await Promise.all(
    home.plans.map((plan) => readPlan(deps, plan)),
  );
  const uncommitted = await isUncommitted(
    deps,
    home,
    followupFiles.map((file) => file.path),
  );
  return {
    repo: home.repo,
    root: home.root,
    isCreateTarget: home.isCreateTarget,
    gitRoot: home.gitRoot,
    uncommitted,
    followupFiles,
    plans: plans.filter((plan) => plan !== null),
    features: home.features,
  };
}

async function readHomes(
  deps: BacklogDeps,
  read: SourceRead,
): Promise<BacklogRead> {
  if (read.document === null) {
    return { homes: [], message: read.message };
  }
  const located = await Promise.all(
    groupHomes(read.document.entries, deps.paths).map((home) =>
      locateHome(deps, home),
    ),
  );
  const homes = await Promise.all(
    markCreateTargets(located.filter((home) => home !== null)).map((home) =>
      readHome(deps, home),
    ),
  );
  return { homes, message: read.message };
}

// Why an edited or retagged item's title, as the file already holds it, would
// not read back once rewritten; null when it would, or for a create or delete.
function existingTitleProblem(edit: BacklogEdit): string | null {
  if (edit.type !== 'edit' && edit.type !== 'setTags') {
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
function titleProblem(edit: BacklogEdit): string | null {
  const existingProblem = existingTitleProblem(edit);
  if (existingProblem !== null) {
    return existingProblem;
  }
  const isNewTitle =
    edit.type === 'create' ||
    (edit.type === 'edit' && edit.draft.title !== edit.title);
  return isNewTitle ? followupTitleProblem(edit.draft.title) : null;
}

// The file's text at HEAD; '' when HEAD lacks it or has no commit yet.
async function headText(
  git: Git,
  gitRoot: string,
  path: string,
): Promise<string> {
  try {
    return (await git.fileAtHead(gitRoot, path)) ?? '';
  } catch {
    return '';
  }
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
  edit: BacklogEdit,
): void {
  switch (edit.type) {
    case 'create':
      emit('followupCreated', { homeRoot, title: edit.draft.title });
      return;
    case 'edit':
      emit('followupEdited', { homeRoot, title: edit.draft.title });
      return;
    case 'setTags':
      emit('followupEdited', { homeRoot, title: edit.title });
      return;
    case 'delete':
      emit('followupDeleted', { homeRoot, title: edit.title });
      return;
  }
}

// Serves the channel and the exports: the last load's homes answer
// `applyEdit`, `fileNote` and `commit`, and its follow-up files are the ones
// watched.
function createBacklogMain(deps: BacklogDeps) {
  const { docs, git, files, paths, clock, log, channel, emit } = deps;
  let last: BacklogRead | null = null;
  let watches: Disposable[] = [];
  // Counts loads, so only the newest load keeps its watches.
  let loads = 0;

  function homeAt(homeRoot: string): BacklogHome {
    const home = last?.homes.find((candidate) =>
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
    const started = await Promise.all(
      read.homes.flatMap((home) =>
        home.followupFiles.map((file) => watchFile(file.path, home.root)),
      ),
    );
    const next = started.filter((watch) => watch !== null);
    const superseded = load !== loads ? next : watches;
    for (const watch of superseded) {
      watch.dispose();
    }
    if (load === loads) {
      watches = next;
    }
  }

  async function serve(index: () => Promise<SourceRead>): Promise<BacklogRead> {
    loads += 1;
    const load = loads;
    const read = await readHomes(deps, await index());
    if (load === loads) {
      last = read;
    }
    await watchHomes(read, load);
    return read;
  }

  const load = () => serve(() => docs.machineIndex());

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

  // The image folders the item titled `title` in `file` links and no other
  // item there does.
  async function orphanedImageFolders(
    home: BacklogHome,
    file: string,
    title: string,
  ): Promise<string[]> {
    const { items } = parseFollowups(await readFollowupText(docs, file));
    const deleted = items.find((item) => item.title === title);
    if (deleted === undefined) {
      return [];
    }
    const stillLinked = items
      .filter((item) => item !== deleted)
      .flatMap((item) => homeImages(home, file, item.body))
      .map((image) => image.folderPath);
    const orphaned: string[] = [];
    for (const { folderPath } of homeImages(home, file, deleted.body)) {
      const isKept = [...stillLinked, ...orphaned].some((folder) =>
        paths.samePath(folder, folderPath),
      );
      if (!isKept) {
        orphaned.push(folderPath);
      }
    }
    return orphaned;
  }

  async function applyEdit(
    homeRoot: string,
    path: string | null,
    edit: BacklogEdit,
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
    const orphaned =
      edit.type === 'delete'
        ? await orphanedImageFolders(home, file, edit.title)
        : [];
    const result = await writeFollowupEdit(
      docs,
      file,
      edit,
      path === null ? home.repo : null,
    );
    if (result.type === 'applied') {
      for (const folder of orphaned) {
        await trashLogged(folder);
      }
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
  ): BacklogEdit {
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

  // Commits the home's changed follow-up files and every changed file in a
  // folder of its images folder; resolves to the message.
  async function commit(homeRoot: string): Promise<string> {
    const home = homeAt(homeRoot);
    const { gitRoot } = home;
    if (gitRoot === null) {
      throw new Error(`${home.root} is in no git clone`);
    }
    const inHome = home.followupFiles.flatMap(({ path }) => {
      const relative = clonePath(home.root, path, paths);
      return relative === null ? [] : [{ path, relative }];
    });
    const texts = await Promise.all(
      inHome.map(async ({ path, relative }) => ({
        relative,
        before: await headText(git, gitRoot, relative),
        after: await readFollowupText(docs, path),
      })),
    );
    const changed = texts.filter(({ before, after }) => before !== after);
    const changedImages = (
      await git.changedPaths(gitRoot, IMAGES_PATHSPEC)
    ).flatMap((path) => {
      const folder = imageFolderOf(path);
      return folder === null ? [] : [{ path, folder }];
    });
    if (changed.length === 0 && changedImages.length === 0) {
      throw new Error(`Nothing to commit in ${home.root}`);
    }
    const imageFolders = [
      ...new Set(changedImages.map(({ folder }) => folder)),
    ].sort();
    const message = commitMessage(
      changed.map(({ before, after }) => ({
        before: parseFollowups(before).items,
        after: parseFollowups(after).items,
      })),
      imageFolders,
    );
    await git.commitPaths(
      gitRoot,
      [
        ...changed.map(({ relative }) => relative),
        ...changedImages.map(({ path }) => path),
      ],
      message,
    );
    channel.send('changed', { homeRoot: home.root });
    return message;
  }

  return {
    load,
    rescan: () => serve(() => docs.rebuildMachineIndex()),
    applyEdit,
    fileNote,
    commit,
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
// machine, from the docs machine index, Docs' guarded follow-up writes and the
// home's follow-up commit, and exports the load, the tag list and note filing
// to dependent plugins; watches each listed follow-up file and hears the
// machine index reload, each sending `changed`. Outside a live run it writes
// the self-test's fixture repo at start, before Docs' self-test counts the
// files the index lists.
export const backlogMainPart: MainPart<typeof backlogManifest> = {
  manifest: backlogManifest,
  start(api: BacklogApi) {
    const { services, channel } = api;
    const docs = api.dependency(docsMainKey);
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
    });
    const exports: BacklogMainExports = {
      load: backlog.load,
      tags: () => api.settings().tags,
      fileNote: backlog.fileNote,
    };
    channel.handle('load', backlog.load);
    channel.handle('rescan', backlog.rescan);
    channel.handle('readDoc', (path) => docs.readDoc(path));
    channel.handle('applyEdit', backlog.applyEdit);
    channel.handle('commit', backlog.commit);
    api.events.on('docs.indexLoaded', ({ sourceId }) => {
      if (sourceId === MACHINE_SOURCE_ID) {
        channel.send('changed', { homeRoot: null });
      }
    });
    services.selfTest?.run(
      backlogSelfTestScript({
        files: services.files,
        processes: services.processes,
        git: services.git,
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
    };
  },
};
