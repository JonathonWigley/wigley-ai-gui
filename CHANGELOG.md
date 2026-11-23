# Changelog

Each landing on `main` adds a version heading, `## <version> — <YYYY-MM-DD>`, with the entries that were under
`## Unreleased`. The version is the one `package.json` and both `auri` plugin manifests carry, bumped together. Entries sit under `### Added`, `### Changed`, `### Fixed` or `### Removed`, one line each, saying what
changes for the user.

## Unreleased

### Added

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
- Inbox mode (`Space k i`): your Slack threads sorted by what needs you, with drafts ready to send, snooze, dismiss and
  restore, a ticket filter, and a Dock badge counting what needs you.
- Board mode (`Space k j`): your Jira tickets and local tasks in columns, with moves you make by key, button or drag and
  moves the app suggests from your branches, commits, pull requests and sessions.
- Background sweeps of Slack and Jira by unattended worker sessions every `work.intervalMinutes` while the app runs, or
  at once on `W`, with the `work.*` settings for channels, keywords, the Jira query, the Board columns and each signal's
  column.

### Changed

- The MCP server is `auri`, so Claude Code names its tools `mcp__plugin_auri_auri__<tool>`.
- Workflows are declarative config. `workflow.autoStart` replaces the Large workflow's auto Clear & make settings,
  and `workflow.layout` replaces the four level layouts.
- The Unity pool plugin is off by default, and `unity-pool.scriptPath` names its script.

### Removed

- The built-in Spike, Small, Medium and Large workflow plugins, and the settings `auto-retro.folder`,
  `workflow-large.autoClearAndMake`, `workflow-large.autoStartSeconds` and `workflow-*.layout`.
