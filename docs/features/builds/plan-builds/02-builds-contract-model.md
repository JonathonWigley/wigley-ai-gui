# 02 — Builds contract, manifest and model

Status: not started
Type: Batch
Rung: hard · adds the `builds` contract, manifests, part skeletons and model that tasks 03–08 consume
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `wigley-ai-gui/src/plugins/builds/manifest.ts`
- create `wigley-ai-gui/src/plugins/builds/contract.ts`
- create `wigley-ai-gui/src/plugins/builds/contract.test-support.ts`
- create `wigley-ai-gui/src/plugins/builds/builds-model.ts`
- create `wigley-ai-gui/src/plugins/builds/main/start.ts` (skeleton; task 03 fills it)
- create `wigley-ai-gui/src/plugins/builds/page/start.ts` (skeleton; tasks 06 and 07 fill it)
- create `wigley-ai-gui/src/plugins/builds-teamcity/manifest.ts`
- create `wigley-ai-gui/src/plugins/builds-teamcity/main/start.ts` (skeleton; task 04 fills it)
- create `wigley-ai-gui/src/plugins/builds-local/manifest.ts`
- create `wigley-ai-gui/src/plugins/builds-local/main/start.ts` (skeleton; task 05 fills it)
- modify `wigley-ai-gui/src/plugins/manifests.ts`
- modify `wigley-ai-gui/src/plugins/main.ts`
- modify `wigley-ai-gui/src/plugins/page.ts`
- modify `wigley-ai-gui/scripts/check-layers.mts` (`PLUGIN_EXTRAS`, only when the lint asks)
- test `wigley-ai-gui/src/plugins/builds/builds-model.test.ts`

Consumes: `GitRemoteHead` is task 01's, and 01 runs in parallel with this task. Declare no
`GitRemoteHead` in `builds` and import none: write the `branches` channel member's heads as the
inline type `{ name: string; sha: string }[]`, and keep it. It is structurally equal to 01's
`GitRemoteHead`, so 03 and 06 pass `GitRemoteHead[]` through it unchanged. Every other type comes
from the tree: `Files`
(`src/contracts/files.ts`), `Clock` and `Timers` (`src/contracts/ambient.ts`), `ProcessRunner`
(`src/contracts/processes.ts`), `Git` (`src/contracts/git.ts`), `Platform`
(`src/contracts/platform.ts`), `Disposable` (`src/contracts/disposable.ts`), `ChannelShape` and
`DependencyKey`, `MainPart` and `PagePart` (`src/contracts/plugin.ts`), `SlotKey` and
`KeyedSlotKey` (`src/contracts/state.ts`), `Paths` (`src/contracts/paths.ts`) and `definePlugin`
(`src/shared/define-plugin.ts`).

Produces:

In `src/plugins/builds/contract.ts`, every name of plan.md § Shared names and signatures under
"builds contract" and "published state", written as plan.md gives them, with these four shapes the
tree's typing needs (each is a contract change the lead records):

```ts
interface BackendServices {
  processes: ProcessRunner; git: Git; files: Files; dataFiles: Files;
  dataFolder: string;      // added: the full path of the folder `dataFiles` points to
  paths: Paths;            // added: `src/contracts/paths.ts`
  clock: Clock; timers: Timers; homeDir: string; platform: Platform; log(message: string): void;
}
interface BackendKind {
  kind: string; label: string;
  create(entry: BackendEntry, services: BackendServices): Promise<BuildBackend | { problem: string }>;   // async
}
const buildsMainKey: DependencyKey<BuildsMainExports, 'main', 'builds'>;
const buildsSnapshotSlot: SlotKey<BuildsSnapshot, 'main', 'builds'>;       // 'builds.snapshot'
const buildsSessionsSlot: KeyedSlotKey<SessionBuilds, 'main', 'builds'>;   // 'builds.sessions'
interface BuildsChannel extends ChannelShape {
  invoke: {
    setShown(shown: boolean): void;
    branches(arg: { backend: string; game: string; set: string | null }): Promise<GitRemoteHead[] | { problem: string }>;
    queue(arg: { backend: string; game: string; kind: string; branch: string; sessionId: string | null }): Promise<{ ok: true } | { problem: string }>;
    queueOffer(sessionId: string): Promise<{ ok: true } | { problem: string }>;
    dismissOffer(sessionId: string): void;
    cancel(arg: { backend: string; game: string; build: string }): Promise<{ ok: true } | { problem: string }>;
    launchSetAgent(arg: { backend: string; game: string; set: string }): Promise<{ ok: true } | { problem: string }>;
  };
  messages: Record<never, never>;
}
```

