import type { Clock, Timers } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import type { Files } from '../../contracts/files';
import type { Git, GitRemoteHead } from '../../contracts/git';
import type { Paths } from '../../contracts/paths';
import type { Platform } from '../../contracts/platform';
import type { ChannelShape, DependencyKey } from '../../contracts/plugin';
import type { ProcessRunner } from '../../contracts/processes';
import type { KeyedSlotKey, SlotKey } from '../../contracts/state';

// How many builds each poll lists per game.
export const BUILDS_PER_GAME = 20;

export type BuildState = 'queued' | 'running' | 'finished';
export type BuildResult = 'success' | 'failure' | 'cancelled';

// One job of a build, such as a TeamCity chain's snapshot dependency. A field the backend cannot read is null.
export interface BuildJob {
  id: string;
  label: string;
  state: BuildState;
  result: BuildResult | null; // null until the job finishes
  percent: number | null; // 0–100
  leftSeconds: number | null;
  stepText: string | null; // the job's current step, or its last log line
  webUrl: string | null; // the job's own page in the backend
  startedAt: number | null; // epoch ms
  finishedAt: number | null; // epoch ms
  dependsOn: string[]; // ids of the jobs in the same build this job directly waits on
}

// A link a build carries, such as an install link.
export interface BuildLink {
  label: string;
  url: string;
}

// One build as a backend reads it. Times are epoch milliseconds. A field the backend cannot read is null, or an
// empty list.
export interface BuildRecord {
  id: string; // unique within its backend
  gameId: string;
  kind: string; // a key of the game's `kinds`
  number: string | null;
  version: string | null;
  branch: string;
  revision: string | null; // the full commit sha the build was made from
  state: BuildState;
  result: BuildResult | null; // null until finished
  statusText: string | null;
  percent: number | null; // 0–100
  leftSeconds: number | null;
  stepText: string | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  startEstimate: number | null; // a queued build's expected start
  webUrl: string | null; // the build's page in the backend
  links: BuildLink[];
  jobs: BuildJob[];
  triggeredBy: string | null; // who queued it, as the backend names them
}

// path: a full path, `~` expanded; `{version}` and `{number}` are filled per build
export interface BuildDownloadEntry {
  label: string;
  path: string;
}

// A build kind of a game: `target` is parsed by the backend (a TeamCity build configuration id, a local command).
// `downloads` lists the files each build of the kind can have.
export interface BuildKindEntry {
  label: string;
  target: unknown;
  downloads: BuildDownloadEntry[];
}

// A set of kinds queued together on one branch and revision, such as an RC set.
export interface BuildSetEntry {
  id: string;
  label: string;
  kinds: string[]; // kinds of the same game
  branches: string; // a pattern under `refs/heads/`, as `Git.remoteHeads` takes it
  agentPrompt: string | null; // the first message of the set's "with agent" session; null with none
}

// A tracked game of a backend entry.
export interface GameEntry {
  id: string;
  label: string;
  clone: string | null; // the `~` is expanded by `builds`; null when the entry names none
  defaultBranch: string;
  kinds: Record<string, BuildKindEntry>;
  sets: BuildSetEntry[];
}

// One element of the `builds.backends` setting, with its generic fields parsed by `builds`; `config` is parsed by the
// backend of its `kind`.
export interface BackendEntry {
  id: string;
  kind: string;
  label: string;
  config: unknown;
  games: GameEntry[];
}

// One build to queue: `revision` pins the commit when the backend chooses the branch, else null.
export interface QueueRequest {
  kind: string;
  branch: string;
  revision: string | null;
}

// `cancel`: the backend can cancel a running build. `choosesBranch`: a queue takes a branch and a pinned revision;
// false for a backend that builds a folder as it stands. `saveLog`: the backend can save a job's or a build's whole
// log to a file.
export interface BackendCapabilities {
  cancel: boolean;
  choosesBranch: boolean;
  saveLog: boolean;
}

// One backend entry's instance, made by its kind's `create`.
export interface BuildBackend {
  readonly capabilities: BackendCapabilities;
  // The game's newest builds across its kinds, newest first, at most `limit`.
  list(game: GameEntry, limit: number): Promise<BuildRecord[]>;
  // Queues one kind on a branch and revision, and returns the new build's id.
  queue(game: GameEntry, request: QueueRequest): Promise<{ id: string }>;
  // Present only when `capabilities.cancel` is true.
  cancel?(game: GameEntry, buildId: string): Promise<void>;
  // Present only when capabilities.saveLog is true. Saves the job's whole log to the full path `path`; `jobId` null saves the build's own log.
  saveLog?(
    game: GameEntry,
    buildId: string,
    jobId: string | null,
    path: string,
  ): Promise<void>;
  dispose(): void;
}

// What `builds` hands each backend instance. `dataFiles` is scoped to a folder of that backend entry's own, builds
// data `backends/<entry id>/`, whose full path is `dataFolder`; `log` logs under `builds` with the entry id first.
export interface BackendServices {
  processes: ProcessRunner;
  git: Git;
  files: Files;
  dataFiles: Files;
  dataFolder: string;
  paths: Paths;
  clock: Clock;
  timers: Timers;
  homeDir: string;
  platform: Platform;
  log(message: string): void;
}

// A backend kind, which a backend plugin registers through `addBackend`: a factory of one instance per backend entry
// whose `kind` is this `kind`.
export interface BackendKind {
  kind: string;
  label: string;
  // The entry's backend, or a `{ problem }` that names what is wrong with the entry's `config` or a kind's `target`.
  // Async, so a kind may run a program (`teamcity --version`) to find it is missing.
  create(
    entry: BackendEntry,
    services: BackendServices,
  ): Promise<BuildBackend | { problem: string }>;
}

