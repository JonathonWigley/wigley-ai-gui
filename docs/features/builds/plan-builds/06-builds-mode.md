# 06 — Builds mode, its queue picker and the `builds` layout

Status: not started
Type: Task
Rung: hard · adds the `builds` Layout contract (`layouts/layout.d.ts`) and the page part that 07 extends, with many parts (side bar, list, All feed, detail, picker)
Wave: 2 · Depends on: 01 (`GitRemoteHead`), 02
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/builds/page/start.ts` — `buildsPagePart`, the empty part 02 created and registered
- create `src/plugins/builds/page/builds-view.ts` — the mode's side bar and sheet, keys, picker
- create `src/plugins/builds/page/builds-view-model.ts` — the pure rules below
- create `src/plugins/builds/page/queue-picker.ts` — the two-step queue picker
- create `src/plugins/builds/page/demo-sample.ts` — the demo step's sample snapshot
- create `src/plugins/builds/page/demo-steps.ts` — the Builds demo step, page half only
- create `src/plugins/builds/page/builds.css` — CSS for the panes the app draws itself
- create `src/plugins/builds/page/layout/read-builds-layout.ts`
- create `src/plugins/builds/layouts/layout.d.ts`
- create `src/plugins/builds/layouts/default/layout.js`
- create `src/plugins/builds/layouts/default/layout.css`
- modify `src/plugins/builds/manifest.ts` — the page commands and scopes below
- modify `src/plugins/keymap.ts` — the binds below
- modify `docs/features/layouts/design.md` — a `builds` row in § Adopters
- modify `docs/features/demo/design.md` — a `Builds` bullet in § Real state stays untouched
- test `src/plugins/builds/page/builds-view-model.test.ts`
- test `src/plugins/builds/page/start.test.ts`

Pattern: `src/plugins/chatroom/page/start.ts` (a mode with a side bar, `createLayoutParts`, `api.layouts.show`, a page demo half) and `src/plugins/chatroom/layouts/` (its contract and `default`). The queue picker follows `src/plugins/scheduling/page/start.ts` (`services.picker.create({ filter: true })`, `LIST_PICKER_COMMANDS`).

Consumes:
- `buildsSnapshotSlot`, `buildsSessionsSlot`, `BuildsSnapshot`, `BackendView`, `GameView`, `SetRunView`, `BuildRecord`, `BuildJob`, `BuildLink`, `BuildRef`, `GameEntry`, `BuildSetEntry`, `BackendCapabilities`, `SessionBuilds` ← 02
- `kindLabel(game: GameEntry, kind: string): string` (the kind's label, else the kind id) and
  `shortRevision(sha: string): string` (the first 8 characters) in `src/plugins/builds/builds-model.ts` ← 02. 06
  uses both and defines neither.
- `GitRemoteHead` (`src/contracts/git.ts`) ← 01; 02's `branches` member returns the structurally equal inline `{ name: string; sha: string }[]`
- `BuildsChannel` with the methods `setShown`, `branches`, `queue`, `cancel`, `launchSetAgent`, in the tree's channel shape (`interface BuildsChannel extends ChannelShape { invoke: { … } }`), called as `api.channel.invoke('<method>', arg)` ← 02
- `buildsManifest` in `src/plugins/builds/manifest.ts`, with `dependsOn.page` `['sessions', 'chat']`, `settings.layout` `'default'` and `settingControls.layout` `'layout'` ← 02
- `buildRecord(overrides?: Partial<BuildRecord>): BuildRecord` and `gameEntry(overrides?: Partial<GameEntry>): GameEntry` in `src/plugins/builds/contract.test-support.ts` ← 02
- `sessionsRowsSlot`, `SessionRow.label` (`src/plugins/sessions/contract.ts`, in the tree)
- `services.picker`, `services.openExternal`, `services.toast`, `services.clock`, `services.demoSteps` (`PageServices`, in the tree)

Produces:
- `export const buildsPagePart: PagePart<typeof buildsManifest>` in `src/plugins/builds/page/start.ts`
- `export interface BuildsLayout` and `export interface CompleteBuildsLayout extends Required<BuildsLayout>` in `src/plugins/builds/layouts/layout.d.ts`, with the parts in § Layout below
- `export function readBuildsLayout(module: unknown, name: string): BuildsLayout` in `src/plugins/builds/page/layout/read-builds-layout.ts`, over a `LAYOUT_PARTS: Record<keyof BuildsLayout, true>` table
- in `src/plugins/builds/page/builds-view-model.ts`:
  - `export type BuildsEntryKey = 'all' | \`${string}/${string}\`` — `all`, or `<backendId>/<gameId>`
  - `export type FeedFilter = 'all' | 'running' | 'sessions'`
  - `export function gameDot(builds: readonly BuildRecord[]): DotStatus`
  - `export function sideBarEntries(snapshot: BuildsSnapshot): SideBarEntry[]`, where `type SideBarEntry = { kind: 'all' } | { kind: 'backend'; backendId: string; label: string; problem: string | null } | { kind: 'game'; key: BuildsEntryKey; label: string; dot: DotStatus }`
  - `export function buildRowInput(record: BuildRecord, view: GameView, queuedBy: string | null, now: number): BuildRowInput`
  - `export function gameRows(view: GameView, queuedByOf: (backendId: string, buildId: string) => string | null, now: number): GameListItem[]`, where `type GameListItem = { kind: 'build'; row: BuildRowInput } | { kind: 'set'; group: SetGroupInput; rows: BuildRowInput[] }`
  - `export function feedRows(snapshot: BuildsSnapshot, filter: FeedFilter, linked: ReadonlySet<string>, queuedByOf: (backendId: string, buildId: string) => string | null, now: number): BuildRowInput[]`
  - `export function linkedBuilds(sessions: ReadonlyMap<string, SessionBuilds>): Map<string, string>` — `<backendId>/<buildId>` → session id
  - `export function queueChoices(game: GameEntry): QueueChoice[]`, where `type QueueChoice = { kind: 'kind'; id: string; label: string } | { kind: 'set'; id: string; label: string; set: BuildSetEntry }`
  - `export function queuedBy(key: string, triggeredBy: string | null, linked: ReadonlyMap<string, string>, sessionLabels: ReadonlyMap<string, string>): string | null` — the label of the session that links `key`, else `triggeredBy`
  - `export function heldKey(before: readonly string[], after: readonly string[], key: string | null): string | null` — the key the cursor keeps after a redraw
  - `export function emptyReason(snapshot: BuildsSnapshot, entry: BuildsEntryKey, shownRows: number): EmptyInput['reason'] | null`
