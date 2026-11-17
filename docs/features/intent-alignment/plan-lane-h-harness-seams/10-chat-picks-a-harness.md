# 10 — Chat picks a harness

Status: done
Type: Task
Wave: 7 · Depends on: 09
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/chat/contract.ts` · `src/plugins/chat/manifest.ts` · `src/plugins/chat/main/lookups.ts` ·
  `src/plugins/chat/main/chat-sessions.ts` · `src/plugins/chat/main/start.ts` · `src/plugins/chat/main/open-sessions.ts` ·
  `src/plugins/chat/main/recent-folders.ts` · `src/plugins/chat/main/folder-choices.ts` ·
  `src/plugins/chat/main/accounts.ts` · `src/plugins/chat/main/start-session-tool.ts` ·
  `src/plugins/chat/main/fixtures.ts` (when it still exists after task 08) · `src/plugins/chat/main/selftest-script.ts`
  (its `fixtureProblems` and task 09's `openSessions` literal) · `src/plugins/chat/main/chat-slots.ts` (`setInfo`'s
  update type) · `src/plugins/chat/main/preview/chat-preview.ts` (its `deps.slots.open` state) ·
  `src/plugins/docs/main/selftest-fixture.ts` (load states and plugin entries under the fake's id) ·
  `src/main/selftest-config.ts` (the fake-run settings helper) ·
  `src/plugins/chat/page/start.ts` · `src/plugins/chat/page/start-prompt.ts` · `src/plugins/chat/page/start-prompt-items.ts` ·
  `src/plugins/chat/page/session-part.ts` · `src/plugins/chat/page/chat-view.ts` · `src/plugins/chat/layouts/layout.d.ts` ·
  `src/plugins/chat/layouts/default/layout.js` · `src/plugins/usage/main/start.ts` (only when it still names
  `CHAT_HARNESS_ID`) · `src/shared/fake-agent-harness.ts` · `src/main/main.ts` · `docs/features/followups.md` ·
  `docs/features/intent-alignment/master-plan.md`
- create `src/plugins/chat/main/lookups.test.ts`
- test `src/plugins/chat/main/chat-sessions.test.ts` · `src/plugins/chat/main/open-sessions.test.ts` ·
  `src/plugins/chat/main/recent-folders.test.ts` · `src/plugins/chat/main/folder-choices.test.ts` ·
  `src/plugins/chat/main/accounts.test.ts` · `src/plugins/chat/main/start.test.ts` ·
  `src/plugins/chat/main/start-session-tool.test.ts` · `src/plugins/chat/page/start-prompt.test.ts` ·
  `src/plugins/chat/page/start-prompt-items.test.ts` · `src/plugins/chat/page/session-part.test.ts` ·
  `src/plugins/chat/layouts/default/layout.test.ts` · `src/plugins/usage/main/start.test.ts` ·
  `src/shared/fake-agent-harness.test.ts` · `src/main/selftest-config.test.ts` ·
  `src/plugins/docs/main/selftest-fixture.test.ts` · `src/plugins/chat/main/chat-slots.test.ts`
- test, `harness` added to each `ChatSessionInfo` or `ChatSessionState` literal (measured at plan time, re-verify
  with `npm run typecheck`): `src/plugins/chat/main/chat-slots.test.ts` (`STATE`, line 42),
  `src/plugins/chat/main/chat-sessions.test.ts` (`keptSessionInfo`, line 317; the `sessionStarted` expectation at
  line 878, a runtime `toEqual`), `src/plugins/chat/page/chat-view.test.ts` (`stateOf`, line 105),
  `src/plugins/chat/page/chat-commands.test.ts` (`state`, line 128), `src/plugins/chat/page/start.test.ts`
  (`SESSION`, line 43), `src/plugins/auto-retro/main/start.test.ts` (`sessionInfo`, line 62),
  `src/plugins/auto-retro/main/retro-done.test.ts` (line 14), `src/plugins/workflow/main/start.test.ts`
  (`chatHeld`, line 303), `src/plugins/workflow/page/start.test.ts` (`chatInfo`, line 415).
  `src/plugins/system-stats/main/grouping.test.ts` builds its info with `as ChatSessionInfo` (line 192) and needs no
  edit; nor do the `as ChatSessionInfo` reads in `chat-view.test.ts` and `chat/page/start.test.ts`

Consumes:
- `MainServices.agentHarnesses: AgentHarnessRegistry` (`register`, `list`, `get`) ← 01
- `coreAgentHarnessesSlot: KeyedSlotKey<AgentHarnessInfo, 'main', 'core'>` (`core.agentHarnesses`, keyed by harness id) ← 01
- `harnessLabel(infos: ReadonlyMap<string, AgentHarnessInfo>, id: string): string` in
  `src/shared/agent-harness-label.ts` ← 01
- `AgentHarness.info(): AgentHarnessInfo` with `label` ← 01 and `profiles: readonly HarnessProfile[]` ← 05
- `AgentHarnessInfo.capabilities.midTurnSend: boolean` ← 04
- `HarnessProfile { name: string; configDir: string }` ← 05; chat's `profiles` setting and `ChatProfile` are gone ← 05
- `CLAUDE_HARNESS_ID = 'claude'` in `src/plugins/claude-code/main/claude-code-harness.ts` ← 03 (chat does not import
  it; the setting default is the literal `'claude'`)
- `AgentStart.sessionId: string | null`, `AgentProcessEvents.sessionId(id: string): void` ← 09
- `SavedSession`'s optional-field pattern (`LaterSavedField`, `StoredSession`, `parseSavedSessions`) in
  `src/plugins/chat/main/open-sessions.ts` — today
- `overrideSettings(settingsByPlugin, overrides)` in `src/shared/plugin-manifests.ts` — today

Produces:
- `defaultHarness: 'claude'` in `src/plugins/chat/manifest.ts`
- `export type StartRequest = StartTarget & { harness: string; profile: string };` in `src/plugins/chat/contract.ts`
- `harness: string;` in `RecentFolder` and in `ChatSessionInfo`, `harness?: string;` in `ResumeRequest` and in
  `ResumeSectionRow`, in `src/plugins/chat/contract.ts`
- `harness: string;` in `SavedSession` in `src/plugins/chat/main/open-sessions.ts`
- `export function requireHarness(harnesses: AgentHarnessRegistry, id: string): AgentHarness` in
  `src/plugins/chat/main/lookups.ts`
- `export function harnessOfProfile(harnesses: AgentHarnessRegistry, profile: string): AgentHarness | null` in
  `src/plugins/chat/main/lookups.ts`
- `harnessLabel: string;` in `SessionFactsInput` in `src/plugins/chat/layouts/layout.d.ts`
- `export const FAKE_HARNESS_ID = 'fake';` in `src/shared/fake-agent-harness.ts`
- `export function fakeRunPluginSettings(pluginSettings: Record<string, object>, environment: RunEnvironment):
  Record<string, object>` in `src/main/selftest-config.ts`
- `CHAT_HARNESS_ID` and `requireChatHarness` no longer exist (`grep -rn 'CHAT_HARNESS_ID\|requireChatHarness' src`
  prints nothing)

Decisions:
- A new session runs on chat's `defaultHarness` setting. A project that pins a profile runs on that profile's
  harness. A resumed, re-attached or restored session runs on the harness it was saved with. No harness step in the
  start prompt: the user wants a default-harness setting now and no harness step in the start prompt (plan.md
  § Decisions; design doc § Profiles and the default harness).
- The setting: key `defaultHarness`, default `'claude'`, `settingInfo` label `Default harness`, description
  `The id of the agent harness a new session runs on: claude for Claude Code. A project that names a profile runs on
  that profile's harness, and a resumed session on the harness it was saved with.` (drafter: wording in the style of
  the other `settingInfo` descriptions).
