# Agent strip and status line — plan

Feature: chat bar · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

In each Chat tab the user sees, above the box, a strip of boxes, one per subagent and per background task of the
session, which the entry cursor reaches with `j` and moves through with `h`/`l`; and under the box a status line —
repo, branch, model · effort, the other controls, context, cache, spend, the running dot and Send — in place of the
composer bar and its vim mode label. The sidebar's subagent lines and the tab bar's usage line become plugins that
start switched off through a new core setting, `plugins.disabled`.

## Architecture

- **Core** — the setting `plugins.disabled` and the plugin host in both roots, which starts no part of a disabled
  plugin; the config check, which rejects disabling a plugin a started plugin depends on; the HScroller primitive.
- **Claude adapter** (`src/main/claude-code/`) and the fake harness — richer agent events: a subagent's name, model,
  effort and estimated spend, each tool call's summary, a task's command.
- **agents** — the roster keeps finished subagents and tasks until the next user message, each subagent's tool calls,
  model, effort and spend; the page part draws nothing and exports the rosters.
- **agent-lines** (new) — the sidebar lines, moved out of agents.
- **chat** — the status line (`statusLine` layout part, `addStatusPart`), repo and branch through a new
  `Git.currentBranch`, no mode label, and a composer part's `stop` on the entry cursor.
- **usage** — its session line drawn as a chat status part. **usage-tab-line** (new) — the tab-bar line, moved out.
- **agent-strip** (new) — the strip, its boxes, its key scope and its layout.

## Preconditions

Re-run each before the first dispatch:

- The background-tasks plan has landed on `main`: `grep -c "taskStarted" src/contracts/agent.ts` prints 1 or more,
  and `docs/features/agent-tower/plan-background-tasks/` is gone. At plan time it ran in
  `.claude/worktrees/background-tasks` and had not landed. This plan's roster shape starts from its
  `Roster { agents, tasks }` and `RunningTask` (`src/plugins/agents/contract.ts`).
- Other plans touching this plan's files are landed or not running: `ls -d docs/features/*/plan-*` at plan time listed
  `agent-chat/plan-slash-completion`, `agent-chat/plan-turn-tracking`, `agent-chat/plan-working-block`,
  `connected-session-rows/plan-hidden-rows`, `docs-browser/plan-ownership`, `session-titles/plan-titles-and-status`.
  Turn tracking touches the Claude decoder; working block, slash completion and session titles touch the chat page and
  layout. For each still present, read its `plan.md` File Structure; when it shares a file with this plan, run it
  first or rebase this plan's task documents on its landed code.
- Nothing in the user config folder overrides the agents, chat or usage layout parts this plan renames:
  `find ~/.config/wigley-ai-gui/layouts -name layout.js` prints no path under `agents/`, `chat/` or `usage/`.
