# 04 — The auto-retro plugin

Status: not started
Type: Task
Wave: 2 · Depends on: 02, 03
Plan: [plan.md](plan.md)

All new paths are under `src/plugins/auto-retro/`. Read `docs/features/auto-retro/design.md` first: it is the
behaviour this task builds.

Files:
- create `manifest.ts` · `contract.ts` · `main/start.ts` · `main/retro-queue.ts` · `main/queue-file.ts`
  · `main/retro-done.ts` · `page/start.ts` · `page/layout/read-auto-retro-layout.ts` · `layouts/layout.d.ts`
  · `layouts/default/layout.js` · `layouts/default/layout.css`
- modify `src/plugins/manifests.ts` · `src/plugins/main.ts` · `src/plugins/page.ts`; `scripts/check-layers.mts`
  only when `npm run lint` asks for a `PLUGIN_EXTRAS` entry
- test `main/retro-queue.test.ts` · `main/retro-done.test.ts` · `main/start.test.ts` · `page/start.test.ts`

Consumes:
- `LaunchRequest.unattended?: boolean` ← 02
- `close(sessionId: string, reason: SessionCloseReason): Promise<void>` in `ChatMainExports` ← 02
- `export type SessionCloseReason = 'user' | 'start-failed' | 'project-closed' | 'finished';` ← 02
- `export function isUserClose(reason: SessionCloseReason): boolean;` ← 02
- `export interface SidebarSection { id; label; order; claims(row: SessionRow): boolean; header?: SectionPart }` ← 03
- `export interface SectionPart { build(parent: HTMLElement): { dispose?(): void }; }` ← 03
- `addSection(section: SidebarSection): Disposable;` in `SessionsPageExports` ← 03
- Members the tree holds: `ChatMainExports.launch` and `profiles()`, `chatMainKey`, `chatSessionSlot`
  (`ChatSessionInfo`: `activity`, `background`, `running`, `compaction`), `ChatMainEvents.sessionClosed`,
  `sessionCleared` and `turnStarted`; `SessionsMainExports.setTitle`, `sessionsMainKey`, `sessionsRowsSlot`,
  `followRows`, `editableTitle`, `sessionsPageKey`; `paths.expandTilde`; `api.data`; `api.layouts`.

Produces:
- `contract.ts`, word for word as plan.md's Shared names:
  ```ts
  export interface AutoRetroState { rows: string[]; queued: number } // rows: every row id launch returned and still open
  export const autoRetroStateSlot: SlotKey<AutoRetroState, 'main', 'auto-retro'>; // id 'auto-retro.state'
  ```
  The slot is `{ id: 'auto-retro.state', process: 'main', kind: 'value' }`.
- `manifest.ts`: `export const autoRetroManifest` (`definePlugin`).
- `main/retro-queue.ts`:
  ```ts
  export interface RetroItem { hostIds: string[]; profile: string; title: string | null }
  export interface RetroQueue {
    queued: RetroItem[];                                          // oldest first
    running: { item: RetroItem; hostSessionId: string | null } | null;
    launched: string[];                                           // host ids of every open retro row
    cleared: Record<string, string[]>;                            // a row's current host id → its earlier ids, oldest first
  }
  export const EMPTY_QUEUE: RetroQueue;
  export type QueueEvent =
    | { kind: 'closed'; hostSessionId: string; profile: string; titles: SessionTitles; sent: boolean; reason: SessionCloseReason }
    | { kind: 'cleared'; oldHostSessionId: string; newHostSessionId: string }
    | { kind: 'launching' }
    | { kind: 'launched'; hostSessionId: string }
    | { kind: 'launchFailed' }
    | { kind: 'started'; profiles: readonly string[] };
  export function nextQueue(queue: RetroQueue, event: QueueEvent): RetroQueue;
  export function parseQueue(text: string): RetroQueue;
  ```
- `main/queue-file.ts`: `export const QUEUE_FILE = 'queue.json'`;
  `export function createQueueFile(data: Files): { load(): Promise<RetroQueue>; save(queue: RetroQueue): Promise<void>; settled(): Promise<void> }`
