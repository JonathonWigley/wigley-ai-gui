# Background tasks under session rows — plan

Feature: agent tower (the agents plugin's side bar lines) · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user sees every process a session's agents run apart from their turn, such as a background `npm run selftest`
Bash, as a line under its session row beside the running subagent lines, and the line goes when the process ends.

## Architecture

- `src/contracts/agent.ts` — two new harness-neutral agent events, `taskStarted` and `taskFinished`.
- Claude adapter (`src/main/claude-code/stream-decoder.ts`) — emits them from `system/task_started` and
  `system/task_notification`.
- Fake harness (`src/shared/fake-agent-harness.ts`) — emits them on its agents turn, for the self-test and drive runs.
- `agents` plugin — its roster holds tasks beside subagents (main), and the page draws a task line per running task
  through a new `taskLine` part of the agents layout.

## Preconditions

Re-run each before the first dispatch:

- Claude 2.1.316 sends `task_started` (`task_type: "local_bash"`, no `parent_task_id`) for a main-agent
  `run_in_background` Bash and `task_notification` at its end, after the turn's `result`. Verified 2026-11-02 by
  `claude -p "<run a 6 s sleep with run_in_background true>" --model claude-haiku-5-5 --output-format stream-json
  --verbose --allowedTools "Bash(python3 -c 'import time; time.sleep(6)')"` in the session scratchpad; the lines are
  recorded in `docs/features/agent-chat/claude-stream.md` § Subagents. Re-check with `claude --version` (2.1.316 at
  plan time); a newer version needs the probe re-run only when a decoder test row fails against real lines.
- Nothing in the user config folder overrides the agents layout, so renaming its `line` part breaks no user layout:
  `find ~/.config/wigley-ai-gui/layouts/agents -name layout.js` prints nothing (measured at plan time: only the
  app-written `layout.d.ts`).
- `git -C <repo> log --oneline -1 -- docs/features/agent-tower/design.md` shows `978c65b` or a later commit.
- Another session may be running the file-drop plan in this tree. Commit only this plan's paths, by name.

## Docs written ahead

Commit `978c65b`:

- `docs/features/agent-tower/design.md` — § Vocabulary (Task, Roster), § Agent events (the two rows), § The agents
  plugin (Tasks, Page).
- `docs/features/agent-chat/claude-stream.md` — § Subagents: a task's `parent_task_id`, and the main agent's
  background Bash lines.

## Mandatory Reads

- `AGENTS.md` (repo root) — whole; § Architecture and § Running and testing especially
- `DESIGN.md` — for task 02 (a view, its CSS, a layout)
- `docs/features/agent-tower/design.md` — § Agent events, § The agents plugin
- `docs/features/agent-chat/claude-stream.md` — § Subagents, the task lines (task 01)
- `docs/features/layouts/design.md` — for task 02 (a layout contract part)
- `find . -path ./node_modules -prune -o \( -name 'AGENTS*.md' -o -name 'CLAUDE*.md' \) -print` — any nested one
  under a touched folder

## Design Overview

```
claude stream                      Claude adapter (stream-decoder)
 system/task_started ──────────▶  task_type local_agent → keep task_id → Agent call id (owner map)
   task_type != local_agent        otherwise → taskStarted { taskId, agentId: owner | main, description }
 system/task_notification ─────▶  started task → taskFinished { taskId, done | failed }
                                    (a turn's result and an agent's end finish no task)
fake harness ── agents turn ───▶  taskStarted ×2 (main, first subagent); interrupt → taskFinished ×2
                                          │ AgentProcessEvents.agentEvent
                                          ▼
                       chat.agentEvent ─▶ agents main: foldAgentEvent(Roster, event) per host id
                                          │ rosterChanged { sessionId, roster: { agents, tasks } }
                                          ▼
                       agents page: orderRosterLines(roster) → agent / task lines in start order,
                                    a task under its running owner's line, nested
                                    → layout parts agentLine / taskLine (terminal icon, description, elapsed)
```

Decisions (interview round 1, all as recommended):

- Every non-subagent task Claude reports shows: the main agent's background Bash, any Bash a subagent runs (foreground
  ones included), and task types Claude adds later. A task is keyed on `task_type` present and not `local_agent`.
