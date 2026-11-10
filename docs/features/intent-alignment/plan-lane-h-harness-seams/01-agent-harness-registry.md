# 01 — AgentHarnessRegistry

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/main/agent-harness-registry.ts` · test `src/main/agent-harness-registry.test.ts`
- create `src/shared/agent-harness-label.ts` · test `src/shared/agent-harness-label.test.ts`
- create `src/shared/agent-harness-registry.test-support.ts` (`harnessRegistryOf` and `harnessInfo`)
- modify `src/contracts/agent.ts` · `src/contracts/core-state.ts` · `src/contracts/plugin.ts`
- modify `src/main/main.ts` · `src/main/plugins/main-api.ts` · test `src/main/plugins/main-api.test.ts`
- modify `src/shared/plugin-service-views.ts` · `src/shared/plugin-part-harness.test-support.ts`
- modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts`
- modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts`
- modify chat: `src/plugins/chat/main/start.ts` · `src/plugins/chat/main/lookups.ts` ·
  `src/plugins/chat/main/chat-sessions.ts` · `src/plugins/chat/main/selftest-script.ts` · test
  `src/plugins/chat/main/start.test.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
- modify usage: `src/plugins/usage/main/start.ts` · `src/plugins/usage/main/drive-actions.ts` · test
  `src/plugins/usage/main/start.test.ts` · test `src/plugins/usage/main/drive-actions.test.ts`
- modify notes: `src/plugins/notes/contract.ts` · `src/plugins/notes/draft.ts` · `src/plugins/notes/session-ref.ts` ·
  `src/plugins/notes/main/start.ts` · `src/plugins/notes/main/note-sender.ts` · `src/plugins/notes/main/selftest-script.ts` ·
  `src/plugins/notes/page/start.ts` · `src/plugins/notes/page/popup.ts` · test `src/plugins/notes/draft.test.ts` · test
  `src/plugins/notes/session-ref.test.ts` · test `src/plugins/notes/main/note-sender.test.ts` · test
  `src/plugins/notes/page/popup.test.ts` · test `src/plugins/notes/main/selftest-script.test.ts`
- modify sessions: `src/plugins/sessions/contract.ts` · `src/plugins/sessions/main/start.ts` ·
  `src/plugins/sessions/main/session-list.ts` · `src/plugins/sessions/main/relay/relay-server.ts` ·
  `src/plugins/sessions/page/tabs.ts` · `src/plugins/sessions/page/sidebar-view.ts` ·
  `src/plugins/sessions/page/sessions-view.ts` · `src/plugins/sessions/page/start.ts` ·
  `src/plugins/sessions/page/preview.ts` · test `src/plugins/sessions/page/preview.test.ts` ·
  `src/plugins/sessions/page/sessions-view-fakes.ts` · test `src/plugins/sessions/main/start.test.ts` · test
  `src/plugins/sessions/main/session-list.test.ts` · test `src/plugins/sessions/main/relay/relay-server.test.ts` · test
  `src/plugins/agent-form-drive.test.ts`
- modify `src/plugins/session-log/main/session-event-log.ts`
- modify forms and primer: `src/shared/agent-forms/drive-actions.ts` · `src/plugins/forms/main/start.ts` ·
  `src/plugins/forms/main/selftest-script.ts` · `src/plugins/primer/main/start.ts`
- modify workflow: `src/plugins/workflow/main/level-selftest-script.ts` · `src/plugins/workflow-large/main/selftest-script.ts`
  · `src/plugins/workflow-large/main/start.ts` · `src/plugins/workflow-small/main/start.ts` ·
  `src/plugins/workflow-medium/main/start.ts` · `src/plugins/workflow-spike/main/start.ts`
- modify docs: `src/plugins/docs/contract.ts` · `src/plugins/docs/page/docs-state.ts` · `src/plugins/docs/page/docs-view.ts` ·
  `src/plugins/docs/page/start.ts` · test `src/plugins/docs/page/docs-state.test.ts`
- modify `docs/features/followups.md` · `docs/features/intent-alignment/master-plan.md`

Consumes:  `SlotStore.publish(key: KeyedSlotKey<V>): KeyedSlotWriter<V>` in `src/shared/state/slot-store.ts` (today) ·
           `Registrations.track<T extends Disposable>(handle: T): T` in `src/contracts/disposable.ts` (today) ·
           `api.state.read(key)` on a page part (today; `settings` page reads `corePluginsSlot` this way)

