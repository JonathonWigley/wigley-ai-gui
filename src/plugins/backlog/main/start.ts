import type { Disposable } from '../../../contracts/disposable';
import { isMissingFile } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type {
  MainApi,
  MainChannel,
  MainPart,
  MainServices,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  type FollowupEdit,
  parseFollowups,
} from '../../../shared/followups/followup-file';
import {
  type DocsMainEvents,
  type DocsMainExports,
  MACHINE_SOURCE_ID,
  type SourceRead,
} from '../../docs/contract';
import type {
  BacklogChannel,
  BacklogFollowupFile,
  BacklogHome,
  BacklogPlan,
  BacklogRead,
  BacklogWriteResult,
} from '../contract';
import { backlogManifest } from '../manifest';
import { commitMessage } from './commit-message';
import { readFollowupText, writeFollowupEdit } from './followup-writes';
import {
  groupHomes,
  type HomeShape,
  markCreateTargets,
  type PlanShape,
} from './homes';
import { hasBacklogFixture, writeBacklogFixture } from './selftest-fixture';
import { backlogSelfTestScript } from './selftest-script';

type BacklogApi = MainApi<
  typeof backlogManifest,
  BacklogChannel,
  Record<never, never>,
  QualifiedEvents<'docs', DocsMainEvents>
>;

// The file a home's new follow-ups go to.
const CREATE_TARGET_FILE = 'followups.md';
const PLAN_TITLE_SUFFIX = ' — plan';
const PLAN_DATES_LINE = /^(Target|Written): /;

interface BacklogDeps {
  docs: DocsMainExports;
  git: Git;
  paths: Paths;
  log: Log;
  channel: Pick<MainChannel<BacklogChannel>, 'send'>;
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

function logSkipped(log: Log, path: string, error: unknown): void {
  log('backlog', `${path}: ${errorText(error)}`);
}

async function gitRootOf(
  deps: BacklogDeps,
  root: string,
): Promise<string | null> {
  try {
    return await deps.git.topLevel(root);
  } catch (error) {
    logSkipped(deps.log, root, error);
    return null;
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

// Whether git lists any of the home's follow-up files as changed from HEAD.
async function isUncommitted(
  deps: BacklogDeps,
  home: MarkedHome,
  followupPaths: string[],
): Promise<boolean> {
  const { gitRoot } = home;
  if (gitRoot === null) {
    return false;
  }
  const scope = relativePath(home.root, gitRoot, deps.paths) || '.';
  try {
    const changed = new Set(await deps.git.changedPaths(gitRoot, scope));
    return followupPaths.some((path) =>
      changed.has(relativePath(path, gitRoot, deps.paths) ?? ''),
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
    groupHomes(read.document.entries, deps.paths).map(async (home) => ({
      ...home,
      gitRoot: await gitRootOf(deps, home.root),
    })),
  );
  const homes = await Promise.all(
    markCreateTargets(located).map((home) => readHome(deps, home)),
  );
  return { homes, message: read.message };
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

// Serves the channel: the last load's homes answer `applyEdit` and `commit`,
// and its follow-up files are the ones watched.
function createBacklogMain(deps: BacklogDeps) {
  const { docs, git, paths, log, channel } = deps;
  let last: BacklogRead | null = null;
  let watches: Disposable[] = [];
  // Counts loads, and the dispose, so only the newest load keeps its watches.
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

  async function applyEdit(
    homeRoot: string,
    path: string | null,
    edit: FollowupEdit,
  ): Promise<BacklogWriteResult> {
    if (path !== null) {
      return writeFollowupEdit(docs, path, edit, null);
    }
    const home = homeAt(homeRoot);
    if (!home.isCreateTarget) {
      return {
        type: 'refused',
        reason: `${home.root} is not ${home.repo}'s create target`,
      };
    }
    const createPath = paths.join(home.root, CREATE_TARGET_FILE);
    return writeFollowupEdit(docs, createPath, edit, home.repo);
  }

  async function commit(homeRoot: string): Promise<string> {
    const home = homeAt(homeRoot);
    const { gitRoot } = home;
    if (gitRoot === null) {
      throw new Error(`${home.root} is in no git clone`);
    }
    const texts = await Promise.all(
      home.followupFiles.map(async ({ path }) => {
        const relative = relativePath(path, gitRoot, paths) ?? path;
        return {
          relative,
          before: await headText(git, gitRoot, relative),
          after: await readFollowupText(docs, path),
        };
      }),
    );
    const changed = texts.filter(({ before, after }) => before !== after);
    const message = commitMessage(
      changed.map(({ before, after }) => ({
        before: parseFollowups(before).items,
        after: parseFollowups(after).items,
      })),
    );
    if (message === null) {
      throw new Error(`Nothing to commit in ${home.root}`);
    }
    await git.commitPaths(
      gitRoot,
      changed.map(({ relative }) => relative),
      message,
    );
    channel.send('changed', { homeRoot: home.root });
    return message;
  }

  return {
    load: () => serve(() => docs.machineIndex()),
    rescan: () => serve(() => docs.rebuildMachineIndex()),
    applyEdit,
    commit,
    dispose() {
      loads += 1;
      for (const watch of watches) {
        watch.dispose();
      }
      watches = [];
    },
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

// Serves the page every features home on the machine, from the docs machine
// index, Docs' guarded follow-up writes and the home's follow-up commit;
// watches each listed follow-up file and hears the machine index reload, each
// sending `changed`. Outside a live run it writes the self-test's fixture repo
// at start, before Docs' self-test counts the files the index lists.
export const backlogMainPart: MainPart<typeof backlogManifest> = {
  manifest: backlogManifest,
  start(api: BacklogApi) {
    const { services, channel } = api;
    const docs = api.dependency<DocsMainExports>('docs');
    const fixture = startFixture(services);
    fixture.catch((error: unknown) =>
      services.log('backlog', `fixture not written: ${errorText(error)}`),
    );
    const backlog = createBacklogMain({
      docs,
      git: services.git,
      paths: services.paths,
      log: services.log,
      channel,
    });
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
    return { commands: {}, dispose: backlog.dispose };
  },
};
