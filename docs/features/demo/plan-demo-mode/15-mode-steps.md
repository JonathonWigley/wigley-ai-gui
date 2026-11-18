# 15 — Mode steps: docs, backlog, practice, scheduling, chatroom

Status: not started
Type: Parallel
Rung: deep · each plugin holds a sample beside the user's real state and routes its channel, store or room between the two for a step's lifetime (lifecycle, async, saved data)
Wave: 2 · Depends on: 01 (the demo contract, `services.demoSteps` and `demoSkip`), 02 (02 also lists `src/plugins/scheduling/main/start.ts`)
Plan: [plan.md](plan.md)

One reference pattern (plan.md › File Structure › Per-plugin step files), then each plugin's own
values. Section `modes` for every step here. Files paths are written from the `ai` repo root;
every other path is relative to `wigley-ai-gui/`. This task adds no new plugin part, so 07's
part lists gain nothing from it.

## Reference pattern

- `page/demo-steps.ts` exports `registerDemoSteps(services: PageServices, deps: …): Disposable`;
  `main/demo-steps.ts` (only where named below) exports
  `registerDemoSteps(services: MainServices, deps: …): Disposable`. Each registers through
  `services.demoSteps.register(step)` and returns one Disposable over its registrations. The part's
  `start` calls it and disposes the result in the part's `dispose` (a part with no `dispose` gains
  one).
- A step with a main half: the main half builds the sample and holds it until its stage's
  `dispose`; the page half's `enter` reads the main half's sessions from `context.sessions` by the
  keys named below.
- **The sample-serving rule.** A plugin whose step shows its mode over sample data keeps its real
  serving object and builds a second one over the sample. While a step holds the sample, the
  plugin's **channel handlers** serve the sample object; its **exports, agent tools, scoped agent
  and events** keep the real one. Taking or releasing the hold sends the page the plugin's existing
  reload message, so the page reads again. This is what keeps a real agent's tool call during the
  demo on the user's data, and the demo's clicks on the sample.
- Beats are re-entrant: each beat's `show` sets the whole visible state of that beat, so Previous
  shows it again. A beat that cannot undo a side effect of a later beat (a thread marked read) says
  so below.
- A page half shows a mode with `api.commands.run(MODES_SHOW, '<plugin>.<mode id>')`
  (`src/contracts/commands.ts:48`), never `<plugin>.showMode`, which toggles the side bar when the
  mode already shows.
- Paths in `files` are repo-relative.

Files:
- modify `wigley-ai-gui/src/plugins/docs/contract.ts` · modify `wigley-ai-gui/src/plugins/docs/main/start.ts` · modify `wigley-ai-gui/src/plugins/docs/page/start.ts`
- create `wigley-ai-gui/src/plugins/docs/main/demo-steps.ts` · create `wigley-ai-gui/src/plugins/docs/page/demo-steps.ts`
- test `wigley-ai-gui/src/plugins/docs/main/start.test.ts`
- modify `wigley-ai-gui/src/plugins/docs-session-tab/manifest.ts`
- modify `wigley-ai-gui/src/plugins/backlog/main/start.ts` · modify `wigley-ai-gui/src/plugins/backlog/page/start.ts`
- create `wigley-ai-gui/src/plugins/backlog/main/demo-steps.ts` · create `wigley-ai-gui/src/plugins/backlog/page/demo-steps.ts`
- test `wigley-ai-gui/src/plugins/backlog/main/start.test.ts`
- modify `wigley-ai-gui/src/plugins/practice/main/start.ts` · modify `wigley-ai-gui/src/plugins/practice/page/start.ts`
- create `wigley-ai-gui/src/plugins/practice/main/demo-steps.ts` · create `wigley-ai-gui/src/plugins/practice/page/demo-steps.ts`
- test `wigley-ai-gui/src/plugins/practice/main/start.test.ts`
- modify `wigley-ai-gui/src/plugins/scheduling/contract.ts` · modify `wigley-ai-gui/src/plugins/scheduling/main/start.ts` · modify `wigley-ai-gui/src/plugins/scheduling/page/start.ts`
- create `wigley-ai-gui/src/plugins/scheduling/main/demo-tasks.ts` · create `wigley-ai-gui/src/plugins/scheduling/main/demo-steps.ts` · create `wigley-ai-gui/src/plugins/scheduling/page/demo-steps.ts`
- test `wigley-ai-gui/src/plugins/scheduling/main/start.test.ts` · test `wigley-ai-gui/src/plugins/scheduling/main/demo-tasks.test.ts`
- modify `wigley-ai-gui/src/plugins/chatroom/main/start.ts` · modify `wigley-ai-gui/src/plugins/chatroom/main/selftest-fixture.ts` · modify `wigley-ai-gui/src/plugins/chatroom/page/start.ts`
- create `wigley-ai-gui/src/plugins/chatroom/main/demo-rooms.ts` · create `wigley-ai-gui/src/plugins/chatroom/main/demo-steps.ts` · create `wigley-ai-gui/src/plugins/chatroom/page/demo-steps.ts`
- test `wigley-ai-gui/src/plugins/chatroom/main/start.test.ts`