- step `builds.mode` registered through `services.demoSteps` in `src/plugins/builds/page/demo-steps.ts`

## Manifest additions

Add to `buildsManifest.commands`, each `runsIn: 'page'`:

| Command | Label | Group | Arg |
|---|---|---|---|
| `showMode` | `builds (again: toggle the side bar)` | `modes` | none |
| `pickQueue` | `queue a build` | `build` | none |
| `openDetail` | `open or close the build's detail` | `list` | none |
| `openWeb` | `open the build in the backend` | `list` | none |
| `cancel` | `cancel the build` | `list` | none |
| `listDown`, `listUp`, `listTop`, `listBottom` | `next build`, `previous build`, `first build`, `last build` | `list` | none |
| `gameDown`, `gameUp`, `gameTop`, `gameBottom` | `next game`, `previous game`, `first game`, `last game` | `games` | none |
| `openGame` | `show the game's builds` | `games` | none |
| `selectEntry` | `show this entry` | `games` | `'string'` (a `BuildsEntryKey`) |
| `selectBuild` | `select this build` | `list` | `'string'` (`<backendId>/<buildId>`) |
| `queueButton` | `queue this kind or set` | `build` | `{ backend: 'string', game: 'string', kind: 'string' }` |
| `withAgent` | `make this set with an agent` | `build` | `{ backend: 'string', game: 'string', set: 'string' }` |
| `setFilter` | `filter the feed` | `list` | `'string'` (a `FeedFilter`) |
| `openLink` | `open the link` | `list` | `'string'` (a URL) |
| `...LIST_PICKER_COMMANDS` | | | |

Add `scopes`: `games: 'In the Builds game list'`, `list: 'In the Builds list'`, `picker: 'In the Builds queue picker'`.
Update the manifest's header comment to name the page commands and that click commands (`selectEntry`,
`selectBuild`, `queueButton`, `withAgent`, `setFilter`, `openLink`) have no key.

## Keymap additions (`src/plugins/keymap.ts`)

- `{ keys: '<Leader>km', scope: 'any', command: 'builds.showMode' }`, after `<Leader>kc`.
- `{ keys: '<Leader>mq', scope: 'any', command: 'builds.pickQueue' }`. 07 adds the `<Leader>m` group name.
- Scope `builds.games`: `j` `builds.gameDown`, `k` `builds.gameUp`, `gg` `builds.gameTop`, `G` `builds.gameBottom`,
  `<CR>` `builds.openGame`, `q` `builds.pickQueue`.
- Scope `builds.list`: `j` `builds.listDown`, `k` `builds.listUp`, `gg` `builds.listTop`, `G` `builds.listBottom`,
  `<CR>` `builds.openDetail`, `q` `builds.pickQueue`, `o` `builds.openWeb`, `x` `builds.cancel`.
- `'builds.picker'` joins `LIST_PICKER_SCOPES`.
- `'builds.games'` and `'builds.list'` join the `<C-n>` `chat.startNewSession` scope list, after `'chatroom.log'`.