- One list in start order; a subagent's own tasks right under its line, indented, while it runs.
- A task line: a terminal icon, the description and the elapsed time.
- A line disappears when its task ends, as a subagent line does.
- A click selects the session, as a subagent line's does; no keys, no focus, no stop or output action.
- A new event pair `taskStarted` / `taskFinished` in `AgentEvent`, not a reuse of the agent events.

Decided by the agent:

- A task ends only on its own `task_notification` or the session's `sessionEnded`: a background command outlives its
  turn's `result`, and the decoder emits no `taskFinished` on an agent's end.
- `task_notification` status `completed` is `done`; every other status (`failed`, `stopped`, `killed`) is `failed`.
- A task whose owner is not a running subagent (the main agent, or a subagent that already finished) draws at the top
  level, not nested.
- The fake harness's interrupt ends its tasks too (outcome `failed`), so the self-test's interrupt step still empties
  the row. Real Claude may keep a background Bash past an interrupt; the decoder follows the events either way.
- Names say what the code now does (`wigley:writing-code` § Names): `subagent-lines.ts` becomes `roster-lines.ts`
  (`createRosterLines`, part id `agents.rosterLines`), the layout part `line` becomes `agentLine`, and
  `SubagentLineInput` becomes `AgentLineInput`. One user and no backwards compatibility (`AGENTS.md` § Intent), and
  no user layout overrides the part (Preconditions).
- The chat transcript is unchanged: `task_started` and `task_notification` still land as raw entries there.

Out of scope: opening a task's output file, stopping a task, showing a finished task's exit code, a terminal session's
tasks (only Chat-tab sessions produce agent events), and the tower view.

## File Structure

Modified:

- `src/contracts/agent.ts` — `AgentEvent` gains `taskStarted` and `taskFinished` (01)
- `src/main/claude-code/stream-decoder.ts`, `stream-decoder.test.ts` — task events from the stream (01)
- `src/plugins/agents/roster.ts` — 01 adds the two cases returning the input unchanged so the exhaustive switch
  compiles; 02 folds them
- `src/plugins/agents/contract.ts`, `roster.test.ts`, `main/start.ts`, `main/start.test.ts`, `main/preview.ts`,
  `main/preview.test.ts` — the roster holds tasks (02)
- `src/plugins/agents/layouts/layout.d.ts`, `layouts/default/layout.js`, `page/layout/read-agents-layout.ts`,
  `page/start.ts`, `page/agents.css`, `main/selftest-script.ts` — task lines (02: the roster's shape change reaches
  the page, so one group keeps every commit compiling)
- `src/shared/fake-agent-harness.ts`, `fake-agent-harness.test.ts` — the agents turn's tasks (03)

Moved (02): `src/plugins/agents/page/subagent-lines.ts` → `roster-lines.ts`, and its test with it.

New (02): `src/plugins/agents/page/roster-line-order.ts` and its test — the pure ordering rule, kept apart from the
drawing so its cases run as a table without a DOM.

Shared names every task uses, exactly:

```ts
// src/contracts/agent.ts, in AgentEvent
| { type: 'taskStarted'; at: number; taskId: string; agentId: string; description: string }
| { type: 'taskFinished'; at: number; taskId: string; outcome: 'done' | 'failed' }

// src/plugins/agents/contract.ts
export interface RunningTask { taskId: string; agentId: string; description: string; startedAt: number }
export interface Roster { agents: RunningAgent[]; tasks: RunningTask[] }
// AgentsChannel: invoke.rosters(): Record<string, Roster>; messages.rosterChanged: { sessionId: string; roster: Roster }
```

Boundary rules: no Claude field name (`task_type`, `parent_task_id`) outside `src/main/claude-code/`; the page reads
the roster only through the agents channel; `npm run lint` (layer and style checks) passes.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Task events in the contract and the Claude decoder](01-task-events-decoder.md)

### Wave 2
- [ ] [The roster holds tasks, and the page draws task lines](02-roster-tasks.md) — after 01
- [ ] [The fake harness runs tasks](03-fake-harness-tasks.md) — after 01

### Wave 3
- [ ] [Doc re-read](04-doc-re-read.md) — after 01, 02, 03

### Wave 4
- [ ] [Final verification](05-final-verification.md) — after 04

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