Consumes:

- `DemoStep`, `DemoMainStep`, `DemoStage`, `DemoMainStage`, `DemoPageContext`, `DemoMainContext`,
  `DemoBeat`, `DEMO_HARNESS_ID`, `DEMO_PROFILE` from `src/contracts/demo.ts` ← 01
- `PageServices.demoSteps`, `MainServices.demoSteps` ← 01
- `PluginManifest.demoSkip` ← 01
- The plugin-part test harness (`src/shared/plugin-part-harness.test-support.ts`) gives a part a
  `services.demoSteps` that keeps what the part registers, so a test reads the registered
  `DemoMainStep` and calls its `enter` ← 01 (01 must add the field to the harness's services to
  compile; this task needs it to record registrations)
- The demo harness is unlisted, so scheduling's `profileNames()` leaves out `DEMO_PROFILE` ← 02
- Members the tree holds: `MODES_SHOW` (`src/contracts/commands.ts:48`);
  `sessionsSelectRowCommand`, `sessionsSelectTabCommand` (`src/plugins/sessions/contract.ts:17,25`);
  `createMemoryFiles` (`src/shared/memory-files.ts:37`, a production module); `createMemoryRoomStore`
  (`src/plugins/chatroom/main/memory-room-store.ts`); `writeDocsFixture`
  (`src/plugins/docs/main/selftest-fixture.ts:92`); `writeBacklogFixture`, `hasBacklogFixture`,
  `BACKLOG_REPO` (`src/plugins/backlog/main/selftest-fixture.ts`); `writePracticeFixture`,
  `PRACTICE_FIXTURE_SLUGS` (`src/plugins/practice/main/selftest-fixture.ts`); `seedChatroomFixture`,
  `FIXTURE_THREAD` (`src/plugins/chatroom/main/selftest-fixture.ts`); `nextOccurrence`
  (`src/plugins/scheduling/schedule.ts:109`); `Paths.isInside` (`src/contracts/paths.ts:23`)
- The run's contract, which 06 implements in the same wave (plan.md Run lifecycle):
  `context.scratchDir` is a real path (no symlink in it), so a page half's
  `paths.join(scratchDir, …)` equals the path main wrote after `files.realPath`. When the run
  leaves a step it disposes the page stage, then the main stage, then closes every session id in
  the main stage's `sessions` map with chat's `close(id, 'finished')`; no stage here closes a
  session.

Produces:

- `registerDemoSteps(services: PageServices, deps: …): Disposable` in each `page/demo-steps.ts`
  above; `registerDemoSteps(services: MainServices, deps: …): Disposable` in each
  `main/demo-steps.ts` above. Each plugin picks its own `deps` type.
- `src/plugins/docs/contract.ts`:
  ```ts
  export const SAMPLE_HOME_FOLDER = 'sample-home';
  export const SAMPLE_SOURCE_ID = 'sample';
  export interface SampleDocs extends Disposable { load(): Promise<SourceRead> }
  // DocsMainExports gains:
  addSampleDocs(scratchDir: string): Promise<SampleDocs>;
  ```
- `src/plugins/scheduling/contract.ts`:
  `export const DEMO_TASK_IDS = { triage: 'demo-001', sweep: 'demo-002', dependencies: 'demo-003' } as const;`
- `src/plugins/scheduling/main/demo-tasks.ts`:
  ```ts
  export interface DemoTasks {
    show(views: readonly ScheduledTaskView[]): Disposable; // replaces any shown; dispose clears
    views(): ScheduledTaskView[];
    has(taskId: string): boolean;
    setPaused(taskId: string, paused: boolean): void;
    markViewed(rowId: string): void;
    runRows(): string[];      // each demo entry's rowId once, oldest first
    unviewedRows(): string[]; // finished, not viewed
    onChanged(listener: () => void): Disposable;
  }
  export function createDemoTasks(): DemoTasks;
  ```
- `src/plugins/chatroom/main/demo-rooms.ts`:
  ```ts
  export interface DemoRooms {
    hold(roomName: string): RoomService & Disposable; // a memory room service; dispose releases
    serviceFor(roomName: string): RoomService | null; // the held service, else null
  }
  export function createDemoRooms(deps: Omit<RoomServiceDeps, 'store' | 'files'>): DemoRooms;
  ```
- `ChatroomFixtureDeps` in `src/plugins/chatroom/main/selftest-fixture.ts` changes:
  `chat: Pick<ChatMainExports, 'launch'>` → `launch(title: string): Promise<string>`, and
  `room: Pick<RoomService, 'post' | 'claim'>` → `roomFor(roomName: string): Pick<RoomService, 'post' | 'claim'>`.

## Steps, per plugin

| Id | Order | Title | Caption (verbatim) | Main half |
|---|---|---|---|---|
| `docs.mode` | 10 | Docs | `Docs: every agent doc on the machine, browsed as a tree of rendered pages.` | yes |
| `docs.sessionTab` | 20 | Docs tab | `The Docs tab: the docs one session reads, beside its chat.` | yes, key `session` |
| `backlog.mode` | 30 | Backlog | `Backlog: every repo's follow-ups in one table, with staleness read from git.` | yes |
| `practice.mode` | 40 | Practice | `Practice: coding problems with an editor, a C++ judge and an interviewer agent.` | yes |
| `scheduling.schedules` | 50 | Scheduled tasks | `Scheduled tasks: agent prompts that run on a schedule as new headless sessions.` | yes, key `runRow` |
| `chatroom.room` | 60 | Chatroom | `Chatroom: the sessions of one project post, ask and claim work in a shared room.` | yes, keys `lead`, `peer` |

### docs (`docs.mode`, `docs.sessionTab`) and docs-session-tab

Sample: the docs self-test fixture, written by `writeDocsFixture(files, sampleHome, paths)` into
`sampleHome = paths.join(await files.realPath(scratchDir), SAMPLE_HOME_FOLDER)`, only when
`<sampleHome>/.agents/wigley-docs/index.json` is absent (the `hasDocsFixture` check at
`docs/main/start.ts`), so no entry ever reaches `files.trash`, which is the system Trash in the live
app.

Main (`docs/main/start.ts`):