## Layout

`src/plugins/builds/layouts/layout.d.ts`, in the shape of `src/plugins/chatroom/layouts/layout.d.ts`. Every kit
extends `BaseKit`. Each part appends its root to `parent` and returns it. Times are milliseconds; a layout writes them
with `kit.duration(ms)`.

```ts
export interface BuildsPane { element: HTMLElement }
export interface BackendHeadingInput { label: string; problem: string | null }
export interface GameEntryInput { label: string; dot: DotStatus }
export interface QueueButtonInput { id: string; label: string; withAgent: boolean }
export interface GameHeaderInput {
  backendId: string; gameId: string; label: string; backendLabel: string;
  kinds: QueueButtonInput[];   // withAgent always false
  sets: QueueButtonInput[];    // withAgent true when the set has an agentPrompt
  canQueue: boolean;           // capabilities !== null: false only while the backend has no instance
}
export interface FeedHeaderInput { filter: 'all' | 'running' | 'sessions' }
export interface BuildRowInput {
  key: string;                 // `<backendId>/<buildId>`
  gameLabel: string;           // drawn only in the All feed
  kindLabel: string; number: string | null; version: string | null;
  branch: string; shortRevision: string | null; subject: string | null;
  state: 'queued' | 'running' | 'finished'; result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null; leftMs: number | null; startsInMs: number | null;
  queuedBy: string | null; inFeed: boolean;
}
export interface SetGroupInput { label: string; shortRevision: string | null }
export interface BuildDetailInput {
  statusText: string | null; webUrl: string | null; links: { label: string; url: string }[];
  jobs: { label: string; state: 'queued' | 'running' | 'finished'; result: 'success' | 'failure' | 'cancelled' | null;
          percent: number | null; leftMs: number | null; stepText: string | null }[];
}
export interface EmptyInput { reason: 'noBackends' | 'noGames' | 'noBuilds' | 'noMatches' }
export interface PickerRowInput { picker: string; label: string }

export interface SideBarKit extends BaseKit { entries(parent: HTMLElement): HTMLElement }  // ol.builds-entries
export interface MainKit extends BaseKit { body(parent: HTMLElement): HTMLElement }       // div.builds-body; the app puts the list `ol` in it
export interface SetGroupKit extends BaseKit { rows(parent: HTMLElement): HTMLElement }   // ol.builds-set-rows; the app puts the set's rows in it
export interface PickerRowKit extends BaseKit { trailing(): HTMLElement | null }

export interface BuildsLayout {
  sideBar?(parent: HTMLElement, kit: SideBarKit): BuildsPane;
  main?(parent: HTMLElement, kit: MainKit): BuildsPane;
  allEntry?(parent: HTMLElement, kit: BaseKit): HTMLElement;   // draws `All`
  backendHeading?(parent: HTMLElement, input: BackendHeadingInput, kit: BaseKit): HTMLElement;
  gameEntry?(parent: HTMLElement, input: GameEntryInput, kit: BaseKit): HTMLElement;
  gameHeader?(parent: HTMLElement, input: GameHeaderInput, kit: BaseKit): HTMLElement;
  feedHeader?(parent: HTMLElement, input: FeedHeaderInput, kit: BaseKit): HTMLElement;
  setGroup?(parent: HTMLElement, input: SetGroupInput, kit: SetGroupKit): HTMLElement;
  // parent: the list `ol` in `div.builds-body`, or a set group's `ol.builds-set-rows`; the root is an `li`
  buildRow?(parent: HTMLElement, input: BuildRowInput, kit: BaseKit): HTMLElement;
  // parent: the same `ol` as its row; the app places the root, an `li`, right after the row's root
  buildDetail?(parent: HTMLElement, input: BuildDetailInput, kit: BaseKit): HTMLElement;
  empty?(parent: HTMLElement, input: EmptyInput, kit: BaseKit): HTMLElement;
  pickerRow?(parent: HTMLElement, input: PickerRowInput, kit: PickerRowKit): HTMLElement;
}
```

The contract's comments say, for each slot, what the app places in it, and that the app sets the click and
`is-selected` / `is-cursor` on each `allEntry`, `gameEntry` and `buildRow` root (a row gives `kit.row` no
`onClick`). Kit scopes: `sideBar`, `allEntry`, `backendHeading`, `gameEntry` `builds.games`; `main`, `gameHeader`,
`feedHeader`, `setGroup`, `buildRow`, `buildDetail`, `empty` `builds.list`; `pickerRow` `builds.picker`.

The `default` layout (`layout.js`, `// @ts-check`, every part defined) draws:
- `gameHeader`: the label, then one `kit.button` per kind (`builds.queueButton`, arg `{ backend, game, kind: id }`),
  per set (the same command, `kind` the set id), and per set with `withAgent` a `<set label> with agent` button
  (`builds.withAgent`, arg `{ backend, game, set: id }`). No button while `canQueue` is false.
