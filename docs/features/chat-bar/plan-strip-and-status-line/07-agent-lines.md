# 07 — The agent-lines plugin, and agents' page exports

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 04
Plan: [plan.md](plan.md)

Planned against the background-tasks page shape (`.claude/worktrees/background-tasks/src/plugins/agents/` at plan
time: `page/roster-lines.ts`, `page/roster-line-order.ts`, layout parts `agentLine` and `taskLine`). Re-read the landed
`main` copy before starting; where it differs, move what landed.

Files:
- create `src/plugins/agent-lines/manifest.ts`
- create `src/plugins/agent-lines/main/start.ts` · test `src/plugins/agent-lines/main/start.test.ts`
- move `src/plugins/agents/main/selftest-script.ts` → `src/plugins/agent-lines/main/selftest-script.ts`
- create `src/plugins/agent-lines/page/start.ts`
- move `src/plugins/agents/page/roster-lines.ts` → `src/plugins/agent-lines/page/roster-lines.ts`, with its test
  `roster-lines.test.ts`
- move `src/plugins/agents/page/roster-line-order.ts` → `src/plugins/agent-lines/page/roster-line-order.ts`, with its
  test `roster-line-order.test.ts`
- move `src/plugins/agents/page/layout/read-agents-layout.ts` →
  `src/plugins/agent-lines/page/layout/read-agent-lines-layout.ts`
- move `src/plugins/agents/page/agents.css` → `src/plugins/agent-lines/page/agent-lines.css`
- move `src/plugins/agents/layouts/layout.d.ts` → `src/plugins/agent-lines/layouts/layout.d.ts`
- move `src/plugins/agents/layouts/default/layout.js` → `src/plugins/agent-lines/layouts/default/layout.js`
- modify `src/plugins/agents/manifest.ts`, `src/plugins/agents/contract.ts`, `src/plugins/agents/page/start.ts`,
  `src/plugins/agents/main/start.ts` · test `src/plugins/agents/main/start.test.ts`
- create `src/plugins/agents/page/rosters.ts` · test `src/plugins/agents/page/rosters.test.ts`
- modify `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`, `scripts/check-layers.mts`

Consumes:
- `RosterOutcome`, `RosterAgent`, `RosterTask`, `Roster` in `src/plugins/agents/contract.ts` ← 04
- the agents main part's `rosterChanged` message and `rosters` invoke, carrying `Roster` ← 04 (shape only; the channel
  names stay as the tree holds them)
- the agents preview's sample roster in the 04 shape (`src/plugins/agents/main/preview.ts`) ← 04
- task 01's ruling on how the self-test treats `plugins.disabled` (Run log § Rulings) ← 01
- `SessionsPageExports.addRowPart`, `SessionPart`, `sessions.sessionAdded`, `sessions.sessionRemoved`;
  `KeysPageExports.anchor`, `keysFor`; `ChatMainExports.launch`; `SessionsMainExports.activate` (tree today)

Produces:
- in `src/plugins/agents/contract.ts`, exactly as plan.md § File Structure:
  `export interface AgentsPageExports { roster(sessionId: string): Roster; onRosterChanged(listener: (sessionId: string) => void): Disposable; }`
- in `src/plugins/agents/page/rosters.ts`:
  `export interface PageRosters extends AgentsPageExports { set(sessionId: string, roster: Roster): void; fill(rosters: Record<string, Roster>): void; settle(): void; forget(sessionId: string): void; }`
  `export function createPageRosters(deps: { log: (line: string) => void }): PageRosters`
- `export const agentLinesManifest` in `src/plugins/agent-lines/manifest.ts` (id `agent-lines`)
- `export const agentLinesMainPart: MainPart<typeof agentLinesManifest>` in `src/plugins/agent-lines/main/start.ts`
- `export const agentLinesPagePart: PagePart<typeof agentLinesManifest>` in `src/plugins/agent-lines/page/start.ts`
- `export function agentLinesSelfTestScript(deps: AgentLinesSelfTestDeps): SelfTestScript` in
  `src/plugins/agent-lines/main/selftest-script.ts` (renamed from `agentsSelfTestScript`)
- `export function readAgentLinesLayout(module: unknown, name: string): Layout` in
  `src/plugins/agent-lines/page/layout/read-agent-lines-layout.ts`