- `addSampleDocs(scratchDir)` (the export, and the function both docs main halves call): makes
  `sampleHome`, writes the fixture as above, registers through the index registry a **load-only**
  source `{ id: SAMPLE_SOURCE_ID, title: 'Sample docs', load }` whose `load` is
  `createMachineSource({ ...indexDeps, homeDir: sampleHome }).load` — no `rebuild`, so no script
  runs and the user's index is never rebuilt. It holds the sample home; `dispose` unregisters the
  source and ends the hold. `load()` returns `registry.load(SAMPLE_SOURCE_ID)`. A second
  `addSampleDocs` while one is held rejects (the registry's duplicate-id throw).
- While a sample home is held, `writeDoc`, `writeBytes`, `createDoc`, `renameDoc` (both paths) and
  `trashDoc` — channel handlers and exports alike — reject any target outside it
  (`paths.isInside(target, sampleHome)` false) with
  `Error('While the demo shows sample docs, only the sample docs change.')`. The target of a
  `CreateRequest` is `request.path` for `type: 'path'` and `request.place.folder` for
  `type: 'kind'`.
- `addSessionSource` for a session whose `info.harness === DEMO_HARNESS_ID` registers, under the
  same `sessionSourceId(id)` and `SESSION_SOURCE_TITLE`, a load-only source over
  `paths.join(info.projectDir, SAMPLE_HOME_FOLDER)` built the same way, instead of
  `createSessionSource`; with `projectDir` null its `load` returns the machine source's
  missing-index read. No `docs_index.py` runs for a demo session, in any step.
- `docs.mode` main half: `enter` → `addSampleDocs(scratchDir)`; stage `{ sessions: {} }`, dispose
  disposes the sample.
- `docs.sessionTab` main half: `enter` → `addSampleDocs(scratchDir)`, then
  `launchSession('Which docs does this session read?')`; stage `{ sessions: { session: id } }`,
  dispose disposes the sample.

Page (`docs/page/start.ts`): an internal `showSample(sourceId)` returning
`{ openDoc(path: string, line: number | null): void } & Disposable`. It builds a view the way
`addView` does (`docs/page/start.ts:416`), except its place writes nothing and no saved place is put
back (the `docs.place` slot never gains a sample key). While it is held, Docs mode's sheet shows
the sample split in place of `machineView.doc`, the mode's side bar is hidden (shown again at
dispose if it was shown before), and the mode's `shown`, `focusMain` and `focusSideBar` act on the
sample view instead of `machineView`; `machineView.showFirstTime()` is not called, so the machine
index is not read for the step. Dispose puts `machineView.doc` back and disposes the sample view.

- `docs.mode` page beats (`P = paths.join(scratchDir, SAMPLE_HOME_FOLDER)`):
  1. `tree` — `showSample(SAMPLE_SOURCE_ID)` held from `enter`; `MODES_SHOW 'docs.docs'`.
  2. `page` — `openDoc(paths.join(P, '.claude', 'CLAUDE.md'), null)`.
  3. `skill` — `openDoc(paths.join(P, 'dev', 'selftest-repo', '.claude', 'skills', 'demo', 'SKILL.md'), null)`.
- `docs.sessionTab` page beats (`id = context.sessions.session`):
  1. `session` — `sessionsSelectRowCommand` with `id`, then `sessionsSelectTabCommand` `{ sessionId: id, tab: 'chat' }`.
  2. `Docs tab` — `sessionsSelectTabCommand` `{ sessionId: id, tab: 'docs' }`.
- `files`: `docs.mode` → `src/plugins/docs/page/docs-view.ts`, `src/plugins/docs/page/start.ts`,
  `src/plugins/docs/main/start.ts`; `docs.sessionTab` → `src/plugins/docs-session-tab/page/start.ts`,
  `src/plugins/docs/page/start.ts`, `src/plugins/docs/main/start.ts`.
- docs-session-tab: `demoSkip: "Its Docs tab shows in docs' docs.sessionTab step, which needs a demo session from docs' main half."`
  (it has no main part to launch a session, and the page context has no `launchSession`). The run
  starts it in memory (`runDisabledForNow` ← 01), so the tab shows.

### backlog (`backlog.mode`)