- `feedHeader`: three chips `All`, `Running`, `From sessions`; a click runs `builds.setFilter` with `all`, `running`
  or `sessions`; the shown filter's chip is `is-selected`.
- `buildRow`: kind label; `#<number>` and `(<version>)` when not null; branch; short revision and subject
  (the short revision alone when `subject` is null); the state: while running, a `kit.meter` at `percent`
  (tone `normal`) and `<duration> left`; `starts in <duration>` while queued with `startsInMs`, `Queued` while queued
  without it, `Succeeded`, `Failed` or `Cancelled` when finished; then `queuedBy` when not null. The game label
  leads the row when `inFeed`. With `percent` null, draw no meter. With `leftMs` null, draw no `left` text. A running
  row with `percent` null shows `Running`. A `finished` row with `result` null reads `Ended`.
- `buildDetail`: each job with its state, meter, time left and step text, with the same null rules as `buildRow`
  (no meter at a null `percent`, no `left` text at a null `leftMs`, `Running` for a running job with no `percent`,
  `Ended` for a finished job with a null `result`); the status text; each link as a `kit.button`
  (`builds.openLink`, arg the URL); `Open in the backend` (`builds.openWeb`) while `webUrl` is not null.
- `empty`: `noBackends` `No build backends. Add one to builds.backends in settings.json.`; `noGames` `No tracked
  games.`; `noBuilds` `No builds yet.`; `noMatches` `No builds match the filter.`

Decisions:
- Builds mode on `<Leader>km`, `j`/`k` move, `Enter` opens the detail, `q` queues, `o` opens the build in the
  backend, `x` cancels where the backend can, `<Leader>mq` opens the queue picker from anywhere (design.md § Builds
  mode; plan.md § Design Overview).
- Side bar: the All entry first, then each backend's label as a heading with its problem under it, then its games,
  each with a dot for its newest build's state (design.md § Builds mode).
- `gg`/`G` on both lists and the `builds.games` scope's `j`/`k`/`Enter`/`q` follow every list in the app
  (`chatroom.threads`, `scheduling.list`); keymap.md § Adding a bind, steps 1–3 settle them. Decided.
- The detail opens under its row in the list (Enter again closes it; one detail open at a time), so the detail
  needs no scope and no close key of its own. Decided: it keeps the mode's keys to the settled set. The detail is a
  sibling of its row: the app places its root right after the row's root, in the same container (an `li` in the
  list `ol` in `div.builds-body`, or in a set group's `ol.builds-set-rows`).
- Keys and focus. The `Mode` callbacks follow `src/plugins/chatroom/page/chatroom-view.ts`:
  - `shown()` sets the scope `builds.games`, places the side-bar cursor and invokes `setShown(true)`.
  - In `builds.games`, `j`/`k`/`gg`/`G` move only the side-bar cursor. They do not change the selected entry.
  - Enter in `builds.games` (`openGame`) selects the entry under the cursor and calls `mode.picked()`. The keys stay
    in the side bar. `picked()` closes a narrow window's side-bar overlay, as in chatroom.
  - `focusMain` sets `builds.list` and calls `mode.picked()`, as chatroom's `focusMain` does.
  - `focusSideBar` and `sideBarOpenedOver` set `builds.games`.
  - `sideBarHidden` sets `builds.list` when `builds.games` had the keys.
  - A focus target moves `right` from `builds.games` to `builds.list`; every other move goes on to the core, as
    chatroom's `focusTarget` does.
  - `hidden()` invokes `setShown(false)` and bumps the picker generation (below).
- The view holds the cursor, the open detail and the selected entry by key, never by index. A build key is
  `<backendId>/<buildId>`; an entry key is a `BuildsEntryKey`. Each draw rebuilds the list of cursor keys:
  - The cursor stops on build rows only, never on a set group's heading or a backend heading. The order is the
    drawn order: group order, then newest first.
  - Sorts by `queuedAt` are stable. Builds with equal `queuedAt` keep the snapshot's order.
  - `j`/`k` clamp at both ends, as `movedIndex` in `src/plugins/chatroom/page/chatroom-state.ts` does. They do not
    wrap.
  - `heldKey` gives the cursor's key after a redraw: the key itself while it is still drawn; else the nearest
    surviving key, first the later rows of the old order, then the earlier rows; else the first row; else null.
  - The detail closes when its build is no longer drawn.
  - The selected entry falls back to `all` when its game is no longer in the snapshot.
- The view keeps a lookup from key to record, game or entry, built at each draw. `selectBuild`, `selectEntry`,
  `cancel`, `openWeb` and `openDetail` read that lookup. The view never splits a key on `/`, because a backend id
  can hold `/`.
