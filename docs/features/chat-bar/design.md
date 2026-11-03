# Chat bar — settled design

**Contents**

- **Intent** — what the user watches under the transcript, and why.
- **Vocabulary** — strip, box, activity dock, status line, stop, disabled plugin.
- **The composer, top to bottom** — what draws where, and which plugin draws it.
- **The activity dock** — the running turn and the finished line, in the composer.
- **The agent strip** — the boxes, their lifetime, and the keys.
- **The status line** — repo, branch, controls, usage, send.
- **Subagent facts** — name, model, effort and cost, and where each comes from.
- **Optional plugins** — `plugins.disabled`, and the views that start switched off.
- **Decisions** — what the user settled, with the reason for each.
- **Rejected** — the alternatives weighed and why each lost.

The decisions from the 2026-11-02 interviews, kept so a later change does not reopen them. How each surface looks is in
`DESIGN.md`; the plugin seams are in AGENTS.md § Architecture.

## Intent

The user drives several agents from one Chat tab and wants, beside the box they type in, what the session's helpers
are doing and the session's vital numbers: each running subagent and background task as a small box the cursor can
reach, the main agent's live activity as one dock row that shrinks to a finished line when the turn ends, and one
status line with the repo, the branch, the model and effort, the context used and the money spent.
The sidebar's working line (shown while a session runs a subagent or task) and the tab bar's usage line stay available as plugins the user switches on.

## Vocabulary

- **Agent strip** — the horizontal row of boxes above the Chat composer's box, one box per subagent and per task the
  session's roster lists. Drawn by the `agent-strip` plugin.
- **Box** — one subagent's or one task's card in the strip.
- **Activity dock** — the composer row under the strips that shows the running turn, then the finished turn's one
  line. Drawn by chat's `working` layout part.
- **Status line** — the line under the Chat composer's box that replaces the composer bar.
- **Stop** — a place the chat's entry cursor (`j`/`k`) can rest that is not a transcript entry: a composer part
  offers one (`ChatComposerPart.stop`).
- **Disabled plugin** — a plugin named in the core setting `plugins.disabled`: the plugin host starts no part of it.

## The composer, top to bottom

```
┌ composer (L3 floating) ───────────────────────────────────────────────┐
│ workflow strip                                  workflow (composer part)
│ ‹ [box] [box] [box] … ›                         agent-strip (composer part, with a stop)
│ 1:05 Working…  ┌ 3 latest tool calls ┐ counts   chat (activity dock; one dim line once the turn ends)
│ attachments strip                               chat
│ ┌ box ─────────────────────────────────────┐    chat (no mode label; the cursor shape shows the mode)
│ └──────────────────────────────────────────┘
│ repo · branch · hint · model·effort · controls · [status parts] · ● Send     chat + usage (status part)
└───────────────────────────────────────────────────────────────────────┘
```

- Composer parts draw in plugin start order above the activity dock: the workflow strip, then the agent strip.
- The activity dock is chat's own slot in the composer (`ComposerKit.working`), between the composer parts and the
  attachments.
- The status line is chat's `statusLine` layout part. Chat draws the repo, the branch and the control chips itself;
  other plugins draw into it through chat's page export `addStatusPart`, the same shape as `addComposerPart`. Usage
  draws the context bar, the cache countdown and the spend there.
- Each row hides while it has nothing to show.

## The agent strip

- **What it lists:** every subagent and every task in the session's roster (agents plugin), in start order. A task is
  any process Claude reports that is not a subagent (`agent-tower/design.md` § The agents plugin, Tasks).
- **Every box:** a running dot, a name, a kind tag (Subagent, Background agent or Shell) and the elapsed time since
  it started, ticking once a second, then the description on its own line.
- **A subagent box:** the name is the Agent call's `name` when given, else its agent type. Under the description,
  `model · effort` dim, the latest 3 tool calls as mono lines (the two older ones fading), then a context bar with
  `84k/200k` (the warning colour at 80% or more; `84k` alone until the window is known) and the estimated cost.
  The tag reads Background agent once Claude's launch receipt says the call runs in the background, else Subagent.
- **A task box:** the name is the owning agent's (or `main`), kept on the task when it starts, so it survives that
  agent leaving; the tag reads Shell; the command shows as one mono line. A task has no context or cost.
- **Lifetime:** a box leaves the strip the moment its subagent or task ends, done or failed, and every box leaves
  when the session's process exits. Nothing stays to be closed, so the strip has no close control.
- **Scrolling:** the strip scrolls sideways; `‹` and `›` buttons at its ends scroll it by one box and hide when there
  is nothing further that way. The trackpad scrolls it too.