Sample: the backlog self-test repo at `paths.join(sampleHome, BACKLOG_REPO)` — `makeFolder(sampleHome)`
then `writeBacklogFixture({ files, processes, paths }, sampleHome)` only when `hasBacklogFixture` is
false (its `trash` of an old repo never runs). The docs fixture's index already lists this repo's
follow-ups, plan and tasks (`backlogEntries`, `docs/main/selftest-fixture.ts:292`); then
`docs.addSampleDocs(scratchDir)`.

Main (`backlog/main/start.ts`), by the sample-serving rule: a second
`createBacklogMain({ ...deps, docs: sampleDocs, emit: () => undefined })` where `sampleDocs` is
`docs` with `machineIndex` and `rebuildMachineIndex` both replaced by `sample.load`. While held:

- `load`, `rescan`, `sweep`'s read, `staleness`, `commitsSince` serve the sample instance; `rescan`
  never reaches `docs.rebuildMachineIndex`.
- `staleness` and `commitsSince` use a second staleness reader whose `data` is `createMemoryFiles()`,
  so no sample staleness is cached in plugin data.
- `chunks` returns `[]`; `editChunks`, `startChunks` and `sweep` reject with
  `Error('The sample backlog keeps no chunks and starts no sessions.')`.
- `exports` (`load`, `fileNote`), the tools (`rows`, `loadRows`) and the assistant keep the real
  instance.
- Taking and releasing the hold sends `changed` `{ homeRoot: null }`.

Main half: `enter` → write the sample, take the hold; stage `{ sessions: {} }`; dispose releases
the hold, then disposes the `SampleDocs`.

Page beats (keys `rowKey('backlog-repo', <title>)`, `src/plugins/backlog/row-key.ts`):
1. `table` — `MODES_SHOW 'backlog.main'`.
2. `ready follow-up` — `backlog.selectRow` with `rowKey('backlog-repo', 'Ready item')`.
3. `moved since written` — `backlog.selectRow` with `rowKey('backlog-repo', 'Moved item')`.

The page half never runs `backlog.toggleAssistant` and never sends to the assistant.
`files`: `src/plugins/backlog/page/backlog-view.ts`, `src/plugins/backlog/main/start.ts`,
`src/plugins/backlog/main/staleness.ts`.

### practice (`practice.mode`)

Sample: `writePracticeFixture({ files, paths }, folder)` into a fresh
`folder = paths.join(scratchDir, 'practice', String(n))`, `n` a counter the part raises on each
`enter`, so a reset never trashes the last sample's problems (`writePracticeFixture` trashes every
entry of `<folder>/problems/`).

Main (`practice/main/start.ts`), by the sample-serving rule: a second `store`, `progress`, `judge`
and `runs`, built as the real ones are (`practice/main/start.ts`) over `() => folder`. While held,
the channel handlers `list`, `open`, `saveCode`, `saveNotes`, `saveCustomCases`, `run`, `submit`
and `peek` serve the sample set; `startImport` rejects with
`Error('The sample practice folder imports nothing.')`. The tools and the interviewer keep the real
store. The watch moves to the sample store's `problems/` while held and back at release, through
the code the `folder` setting change runs today (factor it into one function both call). Taking and
releasing the hold sends `changed` `{ slug: null }`.

Main half: `enter` → write the sample, take the hold; stage `{ sessions: {} }`; dispose releases it.

Page beats:
1. `problem list` — `MODES_SHOW 'practice.main'`.
2. `problem` — `view.openProblemRow('two-sum')`.
3. `run` — `api.commands.run('practice.run')`, `dwellSeconds: 8` (the judge compiles with the
   user's `compiler` setting into the sample folder's `.build/`).

The page half never runs `practice.toggleInterviewer` or `practice.importStart`.
`files`: `src/plugins/practice/page/practice-view.ts`, `src/plugins/practice/page/problem-workspace.ts`,
`src/plugins/practice/main/judge.ts`, `src/plugins/practice/main/start.ts`.

### scheduling (`scheduling.schedules`)

`createDemoTasks()` holds the demo views in memory; nothing in it reaches `taskStore`, `history`,
the planner or the session host.

Main (`scheduling/main/start.ts`):

