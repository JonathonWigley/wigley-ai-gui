# 05 — Harness settings with the harness

Status: in progress
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/agent-harness-registry.ts` · modify `src/main/main.ts` ·
           modify `src/plugins/claude-code/manifest.ts` · modify `src/plugins/claude-code/main/start.ts` ·
           modify `src/plugins/claude-code/main/claude-code-harness.ts` · create `src/shared/harness-profiles.ts` ·
           modify `src/shared/fake-agent-harness.ts` ·
           modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/manifest.ts` ·
           modify `src/plugins/chat/main/start.ts` · modify `src/plugins/chat/main/lookups.ts` ·
           modify `src/plugins/chat/main/accounts.ts` · modify `src/plugins/chat/main/folder-choices.ts` ·
           modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/page/start.ts` ·
           modify `src/plugins/chat/page/start-prompt.ts` · modify `src/plugins/chat/page/start-prompt-items.ts` ·
           modify `src/plugins/chat/page/picker-row.ts` · modify `src/plugins/chat/page/row-profile.ts` ·
           modify `src/plugins/usage/main/start.ts` · modify `src/plugins/usage/main/plan-poller.ts` ·
           modify `src/plugins/usage/main/usage-store.ts` · modify `src/plugins/workflow/main/start.ts` ·
           modify `src/plugins/auto-retro/main/start.ts` ·
           modify `.agents/skills/drive/SKILL.md` · modify `docs/features/settings/design.md` ·
           modify `docs/features/agent-chat/design.md` · modify `docs/features/usage/design.md` ·
           modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md` ·
           modify `src/shared/agent-harness-registry.test-support.ts` (`harnessInfo`'s defaults gain `profiles: []`) ·
           test `src/plugins/claude-code/main/claude-code-harness.test.ts` ·
           test `src/main/agent-harness-registry.test.ts` · create test `src/shared/harness-profiles.test.ts` ·
           test `src/shared/fake-agent-harness.test.ts` · test `src/plugins/claude-code/main/start.test.ts` ·
           test `src/plugins/chat/main/start.test.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` ·
           test `src/plugins/chat/main/accounts.test.ts` · test `src/plugins/chat/main/folder-choices.test.ts` ·
           test `src/plugins/chat/page/row-profile.test.ts` · test `src/plugins/chat/page/start-prompt.test.ts` ·
           test `src/plugins/chat/page/start-prompt-items.test.ts` · test `src/plugins/usage/main/start.test.ts` ·
           test `src/plugins/usage/main/plan-poller.test.ts` · test `src/plugins/usage/main/usage-store.test.ts` ·
           test `src/plugins/workflow/main/start.test.ts` · test `src/plugins/workflow/main/engine-fakes.test-support.ts` ·
           test `src/plugins/auto-retro/main/start.test.ts` · test `src/main/selftest-config.test.ts`
Consumes:  `AgentHarnessInfo` (`label`, `capabilities`, `clearAliases`, `projectConfigFolder`) ← 01, 04 ·
           `AgentHarnessRegistry` / `AgentHarnessRegistration.refresh()` and `services.agentHarnesses` ← 01 ·
           `coreAgentHarnessesSlot` (`core.agentHarnesses`, keyed by harness id) ← 01 ·
           `claudeCodeManifest` (id `claude-code`, setting `command`) and `src/plugins/claude-code/main/start.ts` ← 03 ·
           `CLAUDE_HARNESS_ID = 'claude'` ← 03 · `CHAT_HARNESS_ID = 'claude'` (today, `src/plugins/chat/contract.ts`) ·
           `isSameJson` (today, `src/shared/json.ts`) ·
           `harnessInfo(overrides?: Partial<AgentHarnessInfo>): AgentHarnessInfo` in
           `src/shared/agent-harness-registry.test-support.ts` ← 01, 04 ·
           `createAgentHarnessRegistry(slot: KeyedSlotWriter<AgentHarnessInfo>): AgentHarnessRegistry` ← 01 ·
           the `state` option of `startMainPart` (`MainPartHarnessOptions.state?: SlotStore`, today,
           `src/shared/plugin-part-harness.test-support.ts`)
Produces:  `export function createAgentHarnessRegistry(slot: KeyedSlotWriter<AgentHarnessInfo>, log: (message: string) => void): AgentHarnessRegistry` in `src/main/agent-harness-registry.ts`
Produces:  `profiles(): readonly HarnessProfile[];` on `ClaudeCodeHarnessDeps` in `src/plugins/claude-code/main/claude-code-harness.ts` (required)
Produces:  `export interface HarnessProfile { name: string; configDir: string }` in `src/contracts/agent.ts`
Produces:  `profiles: readonly HarnessProfile[];` on `AgentHarnessInfo` in `src/contracts/agent.ts`
Produces:  `export const DEFAULT_PROFILES: HarnessProfile[]` in `src/plugins/claude-code/manifest.ts`
Produces:  `export interface RegisteredProfile extends HarnessProfile { harnessId: string }` in `src/shared/harness-profiles.ts`
Produces:  `export function registeredProfiles(infos: ReadonlyMap<string, AgentHarnessInfo>): RegisteredProfile[]` in `src/shared/harness-profiles.ts`
Produces:  `export const FAKE_PROFILES: readonly HarnessProfile[]` in `src/shared/fake-agent-harness.ts`
Decisions:
- `HarnessProfile.configDir` is the folder as the setting writes it, `~/` unexpanded; the adapter resolves it, as
  chat's `ChatProfile.configDir` does today (plan.md File Structure; today's `AgentStart.profileDir` rule).
