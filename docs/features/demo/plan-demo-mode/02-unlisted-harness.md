# 02 — Unlisted harness

Status: in progress
Type: Task
Rung: hard · adds the `unlisted` flag that 06 consumes, and changes eight readers of `core.agentHarnesses` in five plugins
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/contracts/agent.ts`
- modify `wigley-ai-gui/src/shared/fake-agent-harness.ts`
- test `wigley-ai-gui/src/shared/fake-agent-harness.test.ts`
- modify `wigley-ai-gui/src/shared/harness-profiles.ts`
- test `wigley-ai-gui/src/shared/harness-profiles.test.ts`
- modify `wigley-ai-gui/src/plugins/chat/page/start-prompt.ts`
- test `wigley-ai-gui/src/plugins/chat/page/start-prompt.test.ts`
- modify `wigley-ai-gui/src/plugins/chat/main/start.ts`
- test `wigley-ai-gui/src/plugins/chat/main/start.test.ts`
- modify `wigley-ai-gui/src/plugins/chat/main/folder-choices.ts`
- test `wigley-ai-gui/src/plugins/chat/main/folder-choices.test.ts`
- test `wigley-ai-gui/src/plugins/chat/main/lookups.test.ts`
- modify `wigley-ai-gui/src/plugins/usage/main/start.ts`
- test `wigley-ai-gui/src/plugins/usage/main/start.test.ts`
- modify `wigley-ai-gui/src/plugins/scheduling/main/start.ts`
- test `wigley-ai-gui/src/plugins/scheduling/main/start.test.ts`
- modify `wigley-ai-gui/src/plugins/docs/main/harness-folders.ts`
- test `wigley-ai-gui/src/plugins/docs/main/harness-folders.test.ts`
- modify `wigley-ai-gui/src/plugins/docs/page/start.ts`

Consumes: `AgentHarnessInfo` (`src/contracts/agent.ts:553`), `FakeHarnessIdentity` and `createFakeAgentHarness` (`src/shared/fake-agent-harness.ts:342`, `:1243`), `registeredProfiles` (`src/shared/harness-profiles.ts:10`), `registeredInfos` (`src/shared/agent-harness-label.ts:25`) — all in the tree now.

Produces:
- `AgentHarnessInfo.unlisted?: true` in `wigley-ai-gui/src/contracts/agent.ts`
- `FakeHarnessIdentity.unlisted?: true` in `wigley-ai-gui/src/shared/fake-agent-harness.ts`
- `export function listedHarnesses(infos: ReadonlyMap<string, AgentHarnessInfo>): ReadonlyMap<string, AgentHarnessInfo>` in `wigley-ai-gui/src/shared/harness-profiles.ts`

## Decisions

- **The flag.** `AgentHarnessInfo.unlisted?: true`. Present only on an unlisted harness; a listed
  harness leaves the key out (no `unlisted: false`). Add one line to the doc comment above
  `AgentHarnessInfo` (`agent.ts:548-552`): "`unlisted`: true for a harness the app runs sessions
  on but never offers or polls: no reader that offers a profile to the user or an agent, or polls
  a profile, lists it; chat still launches on its profiles."
- **The registry stays as it is.** `computeEntries` (`src/main/agent-harness-registry.ts:20-36`)
  spreads `info`, so the flag reaches the `core.agentHarnesses` slot with no registry change. The
  slot keeps the unlisted harness's profiles, because chat's launch and every per-row lookup read
  them through `ChatHarnesses.profilesOf` (`chat/main/lookups.ts:24-33`;
  `chat-sessions.ts:1833, 2678, 3038, 3442, 3678, 4036, 4099`; `accounts.ts:59`).
- **The fake.** `FakeHarnessIdentity` gains `unlisted?: true`. `info()`
  (`fake-agent-harness.ts:2143-2154`) spreads `{ unlisted: true }` into the info only when
  `identity.unlisted === true`, so the default fake's info is unchanged.
- **One filter, explicit at each call site.** `listedHarnesses(infos)` returns a new map, in the
  same key order, without each entry whose `unlisted === true`. `registeredProfiles` keeps its
  meaning ("every profile in `infos`") and stays unchanged. Each reader that offers or polls a
  profile calls `registeredProfiles(listedHarnesses(…))`; each reader that must see every
  harness keeps `registeredProfiles(…)`. Reason: workflow must still see demo rows (below), so a
  silent change inside `registeredProfiles` would break the one reader that needs the whole set.
- **Reader by reader** (each `coreAgentHarnessesSlot`, `agentHarnesses.list()` and
  `registeredProfiles` reader in `src/plugins`, measured at plan time):

  | Reader | Change | Why |
  |---|---|---|
  | chat page start prompt, `start-prompt.ts:216` `profiles: registeredProfiles(harnesses)` | yes: `registeredProfiles(listedHarnesses(harnesses))` | offers profiles to the user (profile step `:352`, fixed project profile `:394`, resume row `:312`) |
  | chat main `profileNames` (`chat/main/start.ts:353-354`), read by the `start_session` tool (`start-session-tool.ts:100`) | yes: listed only | offers profiles to an agent; an agent never starts a session on the demo harness |
  | chat main folder choices, `folder-choices.ts:91-103` `everyProfileProjects` | yes: skip each harness whose `info().unlisted === true` | lists each profile's project folders in the start prompt |
  | chat main `defaultHarnessProfile` (`start.ts:357-358`) | no | reads `defaultHarness` only, a setting the user picks |
  | chat main drive actions `harnesses.list().find(isFakeAgentHarness)` (`start.ts:156`) | no | drive only; under a drive run the default fake registers first, so `find` returns it, not the demo fake |
  | chat page `rowProfile` profiles (`chat/page/start.ts:354`) | no | names the profile under a row; demo rows are held by chat, so `heldProfile` answers first |
  | chat page clear aliases, chat view facts, start prompt labels (`start.ts:234, 291, 384`) | no | label and alias lookups for a row that exists; a demo row needs them |
  | chat main harness follower (`start.ts:389`) | no | detaches and re-attaches rows when a harness leaves; demo rows need it |
  | chat launch `requireHarnessOfProfile` (`lookups.ts:76-86`) | no | must resolve the demo profile (test row below) |
  | usage `profiles` (`usage/main/start.ts:100`), read by `withProfiles` and the plan poller | yes: listed only | polls `planUsage` per profile and lists plan rows in the status bar |
  | scheduling `profileNames` (`scheduling/main/start.ts:180-183`) | yes: `registeredProfiles(listedHarnesses(registeredInfos(…)))` | the task editor and the task tools offer these profiles |
  | scheduling `controlsHarness` (`scheduling/main/start.ts:171-177`) | yes: the first harness of `services.agentHarnesses.list()` whose `info().unlisted !== true`; the existing `no agent harness is registered` throw when none | it must never pick an unlisted harness, whatever the registration order |
  | docs main `createHarnessFolders` (`docs/main/harness-folders.ts:45-49`) | yes: `registeredProfiles(listedHarnesses(infos()))` | reads each profile's config roots and plugin installs for the docs index; an unlisted harness's folders are not the user's |
  | docs page `harnesses` (`docs/page/start.ts:223`), read by the status chips (`docs-state.ts:366, 945, 999`) | yes: `harnesses: () => listedHarnesses(harnesses.all())` | draws one chip and one "not installed" text per harness; leave `projectConfigFolders` (`:224-230`) on `harnesses.all()` |
  | docs main plugin status `[...harnessInfos.all().keys()]` (`docs/main/start.ts:413`) | no | `pluginHarnesses` keeps only harnesses that index entries name (`plugin-status.ts:234-247`); no entry names `demo` |
  | docs main `isFakeAgentHarness` fixture installs (`docs/main/start.ts:116`) | no | non-live runs only; it sets installs on the fake profiles' folders, which the demo fake never reads |
  | sessions page row harness label (`sessions/page/start.ts:565`) | no | names a row's harness; demo rows show their label |
  | notes page session chips (`notes/page/start.ts:93`) | no | label lookup |
  | chatroom page `harnessLabel` (`chatroom/page/start.ts:95`) | no | label lookup |
  | workflow main `openRowsAlreadyOpen` (`workflow/main/start.ts:337-340`) | no | no change to `registeredProfiles`; task 14 adds the demo-profile skip (demo sessions open no flow; the workflow steps draw sample flows on the page) |
  | auto-retro `begin` profiles (`auto-retro/main/start.ts:304-306`) | no | judges whether a queued retro's profile is gone; it offers and polls nothing, and task 10 keeps demo sessions out of the queue |

- **Start prompt copy stays.** A project pinned to an unlisted profile gets the existing toast
  `Profile <profile> of <project> is not a profile of any registered harness` (`start-prompt.ts:398`).

GIVEN a harness registered with `info().unlisted === true` and profile `demo`
WHEN the start prompt opens, usage polls, the scheduling editor reads its choices, the docs
index reads harness folders, or an agent calls `start_session` with profile `demo`
THEN none of them lists or polls `demo`, and `start_session` answers
`Unknown profile "demo". Profiles: <listed names>.`

GIVEN the same harness
WHEN `chat.launch({ profile: 'demo', … })` runs
THEN it starts the session on that harness

GIVEN an unlisted harness registered before a listed one
WHEN scheduling reads `controlsHarness`
THEN it returns the listed harness

## Tests

- `harness-profiles.test.ts`: new `describe('listedHarnesses')` with one `it.each` table:
  an unlisted entry between two listed ones → the two listed, in key order; every entry
  unlisted → empty map; no entry unlisted → the same entries in the same order.
- `fake-agent-harness.test.ts`: one test — an identity with `unlisted: true` gives
  `info().unlisted === true`; the default identity's info has no `unlisted` key
  (`'unlisted' in info` is false).
- `lookups.test.ts`: row beside `harnessOfProfile_ProfileOfTheSecondHarness_ReturnsTheSecond` —
  `requireHarnessOfProfile_UnlistedHarness_StillResolves`: a harness whose info is unlisted
  resolves its profile.
- `start-prompt.test.ts`: row beside `projectStep_ProjectPinsAnotherHarnessesProfile_StartsOnThatHarness`
  — the pinned profile's harness is unlisted: nothing starts and the toast above shows.
- `folder-choices.test.ts`: row beside `list_TwoHarnesses_ListsEachProfilesFoldersWithItsHarness`
  — the second harness unlisted: only the first harness's folders list. `harnessListing` (`:30`)
  gains an `unlisted?: true` parameter and builds
  `info: () => ({ ...fake.info(), profiles, ...(unlisted === true ? { unlisted } : {}) })`.
- `usage/main/start.test.ts`: `usageMainPart_UnlistedHarness_NeitherPolledNorListed`, built as
  `usageMainPart_TwoHarnesses_PollsEachProfileThroughItsHarness` (`:324`) with `lab` unlisted
  (`harnesses.set('lab', harnessInfo({ profiles: [LAB], unlisted: true }))`; `harnessInfo` takes
  a `Partial<AgentHarnessInfo>`, so it needs no change): `heard.lab` is empty and `planNames`
  holds `personal` only.
- `scheduling/main/start.test.ts`: row beside `editorChoices_ReadsChatAndTheHarness` (`:1215`) —
  an unlisted harness with its own profile and controls registered first: `editorChoices` has the
  same `profiles` and `controls` as with the listed harness alone.
- `harness-folders.test.ts`: row beside `roots_HarnessNotRegistered_LeftOut` — an unlisted
  harness's profiles give no roots.
- `chat/main/start.test.ts`: `startSessionTool_UnlistedHarnessProfile_AnswersUnknownProfile`,
  beside `startSessionTool_NoProfileNamed_…` (`:1042`). `startChatPart` (`:318`) gains an
  `unlistedProfiles?: { name: string; configDir: string }[]` option that sets a second
  `coreAgentHarnessesSlot` entry `demo` with `harnessInfo({ profiles: options.unlistedProfiles,
  unlisted: true })`. Start the part with `unlistedProfiles: [{ name: 'demo', configDir: '/demo' }]`
  and call `start_session` with `{ prompt: 'hi', profile: 'demo' }`: the result's problem is
  `Unknown profile "demo". Profiles: work.`
- No test for the docs page chip call site: it is one call of `listedHarnesses`, whose rule the
  table above pins, and it has no test seam today.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass.

Commit: one commit for the group.

## Proof