Produces:
- `export interface AgentHarnessInfo {` in `src/contracts/agent.ts` (task 01 holds `label: string` only)
- `info(): AgentHarnessInfo;` in `src/contracts/agent.ts` (member of `AgentHarness`, whose `id` becomes `readonly id: string`)
- `export interface AgentHarnessRegistration extends Disposable { refresh(): void }` in `src/contracts/agent.ts`
- `export interface AgentHarnessRegistry {` in `src/contracts/agent.ts` (`register`, `list`, `get` as plan.md writes them)
- `export const coreAgentHarnessesSlot: KeyedSlotKey<AgentHarnessInfo, 'main', 'core'>` in `src/contracts/core-state.ts`
- `agentHarnesses: AgentHarnessRegistry;` in `src/contracts/plugin.ts`
- `export function createAgentHarnessRegistry(` in `src/main/agent-harness-registry.ts`
- `export function harnessLabel(` in `src/shared/agent-harness-label.ts`
- `export function registeredInfos(` in `src/shared/agent-harness-label.ts`
- `export function trackedAgentHarnesses(` in `src/shared/plugin-service-views.ts`
- `export function harnessRegistryOf(` in `src/shared/agent-harness-registry.test-support.ts`
- `export function harnessInfo(overrides?: Partial<AgentHarnessInfo>): AgentHarnessInfo` in
  `src/shared/agent-harness-registry.test-support.ts`

