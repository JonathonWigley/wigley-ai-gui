# 07 — The agent-lines plugin, and agents' page exports

Status: done
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
- move and modify `src/plugins/agents/layouts/default/layout.js` → `src/plugins/agent-lines/layouts/default/layout.js`
  (its class names and header comment change, see Names)
- modify `src/plugins/agents/manifest.ts`, `src/plugins/agents/contract.ts`, `src/plugins/agents/page/start.ts`,
  `src/plugins/agents/main/start.ts` · test `src/plugins/agents/main/start.test.ts`
- create `src/plugins/agents/page/rosters.ts` · test `src/plugins/agents/page/rosters.test.ts`
- modify `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`, `scripts/check-layers.mts`

Consumes:
- `RosterOutcome`, `RosterAgent`, `RosterTask`, `Roster` in `src/plugins/agents/contract.ts` ← 04
- the agents main part's `rosterChanged` message and `rosters` invoke, carrying `Roster` ← 04 (shape only; the channel
  names stay as the tree holds them)
- the agents preview's sample roster in the 04 shape (`src/plugins/agents/main/preview.ts`) ← 04
- the self-test starts every plugin (`plugins.disabled: []`; task 01 § Decisions, Self-test; plan.md § Decided by
  the agent) ← 01
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
  id. The read window is open from creation until `settle`. `set` stores the roster, calls every listener with the id,
  and, while the window is open, marks the id. `fill` stores each read roster whose id is not marked, and calls the
  listeners once for each roster it stored (a marked id's listeners already heard its `set`). `settle` clears the marks
  and closes the window. agents' page calls `fill` then `settle` when the read resolves, and only `settle` when it
  rejects; a `fill` after `settle` (no page does this) stores every roster, as no id is marked.
  `forget` drops the id and calls no listener; agents' page calls it on `sessions.sessionRemoved`. A listener that
  throws does not stop the others: listeners run through `callEach`, and a throw logs
  `[agents] roster listener failed: <errorText>`. A disposed listener is not called again.
- **agent-lines shows running items only.** Task 04 already made `orderRosterLines` keep only running items (a task
  nests under its subagent only while that subagent runs) and `toolCalls` read `agent.tools.length`, with the rows
  `FinishedAgentDrawsNoLine`, `FinishedTaskDrawsNoLine` and `RunningTaskOfFinishedAgentIsTopLevel`. This task moves
  that code and those rows unchanged. `AgentLineInput.agentType` stays the agent type (the line looks as today).
- **agent-lines' page part** reads the rosters only through `api.dependency<AgentsPageExports>('agents')`. `onRosterChanged(id)` calls
  `lines.setRoster(id, agents.roster(id))`. agents' page part starts first and fills its rosters only after its async
  `rosters` read, so every roster reaches agent-lines through a listener call. `RosterLinesDeps` gains
  `roster(sessionId: string): Roster` (agent-lines' page passes `agents.roster`), and the row part's `build` draws
  `deps.roster(sessionId)` when no roster was set for that session, so a row built before any listener call draws
  the current roster. Names and `sessions.sessionRemoved` handling move unchanged from agents' page part. The row
  part id becomes `agent-lines.rosterLines`.
- **Names in the moved code.** Owner `agentsManifest.id` becomes `agentLinesManifest.id`. Log lines move from
  `[agents] lines in <name>: <count>` to `[agent-lines] lines in <name>: <count>`. CSS classes `agents-*` become
  `agent-lines-*` (`agent-lines-line`, `agent-lines-task-line`, `agent-lines-task-line-nested`,
  `agent-lines-task-icon`, `agent-lines-line-type`, `agent-lines-line-description`, `agent-lines-line-elapsed`,
  `agent-lines-line-tools`), the CSS container name `agents-lines` becoming `agent-lines` in both
  `container: agent-lines / inline-size` and `@container agent-lines (width < 180px)`, and the wrapper selector
  `.session-row-part[data-part='agent-lines.rosterLines']`. `layout.js` writes every one of those classes, so it
  changes with the CSS. Comments that name the old owner change too: `layout.js`'s header ("agents look"),
  `layout.d.ts`'s (`agents`, `layouts/agents/<name>`, `data-layout-owner="agents"`, `agents.layout`), and the header
  comments of agents' `manifest.ts`, `page/start.ts` and `main/start.ts` (agents now draws nothing, registers no
  layout and hands no script).
- **agent-lines' manifest:** `id: 'agent-lines'`, `dependsOn: ['agents', 'sessions', 'chat', 'keys']` (chat for the
  self-test's `launch`), `commands: {}`, `scopes: {}`, the `layout` setting above, `themeTokens: {}`.
- **Start order.** In `src/plugins/main.ts` and `src/plugins/page.ts`, agent-lines' part sits right after agents'.
  In `builtInManifests`, `agentLinesManifest` sits right after `agentsManifest`.
- **Self-test.** The group `roster lines` moves to agent-lines' script with its project folder renamed
  `agent-lines-selftest`, each `[agents] lines in` expect renamed `[agent-lines] lines in`, and `scrollsItself`'s
  `.agents-line-type` and `.agents-line-description` renamed to the `agent-lines-` classes. The preview step still
  presses `Space z l a` (agents' command). agents' main hands no script. The self-test starts every plugin (task 01),
  so agent-lines' main part hands its script and its steps run in every self-test run, though agent-lines is in the
  default `plugins.disabled`.
- **A stale `agents.layout` key.** The `layout` setting leaves agents, so a user `settings.json` that still sets
  `agents.layout` reads as a settings problem once this lands. plan.md § Preconditions checks the user's file for it.
- **LAYERS** (`scripts/check-layers.mts`): add `src/plugins/agent-lines` (`src/contracts`, `src/shared`),
  `src/plugins/agent-lines/layouts` (`src/shared/page/layout-host`), `src/plugins/agent-lines/main` (`src/contracts`,
  `src/shared`, `src/plugins/agent-lines`, `src/plugins/agent-lines/layouts`, `src/plugins/chat/contract.ts`,
  `src/plugins/sessions/contract.ts`), `src/plugins/agent-lines/page` (`src/contracts`, `src/shared`,
  `src/shared/page`, `src/shared/page/ui`, `src/shared/page/layout-host`, `src/plugins/agent-lines`,
  `src/plugins/agent-lines/layouts`, `src/plugins/agents/contract.ts`, `src/plugins/sessions/contract.ts`,
  `src/plugins/keys/contract.ts`). Add `src/plugins/agent-lines` and its `main` to `src/plugins/main.ts`'s entry, it
  and its `page` to `src/plugins/page.ts`'s entry, and it to `src/plugins/manifests.ts`'s entry. Drop
  `src/plugins/agents/layouts` from agents' `main` and `page` entries, drop `src/plugins/keys/contract.ts` from agents'
  `page` entry, and remove the `src/plugins/agents/layouts` entry. agents' `page` entry keeps
  `src/plugins/sessions/contract.ts`: its `api.events.on('sessions.sessionRemoved', …)` (for `forget`) types the event
  name through `Heard`, which `src/contracts/plugin.ts` builds from `SessionsPageEvents` in that file.

GIVEN a roster with one running and one done subagent WHEN agent-lines draws the session's row THEN one agent line
draws, and the log says `[agent-lines] lines in <name>: 1`.
GIVEN agents' page received a `rosterChanged` for s1 while its `rosters` read ran WHEN the read returns an older s1
THEN `roster('s1')` returns the `rosterChanged` roster, and listeners heard s1 once.
GIVEN `plugins.disabled` lists agent-lines WHEN the app starts THEN agents still starts, its exports read the rosters,
and no line draws under a row.

Tests:
- `roster-line-order.test.ts` (moved): 04's rows move unchanged. Add the row `a running task under a running subagent
  nests` only if the moved table has no row that pins it. Catches nesting lost in the move.
- `roster-lines.test.ts` (moved): fixtures in the 04 shape; `build_WithTasks_DrawsLineEachAndLogsCount` asserts
  `[agent-lines] lines in <name>: <count>` and the `agent-lines-*` classes. Catches a missed rename. New row
  `build_NothingSet_DrawsTheDepsRoster`: a part built for a session no `setRoster` named draws `deps.roster`'s roster
  (one running and one done subagent → one line, the log `lines in <name>: 1`). Catches a row built before the first
  listener call drawing nothing.
- `rosters.test.ts` (new), one `it.each` table over `createPageRosters`: unknown id → empty roster; `set` → listener
  hears the id; `fill` after a `set` for the same id (window open) keeps the set's roster, and listeners heard that id
  once; `set` after `settle`, then `fill` → `fill` stores the read roster (the mark was cleared); `forget` → empty
  roster, no listener call; disposed listener not called; a throwing listener → the next listener is still called and
  the log line is written. Catches a stale read overwriting a live roster and a dead listener.
- `agent-lines/main/start.test.ts` (new): `start_RegistersLayoutsAndHandsScript` — the fake `layouts.register` got the
  contract text and the fake self-test host got one script; `dispose` disposes the registration. Catches a lost
  layout registration.
- `agents/main/start.test.ts`: remove the layout-registration and self-test expectations; the fold rows stay.

Done when: `npm run lint` passes (layer and style checks); the moved and new Vitest tests pass;
`npm run selftest -- --plugin agent-lines` passes (agents hands no script now, and a `--plugin` filter naming a plugin
with no script fails the run); no file under `src/plugins/agents/` imports a layout, `roster-lines`,
`SessionsPageExports` or `src/plugins/keys/contract.ts`.
Commit: one commit for the group.

Runtime looks for task 11: with `agent-lines` removed from `plugins.disabled`, the sidebar lines draw as before under a
session running `fake: agents` (drive run, `.selftest/screenshots/agent-lines-subagent-lines*.png` when the self-test
ran them); with the default list, no line draws and the agents preview (`Space z l a`) opens its row with no lines.

## Proof

Commit 26bf19f6 · proof: diff read: AgentsPageExports roster/onRosterChanged in agents/contract.ts; agent-lines plugin listed in main/page/manifests and LAYERS; tsc clean apart from 06 in flight; worker's 10 test files (109 tests) pass · concerns: the pure renames landed in peer commit d035a2db; npm run lint stops on a peer's sessions.css:188 raw 2s (d95c8c4b)