// `addBackend` registers a backend kind until its Disposable is disposed.
export interface BuildsMainExports {
  addBackend(kind: BackendKind): Disposable;
}

export const buildsMainKey: DependencyKey<BuildsMainExports, 'main', 'builds'> =
  {
    id: 'builds',
    process: 'main',
  };

// A build as a session or a set run names it.
export interface BuildRef {
  backendId: string;
  buildId: string;
}

// One run of a set: the builds it queued, all on `revision`.
export interface SetRunView {
  id: string;
  setId: string;
  label: string;
  builds: BuildRef[];
  revision: string | null;
}

// a filled path that exists on disk; entry: its index in the kind's `downloads`
export interface BuildFile {
  label: string;
  path: string;
  entry: number;
}

export interface GameView {
  backendId: string;
  game: GameEntry;
  builds: BuildRecord[]; // newest first
  subjects: Record<string, string>; // revision sha → commit subject
  setRuns: SetRunView[]; // newest first
  files: Record<string, BuildFile[]>; // build id → its files that exist
}

// One backend entry: `problem` names what is wrong with its entry or its last poll, null when nothing is;
// `capabilities` is null while the backend has no instance.
export interface BackendView {
  id: string;
  kind: string;
  label: string;
  problem: string | null;
  capabilities: BackendCapabilities | null;
  games: GameView[];
}

export interface BuildsSnapshot {
  backends: BackendView[];
  polledAt: number | null; // epoch ms of the last poll; null before the first
}

// A build an agent offered the session for the user to queue. `revision` and `subject` are the branch's origin head
// and its commit subject when read; `createdAt` is epoch ms.
export interface BuildOffer {
  backendId: string;
  gameId: string;
  kind: string; // a kind or a set id
  branch: string;
  revision: string | null;
  subject: string | null;
  createdAt: number;
}

export interface SessionBuilds {
  builds: BuildRef[]; // newest link first
  offer: BuildOffer | null;
}

// Every backend's games and builds.
export const buildsSnapshotSlot: SlotKey<BuildsSnapshot, 'main', 'builds'> = {
  id: 'builds.snapshot',
  process: 'main',
  kind: 'value',
};

// Each session's linked builds and offer, keyed by the session id; a session with neither has no key.
export const buildsSessionsSlot: KeyedSlotKey<SessionBuilds, 'main', 'builds'> =
  {
    id: 'builds.sessions',
    process: 'main',
    kind: 'keyed',
  };

// One log save or file download into the Downloads folder.
export interface BuildDownload {
  id: string; // `<backend id>/<build id>/log` (the build's own log), `<backend id>/<build id>/log/<job id>`, or `<backend id>/<build id>/file/<entry>`
  backendId: string;
  buildId: string;
  label: string; // the job's label for a log (`build` for the build's own log), the file's label for a file
  state: 'running' | 'saved' | 'failed';
  path: string | null; // the saved file, once saved
  problem: string | null; // why it failed
  startedAt: number; // epoch ms
}

// id 'builds.downloads', keyed by BuildDownload.id
export const buildsDownloadsSlot: KeyedSlotKey<
  BuildDownload,
  'main',
  'builds'
> = {
  id: 'builds.downloads',
  process: 'main',
  kind: 'keyed',
};

// What a page reload puts back in Builds mode: `entry` the shown side-bar entry (`all` or `<backendId>/<gameId>`),
// `build` the list cursor's build key `<backendId>/<buildId>` and `job` the job cursor's job id, each null with none.
export interface BuildsPlace {
  entry: string;
  build: string | null;
  job: string | null;
}

export const buildsPlaceSlot: SlotKey<BuildsPlace, 'page', 'builds'> = {
  id: 'builds.place',
  process: 'page',
  kind: 'value',
};

// The page's calls into main. `setShown` reports whether Builds mode shows, which speeds polling; the last report
// wins. `branches` lists a game's origin branch heads, those matching the set's pattern when `set` names one. `queue`
// queues a kind or a set, linked to `sessionId` when set. `queueOffer` and `dismissOffer` act on the session's offer;
// a `queueOffer` while one for the session is in flight is refused. `saveLog` and `download` start a save into the
// Downloads folder and answer once it is in `builds.downloads`; a refusal answers `{ problem }` and starts nothing.
export interface BuildsChannel extends ChannelShape {
  invoke: {
    setShown(shown: boolean): void;
    branches(arg: {
      backend: string;
      game: string;
      set: string | null;
    }): Promise<GitRemoteHead[] | { problem: string }>;
    queue(arg: {
      backend: string;
      game: string;
      kind: string;
      branch: string;
      sessionId: string | null;
    }): Promise<{ ok: true } | { problem: string }>;
    queueOffer(sessionId: string): Promise<{ ok: true } | { problem: string }>;
    dismissOffer(sessionId: string): void;
    cancel(arg: {
      backend: string;
      game: string;
      build: string;
    }): Promise<{ ok: true } | { problem: string }>;
    launchSetAgent(arg: {
      backend: string;
      game: string;
      set: string;
    }): Promise<{ ok: true } | { problem: string }>;
    saveLog(arg: {
      backend: string;
      game: string;
      build: string;
      job: string | null;
    }): Promise<{ ok: true } | { problem: string }>;
    // file: a BuildFile.entry
    download(arg: {
      backend: string;
      game: string;
      build: string;
      file: number;
    }): Promise<{ ok: true } | { problem: string }>;
  };
  messages: Record<never, never>;
}