Also in `contract.ts`: `export const BUILDS_PER_GAME = 20;` (design.md § Polling and the model:
"Each poll lists 20 builds per game"), read by task 03's poller.

In `src/plugins/builds/manifest.ts`: `export const buildsManifest = definePlugin({ … })`.
In `src/plugins/builds-teamcity/manifest.ts`: `export const buildsTeamcityManifest`; in
`src/plugins/builds-local/manifest.ts`: `export const buildsLocalManifest`.
Skeleton parts: `buildsMainPart` in `src/plugins/builds/main/start.ts`, `buildsPagePart` in
`src/plugins/builds/page/start.ts`, `buildsTeamcityMainPart` in
`src/plugins/builds-teamcity/main/start.ts`, `buildsLocalMainPart` in
`src/plugins/builds-local/main/start.ts`, each listed in `builtInManifests`
(`src/plugins/manifests.ts`), `mainParts` (`src/plugins/main.ts`) or `pageParts`
(`src/plugins/page.ts`).

In `src/plugins/builds/builds-model.ts`:

```ts
export const UNLISTED_ACTIVE_MS = 10 * 60 * 1000;
export interface SessionLink {
  sessionId: string; backendId: string; buildId: string; setRunId: string | null;
  linkedAt: number; failingNotified: boolean; notified: boolean; endedAt: number | null;
}
export interface SetRun {
  id: string; setId: string; label: string; backendId: string; gameId: string;
  sessionId: string | null; builds: BuildRef[]; revision: string | null;
  createdAt: number; notified: boolean; endedAt: number | null;
}
export interface GameState { game: GameEntry; builds: BuildRecord[]; subjects: Record<string, string> }
export interface BackendState {
  id: string; kind: string; label: string; problem: string | null;
  capabilities: BackendCapabilities | null; games: GameState[];
}
export interface BuildsModelInput {
  backends: BackendState[]; links: SessionLink[]; setRuns: SetRun[];
  offers: Record<string, BuildOffer>; polledAt: number | null; now: number;
}
export type BuildsEvent =
  | { kind: 'failing'; sessionId: string; ref: BuildRef; game: GameEntry; build: BuildRecord; failedJobs: BuildJob[] }
  | { kind: 'ended'; sessionId: string; ref: BuildRef; game: GameEntry; build: BuildRecord }
  | { kind: 'setEnded'; setRun: SetRun; game: GameEntry; builds: BuildRecord[] };
export interface BuildsFold {
  snapshot: BuildsSnapshot; sessions: Record<string, SessionBuilds>;
  events: BuildsEvent[]; activeBackends: string[];
}
export function foldBuilds(input: BuildsModelInput): BuildsFold;
// The one home of two display rules that tasks 03, 06 and 07 share.
export function kindLabel(game: GameEntry, kind: string): string;   // game.kinds[kind].label, else kind
export function shortRevision(sha: string): string;                 // the first 8 characters
```

In `src/plugins/builds/contract.test-support.ts` (record builders and a fixture backend for the
tests of tasks 03, 04, 05, 06 and 07):

