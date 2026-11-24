# Auri

**Contents**

- **Status** — what in this README is planned and not built yet.
- **What Auri is** — the app, and the agent plugin it ships.
- **Requirements** — the programs the app and its plugin run.
- **Install the app** — build and install the stable app, or run the dev app.
- **The auri agent plugin** — how app sessions get it, and installing it for terminal Claude Code and Codex.
- **Binding features with auri.json** — what a plugin's contributions turn on.
- **Settings** — where settings live, and every setting path.
- **Built-in plugins** — every plugin the app ships.
- **MCP tools** — every tool the `auri` server offers.
- **Skills** — the `auri` plugin's skills.
- **Hooks** — the `auri` plugin's hooks.
- **Data folders** — where the app keeps rounds, primers and its endpoint.
- **License**

## Status

Planned in `shareable-app`, not built yet: the app's own repo at the clone URL below (task 17's split). Everything
else in this README is built.

## What Auri is

Auri is a desktop app (Electron, macOS and Windows) for running and answering coding-agent sessions. It starts Claude
Code sessions and chats with them, shows each session's workflow, step and checklist, and opens a popup over a session
whenever its agent asks the user something: a forms round of questions and review findings, a primer, an audio
picker. It also browses every agent doc on the machine, runs scheduled tasks, keeps a backlog of follow-ups across
repos, and hosts a chatroom per project where sessions and the user talk.

The app ships its own agent plugin, `auri`. The plugin carries the MCP server that connects a session to the app, the
hooks the app's features need, and skills that teach an agent each feature. Everything personal — a workflow's
stages, a retro command, where follow-ups live — comes from another plugin's `auri.json`, and a feature shows an
empty state until a plugin binds it.

The app shows as Auri. Its executable, bundle and every path keep the name `wigley-ai-gui`.

## Requirements

- macOS or Windows.
- Node.js at the version in `.nvmrc`, for building the app.
- The Claude Code CLI (`claude`) on `PATH` or in `~/.local/bin`, or named by the `claude-code.command` setting.
- Python 3 with the standard library only: the MCP relay, the hooks and the docs index run on it. The
  `programs.python` setting names it when the default lookup does not find it.
- git.
- The GitHub CLI (`gh`), logged in, for the Board's suggested moves from pull requests; without it those suggestions
  are skipped.

## Install the app

1. Clone the repo and work from its root:

   ```
   git clone git@github.com:JonathonWigley/wigley-ai-gui.git
   cd wigley-ai-gui
   ```

   The repo may be private: a clone then needs read access from its owner.

2. Select the Node.js version in `.nvmrc`, then run `npm ci` to install the build dependencies. On macOS and Linux,
   `nvm use` reads `.nvmrc`. On Windows, nvm-windows does not read it: run `nvm install <version>` and
   `nvm use <version>` with the version the file holds.
3. On a Mac, once per machine: `npm run create-signing-identity`. It makes a self-signed certificate in a keychain of
   its own, so macOS keeps the app's privacy grants across rebuilds. When macOS asks for Documents access on the first
   start, answer Allow: a denied grant makes every session under `~/Documents` exit with `EPERM`.
4. `npm run install-app`. It builds `main` (`-- --ref <ref>` builds another committed ref) in a build-only worktree,
   installs it as `/Applications/wigley-ai-gui.app` on macOS or under `%LOCALAPPDATA%\Programs\wigley-ai-gui\` on
   Windows, and restarts the app when it was running. Running sessions keep going.
5. Check that it works. Start Auri, start a session in any project folder, and ask its agent to send a forms round
   with one notice: the round opens as a popup over the session and returns when submitted. Settings lists each
   feature an `auri.json` can bind, and each shows its empty state until an installed plugin binds it.

`npm start` runs the dev app beside the stable one, shown as Auri Dev, with its own user data and relay endpoint
(`~/.agents/wigley-ai-gui-dev/`). Both share the user config folder.

Checks: `npm run typecheck`, `npm run lint` (which runs `npm run lint:changelog` and `npm run lint:boundary`),
`npm test`, `npm run selftest`. Before landing on `main`, `npm run changelog:release` moves the `## Unreleased`
entries of `CHANGELOG.md` under a version heading and bumps the version in `package.json` and both plugin
manifests.

## The auri agent plugin