Decisions:
- **agent-lines has a main part.** A layout contract is registered only from main: `MainApi.layouts.register` registers
  under the calling plugin's id (`src/main/plugins/main-api.ts`), and `PageApi` has no `register`. So agent-lines gets a
  main part that registers its layouts and hands its self-test script, as keys' and gallery's main parts do
  (`src/plugins/keys/main/start.ts`). It is not page-only. A disabled agent-lines starts neither part, so its layouts
  stay unregistered while it is off.
- **The layout owner moves to agent-lines.** `layouts/` moves whole: contract `Layout` with parts `agentLine` and
  `taskLine`, `AgentLineInput`, `TaskLineInput`, `AgentsKit` renamed `AgentLinesKit`, `AgentsPart` renamed
  `AgentLinesPart`, `CompleteLayout`. The contract's comments name owner `agent-lines`, the folder
  `layouts/agent-lines/<name>/layout.js` and the setting `agent-lines.layout`. The setting `layout` (default
  `'default'`) leaves agents' manifest for agent-lines'. Its `settingInfo`: label `Layout`, description
  `The agent-lines layout the subagent and task lines under each session row draw in: a folder name in agent-lines' layouts folder, or default.`
- **agents draws nothing.** agents' page part keeps only the rosters and the `openPreview` command. It hears
  `rosterChanged` and the one `rosters` read, with today's stale-read rule (a `rosterChanged` that lands while the read
  runs wins over the read for that session), and returns `exports: AgentsPageExports` from `createPageRosters`. It drops
  `agents.css`, the layout show, and its use of sessions and keys. agents' main drops `api.layouts.register` and the
  self-test run. agents' manifest: `dependsOn: ['sessions', 'chat']`, `settings: {}`, `settingInfo: {}`; command
  `openPreview` keeps its id and key, label `open the agents sample session`.
- **`createPageRosters` rules.** `roster(id)` returns the stored roster, or `{ agents: [], tasks: [] }` for an unknown
  id. `set` stores the roster and calls every listener with the id. `fill` stores each read roster unless a `set` for
  that id came since the read began, and calls the listeners for each stored one. `settle` ends the read window.
  `forget` drops the id and calls no listener; agents' page calls it on `sessions.sessionRemoved`. A listener that
  throws does not stop the others: listeners run through `callEach`, and a throw logs
  `[agents] roster listener failed: <errorText>`. A disposed listener is not called again.
- **agent-lines shows running items only.** `orderRosterLines` first keeps the subagents and tasks whose
  `outcome` is `'running'`. A task nests under its subagent only when that subagent is still running; a running task
  whose subagent finished takes its own place in start order, as today. `AgentLineInput.toolCalls` is
  `agent.tools.length`. `AgentLineInput.agentType` stays the agent type (the line looks as today).
- **agent-lines' page part** reads the rosters only through `api.dependency<AgentsPageExports>('agents')`. `onRosterChanged(id)` calls
  `lines.setRoster(id, agents.roster(id))`. agents' page part starts first and fills its rosters only after its async
  `rosters` read, so every roster reaches agent-lines through a listener call; the row part's `build` also calls
  `setRoster(sessionId, agents.roster(sessionId))` before drawing, so a row built later draws the current roster. Names and `sessions.sessionRemoved` handling move unchanged from agents' page part. The row
  part id becomes `agent-lines.rosterLines`.
- **Names in the moved code.** Owner `agentsManifest.id` becomes `agentLinesManifest.id`. Log lines move from
  `[agents] lines in <name>: <count>` to `[agent-lines] lines in <name>: <count>`. CSS classes `agents-*` become
  `agent-lines-*` (`agent-lines-line`, `agent-lines-task-line`, `agent-lines-task-line-nested`,
  `agent-lines-task-icon`, `agent-lines-line-type`, `agent-lines-line-description`, `agent-lines-line-elapsed`,
  `agent-lines-line-tools`), the container `agent-lines`, and the wrapper selector
  `.session-row-part[data-part='agent-lines.rosterLines']`.
- **agent-lines' manifest:** `id: 'agent-lines'`, `dependsOn: ['agents', 'sessions', 'chat', 'keys']` (chat for the
  self-test's `launch`), `commands: {}`, `scopes: {}`, the `layout` setting above, `themeTokens: {}`.
- **Start order.** In `src/plugins/main.ts` and `src/plugins/page.ts`, agent-lines' part sits right after agents'.
  In `builtInManifests`, `agentLinesManifest` sits right after `agentsManifest`.