- The setting is `claude-code.profiles`. Its default is today's chat `DEFAULT_PROFILES`, in this order:
  `{ name: 'work', configDir: '~/.claude' }`, `{ name: 'personal', configDir: '~/.claude-personal' }` (plan.md
  Decisions; design doc § The claude-code plugin). Its `settingInfo`: label `Profiles`, description
  `The Claude Code profiles a new session can start in: a name and its config folder each. A name another harness already has is left out.`
  (drafter).
- Chat's `profiles` setting, `ChatProfile` and chat's `DEFAULT_PROFILES` go. Every chat file that typed
  `ChatProfile` types `HarnessProfile` (plan.md File Structure).
- One source for every reader: the `core.agentHarnesses` slot. The registry writes each harness's profiles there
  with clashes already left out, so main readers read the slot (`api.state.read(coreAgentHarnessesSlot)`), not
  `harness.info().profiles` (drafter: keeps the clash rule in one place).
- Clash rule (plan.md Decisions; design doc § Profiles): names are unique across harnesses. The first registered
  harness that is still registered keeps a name. On every `register`, `refresh` and registration `dispose`, the
  registry recomputes every entry in registration order from `harness.info()`, leaving out each profile whose name
  an earlier entry already holds. It `set`s only the entries whose computed value is not `isSameJson` with what the
  slot holds. For each profile left out of an entry it sets, it logs one line, pinned:
  `agent harness "<later id>": profile "<name>" left out, agent harness "<first id>" has that name`.
  A refresh that changes nothing sets nothing and logs nothing.
- Registry signature: `createAgentHarnessRegistry(slot, log)` gains the second parameter
  `log: (message: string) => void`, used only for the clash line. `main.ts`'s call becomes
  `createAgentHarnessRegistry(slots.publish(coreAgentHarnessesSlot), (message) => log('agent-harnesses', message))`,
  where `log` is `main.ts`'s `pageLog.log`, in scope at that call. The registry test passes
  `(message) => logged.push(message)`.
- Write order, kept with task 01's `slotListener_RegisterAndDispose_RegistryAlreadyUpdated`:
  - `register`: add the harness to `list()` and `get()`, then recompute and `set` the changed entries in
    registration order.
  - `refresh`: recompute and `set` the changed entries in registration order.
  - `dispose`: remove the harness from `list()` and `get()`, then `slot.delete(<its id>)`, then recompute and `set`
    each later harness's entry that changed, in registration order. A listener that hears the delete sees the
    harness gone from `list()` and `get()`. A listener that hears a later entry's set sees the same.