- `main/retro-done.ts`: `export const RETRO_SETTLE_MS = 5000`;
  `export function isRetroDone(info: ChatSessionInfo | undefined, hasStarted: boolean): boolean`
- `main/start.ts`: `export const autoRetroMainPart: MainPart<typeof autoRetroManifest>`
- `page/start.ts`: `export const autoRetroPagePart: PagePart<typeof autoRetroManifest>`
- `layouts/layout.d.ts`: `export interface QueuedInput { queued: number }`, `export interface AutoRetroKit extends
  BaseKit {}`, `export interface AutoRetroPart { element: HTMLElement }`, `export interface Layout { queued?(parent:
  HTMLElement, input: QueuedInput, kit: AutoRetroKit): AutoRetroPart }`, `export interface CompleteLayout extends
  Required<Layout> {}`
- `page/layout/read-auto-retro-layout.ts`: `export function readAutoRetroLayout(module: unknown, name: string): Layout`

Decisions:
- **Manifest.** `id: 'auto-retro'`; `dependsOn: { main: ['chat', 'sessions'], page: ['sessions'] }`;
  `reads: { main: [], page: [] }`; no commands, scopes or theme tokens. Settings
  `{ folder: '~/wigley-agents', layout: 'default' }`. `settingInfo`:
  - `folder`: label `Retro folder`; description `The folder each background retro runs in: the clone that holds the
    retro ledger. ~ is the home folder.`
  - `layout`: label `Layout`; description `The auto-retro layout the Retro section's queued count draws in: a folder
    name in auto-retro's layouts folder, or default.` (The `layout` setting is not in the brief; `api.layouts.show`
    needs it, as in unity-pool.)
  - The manifest's top comment says what the plugin does and why it names `chat` and `sessions`.
- **Registration.** `autoRetroManifest` in `builtInManifests` after `sessionLogManifest`; `autoRetroMainPart` in
  `mainParts` after `sessionLogMainPart`; `autoRetroPagePart` in `pageParts` after `unityPoolPagePart`.
- **Host ids, not row ids, on disk.** A restored row gets a new row id at each start
  (`chat-sessions.ts` `restoreRecord` opens a new row), and its host id stays. So `queue.json` keys every row by host
  id. The slot's `rows` holds the current row ids. (`AutoRetroState.rows` is plan.md's name, kept as written.)
- **The queue rules** (`nextQueue`, pure; every rule is a row of its table test):
  - `closed`, host id in `launched`: remove it from `launched`; when it is `running.hostSessionId`, set `running` to
    null. Queue nothing. A retro never queues a retro.
  - `closed`, host id not in `launched`, `isUserClose(reason)` and `sent`: append `{ hostIds: [...cleared[host] ??
    [], host], profile, title }`. `title` is `editableTitle(titles)`, null when that is `''`. A host id already
    queued queues again: a re-closed row runs again.
  - Every `closed` deletes `cleared[host]`.
  - `cleared`, old id in `launched`: replace it with the new id in `launched` and in `running`. Otherwise
    `cleared[new] = [...cleared[old] ?? [], old]` and delete `cleared[old]`.
  - `launching`: when `running` is null and `queued` is not empty, `running = { item: queued[0], hostSessionId:
    null }` and `queued` drops its head. Otherwise no change.
  - `launched`: `running.hostSessionId = hostSessionId`; append it to `launched`.
  - `launchFailed`: `running = null`.
  - `started`: a `running` with `hostSessionId` null goes back to the head of `queued` (a launch a quit cut short).
    A `running` whose item's profile is not in `profiles` is dropped: `running = null` and its host id leaves
    `launched`. Otherwise no change.
  - `nextQueue` returns a new object and never changes its input.
- **`parseQueue`** throws `queue.json is not a queue` for text that is not JSON or not the `RetroQueue` shape.
- **The file** (`queue-file.ts`): `load` returns `EMPTY_QUEUE` for a missing file and throws for an unreadable one.
  `save` writes the whole queue as JSON with 2-space indent, each write after the one before settles, as
  `session-stash`'s `stash-store.ts` does.