- `publish` sets `tasks: [...views(), ...demoTasks.views()]`,
  `runRows: [...real, ...demoTasks.runRows()]`, `unviewedRows: [...real, ...demoTasks.unviewedRows()]`;
  `services.alerts.setOpenCount` counts the real unviewed rows only.
- `plan`, `views` handed to the tools, `toolDeps.isRunRow` and every `history` step stay real-only.
- Channel: `saveTask` with `draft.id` a demo id, `runNow` and `removeTask` of a demo id reject with
  `Error('Demo tasks are samples: they never run and are never saved.')`, before any store call;
  `setPaused` of a demo id calls `demoTasks.setPaused`.
- The selection listener also calls `demoTasks.markViewed(rowId)`.
- `demoTasks.onChanged` → `serial(() => undefined)`, so the change publishes.

Main half (`scheduling/main/demo-steps.ts`): `enter` → `runRow = launchSession('Run the test suite and report each failure with its file.')`,
then `demoTasks.show(demoTaskViews({ now: clock.now(), projectDir: scratchDir, runRowId: runRow }))`;
stage `{ sessions: { runRow } }`, dispose disposes the shown views. `demoTaskViews` is a pure,
exported builder in that file; `HOUR = 3_600_000`; each task has `target: { projectDir }`,
`profile: DEMO_PROFILE`, `controls: {}`, `updatedAt: now`; `nextRun` is
`nextOccurrence(schedule, now)` for an active task, `null` for a paused one:

| Id | Name | Schedule | Prompt | Paused | History, newest first |
|---|---|---|---|---|---|
| `DEMO_TASK_IDS.triage` | Morning triage | `{ kind: 'weekdays', time: '09:00' }` | `Triage yesterday's follow-ups and list the three most urgent.` | false | none |
| `DEMO_TASK_IDS.sweep` | Nightly test sweep | `{ kind: 'daily', time: '22:30' }` | `Run the test suite and report each failure with its file.` | false | finished at `now − 1 h`, `rowId: runRowId`, `processId: null`, `viewed: false`; skipped at `now − 25 h`; failed at `now − 49 h`, `reason: 'spawn ENOENT'` |
| `DEMO_TASK_IDS.dependencies` | Weekly dependency check | `{ kind: 'weekly', day: 1, time: '10:00' }` | `List outdated dependencies and what each update changes.` | true | none |

Each history entry's `occurrence` equals its `at`; skipped and failed entries have `rowId: null`,
`processId: null`, `viewed: true`, and the skipped one `reason: null`. The ids are not 8 hex
characters, so no real task id can equal one.

Page half (`scheduling/page/demo-steps.ts`, deps from `scheduling/page/start.ts`: the view's
`selectTask` and `openRunRow`, the `scheduling.state` reader, `api.commands`): `enter` waits until
the slot holds a view of `DEMO_TASK_IDS.triage` (rejects after 5,000 ms with
`Error('the demo tasks never reached scheduling.state')`), then returns the stage. Beats:
1. `task list` — `MODES_SHOW 'scheduling.main'`; `selectTask(DEMO_TASK_IDS.triage)`.
2. `paused task` — `selectTask(DEMO_TASK_IDS.dependencies)`.
3. `history` — `selectTask(DEMO_TASK_IDS.sweep)`; `api.commands.run('scheduling.open')`.
4. `run row` — `openRunRow(context.sessions.runRow)`: Sessions mode on the run row, which views it,
   so its `done` mark clears; Previous to `history` does not bring the mark back.

The run row draws in the Demo section, not in Scheduled runs, while the demo's `showOnly` holds:
this step takes no `showOnly` hold of its own, so it does not depend on 04.
`files`: `src/plugins/scheduling/page/schedules-view.ts`, `src/plugins/scheduling/page/run-rows.ts`,
`src/plugins/scheduling/main/start.ts`, `src/plugins/scheduling/main/demo-tasks.ts`.

### chatroom (`chatroom.room`)