- Until task 10, chat runs every session on `CHAT_HARNESS_ID`. Chat's main `profiles()` and the start prompt's
  profile step read the profiles of the `core.agentHarnesses` entry `CHAT_HARNESS_ID`, `[]` when it is absent. The
  row profile part reads every registered profile (`registeredProfiles`), so a row of any harness shows its
  profile name.
- Chat's main export `profiles()` goes. Its readers move to the slot through `registeredProfiles`: usage
  (plan polls), workflow's `openRowsAlreadyOpen` (profile names) and auto-retro's `begin` (profile names).
  `defaultProfile` and `profileOf` stay and keep returning profile names; `defaultProfile`'s fallback is the first
  profile of chat's harness.
- Usage polls every registered profile, in slot order then profile order, each through its own harness:
  `services.agentHarnesses.get(profile.harnessId)`. A profile whose harness `get` misses rejects with
  `no agent harness "<id>"`, which the existing `poll <name> failed: <error>` log line carries. The plan with
  `isDefault: true` is the first profile of that flat list. The start-time log
  `no agent harness "claude": plan usage is not read` goes: the poller always exists, and `pollNow` rejects only
  with `usage.seed stopped the poller for this run` (drafter: no single harness to miss any more).
- Usage hears the slot (drafter: today chat's setting was always there at start, and a harness can now register
  after usage starts): on each `core.agentHarnesses` change, when `registeredProfiles(slot.all())` is not
  `isSameJson` with the list the last round read, usage runs `poller.pollNow()`. Usage keeps the last round's list
  from the poller's `roundStarted`.
- The fake declares `FAKE_PROFILES`: `{ name: 'work', configDir: '~/.claude' }`,
  `{ name: 'personal', configDir: '~/.claude-personal' }`, in its `info().profiles`. Self-test and fake drive runs
  leave `claude-code` out (task 03), so these replace the chat default they read before (drafter: same names and
  folders, so the self-tests' `profile: 'work'` and the start prompt's two-profile Profile step hold).
- The `claude-code` plugin's main part calls its registration's `refresh()` from `api.onSettingsChanged`. The
  adapter reads `profiles` through its new required dep `profiles(): readonly HarnessProfile[]`, read at each
  `info()` call, and `info()` returns `profiles: deps.profiles()`. The main part wires it to
  `() => api.settings().profiles` (design doc § Registry). Task 03 adds no `onSettingsChanged`, since `command` is
  read at each call; this task adds `api.onSettingsChanged(() => registration.refresh())`.
- `AgentStart.profileDir`'s comment becomes harness-neutral, pinned: `` `profileDir` is the config folder of the
  profile the session runs under, as that harness's profiles setting writes it (`HarnessProfile.configDir`), which
  the adapter resolves (`~` against the home the adapter was built with); null for the harness default. `` The words
  `Claude's CLAUDE_CONFIG_DIR` move to the comment on the Claude adapter's launch env line (task 03's
  `src/plugins/claude-code/main/claude-launch.ts`).
- The user's `~/.config/wigley-ai-gui/settings.json` holds no `chat.profiles` and no `claude-code` key (measured at
  plan time: its `chat` object holds only `projects`). The implementer re-checks it before the commit. When it holds
  `chat.profiles`, the implementer stops and reports it to the lead: moving a user setting is the user's call.
- Start order: chat's restore, auto-retro's `begin` and workflow's `openRowsAlreadyOpen` run after async file reads,
  so a built-in `claude-code` registers before they read the slot. Chat following a harness that registers later is
  task 15's (plan.md Decisions).