- The newest build is the one with the largest `queuedAt`. `gameDot`: no builds `idle`; `queued` `idle`; `running`
  `running`; finished `success` `success`, `failure` `error`, `cancelled` `warning`.
- One game's list: newest first by `queuedAt`. A set run's builds draw as one group (`setGroup`, label the set
  run's `label`, short revision its `revision`) at the place of its newest build, its rows newest first
  (design.md § Builds mode, § Sets and RCs). The All feed is flat, every game's builds newest first, with no groups.
- Filter `running` keeps the builds whose state is not `finished`; `sessions` keeps the builds a session links
  (`buildsSessionsSlot`). Decided: the `running` chip keeps every build that is not `finished`, queued builds
  included, because the chip means not finished.
- Who queued it (`queuedBy`): the label of the session row that links the build (`sessionsRowsSlot`), else the
  record's `triggeredBy`, else nothing. A link whose session row is gone falls to `triggeredBy` (design.md
  § Builds mode).
- Kind label: `kindLabel(game, build.kind)` from 02. Short revision: `shortRevision(revision)` from 02. The subject
  comes from `GameView.subjects[revision]`, and the row shows the short sha alone when the subject is absent
  (design.md § Builds mode, Commit subjects).
- Empty state: `emptyReason` picks the reason in this order. `noBackends`: the snapshot has no backends. `noGames`:
  no backend holds a game. `noBuilds`: the shown scope (All, or the shown game) has no build, with any filter.
  `noMatches`: builds exist in the shown scope and the filter hides all of them. It returns null while
  `shownRows` is above 0.
- `leftMs` is `leftSeconds * 1000`; `startsInMs` is `max(0, startEstimate - now)`, null without a `startEstimate`;
  `now` is `services.clock.now()` at each draw. The view redraws on each change of `buildsSnapshotSlot`,
  `buildsSessionsSlot` and `sessionsRowsSlot`, and on no timer. `setLayouts` (from `api.layouts.show`) redraws the
  side bar, the sheet and the open picker (`picker.redraw()`), as `src/plugins/chatroom/page/start.ts` does.
- Capabilities: the view reads `BackendView.capabilities !== null` as the backend has an instance, the same test
  03's `queueing` applies. `GameHeaderInput.canQueue`, step 0 and `x` key on it, not on `problem`: a parse problem
  or one game's list failure leaves the backend's other games queueable. A null `capabilities` reads as `cancel`
  false and as the no-instance case for `choosesBranch`. `q` or `<Leader>mq` on a shown game whose backend has a
  null `capabilities` opens no step and toasts `<backend label> cannot queue builds` (tone `warning`).
- Queue picker (shared list picker, `services.picker.create({ filter: true })`, scope `builds.picker`):
  - The game: `q` in `builds.games` queues the game under the side-bar cursor. `q` in `builds.list` and
    `<Leader>mq` use the shown game.
  - From `q` or `<Leader>mq` with a game: step 1, the game's choices from `queueChoices` (kinds in
    `game.kinds` key order under the heading `Kinds`, then sets in `game.sets` order under `Sets`), title
    `Queue <game label>`. With All shown or the mode never shown: step 0 first, every game whose backend has a
    `capabilities` that is not null, label `<backend label> · <game label>`, title `Queue a build`.
  - A kind or set button skips to step 2 for that choice.
  - Step 2, only when the backend's `capabilities.choosesBranch` is true and the game has a `clone`:
    `channel.invoke('branches', { backend, game, set })` (`set` the set id, or null for a kind). The rows are the
    heads in the order `branches` returned: 03 already sorts them (the default branch first, then `localeCompare`),
    so the view does not sort them again. Label `<name>  <shortRevision(sha)>`, `name` the branch name, title
    `<choice label>: pick a branch`. A `{ problem }` answer toasts the problem (tone `error`); an empty list
    toasts `No branch on origin matches <set.branches>` for a set and `No branches on origin` for a kind
    (tone `warning`).
  - With `choosesBranch` true and a game with no `clone`, the picker skips step 2. The choice queues at once with
    `branch` the game's `defaultBranch` and no revision (03's `queue` reads none and records null).
  - Choosing a branch invokes `channel.invoke('queue', { backend, game, kind: <kind or set id>, branch,
    sessionId: null })`. With `choosesBranch` false, the kind or set choice queues at once with `branch` the game's
    `defaultBranch`. A `{ problem }` answer toasts the problem (tone `error`); `{ ok: true }` logs
    `queued <backend>/<game> <kind> on <branch>`. No confirm (design.md § Builds mode, Queueing).
  - Stale answers: the view keeps a picker generation counter. Each press that opens the picker or queues (`q`,
    `<Leader>mq`, a kind, set or `withAgent` button, a picker choice), the picker's `cancelled` and `hidden()` bump
    it. A continuation that awaited `branches` drops its result when the generation moved since its press.
  - In flight: while a `queue` invoke waits for its answer, a second `queue` press does nothing. The flag clears
    when the answer lands, `{ ok: true }` or `{ problem }`.