```ts
export function buildRecord(overrides?: Partial<BuildRecord>): BuildRecord;   // id 'build-1'
export function buildJob(overrides?: Partial<BuildJob>): BuildJob;             // id 'job-1'
export function gameEntry(overrides?: Partial<GameEntry>): GameEntry;          // id 'game'
export function backendEntry(overrides?: Partial<BackendEntry>): BackendEntry; // id 'backend'
export function buildOffer(overrides?: Partial<BuildOffer>): BuildOffer;
export interface FixtureBackend extends BuildBackend {
  readonly listCalls: { gameId: string; limit: number }[];
  readonly queued: { gameId: string; request: QueueRequest }[];
  readonly cancelled: { gameId: string; buildId: string }[];
  readonly disposed: boolean;
  setBuilds(gameId: string, builds: BuildRecord[]): void;
  failLists(error: Error | null): void;
}
export function createFixtureBackend(options?: { capabilities?: BackendCapabilities }): FixtureBackend;
export function fixtureBackendKind(kind: string, backend: FixtureBackend): BackendKind;
```

Decisions:
- **Pattern.** Copy the contract shape of `src/plugins/system-stats/contract.ts` (slot key literals
  with their process and plugin, a channel that `extends ChannelShape`) and the manifest shape of
  `src/plugins/scheduling/manifest.ts` (its `layout` setting and `settingControls`). Copy `src/plugins/sessions/contract.test-support.ts`
  for the builders: an object of defaults spread under `overrides`.
- **Contract changes from plan.md** (each forced by the tree, AGENTS.md § Architecture **A plugin
  talks** and **A slot**): `BuildsChannel` is a `ChannelShape` with `invoke` and `messages`, since
  `api.channel.handle` and `invoke` index `Ch['invoke']`; the slot keys and the dependency key
  carry `'main'` and `'builds'`, since `state.publish` and `api.dependency` take only keys of the
  part's own process and plugin. `BackendServices` adds `dataFolder: string` and `paths: Paths`:
  a detached start's `logPath` is a full path (`DetachedStartOptions` in
  `src/contracts/processes.ts`), so the local backend needs the folder's full path beside its
  scoped `dataFiles` (design.md § The local backend). `BackendKind.create` returns a `Promise`, so
  a backend can read files or run a check while it parses its entry. All settled by the lead.
- **Builders.** Each builder takes only `overrides`. Defaults: `buildRecord` — `id: 'build-1'`,
  `gameId: 'game'`, `kind: 'dev'`, `number`, `version`, `revision`, `statusText`, `percent`,
  `leftSeconds`, `stepText`, `startedAt`, `finishedAt`, `startEstimate`, `webUrl`, `triggeredBy`
  null, `branch: 'main'`, `state: 'finished'`, `result: 'success'`, `queuedAt: 0`, `links: []`,
  `jobs: []`. `buildJob` — `id: 'job-1'`, `label: 'Job 1'`, `state: 'finished'`,
  `result: 'success'`, the rest null. `gameEntry` — `id: 'game'`, `label: 'Game'`, `clone: null`,
  `defaultBranch: 'main'`, `kinds: { dev: { label: 'Dev', target: 'dev-target' } }`, `sets: []`.
  `backendEntry` — `id: 'backend'`, `kind: 'fixture'`, `label: 'Backend'`, `config: {}`,
  `games: []`. `buildOffer` — `backendId: 'backend'`, `gameId: 'game'`, `kind: 'dev'`,
  `branch: 'main'`, `revision: null`, `subject: null`, `createdAt: 0`. `createFixtureBackend`'s
  default capabilities are `{ cancel: true, choosesBranch: true }`; `list` returns the builds set
  for the game (`[]` by default) cut to `limit`, or rejects with the error `failLists` set; `queue`
  returns `{ id: 'queued-<n>' }`, `n` from 1; `cancel` records the call; `dispose` sets `disposed`.
  `fixtureBackendKind` resolves `create` to that backend.