- **Start** (`main/start.ts`). The part:
  1. Registers its layouts (`api.layouts.register({ layoutTypes })`, `layoutTypes` from `../layouts/layout.d.ts?raw`)
     and publishes `autoRetroStateSlot`.
  2. Subscribes to `chat.sessionClosed`, `chat.sessionCleared` and `chat.turnStarted` at once, and runs every
     handler through one serial chain that starts after `load` settles, so no event is lost or applied to an old
     state.
  3. Loads the queue. A load that throws logs `queue.json not read: <error>`; the part then runs on `EMPTY_QUEUE`
     and writes `queue.json` never during this start, since the file is the user's state.
  4. Applies `started` with the names of `chat.profiles()`, and logs `dropped retro <host id>: profile <profile> is
     gone` for a dropped running item.
  5. Follows `sessionsRowsSlot` with `followRows`: an added row whose host id is in `launched` joins the slot's
     `rows`; a removed row leaves it. A row that joins this way is a restored row and counts as started: a launched
     row's host id enters `launched` only after its row exists, so a launched row joins at `launched` (below) and
     counts as not started.
  6. Applies `launching` and launches when the result has a new `running`.
  - After each change: `save`, then write the slot (`{ rows, queued: queue.queued.length }`), then launch when
    `running` is new.
- **The launch.** `chat.launch({ projectDir: paths.expandTilde(settings().folder, homeDir), profile: item.profile,
  message: { text: '/wigley:retro auto ' + item.hostIds.join(' '), images: [] }, unattended: true })`. The folder is
  read at each launch. One launch at a time. On resolve with row id `r`: read `sessionsRowsSlot.get(r)?.hostSessionId`.
  - A host id: apply `launched`; `r` joins the slot's `rows`; call `sessions.setTitle(r, 'user', item.title)` when `item.title` is not null; log
    `launched retro <r> for <host ids, space-joined>`.
  - No row (it already closed): apply `launchFailed`; log `retro row <r> gone at launch`.
  - On reject: apply `launchFailed`; log `retro launch failed for <host ids>: <errorText(error)>`. Then the next
    item launches.
- **Done** (`isRetroDone`, pure): false for `info` undefined or `hasStarted` false; true for `info.running` false;
  true for `activity === 'idle' && background === 0 && compaction === null`; false otherwise. `hasStarted` is true
  for a restored row, and for a launched row once `chat.turnStarted` names it or its `chat.session` value shows an
  `activity` other than `idle`.
- **The settle.** The part reads `chatSessionSlot` for the running row only. When `isRetroDone` turns true it sets
  a `RETRO_SETTLE_MS` timer; any value for that row that reads not done clears the timer. When the timer fires and
  the row still reads done, it calls `chat.close(r, 'finished')` and logs `retro <r> finished`. A close that rejects
  logs `retro <r> not closed: <error>` and changes nothing: a row chat no longer holds already fired its
  `sessionClosed`. The `sessionClosed` of the retro row clears `running`, and the next item launches.
- **Logs.** Also log `queued retro of <host ids> (<n> queued)` on each queued close.
- **The slot's `rows`** are in the order the rows joined.
- **The page** (`page/start.ts`):
  - Reads `autoRetroStateSlot` (null reads as `{ rows: [], queued: 0 }`).
  - Registers the section through `sessions.addSection`: `id: 'auto-retro'`, `label: 'Retro'`, `order:
    RETRO_SECTION_ORDER` (`1000`, a constant with the comment "last: after every other section"), `claims: (row)
    => rows.includes(row.sessionId)` over the slot's current `rows`, and a `header`.
  - Sessions knows no change of `claims`. So each slot change that changes `rows` disposes the section's handle and
    adds it again, which redraws the side bar.
  - `header.build(parent)` keeps `parent` and draws into it: the layout part `queued` with `{ queued }` while
    `queued > 0`, and nothing while it is 0. A slot change that changes only `queued` redraws each kept parent. Its
    `dispose` drops the parent and disposes the drawn part.
  - Draws through `createLayoutParts` and `api.layouts.show`, with `defaultLayout`, `defaultStylesheet`,
    `readAutoRetroLayout` and `userLayout: () => api.settings().layout`, as `unity-pool/page/start.ts` does. A
    layouts set redraws each kept parent.
