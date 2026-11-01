# 07 — Agents plugin: manifest, contract, roster

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     create `src/plugins/agents/manifest.ts` · create `src/plugins/agents/contract.ts` ·
           create `src/plugins/agents/roster.ts` · test `src/plugins/agents/roster.test.ts` ·
           modify `src/plugins/manifests.ts` · modify `scripts/check-layers.mts`
Consumes:  `AgentEvent`, `MAIN_AGENT_ID` in `src/contracts/agent.ts` ← 02
Produces:  `export const agentsManifest` in `src/plugins/agents/manifest.ts`
           in `src/plugins/agents/contract.ts`, exactly as plan.md's File Structure gives them:
           `export interface RunningAgent { agentId: string; agentType: string; description: string; startedAt: number; toolCalls: number }`
           `export interface AgentsChannel extends ChannelShape { invoke: { rosters(): Record<string, RunningAgent[]> }; messages: { rosterChanged: { sessionId: string; running: RunningAgent[] } } }`
           in `src/plugins/agents/roster.ts`:
           `export function foldAgentEvent(running: readonly RunningAgent[], event: AgentEvent): readonly RunningAgent[];`
Decisions:
- **Manifest**: `definePlugin({ id: 'agents', dependsOn: ['sessions', 'chat', 'keys'], commands: {}, scopes: {},
  settings: {}, settingInfo: {}, themeTokens: {} })`. The header comment says what the plugin does
  (`agent-tower/design.md` § The agents plugin) and that it names `keys` for its layout's key hints.
  - `keys` is in `dependsOn`, beyond plan.md's "sessions and chat", because 09's layout kit is built from
    `ownerBaseKitDeps`, which needs `KeysPageExports.anchor` and `keysFor`. Every plugin that has a layout depends on
    `keys` (gallery, chat, sessions).
  - 09 adds the `openPreview` command and the `layout` setting. The compiler requires a handler for every page
    command, and the page part only exists in 09, so declaring the command here would fail to compile.
- **A manifest with no part is valid.** `src/shared/plugin-host.ts` checks only the parts it starts: unique ids,
  `dependsOn` naming listed manifests, and no cycles. `manifests.ts` is read for the keymap, labels and settings, and
  nothing requires a listed manifest to have a part. Only the reverse throws: a part whose manifest is missing. So 07
  adds `agentsManifest` to `builtInManifests` with no part in `main.ts` or `page.ts`. Place it after `chatManifest`,
  since it depends on chat.
- **Contract**: `contract.ts` imports only `ChannelShape` from `src/contracts/plugin`. `rosters()` is keyed by the
  app's sessionId (the row id), and the channel comments say so. There are no exports types: the agents plugin
  exports nothing yet (plan.md Design review).
- **`foldAgentEvent`** is pure, and `running` stays in spawn order. A `switch` on `event.type` lists every member of
  the union, with no `default`, and ends in a `satisfies never` check, so a new `AgentEvent` member fails to compile
  until it is placed here. When the event changes nothing, the function returns `running` itself (the same
  reference), so main sends only real changes (plan.md File Structure):
  - `agentSpawned` appends `{ agentId, agentType, description, startedAt: event.at, toolCalls: 0 }`. An id already
    listed returns `running`.
  - `toolStarted` whose `agentId` is a listed subagent returns a new array with that entry's `toolCalls + 1`; the
    other entries keep their references. `MAIN_AGENT_ID`, or an id that is not listed, returns `running`. A
    subagent's own tool calls count toward its line (plan.md Design review).
  - `agentFinished` removes the entry; an id that is not listed returns `running`.
  - `sessionEnded` returns `[]`, or `running` when it is already empty. It finishes every listed subagent, because a
    process that exits or crashes mid-subagent sends no `agentFinished` (an interrupt's turn result finishes them in
    the adapter, 03) (plan.md Decisions).
  - `sessionStarted`, `toolFinished`, `usage`, `compacted` and `userMessage` return `running`.
- **Layers** (`scripts/check-layers.mts`, modelled on the `chat` and `keys` entries), in this task:
  - `'src/plugins/agents': { layers: ['src/contracts', 'src/shared', 'src/plugins/agents/contract.ts'], packages: [] }`
  - `'src/plugins/agents/contract.ts': { layers: ['src/contracts'], packages: [] }`
  - add `'src/plugins/agents'` to the `src/plugins/manifests.ts` entry
  - 08 adds `agents/main`, and 09 adds `agents/page` and `agents/layouts`.

GIVEN `[]` WHEN two `agentSpawned` events fold in turn THEN the roster lists both in spawn order with `toolCalls` 0
and `startedAt` equal to each event's `at`.
GIVEN two running subagents WHEN a `toolStarted` for the second folds THEN only the second's `toolCalls` rises.
GIVEN a running subagent WHEN a `toolStarted` on `main` folds THEN the same array comes back.

Tests:     `roster.test.ts`, one `it.each` table
           `foldAgentEvent_Event_FoldsRoster ($case)`. Each row has `before`, `event`, and either `after` (asserted
           with `toEqual`) or `same: true` (asserted with `toBe(before)`). Two subagents are written as fixtures `a`
           (`agentType` `Explore`, `description` `Find adapters`, `startedAt` 1000) and `b`:
           - spawn into `[]` gives `[a]` with `toolCalls` 0 and `startedAt` = the event's `at`
           - spawn while `[a]` gives `[a, b]` in order. Catches a prepend.
           - spawn of an id already listed: same
           - `toolStarted` on `b` while `[a, b]` gives `b.toolCalls` 1 and `a` unchanged. Catches counting on every
             subagent.
           - `toolStarted` on `main`: same. Catches counting the main agent's tools on a line.
           - `toolStarted` on an id that is not listed: same
           - `agentFinished` on `a` while `[a, b]` gives `[b]`
           - `agentFinished` on an id that is not listed: same. Catches a needless `rosterChanged`.
           - `sessionEnded` while `[a, b]` gives `[]`. Catches lines left after a crash or exit.
           - `sessionEnded` while `[]`: same
           - `usage`, `compacted`, `userMessage`, `sessionStarted` and `toolFinished` while `[a]`: same, one row
             each
Done when: compiles; `npm test` runs `roster.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof
