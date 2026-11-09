# 02 — Chat main: per-session instructions, owner, main resume

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · `src/plugins/chat/main/chat-sessions.ts` ·
           `src/plugins/chat/main/open-sessions.ts` · `src/plugins/chat/main/start.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts` · `src/plugins/chat/main/open-sessions.test.ts`
Consumes:  `OpenOptions.owner?: string` ← 01; the rule from 01 that sessions never selects a row with an owner and
           ignores `mark`, `activate` and `activateExistingRow` of it.
           `LaunchRequest` (`src/plugins/chat/contract.ts:47-54`), `ResumeRequest` (`:66-71`), the channel's
           `resume` (`:295-298`), `ChatMainExports` (`:506-512`); in `chat-sessions.ts`: `ChatSessions.launch` doc
           (`:143-147`) and `resume` doc (`:189-201`), `HeldSession.unattended` (`:441-443`), `savedSessionOf`
           (`:584-608`), `announceTurnFinished` (`:764`), the alert rule in `updateActivity` (`:834-877`), `openRow`
           (`:1408-1529`), `startProcess` (`:1754`, `instructions` at `:1779`), `currentInstructions` (`:1800-1804`),
           `attachProcess` (`:1827`, `instructions` at `:1853`), `openAndStart` (`:2062-2121`), `openAndAttach`
           (`:2123-2162`), `startNew` (`:2164-2187`), `launch` (`:2524-2541`), `activateRowOf` (`:2557-2569`),
           `openRestoredRow` (`:2586-2628`), `resume` (`:2957-3015`); `SavedSession` and its parse in
           `open-sessions.ts` (`:8-52`, `:63-75`, `:178-200`, `:223-243`); chat main's exports in `start.ts:515-516`.
Produces:  in `src/plugins/chat/contract.ts`: `LaunchRequest.instructions?: readonly string[]`,
           `LaunchRequest.owner?: string`, `ResumeRequest.instructions?: readonly string[]`,
           `ResumeRequest.owner?: string`, `ChatMainExports.resume(request: ResumeRequest): Promise<string>`.
           In `open-sessions.ts`: `SavedSession.instructions: string[]` and `SavedSession.owner: string | null`.
Decisions:
- Follow `unattended` as the precedent (`chat-sessions.ts:441-443`, `:1430`, `:1522`, `:2076`, `:2099`, `:2169`,
  `:2535`, `:2609`; `open-sessions.ts:49-51`, `:75`, `:198`, `:241`). `HeldSession` gains `instructions: readonly
  string[]` and `owner: string | null`; each `opening` object that carries `unattended` (`openRow`, `openAndStart`)
  carries both. They are set at open and never change: `clear` keeps the `HeldSession`, so a clear keeps them.
  Source: design.md § Chat and sessions changes ("saved with the session, so they hold across `/clear`, a relaunch
  and a resume").
- `startNew`'s last parameter `unattended: boolean` becomes `flags: { unattended: boolean; instructions: readonly
  string[]; owner: string | null }`. `launch` passes `{ unattended: request.unattended === true, instructions:
  request.instructions ?? [], owner: request.owner ?? null }`; `start` (the page's new session, `:3225`) passes `{ unattended:
  false, instructions: [], owner: null }`.
- `openRow` passes the owner to sessions: `sessions.open(info, owner === null ? options : { ...options, owner })`.
  The options object stays `{ select }` or `{ select, rowId }` for a row with no owner, so the existing
  `openOptions` assertions hold.
- Order of instructions: `currentInstructions(session: HeldSession): string[]` returns the global registrations in
  registration order, then `session.instructions` in request order. Both call sites pass the session
  (`startProcess`, `attachProcess`). Source: design.md § Per-session instructions ("after the global
  `addInstructions` texts").
- Saved record: `SavedSession.instructions` and `SavedSession.owner`, both added to `LaterSavedField`. A file
  written without them reads `[]` and `null`. `isStoredSession` accepts `instructions` undefined or an array of
  strings (`isOptionalStrings`) and `owner` undefined, null or a string (`isOptionalId`), and rejects any other
  value. `savedSessionOf` writes `[...session.instructions]` and `session.owner`. `openRestoredRow` passes
  `record.instructions` and `record.owner` to `openRow`, so a relaunch re-opens the row with its owner and starts or
  attaches with its instructions.
- Resume with an owner opens its row unselected: `resume` passes `{ select: request.owner === undefined }` to
  `openAndStart`. `openAndAttach` (`:2126`) gains a last parameter `select: boolean` (today it passes `{ select:
  true }` to `openRow`), and its `opening` object gains `instructions: readonly string[]` and `owner: string |
  null`. Its one caller in `resume` (`:2978`) passes `request.owner === undefined` and the request's two fields. Both
  paths carry the request's `instructions ?? []` and `owner ?? null` into `openRow`. A resume with no owner keeps today's
  `{ select: true }`. Source: design.md § Owned rows (pane placement skips an owned row) and 01's rule that main never
  selects such a row.
- A resume that finds a row chat already holds for the host id returns that row's id and keeps that row's own
  instructions and owner; the request's two fields do not change a held row. `activateRowOf` does not call
  `sessions.activate` for a held row whose `owner` is non-null (sessions would only log and ignore it). Source:
  design.md § The interviewer ("Reopening the problem brings the same session back").
- A row with an owner raises no `Turn finished` alert and no mark, as an unattended row: add `session.owner ===
  null` to the alert condition in `updateActivity` (`:870-873`). The reason: such a row is never main's selection,
  so `userIsElsewhere` would read true on every turn the user watches in the owner's pane. `turnFinished` is still
  emitted. Source: this task, following the `unattended` rule (`ChatMainExports.launch` doc).
- `ChatMainExports.resume` is `resume: (request) => chat.resume(request)` in the exports object of `start.ts:515`.
  The channel's `resume` handler (`start.ts:364`) does not change; the page sends no `instructions` or `owner`.
- Doc comments that change with the code (prose lands with the code):
  - `LaunchRequest` (`contract.ts:47`): `instructions` is text this session alone carries to its harness after the
    global `addInstructions` texts; `owner` names the plugin the row belongs to (sessions' `OpenOptions.owner`).
    Both are kept with the row across a clear and a relaunch.
  - `ResumeRequest` (`:64-65`): the same two fields, and that a resume with `owner` opens its row unselected.
  - The channel's `resume` (`:295-297`): unchanged rule; add that a held row is activated only when it has no owner.
  - `ChatMainExports.launch` (`:507-511`): `instructions` and `owner`, and that a row with an owner raises no `Turn
    finished` alert.
  - `ChatMainExports.resume` (new, beside `launch`): the channel's resume for another plugin: resolves to the row's
    sessionId; a row chat holds for the host id is returned as it is (activated only when it has no owner); a
    session open on a row chat does not hold rejects; `instructions` and `owner` as `launch` has them.
  - `ChatMainExports.addInstructions` (`:543-546`): a session's own `instructions` follow these texts.
  - `ChatSessions.launch` (`chat-sessions.ts:143-147`) and `ChatSessions.resume` (`:189-201`): the same rules.
  - `HeldSession` new fields, and `SavedSession` new fields: one line each, as `unattended` has.

GIVEN `addInstructions('global note')` WHEN `launch` runs with `instructions: ['own note']` THEN the harness start's
`instructions` is `['global note', 'own note']`, and a plain `start` in the same chat gets `['global note']`.
GIVEN that launched row WHEN `clear` runs THEN the next start's `instructions` is `['global note', 'own note']`.
GIVEN `launch` with `owner: 'practice'` WHEN the row opens THEN sessions' `open` receives `{ select: false, owner:
'practice' }`.
GIVEN a launched row with `instructions` and `owner` WHEN chat saves, as launched and after a clear THEN the record
holds the same `instructions` and `owner`.
GIVEN a saved record with `instructions: ['own note']` and `owner: 'practice'` WHEN chat restores it THEN `open`
receives `owner: 'practice'` and the row's next start or attach carries `'own note'` after the global texts.
GIVEN `resume` with `owner: 'practice'` and `instructions: ['own note']` WHEN no row holds the host id THEN `open`
receives `{ select: false, owner: 'practice' }` and the process starts with `'own note'` after the global texts.
GIVEN `resume` for a host id chat holds on a row with an owner WHEN it runs THEN it resolves to that row's id and
sessions' `activate` is not called.
GIVEN a launched row with an owner WHEN its turn finishes while the window is not focused THEN no alert and no mark.
GIVEN `open-sessions.json` written before these fields WHEN it loads THEN `instructions` is `[]` and `owner` is null.

Tests (all in `src/plugins/chat/main/chat-sessions.test.ts` unless named; the harness is `setUp()` with
`createFakeAgentHarness` from `src/shared/fake-agent-harness`; `test.harness.processes[n].request` and
`test.harness.attachCalls` record each `AgentStart`; `test.openOptions` records each `OpenOptions`):
- `launch_InstructionsFollowTheGlobalOnesAndSurviveAClear`, beside `addInstructions_EachStartCarriesTheRegisteredOnes`
  (`:850`): `addInstructions('global note')`; `launch` with `instructions: ['own note']`; `start` a second row; assert
  process 0 `['global note', 'own note']` and process 1 `['global note']`; `clear` the launched row; assert its new
  process `['global note', 'own note']`. Catches the session's text placed before the global ones, leaked to every
  session, or lost on a clear.
- `launch_OpensUnselectedAndSendsFirstMessage` (`:1388`) becomes an `it.each` over `{ owner, options }`: owner absent
  → `[{ select: false }]`; `owner: 'practice'` → `[{ select: false, owner: 'practice' }]`. Catches an owner that
  never reaches sessions.
- `turnFinished_LaunchedRow_AlertsByUnattended` (`:1667`) gains a row `{ given: 'owner: practice', flag: { owner:
  'practice' }, alerts: 0 }`; rename it `turnFinished_LaunchedRow_AlertsUnlessUnattendedOrOwned`. Catches the alert
  firing on every interviewer turn.
- `save_LaunchedRow_RecordKeepsUnattended` (`:3561`) becomes `save_LaunchedRow_RecordKeepsItsLaunchFlags`: launch
  with `unattended: true, instructions: ['own note'], owner: 'practice'`; assert the saved records map to
  `[{ unattended: true, instructions: ['own note'], owner: 'practice' }, { unattended: false, instructions: [], owner:
  null }]` in both rows (`as launched`, `after a clear`). Catches a field left out of `savedSessionOf`.
- `restore_RecordWithInstructionsAndOwner_ReopensWithBoth`, an `it.each` over how the row comes back, each with
  `addInstructions('global note')` and `record('host-a', { instructions: ['own note'], owner: 'practice', processId:
  … })`:
  - `resting, then a send`: `restore(saved, [])`, then `send`; assert `openOptions` `[{ select: false, owner:
    'practice' }]` and process 0's `instructions` `['global note', 'own note']`.
  - `running here`: `hosted` lists `{ id: <the record's processId>, startedAt: 1, running: true, current: true }` with
    `scriptAttach` set as in `resume_ProcessRunningHere_ReadsHistoryUpToItsStart` (`:1245`); assert `attachCalls[0]
    .instructions` `['global note', 'own note']`.
  Catches a relaunch that drops either field, and an attach that passes only the global texts.
- `resume_OwnerAndInstructions_OpenUnselectedAndStartWithThem`, an `it.each` over the path, each with
  `addInstructions('global note')` and a request with `owner: 'practice', instructions: ['own note']`:
  - `history read, new process` (as `resume_OpensWithHistoryAndResumesTheProcess`, `:984`): `openOptions` `[{ select:
    false, owner: 'practice' }]`, process 0 `instructions` `['global note', 'own note']`.
  - `process running here` (as `:1245`): `openOptions` the same, `attachCalls[0].instructions` the same.
  Catches a resume that selects a row with an owner, and a resume that drops the instructions.
- `resume_HostIdChatHoldsOnARowWithAnOwner_ReturnsItWithoutActivating`, beside
  `resume_HostIdChatHolds_SelectsExistingRow` (`:1307`): launch with `owner: 'practice'`, then `resume` its host id;
  assert the resolved id is the launched row's and `test.activated` is `[]`. Catches an activate sessions would only
  log and ignore.
- `open-sessions.test.ts`: add `instructions` and `owner` to the `TWO_SESSIONS` fixture records (one record
  `instructions: ['own note'], owner: 'practice'`, the other `[]` and `null`), so the round trip covers them; add the
  rows `a session without instructions` → `instructions: []` and `a session without owner` → `owner: null` to the
  load table (`:102`); add the rows `instructions a string` and `owner a number` to the rejecting table (`:214`).
  Catches a parse that drops or does not check the fields.
Approach:
- TypeScript names every `SavedSession` literal that lacks the new fields (the `record` helper at
  `chat-sessions.test.ts:290`, full records near `:3540` and `:4443`, `open-sessions.test.ts:114-145`): add
  `instructions: []` and `owner: null` there.
- `currentInstructions` stays one function; its comment states the order.
Done when: `npm run typecheck` passes, `npm run lint` passes, and the test gate runs `chat-sessions.test.ts` and
`open-sessions.test.ts`, both green.
Commit:    one commit for the group

## Proof

Commit 4a6843cd · proof: diff read: LaunchRequest/ResumeRequest instructions+owner, ChatMainExports.resume, SavedSession.instructions/owner present; typecheck clean; worker ran chat-sessions and open-sessions tests green (477), oxlint+oxfmt clean on chat (check-layers blocked by in-flight 04) · concerns: none