- A profile's harness is the first harness in `services.agentHarnesses.list()` order whose `info().profiles` holds a
  profile of that name (`harnessOfProfile`). Profile names are unique across harnesses, so the first registered keeps
  a clashing name, as the registry logs (plan.md § Decisions).
- `requireHarness` throws `Error('no agent harness "<id>"')`, the text `requireChatHarness` throws today, now naming
  the id it was asked for.
- `SavedSession.harness` and `RecentFolder.harness` are stored beside the profile name. No migration (one user). A
  saved record or recent folder written without `harness` reads as `'claude'`: the Claude adapter is the only
  harness that wrote them (`open-sessions.ts` already reads every later field this way).
- `ResumeRequest.harness` and `ResumeSectionRow.harness` are optional. Absent, the resume runs on the profile's
  harness (`harnessOfProfile`). `LaunchRequest` gains no field: a launch runs on its profile's harness. Decision:
  session-stash, session-log and practice build these rows and requests from the profile alone, and profile names are
  unique across harnesses, so the profile names the harness.
- `ChatSessionInfo.harness` (the `chat.session` slot) carries the row's harness id, so the page reads it for the
  Session facts. It is a required field, added to a slot other plugins read (auto-retro, system-stats, workflow);
  they read no `harness` today and change only in test literals. It is set once, at `openRow`: `SessionSlots.setInfo`'s
  update type in `src/plugins/chat/main/chat-slots.ts` (line 36 at plan time) becomes
  `Partial<Omit<ChatSessionInfo, 'sessionId' | 'projectDir' | 'profile' | 'harness'>>`, so no update changes it.
  `info()` (line 106) returns the slot value as it is and needs no edit. The `deps.slots.open` states in
  `chat-sessions.ts` (line 1587) and `preview/chat-preview.ts` (line 71) gain `harness`: the row's
  harness, and `FAKE_HARNESS_ID` in the preview.