- **Sessions the app starts** get the plugin with no install step: the app passes `--plugin-dir <app>/agent-plugin`
  and `--permission-prompt-tool mcp__plugin_auri_auri__permission_prompt` to every Claude Code session it launches,
  and sets `WIGLEY_SESSION_ROW` and `WIGLEY_AI_GUI_ENDPOINT_DIR` on it.
- **Terminal Claude Code sessions** install it from this repo's marketplace file:

  ```
  claude plugin marketplace add <path to this clone>
  claude plugin install auri@auri
  ```

  `marketplace add` reads `.claude-plugin/marketplace.json` at the clone's root: the marketplace `auri`, which lists
  the plugin `auri` at `./agent-plugin`. The plugin's version, in both its manifests, is the app's `package.json`
  version. A terminal session reaches the stable app through the relay, which starts the app when it is not
  running. Rounds work; the checklist gate does not apply outside the app. The install goes into the profile
  `CLAUDE_CONFIG_DIR` names (default `~/.claude`): run both commands once more with `CLAUDE_CONFIG_DIR` set for each
  other profile, unless that profile's `plugins` folder links to one that already has it.

- **Codex** reads the plugin's Codex manifest, `agent-plugin/.codex-plugin/plugin.json`, and this repo's
  `.claude-plugin/marketplace.json` as a legacy-compatible marketplace file. Add the marketplace with
  `codex plugin marketplace add <path to this clone>`, then install `auri` from the Plugins directory. To enable it
  for one project instead, set `[plugins."auri@auri"]` to `enabled = true` in that repo's `.codex/config.toml`.
  Codex's docs name no command-line install for a plugin, so none is given here.
- **Tool names.** Claude Code names the tools `mcp__plugin_auri_auri__<tool>` and Codex `mcp__auri__<tool>`, so
  skills name each tool by server and bare name ("the `auri` server's `ask_round` tool"). To pre-approve every tool
  in Claude Code, add `"mcp__plugin_auri_auri__*"` under `permissions.allow` in the profile's `settings.json`. That
  also approves `start_session` and `run_command`, which start sessions and run app commands; the app's own
  Allow or Deny round still gates a risky command.

The relay, endpoint and start scripts and their full contract are in `agent-plugin/scripts/relay/` and its
`README.md`. To start or restart the app by hand: `python3 agent-plugin/scripts/relay/start_app.py` (`--restart`,
`--dev`, `--from <folder>`).

## Binding features with auri.json

Any installed agent plugin may hold an `auri.json` at its root. It binds these features:

| Key          | Feature                                                   | How it runs                                      |
| ------------ | --------------------------------------------------------- | ------------------------------------------------ |
| `workflows`  | declared workflows: stages, steps, actions, side pane     | each one on unless switched off (`workflow.off`) |
| `planFormat` | how a workflow's plan file is read                        | per workflow, from its own plugin                |
| `retro`      | a background retro after each ended conversation          | one plugin at a time (`auto-retro.strategy`)     |
| `backlog`    | where follow-up files live                                | one plugin at a time (`backlog.strategy`)        |
| `docs`       | the docs index's global folders, wiki page, skill links   | every plugin merged                              |
| `liveView`   | commands that open and close the Live view, and its probe | every plugin merged                              |

With no plugin binding a feature, it shows its empty state. A bad file shows a config problem in the title bar,
naming the plugin. The `auri` plugin's `writing-auri-json` skill is the guide for writing one, and
`docs/features/feature-contributions/design.md` is the full contract. The app writes the file's JSON schema to
`~/.config/wigley-ai-gui/plugins/_types/auri.schema.json` at each start.

## Settings

Settings live in `~/.config/wigley-ai-gui/settings.json`, shared by the stable and dev apps, and change live. Settings
mode edits every one. In the file, a plugin's setting nests under its plugin id: `auto-retro.strategy` is
`{ "auto-retro": { "strategy": "" } }`. Every plugin's `layout` setting names a layout folder under
`~/.config/wigley-ai-gui/layouts/<plugin>/`, or `default`.

Core:

- `window.width`, `window.height`, `window.minWidth`, `window.minHeight` — the window's size and minimum size.
- `theme`, `transparency` — the theme, and `system`, `full` or `reduced` transparency.
- `fonts.ui`, `fonts.mono`, `fonts.uiSize`, `fonts.monoSize`, `fonts.proseSize` — font families and sizes.
- `keySequenceTimeoutMs` — how long a key sequence waits for its next key.
- `shell.layout` — the shell's layout.
- `plugins.disabled` — plugin ids the app does not run. Default: `agent-lines`, `usage-tab-line`,
  `docs-session-tab`, `unity-pool`.
