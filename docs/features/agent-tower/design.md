# Agent Tower

**Contents**

- **Status** — what is built now and what waits.
- **Vocabulary** — agent event, agent id, roster, plan step.
- **Agent events** — the record every view reads, who emits it, and where it is logged.
- **The agents plugin** — the roster, the event log and the views that draw it (`agent-lines`, `agent-strip`).
- **The tower** — the game view the seams are built for: constraints, inputs and phases.

A gamified view of a session's agents: each plan step is a floor of a tower, and chibi characters fight their way up
as the harness works, one enemy per floor, cleared when the plan step completes. The first piece built is the seam
it stands on: a harness-neutral stream of agent events, logged per session, and a plain display of each session's
running subagents and tasks in the Sessions side bar.

## Status

Built:

- the agent event record in `src/contracts/agent.ts` (`AgentEvent`), emitted by the Claude adapter
  (`src/main/claude-code/stream-decoder.ts`, `claude-code-harness.ts`) and by the fake harness
- chat main forwarding each owned session's events as `chat.agentEvent`, carrying
  `{ sessionId, profileDir, hostSessionId, event }`
- the `agents` plugin: each session's roster, one JSON-lines event log per host session, and the `Space z l a` layout
  preview. It draws nothing; its page exports the rosters to the views that do
- the `agent-lines` plugin (in `plugins.disabled` by default): one working line under its session's row while the
  session runs any subagent or task, through sessions' `addRowPart`
- the `agent-strip` plugin: the subagent and task boxes above the Chat composer's box (`docs/features/chat-bar/design.md`)

Waits: plan, plan step, retry and watcher events wait for a producer; replay and the tower view wait for the tower
itself. `skillStarted`, `fileWritten`, `turnStarted` and `turnEnded` are emitted by the Claude adapter and the fake
harness and read by the workflow plugin (`docs/features/workflow/design.md`).

## Vocabulary

- **Agent event** — one thing an agent did, in the app's harness-neutral shape (§ Agent events). Not a plugin event
  on the event bus: `chat.agentEvent` is the bus event that carries one.
- **Agent id** — which agent an event is about: `main` for the session's own agent, or a subagent's id (Claude: the
  id of the Agent tool call that started it).
- **Task** — a process an agent started that runs apart from its turn, such as a background shell command (Claude: a
  `task_started` whose `task_type` is not `local_agent`; a subagent is a task too in Claude's stream, but the app
  calls it a subagent and never a task).
- **Roster** — a session's agents and tasks as the agents plugin tracks them from its events: each subagent with its
  type, name, description, start time, whether it runs in the background, model, effort, spend, context tokens and
  window, and every tool call (name, summary, outcome), and each task with its owning agent's id and name,
  description, command and start time. Every listed item is running: an item leaves the moment it ends, done or
  failed, and `sessionEnded` empties the roster.
- **Plan step** — one step of the session's task plan, one floor of the tower. Chat's **step** (a tool, thinking or
  raw entry, `agent-chat/design.md` § Vocabulary) is a different thing; the tower always says plan step.

## Agent events

The harness adapter alone reads its harness's output, so it alone turns that output into agent events, sent through
`AgentProcessEvents.agentEvent` beside the chat entries. Every view — the sidebar working line and the strip now, the tower and replay
later — reads agent events and nothing else, so a Codex or wigley-harness adapter that emits them drives every view
unchanged. Each event carries `at`, epoch milliseconds from the adapter's injected clock.

