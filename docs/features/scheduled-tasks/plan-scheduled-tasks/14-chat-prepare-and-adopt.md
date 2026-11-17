# 14 — Chat prepare and adopt

Status: not started
Type: Task
Wave: 3 · Depends on: 08, 09
Plan: [plan.md](plan.md)

Chat gets three changes. `launch` takes the first process's controls. `prepareLaunch` builds a run that the session
host starts later, with every chat launch rule, and opens nothing. `adopt` opens the row of a run that the host
started from a `prepareLaunch`, through the same path that `restore` uses. The scheduling plugin (17) calls the two
new exports. It holds no chat rule.

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` ·
           modify `src/plugins/chat/main/start.ts` · modify `src/plugins/chat/main/tool-callers.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts` · test `src/plugins/chat/main/start.test.ts` ·
           test `src/plugins/chat/main/tool-callers.test.ts`

Consumes:  `AgentHarness.prepareRun(request: AgentStart, firstMessage: UserMessage, env: Readonly<Record<string, string>>): HostedSpawn` ← 08
           `AgentHarness.startControls(): SessionControl[]` ← 08 (the fake harness's adapter of it too, in `src/shared/fake-agent-harness.ts`)
           `HostedSpawn` (with `unsetEnv` and `stdin`) in `src/contracts/session-host.ts` ← 02, as a type only
           `SessionsMainExports.holdConnects(until: Promise<unknown>): void` — in the tree
           `OpenOptions.rowId` — in the tree
           `GuardedToolCall.replayed` ← 05 (`src/plugins/sessions/contract.ts`; 05 lands before 09, which 14 waits for)
           `ToolCallers`, `callerGuard`, `CALLER_WAIT_MS`, `SUBAGENT_CALL_TEXT` (`tool-callers.ts`), `MAIN_AGENT_ID`
           (`src/contracts/agent.ts`), `prependHistory`, `loadHistory` (`chat-sessions.ts`) — in the tree
           09 consumes nothing from this task and produces nothing it uses. 14 waits for 09 only because both edit
           `src/plugins/chat/main/start.ts`.

Produces:  in `src/plugins/chat/contract.ts`, word for word as plan.md § Shared names and shapes gives them:
           `controls?: Readonly<Record<string, string>>;` on `LaunchRequest`
           `export interface AdoptRequest { hostSessionId; processId; rowId; projectDir; profile; headless; unattended; instructions; owner; controls; titles }`
           `export interface PreparedLaunch { spawn: HostedSpawn; adopt: AdoptRequest; }`
           `prepareLaunch(request: LaunchRequest, env: Readonly<Record<string, string>>): PreparedLaunch;` on `ChatMainExports`
           `adopt(run: AdoptRequest): Promise<string>;` on `ChatMainExports`
           in `src/plugins/chat/main/chat-sessions.ts`, on `ChatSessions`:
           `prepareLaunch(request: LaunchRequest, env: Readonly<Record<string, string>>): PreparedLaunch;`
           `adopt(run: AdoptRequest): Promise<string>;`
           `projects(): readonly ChatProject[];` on `ChatMainExports`
           `onInstructionsChanged(listener: () => void): Disposable;` on `ChatMainExports`, with its comment as plan.md
           gives it
           in `src/plugins/chat/main/chat-sessions.ts`, on `ChatSessions`:
           `onInstructionsChanged(listener: () => void): Disposable;`
           in `src/plugins/chat/main/tool-callers.ts`, on `ToolCallers`:
           `noted(sessionId: string, toolUseId: string): string | null;` — the agent noted for the call, with no wait
           in `src/plugins/chat/main/start.ts`: the `prepareLaunch`, `adopt`, `projects` and `onInstructionsChanged`
           members of the object that `exports` returns

## Decisions

**Contract text.** Copy `LaunchRequest.controls`, `AdoptRequest`, `PreparedLaunch` and the three `ChatMainExports`
members from plan.md § Shared names and shapes, with their comments. `contract.ts` imports `HostedSpawn` as a type from
`../../contracts/session-host`. Add a `controls` line to the comment block above `LaunchRequest`, in the style of the
other lines there. Add "an unknown control id" to the reject list in the comment of `ChatMainExports.launch`.

**Opening controls: one rule for `launch` and `adopt`.** Add one helper in `chat-sessions.ts` that takes the harness
and a controls record, and returns the `controls` and `confirmedPicks` that `openRow` opens a row with:

- An empty record returns `controls: []` and `confirmedPicks: {}`. This is the opening of today, so a launch with no
  `controls` does not change.
- A non-empty record returns `harness.startControls()`, with each control's `value` set to the record's value for its
  id, else null. `confirmedPicks` holds every entry of the record except the `mode` id (`MODE_CONTROL_ID`).
  `controlValuesOf` reads the mode from the held control's value and each other control from `confirmedPicks`, so the
  row's first start, and each later start, passes the record's values.
- An id that `startControls()` does not declare throws `Unknown control "<id>". Controls: <ids joined by ", ">.`
  before anything opens. Values are not checked: the harness owns what a value means. Reason: a task file is
  hand-editable, and a mistyped id must fail with a reason that the run history can show. It must not silently run
  with the harness's defaults.

`openAndStart`'s `opening` gets a `controls: Readonly<Record<string, string>>` field. `startNew` passes it through
`StartFlags` or as its own argument. `launch` passes `request.controls ?? {}`. `start` and `resume` pass `{}`.

**Instructions: one rule for live starts and prepared runs.** Lift the body of `currentInstructions(session)` into a
function of `(own: readonly string[], headless: boolean)`: the global texts in registration order, then `own`, then
`HEADLESS_NOTE` when `headless` is true. `currentInstructions` calls it with the session's fields, and
`prepareLaunch` calls it with the request's fields. A start and a prepared run then cannot drift.

**A change of the global texts is heard.** A prepared run holds the global texts as they stood when it was prepared.
Plugins that start after the scheduling plugin (`agent-strip`, `visual`) register theirs later, and a registration
can be disposed at a plugin reload. So `ChatSessions.onInstructionsChanged(listener)` calls each listener after each
`addInstructions` registration and after each disposal of one; `dispose` removes the listener. The export
`onInstructionsChanged` passes through it, tracked by the calling plugin's consumer as `addInstructions` is
(`consumer.track`). The scheduling main part (17) re-plans on it, so a queued run gets the texts a live start would
get. A burst of registrations at app start gives one call each; the replace-all `setPending` makes extra re-plans
harmless.

**`prepareLaunch(request, env)`** opens nothing. It does not call `sessions.open`, `harness.start` or
`deps.recent.record`, and it does not call `save()`. In this order:

1. It checks each image with `refusalOf`, as `launch` does. It then calls `profileNamed`, `requireHarness` and
   `resolveTarget`, and runs the opening-controls id check. Each throws as it does for `launch`, so a prepared run
   fails where a live launch would fail. It does not call `requireNotDetached`: that guard names a host id that step
   2 has not made yet, and a prepare opens nothing, so a prepare after `detachAll` is harmless.
2. It makes the ids. `hostSessionId` and `rowId` each come from `deps.randomUuid()`. `processId` is
   `` `${hostSessionId}-1-${deps.clock.now()}` ``, which is the form that `startProcess` writes for a row's first
   start. The first message's uuid is not made here: the harness's `prepareRun` (08) makes it.
3. It builds an `AgentStart` with these fields: `processId`, `sessionId: hostSessionId`, `resume: false`, `projectDir`
   from `resolveTarget`, `profileDir: profileDirOf(profile)`, `controls: request.controls ?? {}`, `instructions` from
   the instructions rule above with `request.instructions ?? []` and `request.headless === true`,
   `idleCompactMinTokens: currentIdleCompactMinTokens(rowId)`, `rowId`.
4. `spawn` is `harness.prepareRun(start, request.message, env)`. `env` goes to the harness unchanged.
5. `adopt` holds `hostSessionId`, `processId`, `rowId`, `projectDir`, `profile: request.profile`,
   `headless: request.headless === true`, `unattended: request.unattended === true`,
   `instructions: request.instructions ?? []` (the run's own instructions, without the global texts or the note),
   `owner: request.owner ?? null`, `controls: request.controls ?? {}`, and
   `titles: { ...NO_TITLES, firstMessage }`. `firstMessage` is `firstMessageTitleOf(request.message.text)`, or null
   when that is `''`, as `setFirstMessageTitle` skips a textless message.
6. It logs `prepared session <hostSessionId> in <projectDir>`.

**`adopt(run)` goes through the restore path.** Split `restoreRecord` in two: `openRestoredRow`, and a new step that
holds everything after the open (the attach when `runsHere`, the unheld guard, the older-host and quit notices, the
missing-profile notice, the saved usage read). `restoreRecord` calls both and keeps its behaviour. `openRestoredRow`
gets an `origin: SessionOrigin` parameter: `restoreRecord` passes `'restored'` and `adopt` passes `'launched'`, since
the row is a launch that started in the host. Outside chat, only `session-log` reads `origin`
(`src/plugins/session-log/main/start.ts` copies it into the event log), so an adopted run logs `launched`, like any
launch. That needs no change.

`adopt` runs in this order:

1. It rejects `session <hostSessionId> not adopted: chat is stopping` after `detachAll`.
2. When a row already holds `run.hostSessionId`, it opens nothing and resolves to that row's sessionId: the
   `holding(run.hostSessionId)` session's `sessionId`, else the row id `openHostIds` pairs with the host id
   (`isOpenOnOtherRow`, a relay row). It logs `session <hostSessionId> already open as <row id>`. Reason: the run's
   row exists, so the caller records it and forgets the host run. Cases: chat restored a saved record of the same
   run (the app quit between an adopt and the scheduler's `forgetRuns`); the same run reaches the scheduler twice
   (a `runStarted` push and a `listRuns` at plugin start); the run's relay hello opened a relay row before the
   connect hold began. A rejection there would leave the host run unforgotten, and it would reject again at every
   app start.
3. It awaits `listHost()`. A rejection is logged by `listHost` and becomes `hosted = null`, so the row rests unheld,
   as `restore` does with an unknown list.
4. After the await, it runs the checks of steps 1 and 2 again, with the same outcomes. This is the same pattern as
   `resume`.
5. It builds a `SavedSession` from `run` with these fields: `hostSessionId`, `projectDir`, `profile`, `sent: true`,
   `busy: false`, `titles`, `processId`, `queued: []`, `returned: []`, `launchControls: run.controls`,
   `launchResume: false`, `launchHeadless: run.headless`. `controls` and `confirmedPicks` come from the
   opening-controls rule with `run.controls`. The other fields are `returnedDrops: []`, `activeMs: 0`,
   `rowId: run.rowId`, `unattended`, `headless`, `instructions` and `owner` from `run`. With `busy: false`, a run whose
   process is gone shows no quit notice. A finished run is the normal case, not a quit.
6. It calls `openRestoredRow(record, profileDir, 'launched')`. A throw rejects `adopt` with that error, after a
   `session <hostSessionId> not adopted: <reason>` log line. If `run.rowId` is held, it opens on a new row, as
   `restore` does, and resolves to that row's id.
7. It runs the split-out step with `hosted`. When the host lists `run.processId` as running and current, the row
   attaches (one `harness.attach`, no `harness.start`). Otherwise the row rests with `historyPending` true. An unknown
   profile opens the row with the missing-profile notice, as `restore` does: the run already ran, so its row still
   shows.
8. It awaits `session.attaching` when it is not null. For a resting row it then awaits `loadHistory(sessionId)`, so
   the row's saved history is read now (below, The callers of a replayed call). A failed read is handled as the
   existing path handles it, and `adopt` still resolves. It then calls `save()`, then resolves to
   `session.sessionId`. `attachProcess` never rejects.

**The callers of a replayed call.** Sessions replays a closed-app run's calls after `adopt` resolves (05, 17), and
chat's caller guard must tell the main agent's calls from a subagent's. Two rules:

- **Notes from saved history.** `prependHistory` calls `deps.toolCallers.noteToolStarted(sessionId, entry.toolUseId,
  entry.agentId)` for each `tool` entry of the history it read, before `replaceEntries`. An attached row needs no
  change: its pipe-log replay already notes each `toolStarted` through `agentEvent`, a subagent's included.
- **A replayed call reads the notes without waiting.** `callerGuard`, for a call with `replayed: true` and
  `mainAgentOnly: true` on a row chat owns, reads `callers.noted(sessionId, toolUseId)`. `MAIN_AGENT_ID` runs the
  call. Any other value, null included, skips it with `SUBAGENT_CALL_TEXT`. A live call keeps today's rule
  (`agentOf`, waiting up to `CALLER_WAIT_MS`, then runs). Reason: Claude's transcript reader skips sidechain lines,
  so a resting row's history holds only the main agent's calls; a call no note names is a subagent's. When the
  history could not be read, the run's replayed reports are dropped rather than applied as the main agent's.

**The exports in `start.ts`.**

- `prepareLaunch: (request, env) => chat.prepareLaunch(request, env)`.
- `projects`: the same list the channel's `projects()` handler returns, from the same function, so the page and a
  main part read one list. The scheduling main part (17) reads it for project names and the editor's picker.
- `restored` is the promise the `restored()` export already returns (`start.ts` `restored: () => restored`); chain on
  it.
- `adopt` builds `restored.then(() => chat.adopt(run))`, gives that promise to `sessions.holdConnects`, and returns
  it. Waiting for chat's own restore means that a saved record of the same host session id is restored first, so the
  adopt then resolves to that restored row and does not open a second row. It also means that `save()` runs after
  `isRestored`. The hold makes the run's relay hello join the owned row and not open its own row.
- `onInstructionsChanged: (listener) => consumer.track(chat.onInstructionsChanged(listener))`, in the consumer view
  beside `addInstructions`.

**Out of this task.** Capping controls (15, 17), choosing `headless`, `unattended` or `owner` for a scheduled run (17),
the env (05, 17) and forgetting host runs (17) are not in this task. The live run of a host-fired run adopted by the app
is a check in task 21 (Final verification).

## GIVEN / WHEN / THEN

- GIVEN a launch with `controls { mode: 'plan', effort: 'high' }` WHEN its process starts THEN the harness's
  `start` request has `controls { mode: 'plan', effort: 'high' }`, and the saved record has
  `launchControls { mode: 'plan', effort: 'high' }` and `confirmedPicks { effort: 'high' }`.
- GIVEN a launched row with controls whose process ended WHEN the user sends again THEN the new start passes the same
  `mode` and `effort`.
- GIVEN a launch with no `controls` WHEN its process starts THEN the start request has `controls {}` and the row
  opens with `controls []`, as today.
- GIVEN a launch or a `prepareLaunch` with `controls { mdoe: 'plan' }` WHEN it runs THEN it throws
  `Unknown control "mdoe". Controls: <the fake's ids>.` and opens nothing.