- **The layout contract** (`layouts/layout.d.ts`): the file's top comment says the app draws one `queued` part at the
  end of the Retro section's header while closes wait, and nothing while none waits; the app keeps the section, its
  rows and every redraw; the `data-layout-owner` and `data-layout` attributes as in unity-pool's contract.
- **The `default` layout**: `queued` draws `span.auto-retro-queued` with the text `<queued> queued` (`2 queued`).
  CSS: `--wg-fg-tertiary`, `--wg-text-12`, `white-space: nowrap`; theme tokens only.
- **No self-test script.** The plugin adds no key. The live check is the plan's final verification task.
- **Boundary.** The plugin names a skill only in its message text. It imports only the `contract.ts` of `chat` and
  `sessions`, and its own files.

GIVEN a row the user closed, sent, with host id `h1`, profile `work` and user title `Fix login`, and nothing running
WHEN `chat.sessionClosed` arrives
THEN chat's `launch` gets `{ projectDir: '/home/me/wigley-agents', profile: 'work', message: { text: '/wigley:retro auto
h1', images: [] }, unattended: true }`, the new row's user title is set to `Fix login`, and the slot reads
`{ rows: ['retro-1'], queued: 0 }`

GIVEN the retro row running
WHEN its `chat.session` value reads idle, background 0, no compaction, after its first turn started
THEN `close('retro-1', 'finished')` runs 5000 ms later, not at 4999 ms

GIVEN a queued close and a quit before its launch resolved
WHEN the app starts again
THEN the same item launches again

Tests:
- `retro-queue.test.ts`, `nextQueue_AppliesEachRule: $case` — one `it.each` table. Each row is a start queue, a list
  of events applied in order, and the expected queue as a whole `toEqual`. Use profile `work` and titles
  `{ user: 'Fix login', agent: null, firstMessage: 'hi' }` unless the row says otherwise. Rows:
  - `a user close that sent queues its host id` — closed h1 user sent → queued `[{ hostIds: ['h1'], profile:
    'work', title: 'Fix login' }]`
  - `a user close that sent nothing queues nothing` — closed h1 user not sent → `EMPTY_QUEUE`
  - `a start-failed close queues nothing`, `a project-closed close queues nothing`, `a finished close queues
    nothing` — one row each, sent → `EMPTY_QUEUE`
  - `the title falls back to the agent's, else none` — two closes: h1 titles `{ user: null, agent: 'Agent title',
    firstMessage: null }`, h2 titles all null → titles `'Agent title'` and `null`
  - `two clears hand every earlier id to the close, oldest first` — cleared h0→h1, cleared h1→h2, closed h2 →
    queued `[{ hostIds: ['h0', 'h1', 'h2'], … }]`, `cleared` `{}`
  - `a close drops the row's cleared ids` — cleared h0→h1, closed h1 start-failed → `cleared` `{}`, queued `[]`
  - `a close of a retro row queues nothing and frees the run` — start `{ running: { item, hostSessionId: 'r1' },
    launched: ['r1'] }`, closed r1 user sent → `running` null, `launched` `[]`, queued `[]`
  - `launching moves the head to running` — queued `[A, B]`, launching → running `{ item: A, hostSessionId: null }`,
    queued `[B]`
  - `launching while one runs changes nothing`
  - `launched records the row's host id` — running A with null, launched r1 → running host `r1`, launched `['r1']`
  - `a failed launch frees the run and keeps the rest` — running A, queued `[B]`, launchFailed → running null,
    queued `[B]`
  - `a re-closed row queues again` — closed h1 twice → two items
  - `a cleared retro row keeps its run` — running host r1, launched `['r1']`, cleared r1→r2 → running host `r2`,
    launched `['r2']`, `cleared` `{}`
  - `a start returns a launch the quit cut short` — running `{ A, null }`, queued `[B]`, started `['work']` → running
    null, queued `[A, B]`
  - `a start drops a run whose profile is gone` — running `{ A (profile 'old'), 'r1' }`, launched `['r1']`, started
    `['work']` → running null, launched `[]`
  - `a start keeps a run whose profile is there` — same with started `['old', 'work']` → no change