- `withAgent` invokes `channel.invoke('launchSetAgent', { backend, game, set })`; a problem toasts (tone `error`)
  (design.md § Sets and RCs).
- `x`: the backend's `capabilities.cancel` false toasts `<backend label> cannot cancel builds` (tone `warning`) and
  invokes nothing; a finished build toasts `The build has ended` (tone `warning`); else
  `channel.invoke('cancel', { backend, game, build })`, a problem toasting (tone `error`) (design.md § Builds mode).
- `o` and Open in the backend run `services.openExternal(webUrl)`; a null `webUrl` toasts
  `This build has no link in the backend` (tone `warning`).
- `setShown`: the mode's `shown()` invokes `setShown(true)`, `hidden()` and the part's `dispose` invoke
  `setShown(false)`; a failed invoke logs `setShown failed: <error message>` (design.md § Polling and the model;
  plan.md § Design Overview).
- The page keeps no place: a page load shows All with the first row at the cursor, as Schedules mode does
  (`src/plugins/scheduling/page/start.ts`). Decided.
- Mode: id `main`, title `Builds`, icon `package`; `showMode` shows the mode, or toggles its side bar while it shows,
  as chatroom's does.
- Demo step `builds.mode`: section `modes`, order 70, title `Builds`, caption `Builds: the CI and local builds of
  tracked games, queued in one press and followed live.`, files `src/plugins/builds/page/builds-view.ts`,
  `src/plugins/builds/page/start.ts`, `src/plugins/builds/main/start.ts`, `src/plugins/builds/layouts/default/layout.js`.
  Page half only: `enter` sets the view's sample (`demo-sample.ts`: one backend `Sample CI` with two games, a
  running build at 60 % with 7 min left, a queued build with a start estimate, a failed build with a failed job, and
  a set run of two builds) in place of `buildsSnapshotSlot`, and shows the mode on the first sample game in one beat
  (`game`). While the sample shows, `queueButton`, `pickQueue`, `withAgent`, `cancel`, `openWeb` and `openLink` do
  nothing and log `demo: <command> does nothing`. Selection, the detail and the filter chips work on the sample.
  The stage's dispose drops the sample (docs/features/demo/design.md § Steps, § Real state stays untouched).
- `docs/features/demo/design.md` § Real state stays untouched gains a bullet after `Chatroom`: `- **Builds**: the
  sample snapshot lives in the view; queue, cancel, with agent and open do nothing on it.`
- `docs/features/layouts/design.md` § Adopters gains the row `| \`builds\` | \`builds.layout\` | Builds mode: the
  side bar (All, each backend's heading and games), the game header with its queue buttons, the All feed's filter
  chips, the build rows, set groups and detail, the empty states and the queue picker's rows |`, after `chatroom`.
- `buildsManifest` is in `builtInManifests` (02 adds it), so the keymap's types check every bind against that list;
  `buildsPagePart` is in `pageParts` (02 adds it).

GIVEN the mode shows on a game whose backend has `choosesBranch: true` WHEN the user presses `q`, picks `Dev`, then
`main` THEN the page invokes `branches` with `{ backend: 'work', game: 'g1', set: null }` and then `queue` with
`{ backend: 'work', game: 'g1', kind: 'dev', branch: 'main', sessionId: null }`.
GIVEN a set `rc` with `branches` `releases/*` WHEN the user presses its button THEN `branches` is invoked with
`set: 'rc'` and the picker lists only main's answer.
GIVEN a backend with `capabilities.cancel: false` WHEN the user presses `x` on a running build THEN no `cancel`
invoke runs and the toast names the backend.
GIVEN Builds mode hides WHEN `hidden()` runs THEN the page invokes `setShown(false)`.
GIVEN a backend with `choosesBranch: true` and a game with no `clone` WHEN the user picks `Dev` THEN no `branches`
invoke runs and `queue` is invoked with `branch` the game's `defaultBranch`.
GIVEN the user picked `Dev` and `branches` has not answered WHEN the user presses Esc THEN the late answer opens no
step 2.
GIVEN a poll adds a newer build WHEN the view redraws THEN the cursor and the open detail stay on the same build.

Tests:
- `builds-view-model.test.ts`, `describe('gameDot')`: `it.each` — `[]` → `idle`; newest `queued` → `idle`; newest
  `running` → `running`; newest finished `success` → `success`; `failure` → `error`; `cancelled` → `warning`; an
  older `failure` (queuedAt 100) under a newer `success` (queuedAt 200) → `success`.