- `programs.python` — the Python the docs index and unity-pool run.

By plugin:

| Plugin            | Settings                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`        | `sessions.layout`, `sessions.titleMaxLength`                                                                                                                                                                                                                                                                                                 |
| `claude-code`     | `claude-code.command`, `claude-code.profiles`                                                                                                                                                                                                                                                                                                |
| `forms`           | `forms.autosaveDelayMs`, `forms.deadlineSeconds`, `forms.layout`                                                                                                                                                                                                                                                                             |
| `primer`          | `primer.autosaveDelayMs`, `primer.deadlineSeconds`, `primer.layout`                                                                                                                                                                                                                                                                          |
| `audio-picker`    | `audio-picker.autosaveDelayMs`, `audio-picker.deadlineSeconds`, `audio-picker.layout`                                                                                                                                                                                                                                                        |
| `chat`            | `chat.projects`, `chat.layout`, `chat.keepIdleMinutes`, `chat.completionDescriptions`, `chat.defaultHarness`                                                                                                                                                                                                                                 |
| `auto-compact`    | `auto-compact.minTokens`, `auto-compact.agentWaitMinTokens`                                                                                                                                                                                                                                                                                  |
| `session-stash`   | `session-stash.layout`                                                                                                                                                                                                                                                                                                                       |
| `session-log`     | `session-log.recentlyClosedCount`                                                                                                                                                                                                                                                                                                            |
| `auto-retro`      | `auto-retro.strategy`, `auto-retro.layout`, `auto-retro.settleSeconds`                                                                                                                                                                                                                                                                       |
| `agent-lines`     | `agent-lines.layout`                                                                                                                                                                                                                                                                                                                         |
| `agent-strip`     | `agent-strip.layout`                                                                                                                                                                                                                                                                                                                         |
| `agent-skills`    | `agent-skills.layout`                                                                                                                                                                                                                                                                                                                        |
| `context-sources` | `context-sources.layout`                                                                                                                                                                                                                                                                                                                     |
| `live-view`       | `live-view.frameRate`, `live-view.layout`                                                                                                                                                                                                                                                                                                    |
| `chatroom`        | `chatroom.bodyCap`, `chatroom.postsPerMinute`, `chatroom.claimMinutes`, `chatroom.layout`                                                                                                                                                                                                                                                    |
| `keys`            | `keys.whichKeyDelayMs`, `keys.whichKeyTimeoutMs`, `keys.showHints`, `keys.layout`                                                                                                                                                                                                                                                            |
| `docs`            | `docs.scriptPath`, `docs.layout`, `docs.recentChangesLimit`                                                                                                                                                                                                                                                                                  |
| `gallery`         | `gallery.layout`                                                                                                                                                                                                                                                                                                                             |
| `settings`        | `settings.layout`                                                                                                                                                                                                                                                                                                                            |
| `scoped-agents`   | `scoped-agents.layout`                                                                                                                                                                                                                                                                                                                       |
| `backlog`         | `backlog.strategy`, `backlog.tags`, `backlog.layout`, `backlog.launchBrief`, `backlog.repoFolders`                                                                                                                                                                                                                                           |
| `work`            | `work.profile`, `work.intervalMinutes`, `work.lookbackHours`, `work.channels`, `work.broadcastChannels`, `work.keywords`, `work.stallHours`, `work.jiraQuery`, `work.columns`, `work.signals.branch`, `work.signals.commit`, `work.signals.pr_opened`, `work.signals.pr_merged`, `work.signals.session`, `work.repoFolders`, `work.projects` |
| `work-inbox`      | `work-inbox.layout`                                                                                                                                                                                                                                                                                                                          |
| `work-board`      | `work-board.layout`                                                                                                                                                                                                                                                                                                                          |
| `notes`           | `notes.launchBrief`, `notes.autosaveDelayMs`, `notes.layout`                                                                                                                                                                                                                                                                                 |
| `practice`        | `practice.folder`, `practice.compiler`, `practice.flags`, `practice.timeLimitMs`, `practice.reviewSteps`, `practice.layout`                                                                                                                                                                                                                  |
| `usage`           | `usage.pollIntervalSeconds`, `usage.layout`                                                                                                                                                                                                                                                                                                  |
| `workflow`        | `workflow.off`, `workflow.autoStart`, `workflow.layout`                                                                                                                                                                                                                                                                                      |
| `unity-pool`      | `unity-pool.scriptPath`, `unity-pool.layout`                                                                                                                                                                                                                                                                                                 |
| `system-stats`    | `system-stats.refreshSeconds`, `system-stats.processRows`, `system-stats.layout`                                                                                                                                                                                                                                                             |
| `visual`          | `visual.layout`                                                                                                                                                                                                                                                                                                                              |
| `builds`          | `builds.backends`, `builds.layout`                                                                                                                                                                                                                                                                                                           |
| `scheduling`      | `scheduling.layout`                                                                                                                                                                                                                                                                                                                          |
| `demo`            | `demo.layout`, `demo.autoplaySeconds`                                                                                                                                                                                                                                                                                                        |
| `app-update`      | `app-update.layout`                                                                                                                                                                                                                                                                                                                          |

Settings worth setting first:

- `claude-code.profiles` — the Claude Code profiles a session can start in: a name and its config folder each.
- `chat.projects` — the projects the start prompt offers: a name and a folder each.
- `auto-retro.strategy`, `backlog.strategy` — `''` picks the one installed strategy, or shows a choice when several
  are installed.
- `workflow.off` — qualified workflow ids (`<plugin>:<id>`) to switch off. `workflow.autoStart` lists
  `{ "workflow", "seconds" }` records whose stages run their `auto` action after a countdown.
- `unity-pool.scriptPath` — the `unity-pool` script the Unity pool panel runs. The plugin is off by default: remove
  `unity-pool` from `plugins.disabled` to use it.
- `builds.backends` — the build backends this machine uses (`teamcity` or `local`), each with the games it
  tracks, their build kinds and their sets. An agent adds a game on the user's ask.
- `docs.scriptPath` — empty runs the app's own `agent-plugin/scripts/docs-index/docs_index.py`.

## Built-in plugins

Every feature is a plugin in `src/plugins/<id>/`. Settings mode's Plugins section switches each one on or off.

| Plugin             | What it does                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`         | Sessions mode, with a side bar row for each agent session beside its panes and tabs.                                                                                   |
| `claude-code`      | Runs agent sessions on the Claude Code CLI.                                                                                                                            |
| `forms`            | Shows each forms round an agent asks in a popup, to answer it.                                                                                                         |
| `agent-commands`   | Lets an agent list and run the app's commands and read its state, asking before a risky one.                                                                           |
| `primer`           | Shows each primer an agent opens, to tick and edit its tasks.                                                                                                          |
| `audio-picker`     | Shows each audio picker an agent opens, to play candidate sounds and choose one per moment.                                                                            |
| `chat`             | Runs agent sessions in the Chat tab: the transcript, the composer and the start prompt.                                                                                |
| `auto-compact`     | Compacts an idle session with a cold prompt cache before the next message, when its context is large.                                                                  |
| `session-stash`    | Stashes a session with a note, and offers it again in the start prompt.                                                                                                |
| `session-log`      | Records each session's start and end, and offers closed sessions again.                                                                                                |
| `auto-retro`       | Runs the picked retro strategy's command in the background after each conversation the user ends.                                                                      |
| `agents`           | Tracks the subagents, tasks and skills each session runs.                                                                                                              |
| `agent-lines`      | Shows a working line under each session row while its agents run.                                                                                                      |
| `agent-strip`      | Shows a box for each subagent and task above the composer.                                                                                                             |
| `agent-skills`     | Lists the skills each session's agents started.                                                                                                                        |
| `context-sources`  | Shows what fills each session's context.                                                                                                                               |
| `live-view`        | Streams a Unity editor's Game View into the session hub while an agent plays it.                                                                                       |
| `chatroom`         | One room per project where agent sessions and the user talk, beside a board of every session's state.                                                                  |
| `keys`             | Key hints: which-key, the help overlay and a search over every leader action.                                                                                          |
| `docs`             | Docs mode: browse and edit every agent doc on the machine, as a wiki and a tree.                                                                                       |
| `docs-session-tab` | A Docs tab in each session, over the docs that session reads.                                                                                                          |
| `gallery`          | Gallery mode: every design primitive in every state.                                                                                                                   |
| `settings`         | Settings mode: every setting and key bind.                                                                                                                             |
| `scoped-agents`    | Runs the agent chats a plugin owns per scope, such as Backlog's assistant.                                                                                             |
| `backlog`          | Backlog mode: every repo's follow-ups in one table, their staleness, and chunks started as sessions.                                                                   |
| `work`             | Slack and Jira work gathered by background worker sessions, with every card action: send, dismiss, snooze, move, accept, start a session.                              |
| `work-inbox`       | Inbox mode: Slack threads sorted by what needs you, with drafts ready to send.                                                                                         |
| `work-board`       | Board mode: your Jira tickets and local tasks in columns, with suggested moves.                                                                                        |
| `notes`            | A note popup over every mode that sends a note to a follow-up or a new session.                                                                                        |
| `practice`         | Practice mode: coding problems in C++ with a judge, progress and an interviewer.                                                                                       |
| `usage`            | Plan usage in the status bar, and each session's context and spend.                                                                                                    |
| `usage-tab-line`   | Each session's usage line in its tab bar.                                                                                                                              |
| `workflow`         | Each session's workflow, step and checklist on its row, above the composer and in a side pane; the Checklist flow, declared workflows and the plan capability.         |
| `contributions`    | Reads every installed plugin's `auri.json` and serves its sections to the features.                                                                                    |
| `unity-pool`       | Which Unity pool clone each session holds, with Hold, Release and Open buttons. Off by default.                                                                        |
| `system-stats`     | CPU, GPU, RAM, network and disk use in the right bar.                                                                                                                  |
| `visual`           | Draws the html code blocks an agent writes as live visuals.                                                                                                            |
| `markdown-blocks`  | Draws the `:::changes`, `:::tree` and `:::details` blocks agents write.                                                                                                |
| `scheduling`       | Runs agent tasks on a schedule as new headless sessions, also while the app is closed.                                                                                 |
| `builds`           | Builds mode: the CI and local builds of the tracked games, queued in one press; each session's builds on its row and in its hub, and a build offer above its composer. |
| `builds-teamcity`  | The `teamcity` build backend, over the TeamCity CLI.                                                                                                                   |
| `builds-local`     | The `local` build backend: a command per build kind, run in the game's clone.                                                                                          |
| `window`           | The command that brings the app forward from any other app.                                                                                                            |
| `demo`             | Walks through every feature on sample data, one step at a time.                                                                                                        |
| `app-update`       | Shows Update available when origin's `main` has moved past the installed app's commit.                                                                                 |