Mandatory: AGENTS.md § Intent, § Architecture paragraphs "A setting", "A slot", "An agent harness"; plan.md
           Mandatory Reads; `docs/features/agent-harnesses/design.md` § Registry, § Profiles and the default harness;
           `docs/features/usage/design.md` § Main; `wigley:writing-for-agents` for the `.agents/skills/drive/SKILL.md`
           edit.
GIVEN two harnesses registered in order `a` (profiles `work`) and `b` (profiles `work`, `home`) WHEN the registry
  writes the slot THEN entry `b` holds only `home` and the registry logs the pinned clash line once.
GIVEN `a` holds `work` and `b` lost it WHEN `a`'s registration is disposed THEN entry `b` holds `work` and `home`.
GIVEN the `claude-code` plugin runs WHEN the user changes `claude-code.profiles` THEN the `claude` slot entry holds
  the new list.
GIVEN the `claude` entry holds `work` and `personal` WHEN the start prompt reaches its profile step THEN it lists
  `work` then `personal`, as chat's setting listed them before.
GIVEN no session WHEN a plugin calls chat's `defaultProfile(null)` THEN it returns the first profile name of the
  `claude` entry, null when the entry is absent or holds none.
GIVEN a row whose profile folder belongs to a profile of any registered harness WHEN sessions draws the row THEN
  chat's row profile part draws that profile's name.
GIVEN two registered harnesses with one profile each WHEN usage runs a round THEN it polls each profile through its
  own harness's `planUsage`, and the first harness's profile is the default plan.
GIVEN usage started with an empty slot WHEN a harness registers with profiles THEN usage runs a round at once.
Tests:
- `src/shared/agent-harness-registry.test-support.ts`: `harnessInfo`'s defaults gain `profiles: []`. Every test that
  calls it passes unchanged. Every slot entry this task's tests seed is a `harnessInfo({ … })` call.
- `src/main/agent-harness-registry.test.ts`: every `createAgentHarnessRegistry(slot)` call passes
  `(message) => logged.push(message)` as its second argument; harness `a` declares
  `harnessInfo({ label: 'A', profiles: [{ name: 'work', configDir: '/a' }] })` and `b` declares
  `harnessInfo({ label: 'B', profiles: [{ name: 'work', configDir: '/b' }, { name: 'home', configDir: '/h' }] })`.
- `src/main/agent-harness-registry.test.ts › registry_ProfileNameClash_given $given` (table): row
  `a then b both declare work` → slot `b` profiles `[{ name: 'home', configDir: '/h' }]`, log
  `['agent harness "b": profile "work" left out, agent harness "a" has that name']`; row
  `a disposed` → slot `b` profiles `[{ name: 'work', configDir: '/b' }, { name: 'home', configDir: '/h' }]`, no new
  log line; row `b refreshed with no change` → no slot change heard, no new log line.
- `src/main/agent-harness-registry.test.ts › dispose_ClashHolder_DeletesThenRewritesTheNext` — `a` then `b` as
  above, a slot listener records each event: disposing `a` is heard as the delete of `a`, then the set of `b`, in
  that order; at the set of `b`, `list()` ids are `['b']` and `get('a')` is `null`.
- `src/shared/harness-profiles.test.ts › registeredProfiles_TwoHarnesses_SlotOrderThenProfileOrder` — a map `b`
  (`x`, `y`) then `a` (`z`) gives `[{harnessId:'b',name:'x',…}, {harnessId:'b',name:'y',…}, {harnessId:'a',name:'z',…}]`;
  an empty map gives `[]`.
- `src/plugins/claude-code/main/start.test.ts › settingsChanged_Profiles_RefreshesTheRegistration` — start the part
  with the default settings: the registered harness's `info().profiles` equals `DEFAULT_PROFILES`; change `profiles`
  to `[{ name: 'lab', configDir: '~/.lab' }]` and fire the settings listener: the recording registry double from
  task 03 counts one `refresh`, and `info().profiles` equals that list. The double writes no slot, so the test reads
  the adapter's `info()`; task 01's `refresh_InfoChanged_SlotRewritten` proves a refresh rewrites the slot.