- `describe('sideBarEntries')`: one test over a snapshot of backend `a` (label `A`, no problem, games `a1`, `a2`) and
  backend `b` (label `B`, problem `games[0].id is missing`, no games) asserts the whole list:
  `all`, heading `A` problem null, game `a/a1`, game `a/a2`, heading `B` with its problem.
- `describe('buildRowInput')`: `it.each` — running, `leftSeconds` 90 → `leftMs` 90000; queued, `startEstimate`
  now + 150000 → `startsInMs` 150000; queued, `startEstimate` now − 5000 → `startsInMs` 0; queued with none →
  `startsInMs` null; revision `2993a9e4c1` with a subject → `shortRevision` `2993a9e4` and the subject; a revision
  absent from `subjects` → subject null; `queuedBy` `Fix jump` given → `Fix jump` over `triggeredBy` `ci-bot`;
  `queuedBy` null → `ci-bot`.
- `describe('gameRows')`: `it.each` — builds `b1` (queuedAt 100), set run `s1` holding `b2` (300) and `b3` (200),
  `b4` (250) → `[set s1 [b2, b3], b4, b1]`; set run `s1` holding `b2` (300) and `b9` (not in the list), `b1` (100) →
  `[set s1 [b2], b1]`; set run `s1` holding `b8` and `b9` (neither in the list), `b1` (100) → `[b1]` (no group);
  `b1` and `b4` both at queuedAt 100, snapshot order `[b1, b4]` → `[b1, b4]`.
- `describe('feedRows')`: `it.each` over one snapshot of two games (`b1` running, `b2` finished, `b3` queued, newest
  first `b3`, `b2`, `b1`) and `linked` `{ 'a/b2' }` — `all` → `[b3, b2, b1]`; `running` → `[b3, b1]`; `sessions` →
  `[b2]`.
- `describe('queuedBy')`: `it.each` — key `a/b1` linked to `s1`, labels `{ s1: 'Fix jump' }`, `triggeredBy`
  `ci-bot` → `Fix jump`; key `a/b1` linked to `s9`, labels `{}` (the row is gone), `triggeredBy` `ci-bot` →
  `ci-bot`; key `a/b1` not linked, `triggeredBy` `ci-bot` → `ci-bot`; not linked, `triggeredBy` null → null.
- `describe('heldKey')`: `it.each` — before `[a/1, a/2, a/3]`, after `[a/0, a/1, a/2, a/3]`, key `a/2` → `a/2`;
  before `[a/1, a/2, a/3]`, after `[a/1, a/3]`, key `a/2` → `a/3`; before `[a/1, a/2, a/3]`, after `[a/1, a/2]`,
  key `a/3` → `a/2`; before `[a/1]`, after `[a/5, a/6]`, key `a/1` → `a/5`; key null, after `[a/5]` → `a/5`;
  key `a/1`, after `[]` → null.
- `describe('emptyReason')`: `it.each` — no backends, entry `all`, shownRows 0 → `noBackends`; backend `a` with no
  games, entry `all`, 0 → `noGames`; game `a/a1` with no builds, entry `a/a1`, 0 → `noBuilds`; builds in `a/a1`,
  entry `all`, filter hides all, 0 → `noMatches`; no builds in any game, entry `all`, 0 → `noBuilds`; builds in
  `a/a1`, entry `all`, 2 → null.
- `describe('queueChoices')`: kinds `{ dev, release }` and set `rc` → `[kind dev, kind release, set rc]`.
- `describe('linkedBuilds')`: sessions `s1` → refs `[a/b1, a/b2]`, `s2` → `[b/b9]` → the map `a/b1 → s1`,
  `a/b2 → s1`, `b/b9 → s2`.