Shared builder: `seedChatroomFixture(deps, projectDir)` keeps its posts, claim, waits and return
value; it takes `deps.launch(title)` in place of `chat.launch`, and posts and claims through
`deps.roomFor(project)` once the wait finds the room. The self-test and the drive `seed` action
pass `launch: (title) => chat.launch({ projectDir, profile: 'work', message: { text: title, images: [] } })`
and `roomFor: () => room`, so they behave as today.

Main (`chatroom/main/start.ts`):

- `createDemoRooms` builds each held room's service with `createRoomService` over
  `createMemoryRoomStore()` and `createMemoryFiles()`, with the real `clock`, `randomHex`, `limits`,
  `participants` and `log`. `hold` subscribes the held service's `onMessage` to `rewriteRoom`.
- `rewriteRoom` and the channel handlers `readThread`, `postAsUser` and `markUserRead` use
  `demoRooms.serviceFor(roomName) ?? room`. Tools, hooks, delivery and agent entries keep `room`.
- Releasing a hold rewrites the room from `room` when `room.rooms()` lists it, else deletes its key
  from `chatroom.rooms` (`KeyedSlotWriter.delete`, `src/contracts/state.ts:66`).

Main half: `enter` → `seedChatroomFixture({ …fixtureDeps, launch: (title) => context.launchSession(title), roomFor: (name) => held = demoRooms.hold(name) }, scratchDir)`;
stage `{ sessions: { lead: rowIds[0], peer: rowIds[1] } }`; dispose disposes the held room.

Page beats (`chatroom/page/demo-steps.ts`):
1. `row badge` — `sessionsSelectRowCommand` with `context.sessions.lead`: the peer's question to
   you shows as the rows' badge.
2. `room` — `MODES_SHOW 'chatroom.main'`.
3. `thread` — `api.commands.run` of `chatroom.openRowRoom` with `context.sessions.lead`: the
   `plan-demo` thread opens and is marked read; Previous to `row badge` shows no badge.

`files`: `src/plugins/chatroom/page/chatroom-view.ts`, `src/plugins/chatroom/page/start.ts`,
`src/plugins/chatroom/main/start.ts`, `src/plugins/chatroom/main/room-service.ts`.

## Decisions

- The steps reuse the self-test fixtures as builders (`writeDocsFixture`, `writeBacklogFixture`,
  `writePracticeFixture`, `seedChatroomFixture`), never the drive actions or layout previews
  (plan.md Decisions; seams map § 10).
- Sample-serving rule (above): channel → sample; exports, tools, agents → real.
- docs-session-tab declares `demoSkip`; its tab is a beat of docs' `docs.sessionTab` (coverage
  table change reported to the lead).
- Docs mode shows the sample through a sample view in the Docs sheet; the wiki sidebar, which only
  the machine view draws (`docs/page/docs-view.ts:605`, `hasWiki: isMachine`), is not part of the
  step.
- No fixture writer runs where it would trash: docs and backlog write only into a home without
  their fixture; practice writes into a fresh folder per enter.
- Scheduling's demo tasks never enter `taskStore`, so the planner, the session host, the login
  start and the task file never see them; the Dock badge counts real runs only.
- The chatroom's demo room is a separate memory room service; the user's room files, cursors,
  threads and claims are never opened for it.

## GIVEN / WHEN / THEN

- GIVEN `scheduling.schedules` entered (fires true, runs read) WHEN the part plans THEN
  `sessionHost.setPending` holds no entry whose record names a demo id, the task file is never
  written, and `scheduling.state` lists the three demo tasks after the real ones.
- GIVEN demo tasks shown WHEN the channel's `saveTask` (demo id), `runNow` or `removeTask` runs
  THEN it rejects with the demo-task text and the task file and `history.json` are unwritten; WHEN
  `setPaused(DEMO_TASK_IDS.triage, true)` runs THEN the published view reads paused and the file is
  unwritten.