- GIVEN a headless `prepareLaunch` with own instructions WHEN it runs THEN `prepareRun` gets one `AgentStart` with
  `resume: false`, the processId form `<host>-1-<now>`, the global texts then the own instructions then
  `HEADLESS_NOTE`, `request.message` as the first message, and `env` unchanged. No row opens, the harness starts no
  process, and nothing is saved.
- GIVEN two `prepareLaunch` calls WHEN they return THEN their `hostSessionId`, `rowId` and `processId` values all
  differ.
- GIVEN a `prepareLaunch` that names a pool project WHEN it runs THEN `projectDir` is the pool's lowest-numbered clone
  in both the `AgentStart` and `adopt`.
- GIVEN a `prepareLaunch` with an image over the cap, an unknown profile, an unknown project, another profile than the
  project's own, no pool provider, or a pool with no clones WHEN it runs THEN it throws the same text as `launch`.
- GIVEN an `AdoptRequest` whose process the host lists as running and current WHEN `adopt` runs THEN the row opens
  unselected under `rowId` with the request's titles, it attaches to `processId` once and starts nothing, `sessionOpened`
  has origin `launched`, and `adopt` resolves to `rowId` after the attach settles.
- GIVEN an `AdoptRequest` whose process the host does not list, or lists as not running, WHEN `adopt` runs THEN the
  row rests with no notice, `loadHistory` reads its history before `adopt` resolves, each main-agent `tool` entry of
  that history is noted as the main agent's, and `adopt` resolves to `rowId`.