- `start.test.ts`, `describe('buildsPagePart')`, over `startDrawingPagePart` with a fake `sessions` and `chat`
  (`fakeDependency`) and a fake picker (`src/shared/page/fake-list-picker-service.test-support.ts`):
  - `it('tells main when the mode shows and hides')` — the invoke log holds `setShown` `true`, then `false`.
  - `it('tells main the mode hides when the part is disposed')` — after `shown()`, `dispose` → the invoke log ends
    on `setShown` `false`.
  - `it('logs a failed setShown')` — `setShown` rejects with `new Error('closed')` → the log holds
    `setShown failed: closed`.
  - The fixture for the rows below: backend `work` (label `Work`), game `g1` (label `Game One`, `defaultBranch`
    `protos/game`, clone `/clones/g1`, kinds `dev` (`Dev`) and `release` (`Release`), set `rc` (`RC`, `branches`
    `releases/*`)), and game `g2` (label `Game Two`).
  - `it.each` `'queues $choice'` — rows: kind `dev` with `choosesBranch` true → `branches` `{ backend: 'work',
    game: 'g1', set: null }`, then `queue` `{ backend: 'work', game: 'g1', kind: 'dev', branch: 'main',
    sessionId: null }`; set `rc` → `branches` with `set: 'rc'`, then `queue` with `kind: 'rc'`; kind `dev` with
    `choosesBranch` false → no `branches`, `queue` with `branch` `protos/game` (the game's `defaultBranch`); kind
    `dev` with `choosesBranch` true and game `g1` with `clone` null → no `branches`, `queue` `{ backend: 'work',
    game: 'g1', kind: 'dev', branch: 'protos/game', sessionId: null }`.
  - `it('logs a queued build')` — kind `dev`, branch `main`, `queue` answers `{ ok: true }` → the log holds
    `queued work/g1 dev on main`.
  - `it.each` `'x on a $state build'` — `cancel: false`, running → no `cancel` invoke, toast `Work cannot cancel
    builds` (tone `warning`); `capabilities` null, running → no `cancel` invoke, toast `Work cannot cancel builds`
    (tone `warning`); `cancel: true`, finished → no `cancel` invoke, toast `The build has ended` (tone `warning`);
    `cancel: true`, running → `cancel` `{ backend: 'work', game: 'g1', build: '41' }`, no toast.
  - `it('toasts a build with no link on o')` — `webUrl` null, `o` → no `openExternal` call, toast
    `This build has no link in the backend` (tone `warning`).
  - `it.each` `'toasts the $method problem'` — `branches`, `queue`, `cancel` and `launchSetAgent` each answer
    `{ problem: 'teamcity is not installed' }` → toast `teamcity is not installed` (tone `error`).
  - `it.each` `'toasts no heads for a $choice'` — `branches` answers `[]`: set `rc` → toast
    `No branch on origin matches releases/*` (tone `warning`); kind `dev` → toast `No branches on origin`
    (tone `warning`); neither runs `queue`.
  - `it.each` `'opens step 0 when $case'` — All shown, and the mode never shown (`<Leader>mq` first): the picker
    title is `Queue a build` and the rows are `Work · Game One`, `Work · Game Two`; a second backend `off`
    (label `Off`, `capabilities` null, game `g3`) adds no row.
  - `it('lists kinds then sets in step 1')` — `q` on game `g1` → title `Queue Game One`, rows `Dev`, `Release`
    under section `Kinds`, then `RC` under section `Sets`.
  - `it('queues the game under the side-bar cursor')` — the shown game `g1`, the side-bar cursor on `g2`, `q` in
    `builds.games` → title `Queue Game Two`.
  - `it('drops a branches answer that lands after Esc')` — pick `Dev`, press Esc, then `branches` answers
    `[{ name: 'main', sha: '2993a9e4c1' }]` → the picker does not open step 2 and no `queue` runs.
  - `it('queues once on two quick presses')` — pick `Dev`, then choose `main` twice before `queue` answers → one
    `queue` invoke.
  - `it('keeps the cursor and the detail on their build across a poll')` — rows `a/41`, `a/40`, cursor and detail
    on `a/40`; the snapshot adds `a/42` → the cursor and the open detail stay on `a/40`.
  - `it('closes the detail when its build is gone')` — detail open on `a/40`; the snapshot drops `a/40`, keeps
    `a/41` → no detail is open and the cursor is on `a/41`.
  - `it('shows All when the selected game is gone')` — `g2` selected; the snapshot drops `g2` → the entry `all` is
    selected.
  - `it('cannot queue a shown game with no backend instance')` — `capabilities` null, `q` → no picker opens, toast
    `Work cannot queue builds` (tone `warning`).
  - `it('launches the set agent from its button')` — `withAgent` `{ backend: 'work', game: 'g1', set: 'rc' }` →
    `launchSetAgent` with that arg.
  - `it.each` `'$command does nothing while the demo sample shows'` — after the step's `enter`: `queueButton`
    invokes nothing and logs `demo: queueButton does nothing`; `pickQueue` opens no picker, invokes nothing and
    logs `demo: pickQueue does nothing`.
- `src/plugins/keymap.test.ts` `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` (existing) runs over the new
  binds.
- Layout, look, the meter and the chip states are no asserts: task 10 "Final verification" checks them live.

Done when: compiles (`npm run typecheck`); `npm run lint` passes (02 registered every part, so no
composition-root failure is expected); the test gate runs the tests above. Every live, visual and drive check goes to task 10 "Final verification".
Note: the mode's live check waits for 07. The page part calls `api.layouts.show` on the `builds` layout, and 07
registers the layout contract in main (`api.layouts.register({ layoutTypes })`). Task 10 runs after both.
Commit: one commit for the group: `builds: Builds mode, queue picker and the builds layout`.

## Proof