## MCP tools

The `auri` server offers these tools to every session, unless the row says otherwise.

| Tool                        | What it does                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_session_title`         | Names the session in the side bar.                                                                                                                       |
| `permission_prompt`         | Answers Claude Code's permission prompts for a session the app started.                                                                                  |
| `start_session`             | Starts a new, independent chat session with a first message.                                                                                             |
| `set_headless`              | Turns the session's headless mode on or off.                                                                                                             |
| `ask_round`                 | Sends a forms round and waits for the answers.                                                                                                           |
| `collect_last_round`        | Re-attaches to the open round, or returns the last finished round's answers.                                                                             |
| `list_commands`             | Lists the app's commands.                                                                                                                                |
| `run_command`               | Runs one app command by id, asking the user first when it is risky.                                                                                      |
| `read_state`                | Reads the app's state slots as JSON.                                                                                                                     |
| `open_primer`               | Opens a primer and waits for the user's edits.                                                                                                           |
| `collect_last_primer`       | Re-attaches to the open primer, or returns the last finished one.                                                                                        |
| `open_audio_picker`         | Opens an audio picker and waits for the user's picks.                                                                                                    |
| `collect_last_audio_picker` | Re-attaches to the open audio picker, or returns the last finished one.                                                                                  |
| `show_live_view`            | Streams a Unity editor's Game View into the session's Live section.                                                                                      |
| `hide_live_view`            | Stops the Live section's stream.                                                                                                                         |
| `set_workflow_checklist`    | Sets the session's checklist.                                                                                                                            |
| `set_workflow_step`         | Sets the session's step in its workflow. Offered while an enabled declared workflow names a step.                                                        |
| `set_workflow_plan`         | Sets the plan folder the session's run writes. Offered while an enabled workflow uses the plan capability.                                               |
| `chatroom_post`             | Posts a message in the project's chatroom.                                                                                                               |
| `chatroom_read`             | Reads the chatroom: unread messages, a thread or a message.                                                                                              |
| `chatroom_board`            | Reads the board: each live session's state, branch, edits and claims.                                                                                    |
| `chatroom_claim`            | Claims paths, a branch or a named resource.                                                                                                              |
| `chatroom_release`          | Ends a claim.                                                                                                                                            |
| `read_backlog_state`        | Reads what the user sees in Backlog. Answers only the Backlog assistant.                                                                                 |
| `set_backlog_chunks`        | Replaces one repo's unstarted chunks. Answers only the Backlog assistant.                                                                                |
| `read_work_state`           | Reads what the Inbox and Board hold: the running job, the Board columns, every item and card. Answers only the running work job's session.               |
| `record_work_items`         | Adds or updates Slack conversations in the Inbox, and clears the ones the user has since answered. Answers only the running work job's session.          |
| `record_work_tickets`       | Records the user's Jira tickets on the Board, with their statuses and the statuses their transitions reach. Answers only the running work job's session. |
| `report_work_job`           | Ends the job with whether it did what its message asked and a one-line note. Answers only the running work job's session.                                |
| `add_practice_problem`      | Adds or rewrites a Practice problem.                                                                                                                     |
| `read_practice_state`       | Reads what the user sees in Practice.                                                                                                                    |
| `schedule_task`             | Schedules a prompt to run on a schedule.                                                                                                                 |
| `list_scheduled_tasks`      | Lists the scheduled tasks.                                                                                                                               |
| `update_scheduled_task`     | Changes a scheduled task.                                                                                                                                |
| `remove_scheduled_task`     | Removes a scheduled task.                                                                                                                                |

## Skills

The `auri` plugin's skills, in `agent-plugin/skills/<name>/`:

| Skill                          | What it teaches                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `auri:forms`                   | Asking the user in a forms round: wording, outcomes, headless, the written fallback.               |
| `auri:visuals`                 | Live html visuals, images and videos in replies and rounds; mocks of a look decision.              |
| `auri:chatroom`                | What to post in the chatroom, when, and to whom; reading the board; claims.                        |
| `auri:workflows-and-checklist` | Session title, checklist, steps and plans; the Checklist flow and the edit gate.                   |
| `auri:backlog-format`          | The follow-up file format, and the Backlog assistant's tools.                                      |
| `auri:primer`                  | Opening a primer and reading the edited triage.                                                    |
| `auri:audio-picker`            | Opening an audio picker and reading the picks.                                                     |
| `auri:live-view`               | Streaming a Unity Game View, the `liveView` command patterns, and the probe.                       |
| `auri:writing-auri-json`       | Writing a plugin's `auri.json`.                                                                    |
| `auri:builds`                  | Queueing and offering builds, reading `builds.snapshot`, and tracking a game in `builds.backends`. |

## Hooks

The `auri` plugin's hooks, in `agent-plugin/hooks/hooks.json`. Each runs a Python script under
`agent-plugin/scripts/`, always exits 0, and does nothing when the app is not reachable.

| Event          | Matcher                                      | Script                       | What it does                                                                                      |
| -------------- | -------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `PreToolUse`   | `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash` | `scripts/chatroom/`          | Before an edit or a commit, names another session's claim or uncommitted edits on the same paths. |
| `PostToolUse`  | `Edit\|Write\|MultiEdit\|NotebookEdit`       | `scripts/chatroom/`          | Reports the touched paths, and says when chatroom messages wait.                                  |
| `PreToolUse`   | `Edit\|Write\|MultiEdit\|NotebookEdit`       | `scripts/checklist/`         | In an app session, denies the main agent's edit until the session has sent a checklist.           |
| `Stop`         | —                                            | `scripts/checklist/`         | In an app session, reminds the agent once at turn end while checklist items are open.             |
| `SessionStart` | `compact`                                    | `scripts/checklist/`         | In an app session, shows the last step and checklist again after a compaction.                    |
| `PreToolUse`   | `AskUserQuestion`                            | `scripts/ask-user-question/` | Denies the call and points the agent at the `auri` server's `ask_round` tool.                     |

An app session is one whose environment holds `WIGLEY_SESSION_ROW`, which the app sets on every session it starts.

## Data folders

- `~/.agents/wigley-ai-gui/` — the stable app's relay endpoint and tool list (`~/.agents/wigley-ai-gui-dev/` for the
  dev app).
- `~/.agents/wigley-forms/rounds/` — one JSON file per forms round, pruned after 90 days.
- `~/.agents/wigley-primer/primers/` — one JSON file per primer.
- `~/.agents/wigley-docs/` — the docs index and its config.
- `~/.config/wigley-ai-gui/` — settings, keymap, themes, layouts and user plugins.

## License

MIT. See `LICENSE`.