- **Registry and skeletons** (lead's ruling: `scripts/check-layers.mts` fails the lint when a
  plugin folder's `manifest.ts`, `main/start.ts` or `page/start.ts` is missing from
  `builtInManifests`, `mainParts` or `pageParts`, so this task makes every registry edit of the
  feature, and tasks 03 to 07 never touch `manifests.ts`, `main.ts` or `page.ts`):
  - Each skeleton part follows `src/plugins/window/main/start.ts`: a `MainPart` or `PagePart` of
    its manifest whose `start` registers nothing. `buildsMainPart`'s `commands` has the three main
    commands below, each throwing `new Error('builds.<short id>: not built yet')`; task 03
    replaces them. The other skeletons return `{ commands: {} }`.
  - `buildsTeamcityManifest`: `id: 'builds-teamcity'`, `label: 'TeamCity builds'`,
    `description: 'Adds the teamcity backend kind to Builds, over the teamcity CLI.'`,
    `dependsOn: { main: ['builds'], page: [] }`, `reads: { main: [], page: [] }`, no commands,
    scopes, settings or tokens, `demoSkip: 'It adds a backend kind to Builds and draws nothing of
    its own.'`. `buildsLocalManifest` the same with `id: 'builds-local'`, `label: 'Local builds'`,
    `description: 'Adds the local backend kind to Builds: a command per build kind, run in a
    clone.'`. Tasks 04 and 05 may extend their manifest.
  - Add `buildsManifest`, `buildsTeamcityManifest` and `buildsLocalManifest` to
    `builtInManifests` after `unityPoolManifest`, the three main parts to `mainParts` after
    `unityPoolMainPart`, and `buildsPagePart` to `pageParts` after `unityPoolPagePart`, each with
    its import beside the unity-pool one. Add a `PLUGIN_EXTRAS` entry only for an import the lint
    names.
- **Doc comments.** Write one on each interface and each member whose meaning is not in its name.
  Take the text from design.md § The backend seam for `BackendKind`, `BuildBackend` and
  `BuildRecord`: times are epoch milliseconds; a field the backend cannot read is null or `[]`;
  `cancel` is present only when `capabilities.cancel` is true; `list` gives the game's newest
  builds across its kinds, newest first; `queue` returns the new build's id; `create` returns a
  `{ problem }` that names what is wrong with the entry's `config` or a kind's `target`. On
  `BuildRecord.id`: unique within its backend. On `GameEntry.clone`: the `~` is expanded by
  `builds`, null when the entry names none. On `BuildSetEntry.branches`: a pattern under
  `refs/heads/`, as `Git.remoteHeads` takes it. On `BackendServices`: what `builds` hands each
  backend instance; `dataFiles` is scoped to a folder of that backend entry's own, and `log` logs
  under `builds` with the entry id first. On `SessionBuilds.builds`: newest link first.