- The start prompt opens nothing when `defaultHarness` names no harness in `core.agentHarnesses`: it logs and toasts
  (tone `error`) `No agent harness "<id>" is registered. Set chat's defaultHarness to a registered harness.` (drafter:
  the toast-and-open-nothing shape the prompt's no-profiles case already has).
- The start prompt's profile step lists the profiles of the target's harness. The target's harness is the folder's
  recorded `RecentFolder.harness` for a picked recent folder when `core.agentHarnesses` holds that id, else
  `defaultHarness`. A chosen folder, a folder project and a pool project use `defaultHarness`. A project that pins a
  profile skips the step and uses that profile's harness. One profile in the list skips the step, as today.
- A restored record whose `harness` is not registered opens resting with the error notice
  `No agent harness "<id>" is registered; turn its plugin on to resume this session.`, attaches nothing, and when
  the host lists its process running sets `unheldProcessId` to it, as the restore does for a process it cannot attach
  now (drafter: task 15 replaces this notice with the waiting state).
- `defaultProfile(sessionId)`: the profile of a session chat owns, else the first profile of `defaultHarness`, else
  null. The drive `chat.start` default profile follows the same rule; its harness is the profile's harness.
- `start_session`: the launch runs on its profile's harness. The default profile is the project's own, else the
  asking session's when the app started it, else the default harness's first. So an app-started session's
  `start_session` runs on the asking session's harness. In `START_SESSION_TOOL.description` the sentence
  `It always runs on Claude, whichever agent calls this tool.` becomes `It runs on the agent harness of the profile it
  starts under: this session's harness when the app started this session, else the app's default harness.` In the
  description, and in the `profile` property's description, `else to the app's first profile` becomes `else to the
  first profile of the app's default harness`. The `Profiles:` list in an unknown-profile error lists every
  registered harness's profile names in registration order. A relay session the app did not start runs
  `start_session` on `defaultHarness`, not on its own `info.harness`, since that harness may have no adapter (a Codex
  terminal session today).
- Send now follows the row's harness (the user, refresh round): `writeRowNow`'s `isNow` in `chat-sessions.ts` gains
  one more condition, `deps.harnesses.get(<row's harness>)?.info().capabilities.midTurnSend === true`. A harness that
  declares false, or is not registered, gets a plain write, and the message waits for the turn's end, as during a
  compaction. `sendAllNow` writes through `writeRowNow`, so it follows too. The comment over `writeRowNow` names the
  flag beside its other plain-write cases.
- Task 09's chat self-test literal `harness: 'claude'` in `openSessions` (`src/plugins/chat/main/selftest-script.ts`,
  the relay's `sessions.connect` args) becomes `harness: FAKE_HARNESS_ID`. The session's harness is `fake` in the
  self-test now, and the relay's hello names the harness of its row, so `registry.get` finds the fake.
- Layout input: `SessionFactsInput` keeps `harness` (the id) and gains `harnessLabel` (plan.md § Decisions, "Chat
  layout inputs gain `harnessLabel` beside `harness`"). The value is `harnessLabel(infos, id)`, so an unregistered id
  shows as its raw id (plan.md § Decisions). The default layout's tag shows `harnessLabel`.
- The fake harness: id `fake` (`FAKE_HARNESS_ID`), label `Fake` (plan.md § Decisions; design doc § The claude-code
  plugin). `DriveHarnessName` (`'fake' | 'claude'`, the `WIGLEY_DRIVE_HARNESS` values in `src/main/run-mode.ts`)
  stays.
- Fake runs set `chat.defaultHarness` to `fake` in the composition root, not in the chat self-test script. A script's
  `settings` reach only the config main serves the page; main parts read `store.current().pluginSettings`
  (`src/contracts/plugin.ts`, `SelfTestScript.settings`: "main parts have already started on their defaults"). So
  `main.ts` lays `{ chat: { defaultHarness: FAKE_HARNESS_ID } }` over the plugin settings in the self-test and in a
  drive run whose `environment.harness` is `'fake'`, at three reads (lines at plan time): the `pluginSettings`
  reader handed to `createMainApi` (line 981), the `onPluginSettingsChanged` listener's argument (line 983), and
  `served()` (line 1252; its `applySelfTestConfig` call, line 1254, sits inside `withAppliedList`).
- One helper does it, so the three reads cannot drift: `fakeRunPluginSettings(pluginSettings, environment)` in
  `src/main/selftest-config.ts`, beside `applySelfTestConfig`, which already imports `overrideSettings`. It returns
  `overrideSettings(pluginSettings, { chat: { defaultHarness: FAKE_HARNESS_ID } })` when `environment.mode` is
  `'selfTest'`, or is `'drive'` with `environment.harness` `'fake'`, and `Object.hasOwn(pluginSettings, 'chat')`;
  else it returns `pluginSettings` itself. The `chat` check is needed because `overrideSettings` throws
  `Settings override names no plugin "chat"` on an absent plugin. `main.ts` passes `runEnvironment` (line 220): `pluginSettings: () => fakeRunPluginSettings(store.current().pluginSettings, runEnvironment)`, the
  listener gets `fakeRunPluginSettings(config.pluginSettings, runEnvironment)`, and `served()` hands
  `applySelfTestConfig` `{ ...store.current(), pluginSettings: fakeRunPluginSettings(store.current().pluginSettings,
  runEnvironment) }`. Its comment: "`pluginSettings` as a fake run reads them: chat's `defaultHarness` is the fake's
  id in the self-test and in a drive run on the fake, so main parts and the page both start sessions on the fake.
  Every other run, and settings that hold no `chat`, come back unchanged."
- The docs self-test fixture follows the rename. After it, docs draws a chip and judges `Not installed` only for a
  registered id, matched by equality (task 07), and a fake run registers `fake`, not `claude`. So
  `src/plugins/docs/main/selftest-fixture.ts` writes its load states and its plugin entry under `FAKE_HARNESS_ID`:
  the `state(primary, codex?)` helper (line 248 at plan time) returns `{ [FAKE_HARNESS_ID]: primary }`, plus
  `codex` when given, typed `Partial<Record<string, LoadStateRecord>>`; the plugin entry's `meta.harness` (line 432)
  is `FAKE_HARNESS_ID`. The fixture's `codex` records stay: no `codex` harness registers, so they draw no chip.
  Without this change the docs self-test's `i` step on the plugin (`'[docs] editing installed_plugins.json'`) breaks:
  `pluginConfigFile(key, 'claude')` finds no install, since the fake's installs are listed under `fake`.
- `src/plugins/docs/main/selftest-script.ts` names no chip text and no `Claude` label (measured at plan time); it
  needs no edit. Its `harness: 'claude'` in `openDocsFixtureSession` (line 1279) stays: it is the session's harness
  as `docs_index.py` reads it (`sessionRun` in `index-sources.ts`), and that session opens no relay, so no
  `registry.get` reads it.
- The fixture holds no `meta.installed` copy (measured at plan time), so `readPluginStatus` finds no clone in it and
  the `Not installed` check does not run on the fixture, before or after this task. `plugin-status.test.ts` (task
  07's `harnesses` cases) keeps proving that check. A drive run on the real Claude adapter registers `claude`, so
  the fixture's chips and its plugin entry's `i` step there read no fixture state; that run checks chat on real
  Claude, not the docs fixture.

Mandatory:
- `AGENTS.md` § Intent and the Architecture paragraphs plan.md § Mandatory Reads names; `AGENTS.md`'s chat plugin
  entry.
- `docs/features/agent-harnesses/design.md` (whole); `docs/features/agent-chat/design.md`; `DESIGN.md`;
  `docs/features/layouts/design.md`.
- `wigley:writing-code`, `wigley:codebase-design`, `wigley:writing-tests` and its `typescript-vitest.md`.

GIVEN `defaultHarness` is `claude` and Claude is registered WHEN the start prompt opens on a folder THEN the profile
step lists Claude's profiles only.
GIVEN `defaultHarness` names a harness `core.agentHarnesses` does not hold WHEN the start prompt opens THEN it toasts
`No agent harness "<id>" is registered. Set chat's defaultHarness to a registered harness.` and opens no step.
GIVEN a project pins a profile of a harness other than `defaultHarness` WHEN the user starts it THEN the
`start` request carries that profile's harness and the session runs on it.
GIVEN a recent folder recorded under harness `fake` and profile `work` WHEN the user picks it THEN the profile step
lists `fake`'s profiles with `work` selected.
GIVEN a `start` request whose `harness` is not registered WHEN chat main starts it THEN it throws
`no agent harness "<id>"` and opens nothing.
GIVEN a `start` request whose profile its harness does not declare WHEN chat main starts it THEN it throws and opens
nothing.
GIVEN a held row on harness `fake` WHEN chat saves THEN the `open-sessions.json` record holds `harness: 'fake'`, and
the restore starts and attaches through `fake`.
GIVEN an `open-sessions.json` record or a `recent-folders.json` entry with no `harness` WHEN chat reads it THEN its
harness is `claude`.
GIVEN a resume request with no `harness` WHEN chat main resumes it THEN it runs on the profile's harness.
GIVEN a process start in a folder row WHEN chat records the recent folder THEN the entry holds the row's harness.
GIVEN a session on harness `fake` labelled `Fake` WHEN its Session facts draw THEN the default layout's tag reads
`Fake`, and `SessionFactsInput.harness` is `fake`.
GIVEN the self-test or a fake drive run WHEN chat main and chat page read `defaultHarness` THEN both read `fake`.
GIVEN plugin settings that hold no `chat` WHEN `fakeRunPluginSettings` runs for the self-test THEN it returns them
unchanged and throws nothing.
GIVEN the docs self-test fixture WHEN the index fixture is read back THEN its load states and plugin entry are keyed
by `fake`, so its chips read `Fake <state>` under the fake's label.

Tests:
- `src/plugins/chat/main/lookups.test.ts` › `requireHarness_Registered_ReturnsIt` and
  `requireHarness_Unregistered_ThrowsNamingTheId` — over a stub registry holding a harness `claude`:
  `requireHarness(registry, 'codex')` throws `no agent harness "codex"`.
- `src/plugins/chat/main/lookups.test.ts` › `harnessOfProfile_ProfileOfTheSecondHarness_ReturnsTheSecond` (harness
  `claude` declares `work`, harness `fake` declares `spare`: `'spare'` returns `fake`) and
  `harnessOfProfile_NoHarnessDeclaresIt_Null`.
- `src/plugins/chat/main/chat-sessions.test.ts` › rename `start_noClaudeHarness_throwsAndOpensNothing` to
  `start_HarnessNotRegistered_ThrowsNamingItAndOpensNothing`: `start({ projectDir, harness: 'claude', profile:
  'work' })` with an empty registry throws `no agent harness "claude"`; `opened` is `[]`.
- `src/plugins/chat/main/chat-sessions.test.ts` › `start_ProfileTheHarnessLacks_ThrowsAndOpensNothing` — the fake
  declares `work`; `start({ projectDir, harness: 'fake', profile: 'other' })` throws; `opened` is `[]`.
- `src/plugins/chat/main/chat-sessions.test.ts` › `start_opensTheSessionAndStartsTheHarness` (existing): the
  `sessions.open` info's `harness` is `'fake'` and `chat.session` holds `harness: 'fake'`.
- `src/plugins/chat/main/chat-sessions.test.ts` › `resume_NoHarnessInTheRequest_RunsOnTheProfilesHarness` — two
  harnesses (`claude` declaring `work`, `fake` declaring `spare`); `resume({ projectDir, profile: 'spare',
  hostSessionId, title })` starts its process on `fake` only.
- `src/plugins/chat/main/chat-sessions.test.ts` › `sendNow_HarnessWithoutMidTurnSend_WritesPlainly` — a registry
  double whose `fake` wraps the fake harness, its `info()` returning the fake's info with `capabilities.midTurnSend`
  false; a turn running and one message queued: `sendNow` records a fake `send` call with no `now`, and the queued
  row's `sentEntryId` is set. Over the plain fake the same steps record `now: true`; when an existing send-now test
  already holds that case, the false case is a row added to it.
- `src/plugins/chat/main/chat-sessions.test.ts` › `restore_HarnessNotRegistered_RestsWithTheNotice` — a record with
  `harness: 'gone'`: the row opens resting, its last entry is the error notice
  `No agent harness "gone" is registered; turn its plugin on to resume this session.`, and no harness `attach` runs.
- `src/plugins/chat/main/chat-sessions.test.ts` › every existing expectation of `harness: 'claude'` on a row that runs
  on `createFakeAgentHarness` becomes `FAKE_HARNESS_ID` (measured at plan time, re-verify: lines 578, 668, 861, 1092),
  and `setUp` passes `defaultHarness: () => FAKE_HARNESS_ID`.
- `src/plugins/chat/main/open-sessions.test.ts` › `load_FileShape_ReadsOrRejects`: add a row `a record with no
  harness` whose record loads with `harness: 'claude'`; the `TWO_SESSIONS` fixture records gain `harness` (one
  `'claude'`, one `'fake'`), so the valid-file row round-trips both.
- `src/plugins/chat/main/recent-folders.test.ts` › `record_newestFirstDeduplicated` (existing): `record` takes the
  harness and each entry holds it; add `list_EntryWithNoHarness_ReadsAsClaude`.
- `src/plugins/chat/main/folder-choices.test.ts` › `list_TwoHarnesses_ListsEachProfilesFoldersWithItsHarness` — each
  merged folder holds the harness its listing came from.
- `src/plugins/chat/main/accounts.test.ts` › the existing status, sign-in and sign-out cases run against the
  profile's harness; add `status_ProfileOfNoHarness_Rejects`.
- `src/plugins/chat/main/start-session-tool.test.ts` › the description test (or a new
  `startSessionTool_Description_NamesNoHarness`): the description does not contain `Claude` and contains
  `It runs on the agent harness of the profile it starts under`.
- `src/plugins/chat/main/start.test.ts` › the drive `chat.start` test: with no `profile` arg the request carries the
  first profile of `defaultHarness` and that profile's harness.
- `src/plugins/chat/page/start-prompt.test.ts` › `recentFolder_manyProfiles_opensProfileStepOnItsProfile`
  (existing) reads profiles from a harnesses map; add `open_DefaultHarnessNotRegistered_ToastsAndOpensNothing` (toast
  text as in Decisions, tone `error`, `opened` is `[]`),
  `recentFolder_OtherHarness_ListsThatHarnessesProfiles`, and
  `projectStep_ProjectPinsAnotherHarnessesProfile_StartsOnThatHarness` (the `start` request's `harness` is the pinned
  profile's); `profilePicked_startsThereAndRevealsTheRow` asserts the request's `harness` is `defaultHarness`.
- `src/plugins/chat/page/session-part.test.ts` › the `sessionFactsOf` table: rows assert `harness: 'fake'` and
  `harnessLabel: 'Fake'` for a registered `fake`, and `harnessLabel: 'gone'` for an unregistered `gone`.
- `src/plugins/chat/layouts/default/layout.test.ts` › the `sessionFacts` table: inputs gain `harnessLabel: 'Claude
  Code'`; the tag reads `tag:neutral:Claude Code`; add a row to the unchanged-update test where only `harnessLabel`
  changes, and the header redraws.
- `src/shared/fake-agent-harness.test.ts` › the fake's `id` is `'fake'` and `info().label` is `'Fake'`.
- `src/main/selftest-config.test.ts` › `fakeRunPluginSettings_ByRun_SetsDefaultHarnessOnlyOnFakeRuns` — one
  `it.each` table over plugin settings `{ chat: { defaultHarness: 'claude', other: 1 }, docs: { scriptPath: '' } }`:
  | environment | expected |
  |---|---|
  | `{ mode: 'selfTest' }` | `chat.defaultHarness` is `'fake'`, `chat.other` is `1`, `docs` unchanged |
  | drive, `harness: 'fake'` | `chat.defaultHarness` is `'fake'` |
  | drive, `harness: 'claude'` | the same object, unchanged (`toBe`) |
  | `{ mode: 'live' }` | the same object, unchanged (`toBe`) |
  | `{ mode: 'selfTest' }` over settings `{ docs: { scriptPath: '' } }` (no `chat`) | the same object, no throw |
  A drive row's environment is `{ mode: 'drive', runDir: '/r', harness, systemStats: 'fake' }`.
- `src/plugins/docs/main/selftest-fixture.test.ts` › the existing `GIVEN loadStates on WHEN the index fixture is read
  back THEN it holds each load-state doc and the home context its Claude state` becomes `… the home context its
  fake-harness state`, and its line-107 expectation `{ claude: doc.claude }` reads `{ [FAKE_HARNESS_ID]: doc.claude }`.
  New `writeDocsFixture_IndexFixture_KeysStatesAndPluginEntryByTheFakeId` — after `writeDocsFixture(files, HOME,
  posixPaths, { loadStates: false })`, every state record of every context in the index fixture has the key
  `FAKE_HARNESS_ID` and no key `claude`, and the plugin entry titled `selftest-plugin@selftest-market` has
  `meta.harness` `FAKE_HARNESS_ID`. Task 07's `chips_*` tests prove that a state keyed by a registered id draws its
  chip as `<label> <state>`, so the fixture's chips read `Fake …`; the docs self-test's `i` step on the plugin proves
  the plugin entry matches the fake's installs.
- `src/plugins/chat/main/selftest-script.ts` › `fixtureProblems` gains a check: the self-test project's row in
  `chat.sessions()` has `harness` `fake`; its problem line reads `the self-test session runs on <harness>, not fake`.
  The rest of the chat self-test proves the default harness end to end, since every session it opens starts through
  `defaultHarness`.

Approach:
- `chat-sessions.ts`: `ChatSessionsDeps.harnesses` is the registry (task 01) and gains `defaultHarness(): string`. A
  row's harness lives in `chat.session` (`ChatSessionInfo.harness`), set at `openRow`; `sessions.open` takes it. The
  closure `requireHarness()` goes; each call site asks `requireHarness(deps.harnesses, <row's harness>)`. A row's
  profile is looked up in its harness's `info().profiles` (drafter).
- `startNew` reads `request.harness`; `launch` resolves the harness with `harnessOfProfile` and throws the
  missing-profile error task 05 left when it returns null. `resume` uses `request.harness` when given, else
  `harnessOfProfile`.
- `RecentFolders.record(projectDir, harness, profile)` (drafter: harness before profile, the order `RecentFolder`
  stores them). `parseRecentFolders` maps each entry's absent `harness` to `'claude'`.
- `folder-choices.ts`: `ListedProject` gains `harness: string`; `everyProfileProjects` lists each registered
  harness's profiles through that harness's `listProjects`.
- `accounts.ts`: `deps.harness()` becomes a lookup by profile name that throws when no harness declares it.
- Page: `start.ts` reads `api.state.read(coreAgentHarnessesSlot)`. The start prompt's deps replace the profile list
  with `harnesses(): ReadonlyMap<string, AgentHarnessInfo>` (`reader.all()`) and
  `defaultHarness(): string` (`api.settings().defaultHarness`). The Session facts source reads the label through
  `harnessLabel` and also fires `onChanged` on a `core.agentHarnesses` change, so a label that registers late redraws
  the tag.
- `usage/main/start.ts`: only when it still names `CHAT_HARNESS_ID` (task 05 may have moved it): the poller's
  `planUsage(profileDir)` asks, at each call, the registered harness whose `info().profiles` holds a profile with that
  `configDir`, and rejects `no agent harness holds profile folder <profileDir>` when none does.

Done when: `npm run lint` and `npm run typecheck` pass; the test gate runs the tests above and the chat self-test
(`npm run selftest -- --plugin chat`).

Commit: one commit. It removes the "Chat picks a harness" item from `docs/features/followups.md` § Harness seams and
ticks `[ ] Chat picks a harness` in `docs/features/intent-alignment/master-plan.md` § Lane H.

## Proof

Commit eeb2e337e · proof: diff read: chat defaultHarness setting, FAKE_HARNESS_ID = 'fake', composition-root override in selftest-config, CHAT_HARNESS_ID gone, lookups harness resolution present; wave compile passes after one same-rung fix (harness on RecentFolder test literals) and oxfmt · concerns: restore with an unregistered harness now rests with a notice; two start.test restore tests now throw through an artificial infoFails stub; chat-sessions.test setUp patches the fake's info() in place; docs self-test i step still opens its session as 'claude' (docs only tells codex apart)