- `retro-queue.test.ts`, `parseQueue_BadText_Throws: $case` — rows `not json` (`{`), `an array` (`[]`), `no launched`
  (the queue's JSON without `launched`), `an item with no hostIds`; each throws `queue.json is not a queue`. One row
  `round trip`: `parseQueue(JSON.stringify(q))` equals `q` for a queue with every field set.
- `retro-done.test.ts`, `isRetroDone: $case` — rows with `{ activity, background, running, compaction, hasStarted }`
  → expected: no info → false; idle 0 running null, not started → false; idle 0 running null, started → true;
  working 0 → false; idle 2 → false; waiting 0 → false; idle 0 with a compaction → false; not running, working,
  started → true; not running, not started → false.
- `main/start.test.ts` (on `startMainPart`, with `fakeDependency` for `chatMainKey` and `sessionsMainKey`; the test
  publishes `sessionsRowsSlot` and `chatSessionSlot` through `harness.state`; `homeDir` `/home/me`):
  - `sessionClosed_UserClose_LaunchesUnattendedAndTitlesTheRow` — the first GIVEN above. The fake `launch` resolves
    to `retro-1` after the test sets row `retro-1` (host `retro-host-1`) in `sessionsRowsSlot`. Also `queue.json` in plugin
    data parses to `launched: ['retro-host-1']`, and the log holds `launched retro retro-1 for h1`.
  - `sessionClosed_TwoCloses_LaunchesOneAtATime` — two closes while the first launch has not resolved: `launch`
    called once, slot `queued` is 1; after the first row's `sessionClosed` (reason `finished`), `launch` is called
    a second time with `/wigley:retro auto h2`.
  - `doneRow_AfterTheSettle_ClosesFinished` — the second GIVEN; also a `working` value at 3000 ms after done
    restarts the settle, so the close comes 5000 ms after the last idle value.
  - `restart_LaunchCutShort_LaunchesAgain` — the third GIVEN, through `harness.restart()` with a `launch` that never
    resolves in the first start.
  - `restart_RestoredRetroRow_IsClaimedAndClosingItQueuesNothing` — a first start launches `retro-1` (host
    `retro-host-1`, resolved). Before `harness.restart()`, the test deletes row `retro-1` from `sessionsRowsSlot` and
    sets row `retro-9` with host `retro-host-1`. After the restart: slot `rows` is `['retro-9']`; an idle, background
    0 `chat.session` value for `retro-9` closes it after 5000 ms (a restored row counts as started); a user
    `sessionClosed` of `retro-host-1` queues nothing and calls no `launch`.
  - `launchRejected_LogsAndLaunchesTheNext` — two queued closes, the first `launch` rejects with
    `new Error('unknown profile')`: the log holds `retro launch failed for h1: unknown profile`, and the second launch
    runs.
  - `unreadableQueueFile_IsNeverOverwritten` — the test writes `{` to `queue.json` in plugin data through
    `harness.files` and runs `harness.restart()`: after a user close, the file still reads `{` and the log holds a
    line starting `queue.json not read:`.
- `page/start.test.ts` (on `startPagePart` with a fake `sessionsPageKey` that records each section and files its
  handle with `consumer.track`; under `installFakeDom`):
  - `retroSection_SlotRows_ClaimsThoseRows` — slot `{ rows: ['r1'], queued: 0 }`: one live section with id
    `auto-retro`, label `Retro`; `claims` true for `r1`, false for `r2`. Slot `{ rows: ['r1', 'r2'], queued: 0 }`:
    the first handle is disposed, one live section, `claims` true for `r2`.
  - `retroHeader_Queued_DrawsTheCountOnlyWhileAboveZero` — `header.build(parent)` with queued 2: `parent` text is
    `2 queued`. Slot queued 0: `parent` holds no element. Slot queued 3: `3 queued`, with no new section added.

Approach: the serial chain in `main/start.ts` and the redraw of kept header parents are wiring; the tests above
name what each must keep. Everything else is in the Decisions.

Done when: `npm run typecheck` passes; `npm test` passes on the tests above; `npm run lint` passes (check-layers,
with `manifests.ts`, `main.ts` and `page.ts` listing the plugin once each, and check-styles).

Commit: one commit for the group.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