Decisions:
- Slot key type (tree, against plan.md's `SlotKey`): a keyed slot is a `KeyedSlotKey` in `src/contracts/state.ts`;
  `SlotKey` has `kind: 'value'`. Write
  `export const coreAgentHarnessesSlot: KeyedSlotKey<AgentHarnessInfo, 'main', 'core'> = { id: 'core.agentHarnesses', process: 'main', kind: 'keyed' };`
  with a comment: "Each registered harness's label and declarations, keyed by harness id. The agent harness registry
  writes it at each register, refresh and dispose."
- `AgentHarnessInfo` (plan.md): task 01 declares `label: string` alone. Tasks 04 and 05 add the other fields.
- Registry signature (plan.md): `createAgentHarnessRegistry(slot: KeyedSlotWriter<AgentHarnessInfo>): AgentHarnessRegistry`
  (drafter: the one dependency is the slot's writer).
- Registry rules (drafter):
  - `register(harness)` throws `Error('agent harness "<id>" is already registered')` when a live registration holds
    that id, and writes nothing. Otherwise it appends the harness and writes `slot.set(id, harness.info())`.
  - `list()` returns a new array in registration order. `get(id)` returns the harness or `null`.
  - `refresh()` writes `slot.set(id, harness.info())` again. After `dispose` it does nothing.
  - `dispose()` removes the harness from `list` and `get` and calls `slot.delete(id)`. A second `dispose` does
    nothing.
  - Order: `register` adds the harness to `list()` and `get()` before it sets the slot key. `dispose` removes it from
    `list()` and `get()` before it deletes the slot key. A slot listener that reads the registry then sees the same
    state the slot reports (task 15's `harnessReturned` relies on it). After a dispose the id may register again, and that harness goes last in `list`.
  - Task 05 adds the profile clash log; task 01 takes no `log`.
- Per-plugin view (AGENTS.md "A registration"): `trackedAgentHarnesses(registry: AgentHarnessRegistry, registrations:
  Registrations): AgentHarnessRegistry` in `src/shared/plugin-service-views.ts`. Its `register` returns
  `registrations.track(registry.register(harness))`; `list` and `get` pass through. `createMainApi` sets
  `agentHarnesses: trackedAgentHarnesses(deps.services.agentHarnesses, registrations)` beside `alerts`. The part
  harness in `src/shared/plugin-part-harness.test-support.ts` wraps its registry the same way, as it wraps
  `trackedFiles`.
- Composition root (drafter): `ModeServices.forWindow` stops returning `agentHarnesses`. It returns
  `harnesses: readonly AgentHarness[]` beside `alerts`, `window`, `openExternal` and `systemStats`: `liveServices`
  returns `[claudeHarness(…)]`, `offscreenRunServices` returns `[harness(context)]`. In `main.ts` after the
  `forWindow` call: destructure `harnesses` out, build
  `const agentHarnesses = createAgentHarnessRegistry(slots.publish(coreAgentHarnessesSlot))`, call `register` for each
  harness, and pass `agentHarnesses` in the services given to `startMainParts`. The registrations live as long as
  the window, as `layouts.register('shell', …)` does; say so in a comment. Task 03 moves the Claude registration into
  the `claude-code` plugin.
- Labels (plan.md): the Claude adapter's `info()` returns `{ label: 'Claude Code' }`. The fake's returns
  `{ label: 'Fake' }`. The fake keeps `id: 'claude'` until task 10.
- `harnessLabel(infos: ReadonlyMap<string, AgentHarnessInfo>, id: string): string` (plan.md): the label when
  `infos.get(id)` holds an info, else `id` (drafter: a map, so an id such as `constructor` reads as itself, and it
  matches the keyed slot reader's `all()`, `src/contracts/state.ts`).
- `registeredInfos(registry: Pick<AgentHarnessRegistry, 'list'>): ReadonlyMap<string, AgentHarnessInfo>`
  (drafter): each listed harness's `info()` by id, in registration order. Main code builds `harnessLabel`'s map with it;
  page code passes `reader.all()` of `api.state.read(coreAgentHarnessesSlot)`.
- Who reads what (plan.md boundary rule): main code reads harnesses and labels through `services.agentHarnesses`;
  page code reads labels through `core.agentHarnesses`. A page reads the slot at each draw and subscribes to nothing
  (drafter): the composition root registers every harness before the main parts start, so the slot is full before a
  page part starts. Task 15 handles a harness that leaves and returns.
- Consumer deps (drafter): every deps field named `harnesses` typed `readonly AgentHarness[]` becomes
  `AgentHarnessRegistry`, and each reader calls `list()` or `get()` at use, not at start: `ChatDriveDeps.harnesses`
  (`chat/main/start.ts`), `ChatSessionsDeps.harnesses` (`chat/main/chat-sessions.ts:102`), the chat self-test deps
  (`chat/main/selftest-script.ts:76`), `UsageDriveDeps.harnesses`, `LevelSelfTestDeps.harnesses`, the workflow-large
  and notes self-test deps. `markRun(harnesses: readonly AgentHarness[])` keeps its signature; callers pass
  `harnesses.list()`. `harnesses.find(isFakeAgentHarness)` becomes `harnesses.list().find(isFakeAgentHarness)`.
- Lookups: `requireChatHarness(harnesses: AgentHarnessRegistry)` reads `harnesses.get(CHAT_HARNESS_ID)` and keeps its
  error `no agent harness "claude"`. Usage's lookup (`usage/main/start.ts:122`) becomes
  `services.agentHarnesses.get(CHAT_HARNESS_ID)`, its `undefined` checks become `null` checks, and its log line
  `no agent harness "claude": plan usage is not read` stays. Sessions' `hostSessionName` and `configFolder`
  (`sessions/main/start.ts:57`, `:69`) call `get(info.harness)` when `info.harness` is not null.
- Open harness ids (plan.md): `HARNESSES`, `Harness` and `DRIVE_SESSION_DEFAULTS.harnesses` leave
  `src/plugins/sessions/contract.ts`. `DRIVE_SESSION_DEFAULTS` keeps `projectDir: 'drive'` and `harness: 'claude'`,
  typed `{ projectDir: string; harness: string }`. Every `Harness` becomes `string`: `SessionInfo.harness`,
  `SessionRow.harness`, `NoteSession.harness`, `session-event-log.ts:70`, `forms/main/selftest-script.ts:1341`,
  `preview.ts` `sampleRow`, `session-list.test.ts:37`. `addAgentFormDriveActions` and its two interfaces drop the
  `Harness` type parameter and use `string`; forms' and primer's calls drop `<Harness>`.
  `AgentFormDriveSessionDefaults` loses `harnesses`.
- Relay hello (drafter, follows the open id): `harnessOf` goes; `sessionInfo` sets `harness: hello.harness ?? null`.
  The comments on `SessionInfo.harness` and `RelayHello.harness` read "Null when the relay did not say." and
  "Absent reads as null." A wrong-typed `harness` still fails the hello as `mistypedHelloField` does today.
- Notes draft parse (drafter): `isHarnessOrNull` becomes `isStringOrNull`, so a saved draft with any harness id parses.
- Drive args (plan.md): sessions' `sessionArgs` reads
  `'{ sessionId?: string, projectDir?: string | null, harness?: string, host?: object }'`. `sessionArgsText` in
  `drive-actions.ts` takes no list and writes `harness?: string`. Both read the arg with
  `optionalString(args, 'harness') ?? <defaults>.harness`, so a wrong type still throws naming `harness`.
- Sessions row text: `harnessText` leaves `src/plugins/sessions/page/tabs.ts` (drafter). `drawRow` in
  `sidebar-view.ts` sets `harness: session.harness === null ? '' : harnessLabel(harnesses(), session.harness)`.
  `mountSidebarView` gains a fifth parameter `harnesses: () => ReadonlyMap<string, AgentHarnessInfo>`;
  `SessionsViewDeps` gains `harnesses(): ReadonlyMap<string, AgentHarnessInfo>`; sessions' page start builds it
  from the slot.
- The no-folder group label in `groupOf` (`session-list.ts:137`) (the user, round 3): a
  session with no folder and a harness groups as `<label> session`. One with no harness groups as `session`. Claude
  rows then read `Claude Code session` where they read `session` today. Codex rows read `codex session` until a
  Codex adapter registers. Wiring:
  `SessionListDeps` gains `harnessLabel(harness: string): string`; sessions' main start passes
  `(harness) => harnessLabel(registeredInfos(api.services.agentHarnesses), harness)`. `CODEX_NO_FOLDER_LABEL` goes.
- Notes (plan.md): `HARNESS_LABELS` goes. `sessionLine` and `sessionChipText` take a new second parameter
  `harnesses: ReadonlyMap<string, AgentHarnessInfo>` and label with `harnessLabel`. `NoteSenderDeps` gains
  `harnesses(): ReadonlyMap<string, AgentHarnessInfo>` (notes main start:
  `() => registeredInfos(services.agentHarnesses)`); `NotePopupDeps` gains the same member (notes page start: from
  the slot).
- Docs (plan.md): `IndexHarness` becomes `string`. `HARNESS_NAMES` goes; `chips`, `detailFields`,
  `statusTexts`, `rollupText` and `treeRowStatus` in `docs-state.ts` take a new last parameter
  `harnesses: ReadonlyMap<string, AgentHarnessInfo>` and label with `harnessLabel`. `detailFields`'s Harness row
  shows `harnessLabel(harnesses, harness)` for any string `meta.harness`, and `—` (`NO_VALUE`) when it has none.
  `DocsViewDeps` gains `harnesses(): ReadonlyMap<string, AgentHarnessInfo>`; docs' page start builds it from the
  slot.
- Docs in the meantime (drafter, until task 07): `chips` keeps its `{ claude: Chip; codex: Chip }` record, `chipsOf`
  in `doc-view.ts` and `ChipInput.harness: 'claude' | 'codex'` in `layouts/layout.d.ts` keep their two keys, and
  `INDEX_HARNESSES` keeps `['claude', 'codex']`: it still gates `isInstalledCopy` and `plugin-status.ts`, because docs
  reads installed plugins in those two formats alone until task 07. Only the labels change: chips read
  `Claude Code <state>` and `codex <state>`. `docs-view.ts:495`, `doc-files.ts:312`/`:357` and `index-sources.ts:258`
  still compare ids; task 07 removes the format switches.
- Contract comment: the `MainServices` comment in `src/contracts/plugin.ts:1043` changes from "`agentHarnesses` lists
  every harness adapter the app runs, found by `id`" to "`agentHarnesses` is the harness registry: a harness plugin
  registers its adapter there, and stopping the plugin disposes its registrations".
- Test double (drafter): `harnessRegistryOf(harnesses: readonly AgentHarness[]): AgentHarnessRegistry` in
  `src/shared/agent-harness-registry.test-support.ts`, over a copy of `harnesses`: `register` appends and its handle
  removes; `refresh` does nothing; it writes no slot. Plugin tests cannot import `src/main`. The part harness's
  default `agentHarnesses` becomes `harnessRegistryOf([])`.
- Info builder (drafter): `harnessInfo(overrides?: Partial<AgentHarnessInfo>): AgentHarnessInfo` in the same file
  returns `{ label: 'Harness', ...overrides }`. Every test and test fixture that builds an `AgentHarnessInfo` calls
  it, never an object literal, so tasks 04 and 05 add fields by changing only the builder's defaults. Measured at
  plan time, the builder's users are: `src/main/agent-harness-registry.test.ts`,
  `src/shared/agent-harness-label.test.ts`, `src/plugins/sessions/main/session-list.test.ts`,
  `src/plugins/notes/session-ref.test.ts`, `src/plugins/docs/page/docs-state.test.ts`,
  `src/plugins/notes/main/note-sender.test.ts`, `src/plugins/notes/page/popup.test.ts` and
  `src/plugins/sessions/page/sessions-view-fakes.ts`. Before the commit, run
  `grep -rn "{ label: '" src --include='*.test.ts' --include='*.test-support.ts' --include='*-fakes.ts'`; each hit that
  is an `AgentHarnessInfo` goes through `harnessInfo`. The adapters' own `info()` tests assert `info().label` only.
- Fixtures the open ids reach (drafter):
  - `src/plugins/sessions/page/preview.test.ts` imports `HARNESSES`. Drop the import. Its set assertion becomes
    `new Set(['claude', 'codex', null])`.
  - `src/plugins/sessions/page/sessions-view-fakes.ts`: `mountSessionsView`'s deps gain
    `harnesses: () => new Map([['claude', harnessInfo({ label: 'Claude Code' })]])`.
  - `src/plugins/notes/main/selftest-script.test.ts`: the deps' `harnesses: []` becomes
    `harnesses: harnessRegistryOf([])`.
  - `note-sender.test.ts` and `popup.test.ts`: their deps gain
    `harnesses: () => new Map([['claude', harnessInfo({ label: 'Claude Code' })]])`.
- The follow-up text also names "the fake's `id: 'claude'`". That lands in task 10 (plan.md); this commit removes
  the follow-up all the same, since the plan carries the rest.

Mandatory: AGENTS.md § Intent, § Architecture "A plugin", "A registration", "A plugin talks", "A slot", "An agent
harness", and the `npm run lint` layer paragraph; `docs/features/agent-harnesses/design.md` § Registry;
`docs/features/plugin-framework/design.md` § Hot reload (Wave 4) and § Runtime loader (Wave 4 step 3).

GIVEN a harness registered WHEN `list`, `get` or the `core.agentHarnesses` slot is read THEN each holds it, the slot
under its id with its `info()`.
GIVEN a live registration of id `a` WHEN another harness registers with id `a` THEN `register` throws and nothing
changes.
GIVEN a registration WHEN it is disposed THEN `list`, `get` and the slot no longer hold the harness, and a second
dispose does nothing.
GIVEN a registration WHEN `refresh()` runs after the adapter's `info()` changes THEN the slot holds the new info.
GIVEN a plugin registered a harness through `api.services.agentHarnesses` WHEN the plugin stops THEN the registration
is disposed.
GIVEN any app run WHEN main starts THEN the composition root registers today's harness (Claude live, the fake or
Claude in a drive run, the fake in the self-test) before the main parts start.
GIVEN a relay hello naming harness `gemini` WHEN sessions reads it THEN the session's harness is `gemini`.
GIVEN a harness id no adapter registered WHEN a sessions row, a note line or chip, or a docs chip, status or detail
row names it THEN it shows the raw id.
GIVEN the Claude adapter is registered WHEN a sessions row, note or docs chip names `claude` THEN it shows
`Claude Code`.
GIVEN a saved notes draft whose session names any harness id WHEN it loads THEN it parses.

Tests:
- `src/main/agent-harness-registry.test.ts` (new; slot from `createSlotStore`, read with
  `store.read(coreAgentHarnessesSlot, 'test')`; each harness double's `info()` returns `harnessInfo({ label })`):
  - `register_Harness_ListedGotAndInSlot` — harness `a` with label `A`: `list()` is `[a]`, `get('a')` is `a`, the
    slot's `get('a')` equals `harnessInfo({ label: 'A' })`.
  - `register_TakenId_ThrowsAndChangesNothing` — throws `agent harness "a" is already registered`; `list()` stays
    `[first]`; the slot holds the first's info.
  - `list_TwoHarnesses_InRegistrationOrder` — `b` then `a`: `list()` ids `['b', 'a']`.
  - `get_UnknownId_Null`.
  - `slotListener_RegisterAndDispose_RegistryAlreadyUpdated` — a listener on the slot records `get('a')` and `list()`
    ids when it hears the set and when it hears the delete: at the set it sees `a` listed and got; at the delete it
    sees `list()` `[]` and `get('a')` `null`.
  - `dispose_Registration_LeavesListGetAndSlot` — after dispose: `list()` `[]`, `get('a')` `null`, slot `get('a')`
    `undefined`; a second dispose throws nothing and the slot heard one delete.
  - `register_AfterDispose_SameIdGoesLast` — `a`, `b`, dispose `a`, register `a` again: ids `['b', 'a']`.
  - `refresh_InfoChanged_SlotRewritten` — label `A` then `B`: slot equals `harnessInfo({ label: 'B' })`.
  - `refresh_AfterDispose_WritesNothing` — slot stays `undefined`.
- `src/shared/agent-harness-label.test.ts` (new) › `harnessLabel` table over
  a map holding `claude` → `harnessInfo({ label: 'Claude Code' })`: `claude` → `Claude Code`; `codex` → `codex`;
  `constructor` → `constructor`.
  › `registeredInfos_TwoHarnesses_InfoById` — a map `a` → `harnessInfo({ label: 'A' })`, then
  `b` → `harnessInfo({ label: 'B' })`.
- `src/main/plugins/main-api.test.ts` › `RETURNED_HANDLE_ROWS` — a row added to that test, member
  `services.agentHarnesses.register`: its dep returns `handle`, and `register` calls
  `api.services.agentHarnesses.register(harness)`.
- `src/shared/fake-agent-harness.test.ts` › `info_Label_Fake` — `info().label` is `'Fake'`.
- `src/main/claude-code/claude-code-harness.test.ts` › `createClaudeCodeHarness` › `info_Label_ClaudeCode` —
  `info().label` is `'Claude Code'`.
- `src/plugins/sessions/main/relay/relay-server.test.ts` — the `it.each` row with hello `harness: 'gemini'` now
  expects `harness: 'gemini'` (a row of the hello-parse table).
- `src/plugins/sessions/main/start.test.ts` › `connect rejects a field of the wrong type and an unknown harness`
  becomes `connect rejects a field of the wrong type and takes any harness id`: `{ sessionId: 7 }` rejects
  `/sessionId/`; `{ harness: 7 }` rejects `/harness/`; `{ harness: 'gpt' }` connects with `harness: 'gpt'`. Its
  `agentHarnesses` option passes through `harnessRegistryOf`.
- `src/plugins/sessions/main/session-list.test.ts` — setUp passes
  `harnessLabel: (id) => harnessLabel(new Map([['claude', harnessInfo({ label: 'Claude Code' })], ['codex', harnessInfo({ label: 'Codex' })]]), id)`;
  `labels a codex session with no project folder Codex session` becomes
  `labels a session with no project folder by its harness label`, expecting
  `['Codex session', 'Codex session 2', 'Claude Code session']`; the `no folder asks nothing` row keeps
  `['session', 'Codex session']`.
- `src/plugins/notes/draft.test.ts` › `parseDraft_UnknownHarness_Null` becomes `parseDraft_AnyHarnessId_Parses` —
  harness `gemini` parses and round-trips.
- `src/plugins/notes/session-ref.test.ts` — every call passes `new Map([['claude', harnessInfo({ label: 'Claude Code' })]])`;
  `sessionLine_Codex_CodexLabel` becomes `sessionLine_UnregisteredHarness_RawId`, expecting
  `Source session: codex a1b2c3d4-0000-4000-8000-000000000001`. The `Claude Code` rows keep their texts.
- `src/plugins/docs/page/docs-state.test.ts` — `chips`, `detailFields`, `statusTexts`, `rollupText` and
  `treeRowStatus` calls pass `new Map([['claude', harnessInfo({ label: 'Claude Code' })]])`. Each expected text that names `Claude` names
  `Claude Code`, and each that names `Codex` names `codex`: `detailFields_Plugin_InstallsJoined` expects
  `['Harness', 'Claude Code']`; `rollupText_BothHarnesses_ClaudeFirst` matches `/2.*Claude Code.*5.*codex/`.
- Fixtures that build services or deps take the new types, with no new test: `chat/main/start.test.ts`,
  `chat/main/chat-sessions.test.ts`, `usage/main/start.test.ts`, `usage/main/drive-actions.test.ts`,
  `notes/main/note-sender.test.ts`, `notes/page/popup.test.ts`, `notes/main/selftest-script.test.ts`,
  `sessions/page/sessions-view-fakes.ts`, `sessions/page/preview.test.ts`, `agent-form-drive.test.ts`.
- Self-test: no new step. Every chat self-test group starts its sessions through `registry.get`, so a broken
  registry fails the run; the label is row text no step reads.

Done when: compiles (`npm run lint` and `npm run typecheck`); the test gate runs the tests above.

Commit: one commit for the group. It also removes the "AgentHarnessRegistry" item from `docs/features/followups.md`
§ Harness seams and ticks `1. [ ] AgentHarnessRegistry [ready]` to `[x]` in
`docs/features/intent-alignment/master-plan.md`.

## Proof