- GIVEN an `AdoptRequest` whose process the host lists as running but not current (an older host) WHEN `adopt` runs
  THEN the row rests unheld with the older-host notice, as `restore` does.
- GIVEN an `AdoptRequest` whose profile chat does not know WHEN `adopt` runs THEN the row opens with the
  missing-profile notice and `adopt` resolves to its id.
- GIVEN a resting adopted row whose history holds a main-agent call `toolu_main` WHEN the guard sees replayed
  main-agent-only calls `toolu_main` and `toolu_sub` THEN `toolu_main` runs and `toolu_sub` is skipped with
  `SUBAGENT_CALL_TEXT`, with no `CALLER_WAIT_MS` wait.
- GIVEN a `prepareLaunch` after `detachAll` WHEN it runs THEN it returns a spec and opens nothing.
- GIVEN chat's main part with an `onInstructionsChanged` listener WHEN a plugin calls `addInstructions`, then
  disposes the registration THEN the listener runs once for each, and a disposed listener does not run.
- GIVEN a host list that rejects WHEN `adopt` runs THEN the row rests unheld, and a later send runs the unheld guard
  first.
- GIVEN an adopted resting row WHEN the user sends THEN the process starts with `resume: true` and the request's
  controls, and the saved record keeps `headless`, `unattended`, `instructions` and `owner`.