- `src/plugins/claude-code/main/claude-code-harness.test.ts`: each of the five `createClaudeCodeHarness({ … })`
  deps fixtures (measured at plan time) gains `profiles: () => []`.
  `info_DeclaresCapabilitiesAliasesAndProjectFolder` builds its harness with
  `profiles: () => [{ name: 'work', configDir: '~/.claude' }]` and expects `info()` to also hold
  `profiles: [{ name: 'work', configDir: '~/.claude' }]`. New: `info_Profiles_ReadAtEachCall` — a `profiles` dep
  over a variable: `info().profiles` is `[]`, then after the variable is set to the `lab` list it is that list.
- `src/shared/fake-agent-harness.test.ts › info_Profiles_FakeProfiles` — `info().profiles` equals `FAKE_PROFILES`.
  Task 04's `declarations_AnswerEveryNewMember` `info()` expectation gains `profiles: FAKE_PROFILES`.
- `src/plugins/chat/main/start.test.ts › exports_DefaultProfile_given $given` — a row added to the existing table:
  `no chat harness registered` → `null`. `startChatPart`'s `options.profiles` now seeds the slot entry `claude`
  (through the test store `startChatPart` already builds) instead of `startSettings.profiles`; every existing row
  keeps its expected value.
- `src/plugins/chat/main/start.test.ts › exports_HaveNoProfiles` — `'profiles' in chat.exports` is `false`.
- `src/plugins/usage/main/start.test.ts › usageMainPart_TwoHarnesses_PollsEachProfileThroughItsHarness` — harness
  `claude` with profile `personal` (`~/.claude-personal`) and harness `lab` with profile `lab` (`/lab`): each
  harness's `planUsage` hears only its own folder; snapshot plans are `personal` (`isDefault: true`) then `lab`.
- `src/plugins/usage/main/start.test.ts › usageMainPart_HarnessRegistersAfterStart_PollsItsProfiles` — start with an
  empty slot, then set entry `claude` with `personal`: `planUsage` is called once with `~/.claude-personal`.
- `src/plugins/usage/main/start.test.ts › usageMainPart_NoHarness_NoPlansAndNoLog` (it replaces the no-harness test
  at line 296): logs `[]`, snapshot plans `[]`.
- The usage tests seed the slot through the `state` option of `startMainPart`: `const state =
  createSlotStore(() => undefined)`, passed as `state`, and
  `const harnesses = state.publish(coreAgentHarnessesSlot)`; `harnesses.set('claude', harnessInfo({ profiles }))`
  before the start, or after it in `usageMainPart_HarnessRegistersAfterStart_PollsItsProfiles`.
