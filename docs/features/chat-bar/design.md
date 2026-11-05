# Chat bar — settled design

**Contents**

- **Intent** — what the user watches under the transcript, and why.
- **Vocabulary** — strip, box, activity dock, status line, stop, disabled plugin.
- **The composer, top to bottom** — what draws where, and which plugin draws it.
- **The session hub** — the sections beside the transcript, who draws each, and when the hub hides.
- **The activity dock** — the running turn and the finished line, in the hub, and its one line in the composer.
- **The agent strip** — the cards and rows, their lifetime, and the keys.
- **The context line** — context and cache, above the box.
- **The status line** — repo, branch, controls, spend, send.
- **Subagent facts** — name, model, effort and cost, and where each comes from.
- **Optional plugins** — `plugins.disabled`, and the views that start switched off.
- **Decisions** — what the user settled, with the reason for each.
- **Rejected** — the alternatives weighed and why each lost.

The decisions from the 2026-11-02 interviews, kept so a later change does not reopen them. How each surface looks is in
`DESIGN.md`; the plugin seams are in AGENTS.md § Architecture.

## Intent

The user drives several agents from one Chat tab and wants, beside the box they type in, what the session's helpers
are doing and the session's vital numbers: each running subagent as a card and each background task as a one-line row
the cursor can reach, the context used and the cache countdown directly over the box, and one status line with the
repo, the branch, the model and effort and the money spent. Beside the transcript, the session hub collects what the
user checks about the session: the main agent's live activity, the plan, the skills loaded and the session's facts.
The sidebar's working line (shown while a session runs a subagent or task) and the tab bar's usage line stay available as plugins the user switches on.

## Vocabulary

- **Agent strip** — the boxes above the Chat composer's box, one box per subagent and per task the session's roster
  lists. Drawn by the `agent-strip` plugin.
- **Box** — one subagent's card or one task's row in the strip.
- **Session hub** — the column of side parts beside a Chat tab's transcript (chat's `addSidePart`), each drawn in a
  titled section. The hub is the column; a **section** is one part with its frame.
- **Activity dock** — the running turn, then the finished turn's one line, drawn by chat's `working` layout part in the
  hub's Main agent section.
- **Activity line** in the composer — chat's `workingLine` layout part: the dock's time and state on one line, shown
  only while the hub is not visible. (`agent-chat/design.md` § Activity line names a different thing: a run of steps in
  the transcript.)
- **Turn line** in the transcript — the same `workingLine` part under the last entry: the time and state while the turn
  runs, dim, shown only while the hub is visible, and never the finished line.
- **Context line** — the session's context bar and cache countdown above the box, drawn by the `usage` plugin.
- **Status line** — the line under the Chat composer's box that replaces the composer bar.
- **Stop** — a place the chat's entry cursor (`j`/`k`) can rest that is not a transcript entry: a composer part
  offers one (`ChatComposerPart.stop`).
- **Disabled plugin** — a plugin named in the core setting `plugins.disabled`: the plugin host starts no part of it.

## The composer, top to bottom

```
┌ composer (L3 floating) ───────────────────────────────────────────────┐
│ workflow strip                                  workflow (composer part)
│ ‹ [card] [card] … ›                             agent-strip (composer part, with a stop)
│ ● Shell  npm test -- chat-row-clock      3m 05s agent-strip (one row per task, in the same part)
│ ▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂  58k/300k  cache 59m    usage (composer part)
│ 1:05 Working…                                   chat (activity line; only while the hub is not visible)
│ attachments strip                               chat
│ ┌ box ─────────────────────────────────────┐    chat (no mode label; the cursor shape shows the mode)
│ └──────────────────────────────────────────┘
│ repo · branch · hint · model·effort · controls · [status parts] · ● Send     chat + usage spend (status part)
└───────────────────────────────────────────────────────────────────────┘
```

- Composer parts draw in plugin start order above the activity line: the workflow strip, the agent strip, then the
  context line.
