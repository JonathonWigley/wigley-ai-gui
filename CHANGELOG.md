# Changelog

Each landing on `main` adds a version heading, `## <version> — <YYYY-MM-DD>`, with the entries that were under
`## Unreleased`. The version is the one `package.json` and both `auri` plugin manifests carry, bumped together. Entries sit under `### Added`, `### Changed`, `### Fixed` or `### Removed`, one line each, saying what
changes for the user.

## Unreleased

### Added

- Every code block in chat, docs, forms and practice shows a copy button in its corner on hover; a click copies
  the block's code and toasts Copied.
- The app ships its own agent plugin, `auri`, in `agent-plugin/`: the MCP relay, the chatroom, checklist and
  AskUserQuestion hooks, and skills for forms, visuals, chatroom, workflows and checklist, backlog format, primer,
  audio picker, live view and writing `auri.json`. App sessions load it through `--plugin-dir`; terminal and Codex
  sessions install it from `.claude-plugin/marketplace.json`.
- Any agent plugin can bind the app's workflows, plan format, retro, backlog, docs and live view through an
  `auri.json` at its root. Each feature shows an empty state until a plugin binds it.
- Settings choose between installed strategies: `auto-retro.strategy`, `backlog.strategy`, and an on/off list of
  declared workflows, `workflow.off`.
- Every app session starts on a built-in Checklist flow, and the `auri` hook holds edits until the session sends its
  checklist.
- `README.md`, this changelog and an MIT `LICENSE`. `npm run lint` fails when a branch changes app code without a
  changelog entry, and a test fails when the README leaves out a plugin, tool, setting, skill or hook.
- `npm run lint` also fails when app code names one user's setup (`npm run lint:boundary`), and
  `npm run changelog:release` moves the Unreleased entries under a version heading and bumps the app and `auri`
  plugin versions together.
- Inbox mode (`Space k i`): your Slack threads sorted by what needs you, with drafts ready to send, snooze, dismiss and
  restore, a ticket filter, and a Dock badge counting what needs you.
- Board mode (`Space k j`): your Jira tickets and local tasks in columns, with moves you make by key, button or drag and
  moves the app suggests from your branches, commits, pull requests and sessions.
- Background sweeps of Slack and Jira by unattended worker sessions every `work.intervalMinutes` while the app runs, or
  at once on `W`, with the `work.*` settings for channels, keywords, the Jira query, the Board columns and each signal's
  column. Worker sessions run with permission checks off, and launch only in the installed app's live run: the dev app
  queues jobs and logs each one not launched.

### Changed

- The MCP server is `auri`, so Claude Code names its tools `mcp__plugin_auri_auri__<tool>`.
- Workflows are declarative config. `workflow.autoStart` replaces the Large workflow's auto Clear & make settings,
  and `workflow.layout` replaces the four level layouts.
- The Unity pool plugin is off by default, and `unity-pool.scriptPath` names its script.
- The `auri` skills and the docs-index README match the landed app: the workflows-and-checklist skill says how an
  unknown workflow step is refused and when to leave the checklist as it is, and the docs-index README names where the
  pointer check's parser copy lives.
- The "No workflow" tag on a working session is a per-workflow opt-in (`flagsUnclaimedWork` in `auri.json`); with no
  workflow opting in, a session on the Checklist flow is never tagged.
- Docs with no installed plugin naming a wiki page shows "No installed plugin names a wiki page", and the wiki's
  Main page follows a binding change without a restart.
- Docs no longer rebuilds its index at launch.
- `wigley-land` cuts the app release itself: after the rebase it runs `npm run changelog:release` and commits the
  version bump as the branch's last commit.

### Fixed

- The `auri` checklist hook shows the session's workflow step as well as its list again after a compaction.
- A missing hook script no longer blocks a session; the hook fails open.
- A session saved on one of the retired built-in Spike, Small, Medium or Large workflows opens on the Checklist flow with its checklist.

### Removed

- The built-in Spike, Small, Medium and Large workflow plugins, and the settings `auto-retro.folder`,
  `workflow-large.autoClearAndMake`, `workflow-large.autoStartSeconds` and `workflow-*.layout`.