- `src/plugins/chat/page/row-profile.test.ts`, `start-prompt.test.ts`, `start-prompt-items.test.ts`,
  `chat-sessions.test.ts`, `accounts.test.ts`, `folder-choices.test.ts`, `usage-store.test.ts`,
  `plan-poller.test.ts`: type-only edits (`ChatProfile` → `HarnessProfile`, `RegisteredProfile` with a `harnessId`
  in the poller's fixtures); tests that imported `DEFAULT_PROFILES` from `'../manifest'` define a local `PROFILES`
  constant with the same two values.
- `src/plugins/chat/page/row-profile.test.ts › build_RowsOfTwoHarnesses_EachDrawsItsOwnProfileName` (new) —
  `setProfiles([{ harnessId: 'claude', name: 'work', configDir: '~/.claude' }, { harnessId: 'lab', name: 'lab',
  configDir: '~/.lab' }])`; folders `s1` → `${HOME}/.claude` and `s2` → `${HOME}/.lab`: `drawRow('s1')` text is
  `work` and `drawRow('s2')` text is `lab`.
- `src/plugins/workflow/main/start.test.ts`, `engine-fakes.test-support.ts`, `src/plugins/auto-retro/main/start.test.ts`:
  the `profiles` stub on the chat dependency goes. Seeding, by file:
  - `engine-fakes.test-support.ts` (`startEngineMainPart`) and `auto-retro/main/start.test.ts` call `startMainPart`.
    Each passes `state: createSlotStore(() => undefined)` and, before the start, calls
    `state.publish(coreAgentHarnessesSlot).set('claude', harnessInfo({ profiles: [<the profile>] }))`:
    `{ name: 'personal', configDir: '~/.c' }` in `engine-fakes.test-support.ts`, and
    `{ name: 'work', configDir: '~/.claude-work' }` in `auto-retro/main/start.test.ts`.
  - `workflow/main/start.test.ts` builds its own `store` (line 126) and its stub returned `[]`, so it seeds nothing:
    its `api.state.read` over `store` reads an empty `core.agentHarnesses`.
- `src/main/selftest-config.test.ts › mergeSelfTestConfigs_TwoScripts_ConcatenatesBindsInHandOverOrder` — the
  fixture setting `chat: { profiles: [] }` becomes `chat: { keepIdleMinutes: 5 }` in both places.
- Self-test: no new step. Chat's Profile step (`src/plugins/chat/main/selftest-script.ts`, `PROJECT_STEP_STEPS`,
  `'[chat] picker shown: Profile'`) and usage's poll proof (`src/plugins/usage/main/selftest-script.ts`,
  `unreadPlans`) now read the fake's `FAKE_PROFILES` through the slot, so they prove the move.
Approach:
- `registeredProfiles` flattens `infos` in map order, each info's `profiles` in order, adding the map key as
  `harnessId`. Page code passes `api.state.read(coreAgentHarnessesSlot).all()`.
- Chat page `start.ts`: `profiles: () => harnessSlot.get(CHAT_HARNESS_ID)?.profiles ?? []` for the start prompt;
  `profiles: () => registeredProfiles(harnessSlot.all())` for `createRowProfile`; replace
  `api.onSettingsChanged(() => rowProfile.profilesChanged())` with `harnessSlot.on(() => rowProfile.profilesChanged())`.
  `RowProfile.profilesChanged`'s comment says "after a harness's profiles changed".
- Chat main `start.ts`: `const profiles = () => harnessSlot.get(CHAT_HARNESS_ID)?.profiles ?? [];` feeds every dep
  that took `api.settings().profiles`. The drive action `chat.start`'s description says
  `under profile (default the first profile of chat's harness)` where it says `(default the first of chat's profiles)`.
- Comments that say "chat's profiles setting" (`chat/contract.ts` `CHAT_HARNESS_ID`, the chat events block at the
  `profileDir` / `sessionOpened` lines, `defaultProfile`; `chat-sessions.ts` `openRow`; `start.ts` `ChatDriveDeps`)
  say "the profiles of chat's harness" instead.
- Docs: `.agents/skills/drive/SKILL.md` step 2 says `chat.start` uses the first profile of the run's harness: the
  `claude-code.profiles` setting under `--harness claude`, the fake's `work` under the fake.
  `docs/features/settings/design.md` line 51's example `chat.profiles` becomes `claude-code.profiles`.
  `docs/features/agent-chat/design.md` line 110 says the `claude` path and the profiles are the `claude-code`
  plugin's settings (`claude-code.command`, `claude-code.profiles`). `docs/features/usage/design.md` § Main says one
  plan per registered harness profile, re-read at each round and when a harness's profiles change.
Done when: compiles (`npm run lint` and `npm run typecheck` per the repo's scripts); the test gate runs the tests above;
           `grep -rn 'ChatProfile\|chat\.profiles\|chat\.profiles()' src .agents docs/features --include='*.ts' --include='*.md'`
           finds only plan documents.
Commit:    one commit for the group; it also removes "Harness settings with the harness" from
           `docs/features/followups.md` § Harness seams and ticks its box in `docs/features/intent-alignment/master-plan.md`
           step 3 (`[ ] Harness settings with the harness`).

## Proof