- GIVEN a host session id that chat already holds, or that a relay row holds, before the `listHost` await or during
  it, WHEN `adopt` runs THEN it opens nothing and resolves to that row's sessionId.
- GIVEN `adopt` after `detachAll` WHEN it runs THEN it rejects and opens nothing.
- GIVEN `rowId` held by another session WHEN `adopt` runs THEN the row opens on a new id, and `adopt` resolves to
  that id.
- GIVEN chat's main part WHEN its `adopt` export runs THEN `sessions.holdConnects` gets the promise that the export
  returns, and the adopt runs only after the part's restore has settled.

## Tests

In `chat-sessions.test.ts`, a new `describe('createChatSessions prepare and adopt')` that uses `setUp`. Spy on the
fake harness's `prepareRun` with `vi.spyOn` to read the `AgentStart`, message and env that it got.

- `launch_Controls_FirstStartAndLaterStartsPassThem` — the first two GIVENs.
- `launch_NoControls_OpensAsBefore` — the `controls {}` start request and `controls []` on the row.
- `launchAndPrepare_UnknownControlId_ThrowsAndOpensNothing` — a table over `launch` and `prepareLaunch`.
- `prepareLaunch_Headless_BuildsTheStartAndOpensNothing` — the `AgentStart` fields, the message, the env passed
  through, no `opened` row, no harness process, no save.