- The activity line is chat's own slot in the composer (`ComposerKit.working`), between the composer parts and the
  attachments.
- The status line is chat's `statusLine` layout part. Chat draws the repo, the branch and the control chips itself;
  other plugins draw into it through chat's page export `addStatusPart`, the same shape as `addComposerPart`. Usage
  draws the spend there.
- Each row hides while it has nothing to show.

## The session hub

```
.chat-tab  (inline-size container)
├── .chat-main        entries + floating composer
└── .chat-side-parts  264 px wide until the user drags it
      ▾ Main agent   2:05     chat: the activity dock
      ▾ Plan         5/7      workflow: the side pane (`workflow/design.md` § Where it draws)
      ▾ Skills       4        agent-skills: each skill the main agent started
      ▾ Session               chat: project, branch, folder, harness, model · effort
```

- **A side part** declares a `title` and an `order`. Chat sorts the sections by `order` and draws each one's frame
  through the chat layout's `sideSection` part. The orders: Main agent 10, Plan 20, Skills 30, Session 40.
- **A section's frame:** its title, the summary its part sets (the turn's time, `5/7`, the skill count), and a chevron
  that collapses it. A click on the title toggles the section. Collapsed sections are kept in `uiState` by part id and
  apply to every session. A section takes no key and no focus.
- **Height:** Main agent always shows whole at its own height, which the dock bounds: about 60 px idle, about 155 px
  running. Plan, Skills and Session each take their content's height. When the column is too short they share what is
  left by their content's height, and each scrolls in its own body and keeps its whole head, down to the head alone.
  Plan's action buttons stick to the section's bottom over a task list of at least two rows, or its own height when it
  holds less, so a short list leaves no blank. With a long plan and three
  buttons in the 264 px hub, all three show down to a window about 390 px high, about 490 px during a running turn. Below
  that the section's scroll reaches them, while it has any body left: during a running turn at the 360 px minimum height
  it has none. A section whose part draws nothing hides.
- **When the hub shows:** every Chat tab, in every pane, while its width is at least 640 px and the user has not hidden
  it. `Space v s` hides or shows it in every session, and the choice survives a relaunch. `Space w s` still hides only
  the plan's side pane.
- **Width:** a drag on the hub's start edge sets it, at least 200 px and always leaving the transcript 320 px, in every
  session, kept in `uiState` as `hub-width` across a relaunch. No key moves it: `Alt+Shift+h`/`l` stay with the chat panes'
  dividers.
- **Plan:** the section is the workflow plugin's side pane, unchanged in what it draws. It draws from the first read of
  a plan until Dismiss or a new plan, so the section hides at every other time.
- **Skills:** the skills the main agent started in this row's session, by a Skill call or a typed slash command (the
  `skillStarted` agent event): one row per skill, in start order, showing only its name, a project-scoped skill's without
  its folder path; the summary counts skills. A subagent's skills stay in the roster and are not listed. A skill's row
  stays through a compaction, the agent's end and a `/clear`, until the session's row ends. After an app relaunch a re-attached process's
  log brings its skills back, and a resumed session's list starts empty, because the roster is not saved. It does not say the skill's text is still in the agent's context.
- **Session:** the repo name, the branch (left out when none), the session folder with the home folder as `~`, the
  harness id and the model · effort. These read chat's own state, so chat names no other plugin. The spend stays in the
  status line.

## The agent strip

- **What it lists:** every subagent as a card, in start order, then every task as a row under the cards, in start
  order. A task is any process Claude reports that is not a subagent (`agent-tower/design.md` § The agents plugin,
  Tasks).
- **A subagent card:** a running dot, a name, a kind tag (Subagent or Background agent) and the elapsed time since it
  started, ticking once a second, then the description on its own line. The name is the Agent call's `name` when given,
  else its agent type. Under the description, `model · effort` dim, the latest 3 tool calls as mono lines (the two older
  ones fading), then a context bar with `84k/200k` (the warning colour at 80% or more; `84k` alone until the window is
  known) and the estimated cost. The tag reads Background agent once Claude's launch receipt says the call runs in the
  background, else Subagent.