- No user setting the `layout` setting's move (task 07) breaks: `~/.config/wigley-ai-gui/settings.json`, when present,
  sets no `layout` key under `agents` (read the file's `agents` object). When it does, tell the user before task 07
  runs: once the setting leaves agents, that key reads as a settings problem.
- `git -C <repo> log --oneline -1 -- docs/features/chat-bar/design.md` shows `cd16018` or a later commit.
- Other sessions work in this tree. Commit only this plan's paths, by name.

## Docs written ahead

Commit `cd16018`:

- `docs/features/chat-bar/design.md` — the whole design.
- `AGENTS.md` — the plugin list (agents, agent-lines, agent-strip, usage, usage-tab-line), "A disabled plugin", the
  row and bar part examples, "A composer part" (its stop) and "A status part".
- `DESIGN.md` — § Surfaces, Chat (the composer's rows, the agent strip) and Usage; § Primitives, HScroller.
- `docs/features/plugin-framework/design.md` — the disable list.
- `docs/features/layouts/design.md` — the owner table.
- `docs/features/usage/design.md` — the flow, the page's session line, a decision and a rejection.

Left to task 10, because another plan's run edits them at plan time: `docs/features/agent-tower/design.md` (§ Status,
§ The agents plugin, Page) and `docs/features/agent-chat/design.md` (the Chat tab line naming the box's vim mode).

## Mandatory Reads

- `AGENTS.md` (repo root) — whole; § Architecture and § Running and testing especially
- `DESIGN.md` — every task that draws: 02, 05, 06, 07, 08, 09
- `docs/keymap.md` — tasks 06 and 09 (new binds)
- `docs/features/chat-bar/design.md` — whole
- `docs/features/agent-tower/design.md` — § Agent events, § The agents plugin (tasks 03, 04, 07, 09)
- `docs/features/agent-chat/claude-stream.md` — § Subagents (task 03)
- `docs/features/usage/design.md` — tasks 08
- `docs/features/layouts/design.md` — every task that adds or renames a layout part
- `find . -path ./node_modules -prune -o -path ./.drive -prune -o -path ./.claude/worktrees -prune -o \( -name 'AGENTS*.md' -o -name 'CLAUDE*.md' \) -print`
  — any nested one under a touched folder (at plan time: only the root `AGENTS.md`)

## Design Overview

```
claude stream ─▶ Claude adapter ─▶ AgentEvent (+ name/model/effort on agentSpawned, agentReplied with spend,
                 (price table,      summary on toolStarted, command on taskStarted)
                  agent defs)                │ chat.agentEvent
                                             ▼
                  agents main: foldAgentEvent → Roster { agents: RosterAgent[], tasks: RosterTask[] }
                    (finished items kept, outcome set; userMessage drops finished)
                                             │ rosterChanged
                                             ▼
                  agents page: exports roster(sessionId), onRosterChanged ──┬─▶ agent-lines (row part, running only)
                                                                            └─▶ agent-strip (composer part + stop)
chat main: Git.currentBranch at start and on turnEnded ─▶ ChatSessionState.repo/branch ─▶ chat page statusLine part
usage page ─▶ chat.addStatusPart (context, cache, spend);  usage-tab-line ─▶ sessions.addBarPart (same line)
plugin host (main + page): skip ids in settings plugins.disabled; config check rejects a needed dependency
```

Decisions (interview rounds 1–3; the reasons are in `docs/features/chat-bar/design.md` § Decisions):

- The strip lists every subagent and every task of the roster, in start order; not the main agent.
- A subagent box: status dot, name, `model · effort · $cost`, description, latest 3 tool calls. A task box: terminal
  icon, description, owning agent's name or `main`, elapsed time.
- A finished item stays, dimmed with a done or failed dot, until the next `userMessage`.
- Subagent cost: an estimate from reply tokens and a per-model price table in the Claude adapter; no cost for an
  unpriced model.
- Subagent effort: from the agent definition file that names its type; none when no file names one.
- The strip is a stop on the entry cursor: `j` from the last entry enters it, `h`/`l` move, `k` leaves, `i`/`a` focus
  the box, Enter opens a box in place (every tool call; a task's command) and closes it.
- No scroll keys beyond that; `‹ ›` buttons and the trackpad scroll it.
- The status line replaces the composer bar: repo, branch, one model · effort chip (click opens the model picker),
  the permission-mode chip, every other declared control's chip, status parts (usage: context, cache, spend), the
  running dot, Send.
- `plugins.disabled` default: `['agent-lines', 'usage-tab-line']`. Page parts follow it on page load, main parts on
  app start.
- `agents` keeps data and draws nothing; `agent-lines` and `agent-strip` are its views. `usage` keeps data, the
  status-bar line, the right bar and the status part; `usage-tab-line` draws the tab-bar line.
- Chat adds `addStatusPart` beside `addComposerPart`; usage fills it.
- No vim mode label; the cursor shape shows the mode.

Decided by the agent (shown to the user as Decided notices):

- The usage status part carries the cache countdown too, between context and spend, so the default layout keeps every
  number the tab-bar line showed.
- Repo is the git top folder's name; outside git, the session folder's name and no branch.
- Branch re-reads on each `turnEnded`; a detached HEAD shows its short commit.
- The workflow strip stays above the agent strip (plugin start order).
- `G` and a following cursor stay on the last entry; only `j` enters the strip.
- Each tool call carries its agent's id in the roster only; the transcript stays as it is.
- A subagent's model and effort at spawn: the Agent call's own `model` / `effort` input first, then its definition
  file (03). The model the roster shows then follows, each replacing the last: the spawn's value, the launch
  receipt's `resolvedModel`, each reply's model (03). Task 03 probes the Agent call's `name`, `model` and `effort`
  inputs in one stream line before coding.
- A subagent's spend is null when any of its replies used an unpriced model, rather than a partial sum (03).
- A finished task box shows no elapsed time: the roster keeps no end time (09).
- `usage-tab-line` has no layout of its own: it draws usage's session-line part through a usage page export, so the
  line has one look (08).
- `agent-lines` and `agent-strip` each have a main part that only registers their layouts and hands a self-test
  script: only main can register a layout contract (07, 09).
- The strip previews in chat's `Space z l c` sample session, fed by sample agent events from chat's preview (09).
- The status line keeps the `i`/`a` type hint after repo and branch: the key placement check needs their anchors (05).
- The self-test starts every plugin (`plugins.disabled: []`): `applySelfTestConfig` serves `[]` to the page and
  `mainStartList` gives main `[]`; drive runs keep the defaults (01). So agent-lines, usage-tab-line and agent-strip
  start in every self-test run, and 07, 08 and 09 write their steps for that.
- Plugin ids keep their `-` (`agent-lines`, `agent-strip`, `usage-tab-line`): `definePlugin` and the layout service
  accept `[a-z0-9-]` (01).
- The whole self-test run, and with it the end-of-run key placement check, runs only on the user's ask: tasks prove
  their groups with filtered runs, and task 11 lists the whole run for the user's ask (09, 11).
- A late `toolStarted` for a finished subagent changes nothing in the roster (04).
- The strip keeps one HScroller per session across redraws, so the scroll position survives the tick (09).
- A pending reveal jumps; a chevron step and a live reveal scroll smoothly, and every scroll jumps under reduced
  motion (02).

Out of scope: the running-action list and tool counts (another sketch), a live plugin stop/start
(`PluginHost.stop`), stopping a task or opening its output, a per-plugin switch UI beyond the Settings row of
`plugins.disabled`, the tower view.

## File Structure

Each task document's Files line is the full list. Names more than one task uses, exactly:

```ts
// src/contracts/settings.ts — core setting (01)
plugins: { disabled: string[] }   // default ['agent-lines', 'usage-tab-line']

// src/shared/page/ui/h-scroller.ts — primitive (02)
export interface HScroller {
  element: HTMLElement;      // the root: chevrons and the scrolling track
  track: HTMLElement;        // items are appended here by the owner
  reveal(item: HTMLElement): void;   // scrolls `item` fully into view
  refresh(): void;           // re-reads overflow after the owner changed the items; shows or hides each chevron
  dispose(): void;
}
export function createHScroller(): HScroller;

// src/contracts/agent.ts — AgentEvent members (03); task members as the background-tasks plan landed them
| { type: 'agentSpawned'; at: number; agentId: string; parentAgentId: string; agentType: string; description: string;
    name: string; model: string | null; effort: string | null }
| { type: 'agentReplied'; at: number; agentId: string; model: string; spendUsd: number | null }
    // on each subagent reply and on its launch receipt (`resolvedModel`); spend cumulative per agent
| { type: 'toolStarted'; at: number; agentId: string; toolUseId: string; tool: string; summary: string }
| { type: 'taskStarted'; at: number; taskId: string; agentId: string; description: string; command: string | null }

// src/plugins/agents/contract.ts — roster (04); replaces RunningAgent / RunningTask
export type RosterOutcome = 'running' | 'done' | 'failed';
export interface RosterTool { toolUseId: string; tool: string; summary: string; outcome: RosterOutcome }
export interface RosterAgent {
  agentId: string; agentType: string; name: string; description: string; startedAt: number;
  model: string | null; effort: string | null; spendUsd: number | null;
  tools: RosterTool[]; outcome: RosterOutcome;
}
export interface RosterTask {
  taskId: string; agentId: string; description: string; command: string | null; startedAt: number;
  outcome: RosterOutcome;
}
export interface Roster { agents: RosterAgent[]; tasks: RosterTask[] }

// src/plugins/agents/contract.ts — page exports (07)
export interface AgentsPageExports {
  roster(sessionId: string): Roster;                                  // empty roster for an unknown session
  onRosterChanged(listener: (sessionId: string) => void): Disposable;
}

// src/plugins/chat/contract.ts — chat page exports (05, 06)
export interface ChatStatusPart {                                                            // (05)
  id: string;
  build(parent: HTMLElement, sessionId: string): { dispose?(): void };   // ChatComposerPart.build's shape
}   // its own interface, so a status part never carries the `stop` 06 adds to ChatComposerPart
// ChatPageExports gains: addStatusPart(part: ChatStatusPart): Disposable                    (05)
export interface ComposerStop {                                                              // (06)
  // Takes the entry cursor in `sessionId`; false when the part has nothing to select, and `j` stays put.
  enter(sessionId: string, exits: ComposerStopExits): boolean;
  // The cursor left by a chat action (the box took focus, the tab hid); the part drops its selection and scope.
  leave(sessionId: string): void;
}
export interface ComposerStopExits {
  toEntries(): void;                     // back to the last entry, chat's scope in force again
  toBox(how: 'insert' | 'append'): void; // focus the chat box as `i` / `a` do
}
// ChatComposerPart gains: stop?: ComposerStop                                               (06)

// src/contracts/git.ts — (05)
// The branch checked out in the clone holding `folder`; the short commit on a detached HEAD; null in no clone.
currentBranch(folder: string): Promise<string | null>;
```

Plugin ids `agent-lines`, `agent-strip` and `usage-tab-line` are as the docs name them: `definePlugin` and the layout
service accept `[a-z0-9-]` (checked at plan time, § Decided by the agent).

Boundary rules: no Claude field name (`subagent_type`, `parent_tool_use_id`, `task_type`, a model id's price) outside
`src/main/claude-code/`; agent-lines and agent-strip read the roster only through `AgentsPageExports`; chat names no
other plugin; `npm run lint` (layer and style checks) passes, with a `LAYERS` entry for each new plugin folder.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [The plugins.disabled setting](01-plugins-disabled.md)
- [x] [The HScroller primitive](02-hscroller.md)
- [x] [Subagent facts in agent events](03-agent-event-facts.md)

### Wave 2
- [x] [The roster keeps finished items, tools, model, effort and spend](04-roster.md) — after 03
- [x] [Chat status line, branch and status parts](05-status-line.md) — after 03 (shares `chat-sessions.test.ts`)

### Wave 3
- [ ] [A composer part's stop on the entry cursor](06-composer-stop.md) — after 05
- [ ] [The agent-lines plugin, and agents' page exports](07-agent-lines.md) — after 01, 04

### Wave 4
- [ ] [Usage in the status line, and the usage-tab-line plugin](08-usage-split.md) — after 01, 05, 07 (shares the plugin lists)

### Wave 5
- [ ] [The agent-strip plugin](09-agent-strip.md) — after 02, 04, 06, 07, 08 (shares the plugin lists)

### Wave 6
- [ ] [Doc re-read](10-doc-re-read.md) — after 01–09

### Wave 7
- [ ] [Final verification](11-final-verification.md) — after 10

## Run log

Review base: b9ab45db2031275b78977d6ab85e250d4cf49d1f

### Groups
- 02 · 7dab784a · diff read: HScroller interface and createHScroller present in h-scroller.ts; worker's h-scroller-steps test 20 rows pass; no typecheck error in 02's files (03 in flight) · concerns: gallery self-test lines unproven live until the test gate
- 01 · a9fc20b5 · diff read: plugins.disabled in Settings and defaults, startPlugins disabled param, disabledDependencyProblem, mainStartList, applySelfTestConfig serves []; no typecheck error outside 03's in-flight files; worker's 13 test files pass · concerns: the six listed fixture files needed no plugins member (partial casts, compiler flags none); check-layers lets manifests.test.ts import src/config; settings selftest comments renamed to the timeout-reset group
- 03 · 602263b9 · diff read: agentSpawned name/model/effort, agentReplied, toolStarted summary, taskStarted command in agent.ts; whole-tree tsc clean; worker's 23 test files (626 tests) pass · concerns: Done-when grep for installed_plugins.json also hits five pre-existing docs-plugin readers — a second reader of that file now exists beside the new loader, layer rules stop reuse; probe ran a live claude -p haiku turn
- 04 · b7219da4 · diff read: RosterOutcome, RosterTool, RosterAgent, RosterTask, Roster in agents/contract.ts as planned; no typecheck error outside 05's in-flight chat files; worker's 5 test files (71 tests) pass · concerns: Done-when grep for RunningAgent matches three plan-chosen test names; RosterAgent.spendUsd comment says 'estimate of its latest reply' where the value is cumulative
- 05 · c3395ad8 · diff read: Git.currentBranch, ChatStatusPart, ChatPageExports.addStatusPart present; vim-mode-label.ts deleted with no reference left; no typecheck error in 05's files; worker's chat, process-git, layout and selftest-script suites pass · concerns: Git fakes in backlog and docs tests changed outside the Files line; composerBar still named at AGENTS.md:607 and agent-chat/design.md:410, left to task 10
### Contract changes
### Rulings
- refresh sets data-overflow before a pending reveal and before reading back/forward, departing from the task's order, so the At end sample measures the narrowed track — chevron state would be wrong otherwise — cost if wrong: one extra layout read per refresh · group 02 · group 02
- track items get flex: none so a long row scrolls rather than squeezes — cost if wrong: a strip box could not shrink · group 02 · group 02
- disabled parts are dropped before the duplicate-id check, so two disabled parts sharing an id go unreported — cost if wrong: a duplicate id surfaces only when re-enabled · group 01 · group 01
- page config pushes are filtered by wrapping applyPush once with startedPluginsConfig(next, pageLoadList) — cost if wrong: none beyond the wrapper · group 01 · group 01
- on a foreground completion receipt agentReplied comes before agentFinished — cost if wrong: 04's fold must accept a reply for an agent about to finish · group 03 · group 03
- the start.test row 'a message drops a cleared host's finished items' built from its GIVEN/WHEN/THEN (old host has an agent that fails on its sessionEnded, the new host's userMessage drops it), since the step list tested nothing — cost if wrong: none · group 04 · group 04
- peer commit d035a2db (send-now plan) swept 07's staged agents→agent-lines renames; they stay there, 07's commit carries its content edits, and the review range is this run's explicit commit list rather than base..HEAD — cost if wrong: the review misses the pure renames, which carry no content · lead
- group 05's commit c3395ad8 swept the session-titles session's SESSION_TITLE_INSTRUCTION edit in chat/main/start.ts (folder pathspec); that session chose to keep it there, no revert — the review should treat that string as outside this plan · lead
### Review rounds
### Test gate