- `prepareLaunch_TwoCalls_FreshIds`.
- `prepareLaunch_PoolProject_StartsInTheLowestClone`.
- `prepareLaunch_RefusedTarget_ThrowsAsLaunch` — a table of the six refusals, each asserting the same text that
  `launch` throws for that case.
- `adopt_ProcessRunsHere_AttachesUnderTheRowId` — also asserts that `save()` ran before `adopt` resolved.
- `adopt_ProcessGone_RestsAndReadsItsHistory` — a table: not listed; listed with `running: false`; listed running
  but not current (older-host notice, unheld); an unknown profile (missing-profile notice). The rows that read
  history assert the read ran, and the `toolCallers` fake got `noteToolStarted(rowId, <toolUseId>, MAIN_AGENT_ID)`
  for the history's `tool` entry, before `adopt` resolved. Break: a replay that runs before the callers are noted.
- `adopt_HostListRejects_RestsUnheld`.
- `adopt_RestingRowSent_ResumesWithTheRunsControls`.
- `adopt_HostIdOpen_ResolvesToThatRowAndOpensNothing` — a table: held by chat (resolves to its sessionId); open on
  a relay row (resolves to that row id); opened by a relay row during the `listHost` await (resolves to it, nothing
  opened). Break: a second row for one run, or a rejection that leaves the host run unforgotten.
- `adopt_AfterDetachAll_RejectsAndOpensNothing`; `prepareLaunch` after `detachAll` returns a spec.
- `onInstructionsChanged_RegisterAndDispose_CallsEachLiveListener`.
- `adopt_RowIdHeld_OpensOnANewRow`.

Existing restore tests (`createChatSessions restoring hosted processes` and `createChatSessions saved sessions`) stay
as they are and must pass after the `restoreRecord` split. Add no rows to them.

In `start.test.ts`, in `describe('chat main part')`:

- `exports_Adopt_HoldsRelayConnectsAfterTheRestore` — the hold gets the export's promise, and the adopt runs after
  the restore settles. It can reuse `startChatPart({ list, data: await dataWithSavedRow() })` and assert through
  `chat.exports.restored()`, as `exports_Restored_SettlesWithTheRestore` does.
- `exports_PrepareLaunch_PassesTheEnvToTheHarness`.
- `exports_Projects_EqualsTheChannelsList` — with one configured project, the export and the channel's `projects()`
  return equal lists; after a settings change that adds a project, both return the new list. Break: an export that
  captured the list once.

In `tool-callers.test.ts`:

- `noted_ReturnsTheNoteWithNoWait` — a noted call returns its agent; an unnoted one returns null with no timer set.
- `callerGuard_ReplayedCall_ReadsTheNotesWithoutWaiting` — an `it.each`: replayed and noted as `MAIN_AGENT_ID` →
  run; replayed and noted as a subagent → skip; replayed and not noted → skip; replayed, not `mainAgentOnly` → run;
  live and not noted → waits `CALLER_WAIT_MS`, then runs (today's rule). Break: a replayed subagent call applied as
  the main agent's.

## Done when

`npm run typecheck` and `npm run lint` pass. The test gate runs the tests above and the two existing chat test files
whole. `git grep -n 'prepareLaunch(request: LaunchRequest' src/plugins/chat/contract.ts` and
`git grep -n 'adopt(run: AdoptRequest)' src/plugins/chat/contract.ts src/plugins/chat/main/chat-sessions.ts` each
find their lines. The live check of a host-fired run that the app adopts is in task 21 (Final verification).

## Commit

One commit for the group, for example: `Chat: launch controls, prepareLaunch and adopt for host-started runs`.

## Proof