- GIVEN demo tasks shown with an unviewed demo run row THEN `alerts.setOpenCount` reads 0; WHEN the
  stage is disposed THEN the demo tasks and run rows leave `scheduling.state`.
- GIVEN `chatroom.room` entered WHEN the seed posts and claims, and the channel's `postAsUser` and
  `markUserRead` run on the demo room THEN no file under the plugin data folder is written and
  `chatroom.rooms` shows the posts; WHEN the stage is disposed THEN the room's key leaves
  `chatroom.rooms`.
- GIVEN the docs sample held WHEN `writeDoc` targets a path outside the sample home THEN it rejects
  with the sample-docs text; WHEN a session with harness `demo` connects and its source loads THEN
  no process runs.
- GIVEN the backlog sample held WHEN `rescan` runs THEN `docs.rebuildMachineIndex` is not called and
  the read lists `backlog-repo`; WHEN `editChunks` or `startChunks` runs THEN it rejects and the
  chunk file is unwritten; the export `load` still reads the machine index.
- GIVEN the practice sample held WHEN `saveCode` runs THEN the file lands under the sample folder;
  `startImport` rejects.

## Tests

- `src/plugins/scheduling/main/start.test.ts`, new `describe('demo tasks')`:
  - `it('never plans, saves or fires a demo task')` — enter the registered step with a context whose
    `launchSession` resolves `'row-demo'`; after `settle`, `part.lastPending()` records no demo id,
    the task file holds the real task alone, `part.state()?.tasks` ends with the three demo ids.
    Break: a demo view added to `taskStore` or handed to `planRuns`.
  - `it.each` over `saveTask` (demo id), `runNow`, `removeTask` — each rejects with
    `'Demo tasks are samples: they never run and are never saved.'`; the files fake records no write.
    Break: a guard dropped, so the call reaches `taskStore`.
  - `it('counts no demo run in the Dock badge and leaves at dispose')` — `alerts.at(-1)?.count` is 0
    with the demo row unviewed; after stage dispose `runRows` holds no `'row-demo'`.
- `src/plugins/scheduling/main/demo-tasks.test.ts`: `setPaused` changes only that view;
  `markViewed` clears the row from `unviewedRows`; `show` twice replaces, and the first Disposable
  no longer clears the second. Break: a stale dispose clearing a later show.
- `src/plugins/chatroom/main/start.test.ts`: `it('keeps the demo room in memory')` — enter with a
  `launchSession` that launches through the test's chat fake; after the seed and a `postAsUser`, the
  data files fake lists no `rooms/` file and no `claims.json`; the rooms slot holds the
  `plan-demo` posts; after dispose its key is gone. Break: a handler routed to `room`.
- `src/plugins/docs/main/start.test.ts`: `it('runs no index script for a demo session')` —
  `FakeProcesses` records no run after a `sessions.connected` with harness `demo` and a
  `loadIndex` of its source; `it('refuses changes outside the sample home while it is held')` — a
  table over `writeDoc`, `trashDoc`, `createDoc` (`type: 'path'`). Break: the harness check or the
  guard removed.
- `src/plugins/backlog/main/start.test.ts`: `it('serves the sample without rebuilding the machine index')`
  — the docs fake records no `rebuildMachineIndex` on `rescan`; `editChunks` and `startChunks`
  reject; `exports.load` reads `machineIndex`. Break: the channel left on the real instance.
- `src/plugins/practice/main/start.test.ts`: `it('serves the sample folder to the page only')` —
  `saveCode` writes under the sample folder; the `read_practice_state` tool lists the setting
  folder's problems; `startImport` rejects. Break: the tools moved to the sample store.

## Done when

`npm run typecheck`, `npm run lint` and `npm test` pass; each plugin above registers its step or
declares its `demoSkip`; the Proof lists each test above passing. Live checks are in task 17.

## Commit

One commit per plugin, in this order: docs and docs-session-tab (backlog consumes
`addSampleDocs`), backlog, practice, scheduling, chatroom.

## Proof