- **Manifest** (design.md § Plugins, § Configuration, § Commands):
  - `id: 'builds'`, `label: 'Builds'`, `description: 'Shows the CI and local builds of the games
    you track, and queues builds and build sets.'`
  - The slots are the contract's `buildsSnapshotSlot` and `buildsSessionsSlot`; a manifest
    declares no slots.
  - `dependsOn: { main: ['chat'], page: ['sessions', 'chat'] }`,
    `reads: { main: ['sessions'], page: [] }`. Main reads `sessions.rows` (task 03 sends a message
    only to a session with a row).
  - `settings: { backends: [] as unknown[], layout: 'default' }`, `settingControls: { layout:
    'layout' }`. The empty array default lets settings accept any element shape; task 03 parses
    each element. `settingInfo.backends`: label `Build backends`, description `The build backends
    this machine uses, each with its tracked games, kinds and sets; see the builds design for the
    shape.` `settingInfo.layout`: label `Builds layout`, description `The layout that draws Builds
    mode and the session parts: a folder in the layouts/builds folder, or default.`
  - `commands`: the three main commands only, each with this label, group and `arg` (`risky` as
    given). Tasks 06 and 07 add every page command (`showMode`, `queueOffer`, `dismissOffer`,
    `pickQueue`, `openDetail`, `openWeb`, `cancel`, the list and picker commands) and every scope
    to this manifest in their own commits (lead's ruling).

    | short id | label | group | runsIn | arg | risky |
    |---|---|---|---|---|---|
    | `queue` | `queue a build or a build set` | `builds` | main | `{ backend: 'string', game: 'string', kind: 'string', branch: 'string' }` | `true` |
    | `offer` | `offer a build for the user to queue` | `builds` | main | `{ backend: 'string', game: 'string', kind: 'string', branch: 'string' }` | |
    | `launchSetAgent` | `run the set with its agent` | `builds` | main | `{ backend: 'string', game: 'string', set: 'string' }` | |

  - `scopes: {}`. No `keys` field: tasks 06 and 07 bind in `src/plugins/keymap.ts`. No
    `demoSkip`: tasks 06 and 07 register the demo steps. `themeTokens: {}`.
- **The model** (design.md § Polling and the model). `foldBuilds` is pure and reads no clock: the
  caller passes `now`. Events come from the links' flags, not from a diff with an earlier fold, so
  an ending missed while the app was closed is reported on the first fold after start (design.md:
  "An ending missed while the app was closed is told on the first poll after start"). Rules:
  - A link's build is the record whose `id` equals `link.buildId` in any game of the backend whose
    `id` equals `link.backendId`. A link with no such record gives no event.
  - `failing`: a link with `failingNotified` false whose build has `state` `queued` or `running`
    and at least one job with `result` `'failure'`. `failedJobs` holds those jobs in job order.
    A link of a set gives its own `failing` event (design.md § Sessions: "A build of a set sends
    its own").
  - `ended`: a link with `setRunId` null and `notified` false whose build has `state` `finished`.
    A finished build gives no `failing` event.
  - `setEnded`: a set run with `notified` false and a non-empty `setRun.builds`, where every ref
    in `setRun.builds` is ended. A ref is ended when its record has `state` `finished`, or when it
    has no record and `setRun.createdAt` is `UNLISTED_ACTIVE_MS` or more before `now`, so a set
    run whose builds fell out of the newest 20 still ends. `builds` holds the records found, in
    `setRun.builds` order; a ref with no record is left out. A set run with an empty `builds`
    gives no event. A set run with `sessionId` null still gives the event, so the caller can mark
    it told.
  - Event order in `events`: every `failing`, then every `ended`, then every `setEnded`, each
    group in link or set-run input order.
  - `snapshot.backends`: one `BackendView` per `BackendState`, in input order, with `games` as
    `GameView`s: `backendId`, `game`, `builds` and `subjects` copied, and `setRuns` as the
    `SetRunView`s (`id`, `setId`, `label`, `builds`, `revision`) of the set runs with that
    `backendId` and `gameId`, newest `createdAt` first. `snapshot.polledAt` is `input.polledAt`.
  - `sessions`: one key per session id that holds a link or an offer. `builds` are the refs
    (`backendId`, `buildId`) of that session's links, newest `linkedAt` first; `offer` is
    `offers[sessionId]`, else null.
  - `activeBackends`: the ids of backends with a link whose `notified` is false and whose build is
    `queued` or `running`, or whose build is in no list and whose `linkedAt` is less than
    `UNLISTED_ACTIVE_MS` before `now`. Each id once, in input backend order. The window gives a
    queued build time to show in the backend's list without fast polls lasting for a build that
    fell out of the newest 20.

GIVEN a running linked build with a failed job and `failingNotified` false WHEN the model folds
THEN it reports one `failing` event naming that job
GIVEN a finished build linked with `notified` false WHEN the model folds THEN it reports `ended`
GIVEN a set run whose second build still runs WHEN the model folds THEN it reports no `setEnded`
GIVEN two links of one session WHEN the model folds THEN the session's builds list the newer link
first

Tests (`src/plugins/builds/builds-model.test.ts`, `describe('foldBuilds')`, every row built with
the builders above; backend `b1`, game `g1`, session `s1` unless the row says otherwise):
- `it.each` "reports $case": the events for one link or set run.

  | case | input | expected events |
  |---|---|---|
  | failing once | link `x` (`failingNotified` false); `x` running, jobs `ios` failure and `and` running | one `failing`, `failedJobs` = [job `ios`] |
  | failing, two jobs | link `x`; `x` running, jobs `and` failure, `web` running, `ios` failure | one `failing`, `failedJobs` = [job `and`, job `ios`] |
  | failing in a set | link `x` with `setRunId` `r1`; `x` running, job `ios` failure | one `failing` for `x` |
  | failing told | as above, `failingNotified` true | none |
  | failing then ended | link `x`, both flags false; `x` finished failure, job `ios` failure | one `ended`, no `failing` |
  | ended once | link `x`, `notified` false; `x` finished success | one `ended` for `s1` |
  | ended told | link `x`, `notified` true; `x` finished | none |
  | set build ended | link `x` with `setRunId` `r1`; `x` finished | none |
  | queued with failed job | link `x`; `x` queued, job `ios` failure | one `failing` |
  | unknown build | link `y`; no record `y` | none |
  | unknown backend | link with `backendId` `b9` | none |
  | set running | set run `r1` over `x`, `z`; `x` finished, `z` running | none |
  | set ended | set run `r1` over `z`, `x`; both finished | one `setEnded`, `builds` = [`z`, `x`] |
  | set told | as above, `notified` true | none |
  | set without session | set run `r1`, `sessionId` null, both finished | one `setEnded` |
  | set ref unlisted, new | set run `r1` over `x`, `y`, `createdAt` = `now - UNLISTED_ACTIVE_MS + 1`; `x` finished, no record `y` | none |
  | set ref unlisted, old | as above, `createdAt` = `now - UNLISTED_ACTIVE_MS` | one `setEnded`, `builds` = [`x`] |
  | set empty | set run `r1` with `builds` [] | none |

- `it('orders failing, then ended, then setEnded events')` — one input with a `setEnded` set run
  first, an `ended` link second and a `failing` link third; the event kinds read
  `['failing', 'ended', 'setEnded']`.
- `it('lists each session's builds newest first, with its offer')` — links of `s1` at `linkedAt`
  100 (`x`) and 200 (`z`), an offer for `s2` only: `sessions` equals
  `{ s1: { builds: [z, x], offer: null }, s2: { builds: [], offer } }`.
- `it.each` "$case is active: $active" for `activeBackends`, with `now` 1_000_000:

  | case | link and record | active |
  |---|---|---|
  | running | `x` running, `notified` false | `['b1']` |
  | queued | `x` queued | `['b1']` |
  | finished | `x` finished, `notified` false | `[]` |
  | unlisted, new | no record; `linkedAt` = `now - UNLISTED_ACTIVE_MS + 1` | `['b1']` |
  | unlisted, old | no record; `linkedAt` = `now - UNLISTED_ACTIVE_MS` | `[]` |
  | two backends | backends in input order `b2`, `b1`; links `x` and `z` of `b1` running, link `w` of `b2` queued | `['b2', 'b1']` |

- `it('publishes each backend in order, with its set runs newest first')` — backends `b2` then
  `b1`; set runs of `b1`/`g1` at `createdAt` 5 and 9 and one of `b2`/`g1`: the views' ids read
  `['b2', 'b1']`, `b1`'s game holds set runs `[9, 5]` by `createdAt`, `b2`'s game holds only its
  own, and `polledAt` is the input's `1234`.
- `it.each` "kindLabel of $kind is $expected" over a game whose kinds hold `dev` with label
  `Dev`: `{ kind: 'dev', expected: 'Dev' }` and `{ kind: 'gone', expected: 'gone' }`.
- `it('shortRevision keeps the first 8 characters')`: `shortRevision('0123456789abcdef')` is
  `'01234567'`.

Done when: compiles (`npm run typecheck`); `npm run lint` passes with the three plugins
registered; the test gate runs `builds-model.test.ts` and `src/plugins/manifests.test.ts` (it
reads `builtInManifests`). Live checks: none for this task; task 10 "Final verification" covers the
published state through the mode.

Commit: one commit for the group.

## Proof
