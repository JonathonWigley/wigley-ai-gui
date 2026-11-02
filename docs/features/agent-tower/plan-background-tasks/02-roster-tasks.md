# 02 — The roster holds tasks, and the page draws task lines

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/agents/contract.ts` · modify `src/plugins/agents/roster.ts` ·
           modify `src/plugins/agents/main/start.ts` · modify `src/plugins/agents/main/preview.ts` ·
           test `src/plugins/agents/roster.test.ts` · test `src/plugins/agents/main/start.test.ts` ·
           test `src/plugins/agents/main/preview.test.ts` ·
           modify `src/plugins/agents/layouts/layout.d.ts` · modify `src/plugins/agents/layouts/default/layout.js` ·
           modify `src/plugins/agents/page/layout/read-agents-layout.ts` · modify `src/plugins/agents/page/start.ts` ·
           modify `src/plugins/agents/page/agents.css` · modify `DESIGN.md` · modify `src/plugins/agents/main/selftest-script.ts` ·
           move `src/plugins/agents/page/subagent-lines.ts` → `roster-lines.ts` (and `subagent-lines.test.ts` →
           `roster-lines.test.ts`) · create `src/plugins/agents/page/roster-line-order.ts` ·
           test `src/plugins/agents/page/roster-line-order.test.ts`
Consumes:  `taskStarted` / `taskFinished` in `AgentEvent` ← 01
           (the self-test's line counts assume 03's fake tasks; 03 lands in the same wave, and only the self-test run in 05 needs both)
Produces:  in `src/plugins/agents/contract.ts`:
           `export interface RunningTask { taskId: string; agentId: string; description: string; startedAt: number }`
           `export interface Roster { agents: RunningAgent[]; tasks: RunningTask[] }`
           `AgentsChannel`: `invoke.rosters(): Record<string, Roster>`,
           `messages.rosterChanged: { sessionId: string; roster: Roster }`
           in `src/plugins/agents/roster.ts`:
           `export function foldAgentEvent(roster: Roster, event: AgentEvent): Roster`
           in `roster-line-order.ts`:
           `export type RosterLine = { kind: 'agent'; agent: RunningAgent } | { kind: 'task'; task: RunningTask; isNested: boolean }`
           `export function orderRosterLines(roster: Roster): RosterLine[]`
           in `layout.d.ts`: `agentLine?(parent, input: AgentLineInput, kit): AgentsPart` (was `line`, input was
           `SubagentLineInput`) and `taskLine?(parent, input: TaskLineInput, kit): AgentsPart`, with
           `export interface TaskLineInput { description: string; elapsedMs: number; isNested: boolean }`
           in `roster-lines.ts`: `createRosterLines(deps)` returning `{ part; setRoster(sessionId, roster); setLayouts; forget }`,
           part id `agents.rosterLines`
Decisions:
- `foldAgentEvent` returns `roster` itself when the event changes nothing (main's change check relies on identity, as
  now). `taskStarted` appends a `RunningTask` (`startedAt` is the event's `at`) unless its id is listed;
  `taskFinished` drops the listed id; `sessionEnded` empties both lists; `agentFinished` drops the agent only, never
  its tasks. Agent behaviour is unchanged.
- Main keeps one roster per host session id under a row, as now; the row's roster sent to the page merges the hosts'
  `agents` lists and `tasks` lists, each in fold order. A host's roster is dropped when both lists are empty. A
  dropped or closed row sends `{ agents: [], tasks: [] }`.
- The preview's sample roster gains two tasks, keeping its two agents: `{ taskId: 'preview-task-1', agentId:
  MAIN_AGENT_ID, description: 'npm run selftest', startedAt: now - 95_000 }` and `{ taskId: 'preview-task-2',
  agentId: 'preview-agent-2', description: 'Watch the stream decoder tests and report each failure as it lands',
  startedAt: now - 60_000 }` — the second is nested under the 185 s Explore line and long enough to end in an
  ellipsis at the side bar's least width. Update the sample's comment. Drawn in start order, the preview reads:
  the Explore agent (185 s), its task `preview-task-2` nested, `preview-task-1` (95 s), the sonnet agent (42 s).
- `orderRosterLines`: a top-level line is every agent, and every task whose `agentId` is not a listed agent's id;
  top-level lines sort by `startedAt` (the page sorts; it does not trust roster order, so agents merged from two host
  ids also land in start order), ties keeping roster order with agents before tasks. Right after each agent's
  line come its own tasks, in `startedAt` order, `isNested: true`; top-level tasks are `isNested: false`. Subagents
  stay flat (no nesting of subagent under subagent), as today.
- The default `taskLine` draws `div.agents-line.agents-task-line` (plus `agents-task-line-nested` when nested): a
  `codicon` terminal icon through `kit.icon` in the dot's column, the description in `agents-line-description`, the
  elapsed time through `kit.duration` in `agents-line-elapsed`. Reusing those two classes keeps the self-test's
  `scrollsItself` list and the ellipsis rules. A task line stays on one row at every width: `.agents-task-line` sets
  its own `grid-template-columns` (icon, a `1fr` description that ellipsizes, elapsed), and the `< 180px` container
  query's wrap rules are scoped to the subagent line so they never reach a task line. The nested indent and the
  spacing values come from `DESIGN.md`'s tokens; add the task line's one-row rule beside the subagent line's wrap
  sentence in `DESIGN.md` (§ the agents lines, line ~185 at plan time).
- The `layout.d.ts` header comment describes both line kinds and their order; `read-agents-layout.ts`'s
  `LAYOUT_PARTS` lists `agentLine` and `taskLine`. The app rewrites `~/.config/wigley-ai-gui/layouts/agents/layout.d.ts`
  itself.
- The log line stays `lines in <name>: <count>`, counting agent and task lines together.
- CSS selector `[data-part='agents.subagentLines']` becomes `agents.rosterLines`; comments naming subagent lines name
  both kinds.
- Self-test: the `subagent lines` group becomes `roster lines`; its waits become `lines in agents-selftest: 4` after
  the agents text (2 subagents + 2 tasks), `lines in Agents preview: 4` for the preview, `… : 0` after the interrupt;
  the `why` texts and the interrupt step's `why` name tasks; the screenshot names stay.
GIVEN a roster with a task WHEN its owner's `agentFinished` folds THEN the task stays listed
GIVEN tasks from two host ids under one row WHEN either changes THEN `rosterChanged` carries both hosts' tasks
GIVEN a host whose only agent finishes while its task runs WHEN folded THEN the host's roster stays, holding the task
GIVEN a main task started before a subagent and a task owned by that subagent WHEN ordered THEN main task, subagent,
  its task (nested)
GIVEN a task whose owner is no listed agent WHEN ordered THEN it is a top-level line, not nested
Tests:     `roster.test.ts` — rows added to the fold's table: taskStarted adds; a repeated taskStarted returns the
           same roster; taskFinished drops it; an unknown taskFinished returns the same roster; sessionEnded empties
           tasks and agents; agentFinished keeps its owned task. Existing rows move to the `Roster` shape.
           `start.test.ts` — existing cases move to the `roster` payload; three cases added: a `taskStarted` sends a
           `rosterChanged` whose roster lists the task (the wiring, once); two host ids under one row each start a
           task and the last `rosterChanged` lists both tasks; the only agent's `agentFinished` while a task runs
           sends a roster that still lists the task (the host is dropped only when both lists are empty).
           `preview.test.ts` — moves to the new shape; asserts the sample lists tasks owned by main and by a sample
           agent, not their copy.
           `roster-line-order.test.ts` — one `it.each` table over `orderRosterLines`: empty roster; agents only,
           given out of start order, come out in start order; main tasks interleaved with agents by start time; a subagent's tasks right after it and
           nested, even when started before a later top-level line; a task whose owner finished is top-level; equal
           start times keep agents before tasks.
           `roster-lines.test.ts` — the moved test's cases move to `setRoster`, and `build_UserLineThrows_DrawsWithDefault`
           becomes a table over both parts (`agentLine` throws, `taskLine` throws; each draws with default). One case
           added: a user layout from the existing `withUser` helper with a recording `taskLine` sees `isNested: true`
           for a nested task, and the count logs agent and task lines together.
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the five test files above
Commit:    one commit for the group

## Proof
