# Agent harnesses: design

**Contents**

- **Intent** — what the harness seams are for.
- **Registry** — how a harness reaches the app, and how plugins and pages see it.
- **The claude-code plugin** — Claude Code as one plugin among harnesses, and the services it needs.
- **Profiles and the default harness** — who owns profiles, and how a new session picks its harness.
- **Joining an app-started session** — the row id in the relay's hello.
- **Permission prompts** — the adapter owns the MCP route and the reply.
- **Docs and a harness's folders** — what docs asks an adapter, and why the index file keeps its list.
- **A harness reloading** — what happens to running sessions.
- **Rejected** — approaches weighed and dropped, with the reason.

## Intent

Claude Code is the first harness; Codex and wigley-harness follow. A new harness is a new plugin folder that
registers an adapter, and no code outside that folder names a harness's CLI, files, environment variables, control ids
or output format. Every decision below serves that.

## Registry

- A harness plugin registers its `AgentHarness` through the main service `services.agentHarnesses`
  (`AgentHarnessRegistry`: `register`, `list`, `get`). `register` returns a handle that is a `Disposable`, because a
  user-folder harness plugin may reload; its `refresh()` re-reads the adapter's declarations after the plugin's
  settings change.
- The registry writes the core slot `core.agentHarnesses`, keyed by harness id, holding each harness's
  `AgentHarnessInfo`: label, capabilities, clear aliases, profiles and project config folder name. Pages and layouts
  read labels and declarations from it; there is no label map outside an adapter. The slot's `on` is the change
  signal, so the registry has no listener API of its own.
- A harness id no adapter registered (a relay hello from a Codex terminal session today) shows as its raw id.
- `capabilities` is a closed record of required booleans. Every reader is chat code that branches per flag, so the
  compiler checking that each adapter declares each flag is worth more than an open set nobody reads.

## The claude-code plugin

- The built-in plugin `claude-code` holds the Claude adapter and registers it. Its harness keeps the id `claude`,
  which relay hellos and saved sessions already carry.
- It owns its settings: `claude-code.command` (the program a session runs) and `claude-code.profiles`.
- The core hands every main part what the adapter used to take from `main.ts`: the session host
  (`services.sessionHost`, already a service), a streaming spawn on `services.processes` that a plugin stop kills like
  its other runs, and the agent environment (`services.agentEnvironment`: the app's environment plus the relay's
  endpoint folder). A user-folder harness plugin so has the same reach as the built-in one.
- In a run whose harness is the fake (the self-test, a drive run on the fake), the composition root registers the fake
  under its own id `fake` and leaves `claude-code` out of the built-in plugins, so no run spawns a real `claude`.

## Profiles and the default harness

- Each harness plugin owns its profiles (name and config folder) as its own setting. A profile carries its harness by
  where it lives. Chat, usage and docs read every harness's profiles from the registry.
- Profile names are unique across harnesses, so a project's pinned profile, recent folders and saved sessions keep
  naming a profile by name alone. When two harnesses declare one name, the first registered keeps it and the
  registry logs the clash.
- Chat's `defaultHarness` setting (default `claude`) picks the harness of a new session; the start prompt's profile
  step lists that harness's profiles. A project that pins a profile runs on that profile's harness. A resumed or
  re-attached session runs on the harness it was saved with. More start-prompt choices wait until a second harness
  exists.
- Every adapter reports its session id after start (`events.sessionId`); `AgentStart.sessionId` is null for a new
  session. Claude's adapter mints the uuid itself, because Claude takes it on the command line and Codex mints its own.

## Joining an app-started session

- The relay's hello carries the row id (`row_id`), which every adapter puts in its process's environment as
  `WIGLEY_SESSION_ROW`. Sessions joins an owned row by it, so `open` needs no host session id, and the host id is set
  when the adapter reports it.
- The row id holds across `/clear`, which changes the host id, so the newer relay of a cleared session joins the same
  row.
- A process an agent starts inside an app session (a nested `claude -p`) inherits `WIGLEY_SESSION_ROW`. A hello whose
  row id names an owned row joins it only while the row has no host id yet, or the hello's session id equals the
  row's host id, or the hello carries no session id; any other hello connects as a session of its own.

## Permission prompts

- The `claude-code` plugin contributes Claude's `permission_prompt` MCP tool to sessions itself and routes each call
  by the session's row id to its process. The process raises `events.permission`; chat draws the entry and answers
  with `answerPermission(id, { allowed, reason })`, and the adapter writes Claude's reply JSON. An unattended session
  is chat's rule, answered the same way.
- Sessions hands each call's raw MCP `_meta` to the adapter registered under the hello's harness id, which reads its
  own tool-use id key. The MCP server's own name comes from the endpoint the composition root hands sessions.

## Docs and a harness's folders

- Each adapter declares its config and plugin-cache roots and its project config folder name (`.claude`), and lists
  a profile's installed plugins (`installedPlugins`) as plain records, so docs parses no harness's file format.
- Docs' write guard and lookups take every registered profile's folder. The docs index file
  (`~/.agents/wigley-docs/config.json`) keeps `claudeConfigDirs` as `docs_index.py`'s own list: the script also runs
  from a terminal, where the app's settings are out of reach. That use is why both lists stay.

## A harness reloading

Agent processes run in the session host, so a harness plugin's stop drops only the adapter object. Chat detaches a
leaving harness's sessions, shows them waiting, and re-attaches each live one through `attach` when the harness
registers again, the path an app relaunch already takes.

## Rejected

- **A harness step in the start prompt.** With one harness it never shows, and the user wants a default harness
  setting until a second harness makes start choices worth designing.
- **Joining by a harness-minted id reported after start.** A relay can connect before the id is reported, so the join
  would need a wait and a timeout; the row id is in the environment before the process starts.
- **Moving `claudeConfigDirs` out of the docs index file.** Terminal runs of `docs_index.py` would lose the list.
- **Docs reading each harness's installed-plugins file by a declared path.** It leaves the JSON and TOML formats in
  docs.
- **A harness plugin refusing to stop while its sessions run.** A code change to the adapter would wait for every
  session to end.