- **A task row:** one line: a running dot, the Shell tag, the command in mono (the Task tag and the description when the
  harness names no command) and the elapsed time. A task has no context or cost. Rows stack under the cards and scroll
  past four rows.
- **Lifetime:** a box leaves the strip the moment its subagent or task ends, done or failed, and every box leaves
  when the session's process exits. Nothing stays to be closed, so the strip has no close control.
- **Scrolling:** the cards scroll sideways; `‹` and `›` buttons at their ends scroll by one card and hide when there
  is nothing further that way. The trackpad scrolls it too. An open box's tool list keeps its scroll as the box redraws while the strip shows; a redraw in a hidden tab, or a rebuilt composer, starts the list at the top.
- **Keys:** the strip is a stop in the chat's entry cursor. `j` on the entry cursor's last stop (the newest pending
  row, else the last entry or an open last run's last step) selects the strip's first box; the strip then holds its own key scope: `h`/`l` move through the cards and then the rows, `k` or Esc returns to the last stop, `i` and `a` focus the chat box, Enter opens the selected box in place to list every tool call of that
  subagent (a task row wraps its whole command over its owner and description), and Enter again closes it. `G` and a following cursor stay on the last entry,
  so new output never moves the cursor into the strip. The selected box takes the focus ring.

## The activity dock

- **While a turn runs:** the turn's time `m:ss` and its state word (`1:05 Working…`), the main agent's latest 3 tool
  calls (the newest in `fg`, older ones dim, a failed one in the error colour), and the main agent's tool counts. It
  replaces the working block that sat under the transcript's last entry.
- **When the turn ends:** one dim line, `Done · 1m 05s · $0.57 · Bash 6 · Read 2`, kept until the user sends the next
  message; the next turn's live dock then takes its place. Idle with no finished turn, the dock takes no space.
- **Main agent only:** a subagent's tool calls show in its strip box, not in the dock.
- **Display only:** the dock is not a stop and has no keys.
- **Where it shows:** in the hub's Main agent section, whose summary is the turn's time while the turn runs. While the
  hub is not visible, the composer's activity line shows the same time and state (`1:05 Working…`), or the finished line
  once the turn ends. While the hub is visible, the transcript's turn line shows that time and state under the last
  entry, ahead of any pending rows, and hides once the turn ends. All of them read one dock, so they cannot disagree.
  CSS alone picks which line shows, so no code measures the Chat tab.
- **The transcript shows messages and turn dividers:** the default chat layout sets `activityInTranscript` to `false`,
  so the activity lines and their steps leave the transcript and the entry cursor. A user layout that sets it `true`
  brings them back. Each `result` entry stays as a dim turn divider, so a turn's end shows with no user message after it. The rules for the dock's lines are in `agent-chat/design.md` § Activity dock.

## The context line

The usage plugin's composer part: the context bar stretched across the composer against the autocompact limit, its
`used/limit` text and the cache countdown. While the session compacts, it opens with the `compacting` chip and its bar
pulses. A session with no usage draws its zero line, `0k`.

## The status line

- **Type hint:** the `i`/`a` keys that focus the box, after the repo and branch.
- **Repo:** the name of the session folder's git top folder; outside git, the folder name, and no branch.
- **Branch:** the current branch, or the short commit on a detached HEAD. Chat main reads it through the Git
  service's `currentBranch` when the session starts and again when each turn ends.
- **Model · effort:** one chip for the two controls; a click opens the model picker, and `o` and `e` keep their
  pickers. The permission-mode chip follows it. Every other control the harness declares keeps its own chip.
- **Spend:** the usage plugin's status part: the session spend alone.
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
  `agent-strip` draws the strip; `agent-skills` draws the hub's Skills section. All three read the agents roster.
- `usage` keeps the polls, the status-bar plan line, the right bar, the context line and the spend status part.
  `usage-tab-line` draws usage's own whole session-line part (context, cache and spend) in each tab bar.

## Decisions

- **The strip shows subagents and tasks, not the main chat.** The main agent's work is the activity dock.
- **The live activity sits in the hub, and the transcript shows messages.** The user reads the conversation in the
  transcript and glances at the hub for what the agent does now; the steps stay one layout flag away
  (`activityInTranscript`). The dock moved from the composer to the hub on 2026-11-03, with the plan steps beside it.
- **The hub is one column per Chat tab, not one right bar.** The user chose this over a right bar that follows the
  focused pane, so every split pane shows its own session's hub, at the cost of each pane's width.
- **The composer keeps one activity line while the hub is not visible.** A narrow split hides the hub, and without
  the line it would show no timer, as it did before the move.
- **The hub shows no thinking text.** The Claude stream sends thinking blocks with empty text
  (`agent-chat/claude-stream.md`), and the CLI has no flag that sends it, so the state word `Thinking…` stands for it.
- **The dock keeps the `working` layout part.** It draws in the Main agent section now; the part's name and signature
  stayed, so a user layout's `working` part draws the dock.
- **Sections are side parts, in chat.** Every section's plugin already depends on chat, as the composer parts do. A
  plugin of its own for the hub could not be switched off once chat and workflow depended on it.
- **Only task boxes became rows.** A background agent keeps its card: it has tool calls and a context meter to show,
  and a task has neither.
- **Spend stays in the status line.** The context line holds what the user watches while typing; a Session row for the
  spend would make chat read usage's data.
- **The 5h and Week limits stay in the usage details.** They are the account's, not the session's.
- **Views are plugins the user switches off.** A view and its data split: the data plugin stays on, each view is its
  own plugin, so turning one view off never starves another (the follow-up's "a behaviour is a plugin to enable").
- **A disable list read at start, not a live stop.** A live `PluginHost.stop` is a framework change of its own; the
  setting is the switch it will act on when it lands. Live on/off is its own feature plan, built on the tracked
  unloading follow-ups (`docs/features/followups.md` § Extensibility review: Unloading and reload); the user chose
  this on 2026-11-02.
- **The strip joins the entry cursor through a general stop.** Any composer part may offer one, so chat names no
  plugin.
- **Every box leaves when its process ends, failed ones included.** The user wants the strip to show only live work
  and to close nothing by hand. Under the default layout a failed Agent call shows only as a failed line in the activity
  dock while it is among the latest 3, and a failed background shell has no surface of its own: either reaches the
  transcript only when the main agent says so. Chosen on 2026-11-03, replacing the earlier rule that kept failed boxes
  until the next message.
- **A box shows its kind, runtime, context and cost.** The user wants to tell a subagent, a background agent and a
  shell apart at a glance, and to watch each agent's context fill and spend (design A, 2026-11-03).
- **Subagent context is its latest reply's prompt tokens over its model's window.** Input, cache write and cache
  read of that reply; Claude names a subagent's model's window only in a turn result's `modelUsage`, so the adapter learns it
  there and sends it on the subagent's next `agentReplied`, or on that `result` to every subagent still running whose model's
  window it changed. A foreground subagent of the main agent is failed at the `result` first, so it gets the window
  only from an earlier result.
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
- **The hub in the right bar** — only the focused pane's session could show there, and the user wanted every pane's.
- **A live thinking token count** (`Thinking… ~1.2k tokens`) — the user took the moved dock with nothing new; the count
  stays available from the adapter's `thinking_tokens` events if long thinks feel opaque.

The first interview rejected a running-action list and tool counts above the composer as another sketch's; the second
interview took them up as the activity dock (`plan-activity-dock/`), so that rejection no longer holds.