- **Self-test.** The group `roster lines` moves to agent-lines' script with its project folder renamed
  `agent-lines-selftest`, each `[agents] lines in` expect renamed `[agent-lines] lines in`, and `scrollsItself`'s
  `.agents-line-type` and `.agents-line-description` renamed to the `agent-lines-` classes. The preview step still
  presses `Space z l a` (agents' command). agents' main hands no script. Assumption: task 01's ruling lets the
  self-test start agent-lines (it is in the default `plugins.disabled`). When 01 rules that the self-test follows the
  default list, agent-lines' main part does not start, its script is not handed and its steps do not run; the lines are
  then proved by the Vitest tests below and by task 11's drive check. Record which held in the Proof section.
- **LAYERS** (`scripts/check-layers.mts`): add `src/plugins/agent-lines` (`src/contracts`, `src/shared`),
  `src/plugins/agent-lines/layouts` (`src/shared/page/layout-host`), `src/plugins/agent-lines/main` (`src/contracts`,
  `src/shared`, `src/plugins/agent-lines`, `src/plugins/agent-lines/layouts`, `src/plugins/chat/contract.ts`,
  `src/plugins/sessions/contract.ts`), `src/plugins/agent-lines/page` (`src/contracts`, `src/shared`,
  `src/shared/page`, `src/shared/page/ui`, `src/shared/page/layout-host`, `src/plugins/agent-lines`,
  `src/plugins/agent-lines/layouts`, `src/plugins/agents/contract.ts`, `src/plugins/sessions/contract.ts`,
  `src/plugins/keys/contract.ts`). Add `src/plugins/agent-lines` and its `main` to `src/plugins/main.ts`'s entry, it
  and its `page` to `src/plugins/page.ts`'s entry, and it to `src/plugins/manifests.ts`'s entry. Drop
  `src/plugins/agents/layouts` from agents' `main` and `page` entries, drop `src/plugins/sessions/contract.ts` and
  `src/plugins/keys/contract.ts` from agents' `page` entry, and remove the `src/plugins/agents/layouts` entry.

GIVEN a roster with one running and one done subagent WHEN agent-lines draws the session's row THEN one agent line
draws, and the log says `[agent-lines] lines in <name>: 1`.
GIVEN agents' page received a `rosterChanged` for s1 while its `rosters` read ran WHEN the read returns an older s1
THEN `roster('s1')` returns the `rosterChanged` roster, and listeners heard s1 once.
GIVEN `plugins.disabled` lists agent-lines WHEN the app starts THEN agents still starts, its exports read the rosters,
and no line draws under a row.

Tests:
- `roster-line-order.test.ts` (moved): add rows `drops a done subagent and a failed task`,
  `a running task whose subagent is done takes its own place` (not nested), and `a running task under a running
  subagent nests`. Catches a finished item drawn as a line, or nesting under a finished subagent.
- `roster-lines.test.ts` (moved): fixtures in the 04 shape; `build_WithTasks_DrawsLineEachAndLogsCount` asserts
  `[agent-lines] lines in <name>: <count>` and the `agent-lines-*` classes. Catches a missed rename.
- `rosters.test.ts` (new), one `it.each` table over `createPageRosters`: unknown id → empty roster; `set` → listener
  hears the id; `fill` after a `set` for the same id keeps the set's roster; `fill` after `settle` stores every roster;
  `forget` → empty roster, no listener call; disposed listener not called; a throwing listener → the next listener is
  still called and the log line is written. Catches a stale read overwriting a live roster and a dead listener.
- `agent-lines/main/start.test.ts` (new): `start_RegistersLayoutsAndHandsScript` — the fake `layouts.register` got the
  contract text and the fake self-test host got one script; `dispose` disposes the registration. Catches a lost
  layout registration.
- `agents/main/start.test.ts`: remove the layout-registration and self-test expectations; the fold rows stay.

Done when: `npm run lint` passes (layer and style checks); the moved and new Vitest tests pass; the agents self-test
(or agent-lines', per 01's ruling) groups the test gate picks pass; no file under `src/plugins/agents/` imports a
layout, `roster-lines` or `sessions`' page contract.
Commit: one commit for the group.

Runtime looks for task 11: with `agent-lines` removed from `plugins.disabled`, the sidebar lines draw as before under a
session running `fake: agents` (drive run, `.selftest/screenshots/agent-lines-subagent-lines*.png` when the self-test
ran them); with the default list, no line draws and the agents preview (`Space z l a`) opens its row with no lines.

## Proof

