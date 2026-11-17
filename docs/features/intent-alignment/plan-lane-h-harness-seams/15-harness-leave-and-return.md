# 15 — Chat follows a harness leaving and returning

Status: done
Type: Task
Wave: 12 · Depends on: 14
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/chat/main/chat-sessions.ts` · `src/plugins/chat/main/start.ts` ·
  `src/plugins/chat/main/selftest-script.ts` · `src/shared/fake-agent-harness.ts`
- test `src/plugins/chat/main/chat-sessions.test.ts` · `src/plugins/chat/main/start.test.ts` ·
  `src/shared/fake-agent-harness.test.ts`

Consumes:
- `MainServices.agentHarnesses: AgentHarnessRegistry` (`register` returns `AgentHarnessRegistration`, a `Disposable`;
  `get(id): AgentHarness | null`) ← 01
- `coreAgentHarnessesSlot` (`core.agentHarnesses`, keyed by harness id, value `AgentHarnessInfo` with `label`) ← 01.
  The registry adds a harness to `list()` and `get` before it sets the key, and drops it from them before it deletes
  the key ← 01
- `KeyedSlotReader<V>.all(): ReadonlyMap<string, V>` and `.on(listener: (key: string, value: V | undefined) => void):
  Disposable` in `src/contracts/state.ts` — today; `value` is `undefined` for a deleted key
- `AgentProcess.detach(): void` in `src/contracts/agent.ts` — today: "Stops this process object's events and timers
  and leaves the hosted process running; a pending `end` settles, with no `ended`"
- `AgentHarness.attach(start: AgentStart, events: AgentProcessEvents): Promise<AgentProcess | null>` and
  `SessionHost.list(): Promise<HostedProcessInfo[]>` — today
- The `claude-code` plugin's stop drops its adapter object and its tool contributions; it neither kills nor detaches
  the processes its adapter started in the session host (`services.sessionHost` is not scoped to the plugin's stop)
  ← 03 (seam)
- `createFakeAgentHarness(clock, files, timers)` with id `FAKE_HARNESS_ID = 'fake'` and label `Fake` ← 10
- `requireHarness`, `harnessOfProfile` in `src/plugins/chat/main/lookups.ts`; `ChatSessionInfo.harness`;
  `SavedSession.harness`; the restore's unregistered-harness notice ← 10
- In `chat-sessions.ts` today: `HeldSession.unheldProcessId`, `settleUnheld`, `runUnheldStep`, `attachProcess`,
  `restAfterFailedAttach`, `afterAttach`, `historyReadOf`, `removeOlderHostNotice`, `isDetached` / `detachAll`

Produces:
- `harnessLeft(harnessId: string): void;` in `ChatSessions` in `src/plugins/chat/main/chat-sessions.ts`
- `harnessReturned(harnessId: string): Promise<void>;` in `ChatSessions` in `src/plugins/chat/main/chat-sessions.ts`
- `harnessLabelOf(harnessId: string): string;` in `ChatSessionsDeps` in `src/plugins/chat/main/chat-sessions.ts`
- `export interface FakeHarnessIdentity { id: string; label: string; profiles: readonly HarnessProfile[] }` in
  `src/shared/fake-agent-harness.ts`, and `createFakeAgentHarness` takes an optional last parameter
  `identity?: FakeHarnessIdentity`

Decisions:
- Chat main hears the change through the `core.agentHarnesses` slot's `on`, not a registry listener: the design doc
  says the slot's `on` is the change signal and the registry has no listener API (design doc § Registry).
- `start.ts` reads `api.state.read(coreAgentHarnessesSlot)` once. It keeps the set of present ids (from `all()` at
  start) and the last label read for each id. A key deleted that the set holds calls `chat.harnessLeft(id)`. A key set
  that the set lacks calls `chat.harnessReturned(id)`, a first registration after chat's start included. A key set
  again for a present id (a `refresh()`) calls neither. `harnessLabelOf(id)` returns the last label read, else `id`
  (plan.md § Decisions: an unregistered id shows as its raw id) (drafter).
- A leave detaches; it never ends a process. Each held row on the leaving harness whose `process` is not null:
  `process.detach()`, then `unheldProcessId` takes the row's `processId`, and the row rests through the steps
  `restAfterFailedAttach` runs (`running: false`, `pid: null`, `process` null, the compaction cleared, the background
  cleared, `showRestingIdle`, `sessionRested` with `error: null`) with no saved-usage read and no quit notice. The
  process goes from chat's `running` set without `kill`. A row still attaching does the same once its attach settles
  (`afterAttach`); an attach that resolved a process detaches that process (design doc § A harness reloading; brief:
  "chat drops the `AgentProcess` without ending it").
- The row's waiting permission cards settle as aborted, as when their tool session ends: `settlePermission` with
  `{ allowed: false, reason: CANCELLED_REASON }`, the answer the call's abort handler gives (drafter: the adapter's
  permission route goes with its plugin, so no answer can reach it; re-verify the name after task 08).
- What the user sees (the user, round 3): the row rests (`activity: 'idle'`, `running: false`, its clock paused),
  and the chat gains an info notice `<label> is not loaded. This session waits for it to load again.` A send to it
  (`send`, `sendAllNow`, the export `send`) rejects before anything queues, with
  `<label> is not loaded. Send again once it is.`; the page shows it as `Message not sent: <text>` and puts the
  message back in the box (today's `refused` path). `clear`, `setControl` and `sendNow` throw the same text (`sendNow` writes to the process, which a waiting
  row lacks). `pullBack` and `setHeadless` work as on any row: neither touches the process, and pull back is how the
  user takes back a message queued before the leave (the rest leaves `chat.queued` as it was; measured at refresh
  time, `restAfterFailedAttach` touches no queue). `interrupt` does nothing, as on any resting row: `liveFor` logs and
  returns (the user, refresh round). `loadHistory`
  reads nothing, and a later call tries again. `<label>` is `harnessLabelOf(id)`.
- Every held row on that harness waits, resting rows with no process included. The waiting state is not saved: a
  relaunch restores by the registry as it stands then.
- A leave after `detachAll` does nothing (chat is stopping; quit stops chat before `claude-code`).
- `claudeCodeMainPart` stands before `chatMainPart` in `mainParts` (`src/plugins/main.ts`), so a full stop, which runs
  in reverse start order (`src/shared/plugin-host.ts`), stops chat first. Task 03 places it right after
  `sessionsMainPart`; this task edits no file for it and verifies it with
  `grep -n 'claudeCodeMainPart\|chatMainPart' src/plugins/main.ts` (the claude-code line comes first).
- A return re-attaches through `attach`, the path an app relaunch takes (design doc § A harness reloading). For each
  held row waiting on the id: the waiting state lifts and the waiting notice goes. A row whose profile its harness no
  longer declares rests with the missing-profile notice, and nothing attaches. That notice is `missingProfileText(name)`
  in `chat-sessions.ts` (line 551, called at line 2982). Neither task 05 nor task 10 rewrites it,
  so it still reads `Profile <name> is not in chat's profiles setting; add it back to resume this session.`, naming a
  setting that no longer exists. This task rewrites it to
  `` `Profile ${name} is not declared by ${harnessLabel}; add it back to resume this session.` `` and gives the
  function a second parameter `harnessLabel: string` (the call at line 2982 passes `deps.harnessLabelOf(record.harness)`). A row with no
  `unheldProcessId` changes nothing more. Any other row replaces its entries with `[]`, sets `historyPending` to its
  `sent` and `historyBefore` to null, and runs `settleUnheld`, which lists the host:
  - its process runs here: `attachProcess` replays it (`historyBefore` becomes the process's `startedAt`);
  - it runs in another app version: the row keeps the guard and gets the older-host notice;
  - it is not running: the row stays resting until the next message, as after a relaunch;
  - the list rejects: the row keeps the guard; the next send or tab show tries again.
  When the step's `readsHistory` is true, chat reads the earlier conversation at once (`historyReadOf`), not on the
  page's next `loadHistory`. Entries are rebuilt from the transcript and the replay because a fresh attach numbers
  its entries under a new process start (`rowEntryId`), so kept entries would show twice (drafter).
- A restored record whose harness is not registered (task 10's notice) waits instead: it opens resting in the waiting
  state with the waiting notice, and `harnessReturned` attaches it as above. Task 10's text
  `No agent harness "<id>" is registered; turn its plugin on to resume this session.` leaves the code.
- The self-test cannot restart `claude-code`: in the self-test the composition root registers the fake and leaves
  `claude-code` out (plan.md § Decisions). The chat self-test makes a harness leave and return by registering a
  fixture fake through `services.agentHarnesses` and disposing the registration (brief option). The fixture's
  identity: id `fake-return`, label `Fake return`, one profile `{ name: 'fake-return', configDir: '~/.fake-return' }`.
  Its run happens inside the script's `open`, before the existing three sessions open, and its row closes before
  them, so the side bar the steps walk holds the same rows as today (drafter). Self-test steps press keys and wait on
  log lines, and the leave is main-side, so the run is checked by the script's `problems`.

Mandatory:
- `AGENTS.md` § Intent and the Architecture paragraphs plan.md § Mandatory Reads names; `AGENTS.md`'s chat plugin
  entry and the session host paragraph.
- `docs/features/agent-harnesses/design.md` (whole, § A harness reloading first).
- `docs/features/plugin-framework/design.md` § Hot reload (Wave 4) and § Runtime loader (Wave 4 step 3).
- `docs/features/agent-chat/design.md`: saved sessions, re-attach and the older-host guard.
- `wigley:writing-code`, `wigley:codebase-design`, `wigley:writing-tests` and its `typescript-vitest.md`.

GIVEN a row on harness `fake` whose process runs WHEN the `fake` key leaves `core.agentHarnesses` THEN chat calls
`detach()` on the process, never `kill()` or `end()`, and the row rests with the notice
`Fake is not loaded. This session waits for it to load again.`
GIVEN a row waiting on `fake` WHEN the user sends THEN the send rejects with `Fake is not loaded. Send again once it
is.`, nothing queues, and no process starts.
GIVEN a row waiting on `fake` WHEN the user presses Send now on a queued message THEN it throws that text and writes
nothing; pull back and the headless switch work as on any row, and interrupt changes nothing.
GIVEN a row waiting on `fake` whose process the host still runs WHEN `fake` registers again THEN chat attaches the
row through `fake`'s `attach` with the row's process id, the notice goes, and the row runs again.
GIVEN a row waiting on `fake` whose process ended meanwhile WHEN `fake` registers again THEN no attach runs, the row
rests, its entries are the transcript's, and the next send starts a process with `resume: true`.
GIVEN a restored record on a harness that is not registered WHEN that harness registers THEN chat attaches the row
as a relaunch does.
GIVEN `fake` refreshes (its key is set again while present) WHEN chat hears it THEN nothing detaches or attaches.
GIVEN chat ran `detachAll` WHEN a harness leaves THEN chat changes no row.

Tests:
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessLeft_RunningRow_DetachesAndRestsWithTheNotice` — a row
  started on the fake, a message sent; the registry double's `get('fake')` returns null; `harnessLeft('fake')` with
  `harnessLabelOf` returning `Fake`: the fake's record has `detached: true` and its `calls` hold no `kill` and no
  `end`; `chat.session` holds `running: false`, `activity: 'idle'`; the last entry is an info notice
  `Fake is not loaded. This session waits for it to load again.`; `sessionRested` was sent with `error: null`.
- `src/plugins/chat/main/chat-sessions.test.ts` › `send_HarnessLeft_RejectsNamingTheLabel` — after the leave, `send`
  rejects with `Fake is not loaded. Send again once it is.`; `chat.queued` is `[]`; the fake holds one process.
  Rows in the same `it.each`: `sendAllNow` rejects, `clear` throws, `setControl` throws, `sendNow` throws, each with
  that text.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessLeft_PullBackHeadlessInterrupt_WorkAsOnAnyRestingRow` — a
  running row with one message queued behind its turn; after `harnessLeft('fake')`: `pullBack` moves that message
  into `chat.returned`, `setHeadless(id, true)` sets `headless: true` in `chat.session`, and `interrupt` adds no entry
  and records no fake call.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessLeft_AttachingRow_DetachesOnceTheAttachSettles` — a
  restored row whose attach is held: the leave runs, then the attach resolves a process: that process gets `detach`,
  and the row rests waiting.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessLeft_AfterDetachAll_ChangesNoRow` — `detachAll()`, then
  `harnessLeft('fake')`: no notice is added and no `sessionRested` is sent.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessReturned_ProcessRunningHere_AttachesThroughAttach` — the
  session host lists `{ id: <the row's processId>, running: true, current: true }` and the fake has a `process`
  attach script whose replay emits one assistant entry; after `harnessReturned('fake')` resolves: `attachCalls` maps
  to `[<processId>]`; `chat.session` holds `running: true`; no entry is the waiting notice; each entry id in
  `chat.entries` occurs once.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessReturned_ProcessEnded_RestsAndReadsTheHistory` — the host
  lists nothing: `attachCalls` is `[]`; `chat.session` holds `running: false`; `chat.entries` equals the fake's
  history entries; the next `send` starts one new process whose request has `resume: true`.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessReturned_ProfileGone_RestsWithTheMissingProfileNotice` —
  the returned harness declares no `work`: no attach runs; the last entry is the error notice `Profile work is not
  declared by Fake; add it back to resume this session.`.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessLeft_WaitingPermissionCard_SettlesAsAborted` — a row with
  one pending permission card (a tool call asked through the permission route, unanswered); after `harnessLeft('fake')`
  the card's entry holds `answer: { allowed: false, reason: CANCELLED_REASON }` and the call's promise resolves with the
  reply text `permissionReplyText` gives that answer.
- `src/plugins/chat/main/chat-sessions.test.ts` › `loadHistory_HarnessLeft_ReadsNothingAndLaterTriesAgain` — after the
  leave, `loadHistory` resolves with the fake's history reader uncalled; after `harnessReturned('fake')` a second
  `loadHistory` reads it once.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessLeft_RestingRowWithNoProcess_StillWaits` — a restored row
  that is idle with no process and no `unheldProcessId`: after the leave a `send` rejects with `Fake is not loaded.
  Send again once it is.` and the last entry is the waiting notice.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessReturned_NoUnheldProcessId_ChangesNothingMore` — the row
  from the test above, then `harnessReturned('fake')`: the waiting notice is gone, the entries and `historyPending`
  are as before the leave, no attach runs and the host is not listed.
- `src/plugins/chat/main/chat-sessions.test.ts` › `harnessReturned_ListRejects_KeepsTheGuard` — the session host's
  `list()` rejects with `boom`: no attach runs, `isUnheld` still holds for the row (a `send` lists the host again), and
  the waiting notice is gone.
- `src/plugins/chat/main/chat-sessions.test.ts` › replace task 10's `restore_HarnessNotRegistered_RestsWithTheNotice`
  with `restore_HarnessNotRegistered_WaitsAndAttachesWhenItRegisters` — a record with `harness: 'gone'` whose process
  the host lists running: the row opens with the notice `gone is not loaded. This session waits for it to load
  again.`; after the registry double holds `gone` and `harnessReturned('gone')` resolves, `gone`'s `attachCalls` maps
  to the record's `processId`.
- `src/plugins/chat/main/start.test.ts` › `start_HarnessKeyDeleted_ChatHearsTheLeave`,
  `start_HarnessKeySetAfterItLeft_ChatHearsTheReturn`, `start_PresentHarnessSetAgain_ChatHearsNeither` — writes to the
  `core.agentHarnesses` slot reach `harnessLeft` and `harnessReturned` on a recording `chat` double as the Decisions
  say.
- `src/shared/fake-agent-harness.test.ts` › `createFakeAgentHarness_Identity_IdLabelAndProfilesAsGiven` — `id`,
  `info().label` and `info().profiles` are the identity's; with none they are `fake`, `Fake` and the profiles task 05
  gave the fake.
- `src/plugins/chat/main/selftest-script.ts` › the chat script's `open` runs the leave-and-return fixture first, in a
  fourth project folder `chat-return` under the temp home that `makeProjects` makes and `closeEarlierSessions`
  closes rows in. It registers the fixture fake, starts a session on `fake-return` / profile `fake-return`, sends one
  message, disposes the registration, waits until the row holds `running: false`, sends again and keeps the
  rejection text, registers the fixture again, waits until the waiting notice is gone, sends a third message, closes
  the row with reason `project-closed`, and disposes the second registration. `problems` adds, for that run's
  fixture records only:
  - `harness leave: the send was not refused` when the second send resolved;
  - `harness leave: the send was refused with "<text>", not "Fake return is not loaded. Send again once it is."`;
  - `harness leave: the process was not detached` when the first record's `detached` is false;
  - `harness return: no resumed process started on Fake return` when no later record's request has `resume: true`.

Approach:
- `HeldSession` gains the id of the harness the row waits on, null when none (drafter). The send, send-now, clear and
  control refusals read it before any other step.
- `harnessReturned` reads the harness with `deps.harnesses.get(id)`. When it returns null (the key and the list
  disagree), chat logs `harness <id> set in core.agentHarnesses but not registered` and changes nothing.
- `selftest-script.ts`: `ChatSelfTestDeps` gains the registry and the fixture fake; `start.ts` builds the fixture with
  `createFakeAgentHarness(services.clock, services.files, services.timers, identity)` only when `services.selfTest`
  is set.

Done when: `npm run lint` and `npm run typecheck` pass; the test gate runs the tests above and the chat self-test
(`npm run selftest -- --plugin chat`).

Commit: one commit. No follow-up to remove and no master-plan box to tick (settled in round 2).

## Proof

Commit f7b3afb8d · proof: Diff read: harnessLeft, harnessReturned, harnessLabelOf, FakeHarnessIdentity and createFakeAgentHarness identity param present; typecheck and lint pass first time · concerns: resume's prefix match (09) still misses new-scheme process ids — return path uses settleUnheld's exact id match instead; a row whose harness leaves before its host id is reported fails its re-attach on return (attach rejects a null sessionId); self-test history read adds a harmless error notice to the return fixture row; hostSessionIdSettled waiters still pending after detachAll