- **Keys:** the strip is a stop in the chat's entry cursor. `j` on the entry cursor's last stop (the newest pending
  row, else the last entry or an open last run's last step) selects the strip's first box; the strip then holds its own key scope: `h`/`l` move between boxes, `k` returns to the last entry, `i` and `a` focus the chat box, Enter opens the selected box in place to list every tool call of that
  subagent (a task shows its command), and Enter again closes it. `G` and a following cursor stay on the last entry,
  so new output never moves the cursor into the strip. The selected box takes the focus ring.

## The activity dock

- **While a turn runs:** the turn's time `m:ss` and its state word (`1:05 Working…`), the main agent's latest 3 tool
  calls (the newest in `fg`, older ones dim, a failed one in the error colour), and the main agent's tool counts. It
  replaces the working block that sat under the transcript's last entry.
- **When the turn ends:** one dim line, `Done · 1m 05s · $0.57 · Bash 6 · Read 2`, kept until the user sends the next
  message; the next turn's live dock then takes its place. Idle with no finished turn, the dock takes no space.
- **Main agent only:** a subagent's tool calls show in its strip box, not in the dock.
- **Display only:** the dock is not a stop and has no keys.
- **The transcript shows messages only:** the default chat layout sets `activityInTranscript` to `false`, so the
  activity lines, their steps and the `result` entries leave the transcript and the entry cursor. A user layout that
  sets it `true` brings them back. The rules for the dock's lines are in `agent-chat/design.md` § Activity dock.

## The status line

- **Type hint:** the `i`/`a` keys that focus the box, after the repo and branch.
- **Repo:** the name of the session folder's git top folder; outside git, the folder name, and no branch.
- **Branch:** the current branch, or the short commit on a detached HEAD. Chat main reads it through the Git
  service's `currentBranch` when the session starts and again when each turn ends.
- **Model · effort:** one chip for the two controls; a click opens the model picker, and `o` and `e` keep their
  pickers. The permission-mode chip follows it. Every other control the harness declares keeps its own chip.
- **Usage:** the usage plugin's status part: the context bar against the autocompact limit, the cache countdown and the
  session spend, dropping whole items from the end in a narrow composer as the tab-bar line did.
- **Running dot and Send** close the line.

## Subagent facts

Only the Claude adapter knows Claude's shapes, so it alone fills these into agent events:

- **Name:** the Agent call's `name` input, else its `subagent_type`.
- **Model:** the model of the subagent's latest reply; before its first reply, the Agent call's `model` input, else
  the `model` its agent definition names.
- **Effort:** the Agent call's `effort` input, else the `effort` its agent definition names; none when neither names
  one. Definitions are the agent
  `.md` files in the project's `.claude/agents/`, the profile's `agents/`, and each installed plugin's `agents/`,
  matched on the agent type (`plugin:name` for a plugin's agent).
- **Cost:** an estimate: the subagent's reply token usage (input, output, cache write by TTL, cache read) priced by a
  per-model list-price table in the adapter. A subagent with any reply on a model the table lacks shows no cost. The session's own spend stays
  Claude's `total_cost_usd`.
- **Tool calls:** each tool call carries the id of the agent that made it, in the agent events and on the chat's
  `tool` entry (`agentId`), so a box lists its own calls and the activity dock lists the main agent's alone.

## Optional plugins

- The core setting `plugins.disabled` lists plugin ids the plugin host does not start. Its default lists
  `agent-lines` and `usage-tab-line`. Settings mode shows it.
- Turning a plugin off takes effect for its page part on the next page load and for its main part on the next app
  start; turning one on takes effect on the next app start, since a page part never starts without its main part (the
  page reads the union of the setting and main's start list). A plugin that another started plugin depends on cannot
  be disabled: the config check reports it as a config problem and keeps the last good config.
- `agents` keeps the roster, the event log and its channel, and draws nothing. `agent-lines` draws the sidebar's working line;
  `agent-strip` draws the strip. Both read the agents roster.
- `usage` keeps the polls, the status-bar plan line, the right bar and the status part. `usage-tab-line` draws usage's
  own session-line part in each tab bar, so the line has one look.

## Decisions

- **The strip shows subagents and tasks, not the main chat.** The main agent's work is the activity dock.
- **The live activity sits in the composer, and the transcript shows messages.** The user reads the conversation in
  the transcript and glances at the dock for what the agent does now; the steps and turn results stay one layout
  flag away (`activityInTranscript`). Settled in the second 2026-11-02 interview (`plan-activity-dock/`).
- **The dock keeps the `working` layout part.** Its slot moved into the composer; the part's name and signature
  stayed, so a user layout's `working` part draws the dock.
- **Views are plugins the user switches off.** A view and its data split: the data plugin stays on, each view is its
  own plugin, so turning one view off never starves another (the follow-up's "a behaviour is a plugin to enable").
- **A disable list read at start, not a live stop.** A live `PluginHost.stop` is a framework change of its own; the
  setting is the switch it will act on when it lands. Live on/off is its own feature plan, built on the tracked
  unloading follow-ups (`docs/features/followups.md` § Extensibility review: Unloading and reload); the user chose
  this on 2026-11-02.
- **The strip joins the entry cursor through a general stop.** Any composer part may offer one, so chat names no
  plugin.
- **Every box leaves when its process ends, failed ones included.** The user wants the strip to show only live work
  and to close nothing by hand; a failure still shows in the transcript. Chosen on 2026-11-03, replacing the earlier
  rule that kept failed boxes until the next message.
- **A box shows its kind, runtime, context and cost.** The user wants to tell a subagent, a background agent and a
  shell apart at a glance, and to watch each agent's context fill and spend (design A, 2026-11-03).
- **Subagent context is its latest reply's prompt tokens over its model's window.** Input, cache write and cache
  read of that reply; Claude names a model's window only in a turn result's `modelUsage`, so the adapter learns it
  there and sends it on the subagent's next `agentReplied`, or at once to every running subagent on that model.
- **Subagent cost is estimated in dollars from tokens.** Claude reports cost only per process.
- **The status line replaces the composer bar.** One line; model and effort share one chip.
- **The tab-bar usage line and the sidebar's working line start switched off**, one setting away.
- **No vim mode label.** The cursor shape already shows the mode: a block in normal and visual, a bar in insert.

## Rejected

- **A setting inside the plugin that draws a view** (`agents.sideBarLines`) — the user wants behaviours to be plugins.
- **Chat reading usage and agents data itself** — chat would name other plugins; parts keep each plugin drawing what
  it owns.
- **A leader key or scroll chords for the strip** — the user wanted the strip on the `j`/`k` cursor with `h`/`l`.
- **Moving the tab-bar line wholesale** — the Form and Primer tabs would lose it with no way back.

The first interview rejected a running-action list and tool counts above the composer as another sketch's; the second
interview took them up as the activity dock (`plan-activity-dock/`), so that rejection no longer holds.