| Event | Carries | Drives in the tower |
|---|---|---|
| `sessionStarted` / `sessionEnded` | — | enter the tower / results screen |
| `agentSpawned` | agent id, parent agent id, agent type, description, name (the label the agent was given, its type when none), model and effort (each null when unknown) | a party member joins |
| `agentReplied` | agent id, model (the reply's, or the launch receipt's resolved model), the subagent's estimated spend so far in USD (cumulative; null before its first reply or when any reply used an unpriced model), context tokens of its latest reply (null before its first reply), its model's context window (null until the harness reports it) | — |
| `agentLaunched` | agent id; the subagent runs in the background | — |
| `agentFinished` | agent id, done or failed | the member steps back |
| `taskStarted` | task id, agent id (the agent that started it), description, command (null when the harness names none) | — |
| `taskFinished` | task id, done or failed | — |
| `toolStarted` / `toolFinished` | agent id, tool call id, tool name, one-line summary (started only), success or failure (finished only) | attack / player hurt |
| `usage` | agent id, context tokens used, context window size (null until the harness reports it), autocompact limit (configured and reported, each tokens or null), cache expiry (null when unknown), session spend in USD (null until the first result) | fatigue bar (context fill) |
| `compactionStarted` | trigger: `app` (the app called `compact()`), `manual` (the user sent `/compact`) or `harness` (the harness's own autocompact) | rest begins |
| `compactionEnded` | trigger, outcome (done, failed or interrupted), context tokens before (null when the harness does not report it, and unless the outcome is done), duration in ms (null when unknown); one for each `compactionStarted`. The after-size is the next `usage` | rest / heal |
| `userMessage` | — | "message from HQ" |
| `skillStarted` | agent id, skill (`wigley:make`), args; a Skill call or a slash command the user typed | — (the workflow plugin's stages) |
| `fileWritten` | agent id, the full path of a Write or Edit | — (the workflow plugin's plan detection) |
| `turnStarted` | —; every turn of the main conversation, a turn the harness runs with no user message included (Claude: each turn's `system/init`) | — (the workflow plugin's busy state) |
| `turnEnded` | — | — (the workflow plugin's plan ready) |

Events with no producer yet join this union when one exists: plan created or revised (ordered plan steps, optional
effort estimate), plan step started and ended, retry (tool, attempt number), and watcher progress (0–100). They wait
because nothing in the app knows a plan today; declaring their fields before a planner exists would guess at them.

Only the app's own Chat-tab sessions produce agent events: a terminal session reaches the app only through the forms
relay. A second source — Claude Code hooks posted over the relay, or the transcript folder's `subagents/` files —
would emit the same events into `chat.agentEvent`'s payload shape.

## The agents plugin

`src/plugins/agents/` depends on `sessions`, `chat` and `keys` (its layout kit's key prompts).

- **Main** hears `chat.agentEvent`, folds each event into the roster of its process's host session id under its row (a
  cleared row's old process ending drops only its own subagents and tasks) with a pure reducer, appends the event as one JSON line
  to `logs/<host session id>.jsonl` in its plugin data, and sends each changed roster to the page over its channel. A
  session's `sessionEnded` finishes every subagent still listed: a process that exits or crashes mid-subagent sends no
  `agentFinished`. The Claude adapter finishes a subagent itself on its `task_notification` or its non-launch
  `tool_result`, whichever comes first: on Claude 2.1.316 a subagent runs in the background by default, so its Agent
  call's first `tool_result` is only a launch receipt, and a turn's `result` (an interrupt's included) fails only the
  main agent's calls with neither. An agent's end fails its own open tool calls and every foreground call still pending
  under it, nested levels included; a background call waits for its own end. A `result` whose `origin` is `peer` or
  `task-notification` is a turn Claude ran on its own after a background subagent ended, and the harness matches it to
  no message sent. A resumed session keeps its host session id, so it appends to the same log. Logs are never pruned.
- **Tasks.** The Claude adapter starts a task on each `task_started` whose `task_type` is not `local_agent`, so a task
  type Claude adds later shows without a change, and finishes it on its `task_notification` (`completed` is done,
  any other status failed). A task's agent id is its owning subagent's (its `parent_task_id` paired with the
  subagent's Agent call through the subagent's own `task_started`), or `main`. A task outlives the turn and the
  subagent that started it: neither a `result` nor an agent's end finishes it, only its own end event or
  `sessionEnded`. Foreground Bash calls of a subagent get a task too (`is_backgrounded: false`) and show the same way.
- **`agentReplied`** is sent on a subagent's reply and on its launch receipt's `resolvedModel`; on a foreground
  completion receipt it comes before `agentFinished`. The roster takes the reply's model and spend.
- **`agentLaunched`** is sent on a background Agent call's launch receipt (`isAsync`); the roster marks that subagent
  as running in the background.
- **Page** draws nothing. It keeps every session's roster and exports `roster(sessionId)` and
  `onRosterChanged(listener)` to the views that draw it.
- **`agent-lines`** (a separate plugin, in `plugins.disabled` by default; its `layout` setting is `agent-lines.layout`)
  adds a row part through sessions' `addRowPart` and draws, under each session row, one `workingLine` while the
  session runs any subagent or task: a running dot and the elapsed time since the earliest running item started. The
  layout input also carries the counts of running subagents and tasks, for a user layout to draw. The line goes when none runs. It takes no keys and no focus; a click on it
  selects its session, as the row does. The elapsed time ticks once a second while any line shows.
- **`agent-strip`** draws the same roster as boxes above the Chat composer's box (`docs/features/chat-bar/design.md`).

The same reducer folds a logged session's events, so replay drives the views with the code a live session uses.

## The tower

### Constraints

- **Personal and local only.** The character art is Granblue Fantasy (Cygames) assets, extracted for private use.
  Never commit assets or the favorites manifest to a public repo, and never hotlink game servers at runtime: load
  everything from local files.
- **Keep the sprite layer swappable.** The tower runs with placeholder art (coloured shapes) whenever no manifest is
  present.
- **Observe, never control.** The tower only listens to agent events; nothing in it can affect agent behaviour.

### Inputs

1. **Agent events** (§ Agent events).
2. **`favorites.json`**, exported by the Chibi Browser: each chosen character's id, name, element, variant, role
   (driver, task agent, enemy, boss, npc), still chibi, and the names and local files of its character animation, hit
   effect, charge attacks and skill effects. The Chibi Browser README documents the format and the playback model;
   its `ensureRuntime()`, `ensureAnim()` and `playAnim()` are the starting point for the tower's renderer.

### Phase 2: tower with placeholder art

All game logic lands before any sprite.

- Floors come from the plan, rebuilt cleanly when the plan is revised mid-session. The current floor shows in focus;
  cleared and failed floors are marked.
- **Enemy HP**, two modes:
  - *Estimate mode*: max HP comes from the planner's per-plan-step estimate, and each successful tool call deals one
    hit.
  - *Asymptotic mode* (the default with no estimate): each success removes a fixed fraction of the *remaining* HP, so
    the bar always moves but never empties on its own. The plan step completing deals the killing blow.
- Player bars show context fill; a compaction's rest shows how much it reclaimed.
- Party: the driver (`main`) always shows. Subagents join on `agentSpawned` and step forward while running.
- **Replay mode**: a logged session fed through the tower at an adjustable speed, used to tune pacing.

### Phase 3: the cast

- Load `favorites.json` and cast by role: the driver for `main`, task-agent favorites for subagents, enemy or boss
  favorites per floor (random, or by plan step type).
- Reuse the Chibi Browser's loader and player. Motion names come from each character's file, mapped through a small
  per-name table with fallbacks. Events map to animation states:
  - idle or waiting → idle
  - tool success → attack (spawns the character's hit effect on the enemy)
  - notable tool calls (a subagent spawn, a write) → skill motion with a skill effect
  - tool failure → hurt
  - plan step done → win pose (a charge attack as the killing blow on long plan steps, when the character has one)
  - plan step failed → KO
- A character whose animation won't load falls back to its still chibi with simple tweened motion.
- Effects are the game's own hit, skill and charge attack files, on their own layer. The game's `mDamage` hook,
  forwarded to `window.onChibiGameEvent`, times the enemy's hurt reaction and HP ticks to the moment a hit lands.

### Phase 4: polish (optional)

- Watcher model: an occasional cheap progress guess, so HP drops track real progress.
- Results screen: floors cleared, hits taken, retries, compactions survived, tokens spent.
- Cosmetics: a favorite's alternate art unlocks after a streak of clean runs.
- Tower history: past sessions browsed as completed towers.

### Main risk

Animation playback follows the community GBF Animation Player and has been tested against real-format demo files,
not live downloads. Confirm it in the Chibi Browser with a few real characters before Phase 3 builds on it; Phase 2
and Phase 3's still-image fallback do not wait on it.
