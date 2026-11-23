# 01 — The `auri` agent plugin scaffold, and the relay and chatroom hook moved into it

Status: not started
Type: Batch
Rung: hard · adds `src/shared/agent-plugin.ts` and `MainServices.appDir`, which 02 and 03 consume, and moves code across two plugins
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Mandatory reads for this task: `wigley-ai-marketplace/AGENTS.md` in full, `~/wigley-agents/WigleyRepos.md`,
`~/wigley-agents/AgentsStandardMapping.md`, `wigley-ai-gui/AGENTS.md` § Architecture (the plugin layout and the relay
paragraph that starts "Each Claude Code or Codex session runs the marketplace's `relay.py`") and § Running and testing.

Paths are relative to the worktree `W` (`~/Documents/.worktrees/ai-shareable-app`) unless they say otherwise.
`M` is `wigley-ai-marketplace/plugins/wigley`. `A` is `wigley-ai-gui/agent-plugin`.

Files (wigley-ai-gui):
- create `wigley-ai-gui/agent-plugin/.claude-plugin/plugin.json`
- create `wigley-ai-gui/agent-plugin/.codex-plugin/plugin.json`
- create `wigley-ai-gui/agent-plugin/hooks/hooks.json`
- create `wigley-ai-gui/.claude-plugin/marketplace.json`
- create `wigley-ai-gui/src/shared/agent-plugin.ts` · test `wigley-ai-gui/src/shared/agent-plugin.test.ts`
- modify `wigley-ai-gui/src/contracts/plugin.ts` (`MainServices`)
- modify `wigley-ai-gui/src/main/main.ts` (the main services record)
- modify `wigley-ai-gui/src/shared/plugin-part-harness.test-support.ts` (the `MainServices` fake)
- modify `wigley-ai-gui/forge.config.mts` (`packagerConfig.extraResource`)
- modify `wigley-ai-gui/src/plugins/sessions/main/relay/connect-hold.ts` (comment only)
- modify `wigley-ai-gui/AGENTS.md` (the lines named under Decisions, Docs)
- move `M/scripts/forms/relay.py`, `endpoint.py`, `start_app.py`, `README.md`, `tests/` → `A/scripts/relay/`
- move `M/scripts/chatroom/hook.py`, `tests/` → `A/scripts/chatroom/`

Files (wigley-ai-marketplace):
- modify `wigley-ai-marketplace/plugins/wigley/.claude-plugin/plugin.json`
- modify `wigley-ai-marketplace/plugins/wigley/.codex-plugin/plugin.json`
- delete `wigley-ai-marketplace/plugins/wigley/hooks/hooks.json`
- modify `wigley-ai-marketplace/AGENTS.md`, `wigley-ai-marketplace/README.md`
- modify `wigley-ai-marketplace/plugins/wigley/scripts/retro/answers.py`, `digest.py` (docstrings only)
- modify `wigley-ai-marketplace/plugins/wigley/scripts/retro/tests/test_record_fields.py`
- modify `wigley-ai-marketplace/plugins/wigley/skills/feature-primer/SKILL.md`, `skills/review/triage.md`

Consumes: nothing.

Produces:
- `src/shared/agent-plugin.ts`, with exactly the names in plan.md § File Structure › Shared names and design.md
  § Names and types › The agent plugin:
  `AGENT_PLUGIN_NAME = 'auri'`, `AGENT_SERVER_NAME = 'auri'`, `AGENT_PLUGIN_FOLDER = 'agent-plugin'`,
  `APP_PLUGIN_KEY = 'auri@app'`, `CONTRIBUTIONS_FILE = 'auri.json'`, `CONTRIBUTIONS_VERSION = 1`,
  `export function claudePluginToolName(plugin: string, server: string, tool: string): string`,
  `export function agentPluginDir(appDir: string, paths: Paths): string`.
- `MainServices.appDir: string` in `src/contracts/plugin.ts`.
- The plugin folder `wigley-ai-gui/agent-plugin/` with its two manifests, `hooks/hooks.json` (chatroom entries only),
  `scripts/relay/` and `scripts/chatroom/`.
- The marketplace file `wigley-ai-gui/.claude-plugin/marketplace.json`.

## Decisions

### `src/shared/agent-plugin.ts`

- `claudePluginToolName` returns `` `mcp__plugin_${plugin}_${server}__${tool}` ``. It does no escaping: Claude Code
  builds the name from the manifest name and the server key as they are.
- `agentPluginDir` returns `paths.join(appDir, AGENT_PLUGIN_FOLDER)`. It reads no file.
- The docs index (`M/scripts/docs-index/`) is task 09's move; this task leaves it, and `check_pointers.py`, as they are.
- The module imports only the `Paths` type (`src/contracts/paths.ts`). It holds no other code. 02 moves
  `RELAY_SERVER_NAME` and `CLAUDE_PERMISSION_TOOL` onto these names; this task does not touch them.

### `MainServices.appDir`

- `appDir` is the folder that holds the app's own files outside the asar: `process.resourcesPath` when
  `app.isPackaged`, else `app.getAppPath()`. This is the rule `emittedTypesFolder`
  (`src/main/plugin-catalog/plugin-types.ts`) already uses for `.plugin-types`. Reuse that rule: extract one helper
  in `plugin-types.ts` or `main.ts` that both call, so the rule is written once.
- `main.ts` sets it in the main services record beside `cloneDir: inputs.repoDir`. The doc comment above
  `MainServices` gets one sentence: "`appDir` is the folder that holds the app's files outside the asar (the
  resources folder when packaged, the repo folder in dev); `agentPluginDir` resolves the `auri` plugin under it."
- The test harness fake (`plugin-part-harness.test-support.ts`, beside `cloneDir: null`) sets `appDir: '/app'`.
- `forge.config.mts`: add `'agent-plugin'` to `packagerConfig.extraResource`, beside `PLUGIN_TYPES_FOLDER`, with a
  comment: Claude Code reads the plugin from disk through `--plugin-dir`, and Python cannot run scripts inside the
  asar. The packaged app then holds `<Resources>/agent-plugin/`, which is `agentPluginDir(appDir)`.

### The plugin manifests

`agent-plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "auri",
  "version": "<package.json version>",
  "description": "The Auri app's agent plugin: the app's MCP tools, its hooks and the skills for its features",
  "author": { "name": "Wigley" },
  "license": "MIT",
  "mcpServers": {
    "auri": {
      "command": "python3",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/relay/relay.py"],
      "env": { "WIGLEY_FORMS_DEADLINE_SECONDS": "300" }
    }
  }
}
```

`agent-plugin/.codex-plugin/plugin.json` takes the shape of the wigley plugin's Codex manifest
(`M/.codex-plugin/plugin.json`): `name`, `version` and `description` the same as the Claude manifest, `author`,
`"skills": "./skills/"`, `mcpServers.auri` with `"command": "python3"`, `"args": ["./scripts/relay/relay.py"]`,
`"cwd": "."`, `"tool_timeout_sec": 330`, and `interface` with `displayName` `Auri`, the same `shortDescription`,
`developerName` `Wigley`, `category` `Development`.

- Verified at plan time against the Codex plugin build guide (developers.openai.com/plugins/build/plugins): a root
  `plugin.json` is the portable manifest and `.codex-plugin/plugin.json` is the compatibility fallback that Codex
  reads when the root one is absent. The `auri` plugin keeps the house shape (`.codex-plugin/` only, no root
  `plugin.json`), because that shape runs the wigley plugin's relay under Codex today, and a root `plugin.json`
  would sit beside `.claude-plugin/` with a different schema. Codex also discovers `hooks/hooks.json` and sets
  `CLAUDE_PLUGIN_ROOT` for it; the chatroom hook already runs that way from the wigley plugin, so nothing changes.
- The env names `WIGLEY_FORMS_DEADLINE_SECONDS` and `WIGLEY_FORMS_OFFLINE` keep their names: the app's
  `sessions/main/offline-calls.ts` sets the offline one, and plan.md keeps every data path and wire name.
- `version` is the app's `package.json` `version` (`1.0.0`, measured at plan time, re-verify). Task 15 enforces
  that the three stay equal and bumps them together; this task only writes the starting value.

### The marketplace file

`wigley-ai-gui/.claude-plugin/marketplace.json`:

```json
{
  "name": "auri",
  "owner": { "name": "Wigley" },
  "description": "The Auri app's agent plugin, for terminal Claude Code and Codex sessions.",
  "plugins": [
    { "name": "auri", "source": "./agent-plugin", "description": "<the manifest's description>", "category": "Development" }
  ]
}
```

- The marketplace is named `auri`, so the install key is `auri@auri` (lead's ruling).
- No `version` in the entry: `wigley-ai-marketplace/AGENTS.md` § Why the layout looks like this says the manifest's
  version wins without warning.
- Codex reads `.claude-plugin/marketplace.json` as its legacy-compatible marketplace path (same guide), so one file
  serves both hosts, as the wigley marketplace does.

### The moves

Use `git mv` for every moved file, so history follows it.

- `relay.py`, `endpoint.py`, `start_app.py`, `README.md` and `tests/` go to `A/scripts/relay/`. `endpoint.py` imports
  `start_app` from its own folder; nothing changes there.
- `chatroom/hook.py` and `chatroom/tests/` go to `A/scripts/chatroom/`. Change its import path from
  `Path(__file__).resolve().parent.parent / "forms"` to `... / "relay"`, and its docstring pointer from
  `forms/README.md § The relay` to `relay/README.md § The relay`.
- `agent-plugin/hooks/hooks.json` holds the two chatroom entries of `M/hooks/hooks.json` as they are (same matchers,
  timeouts and `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/chatroom/hook.py" pre|post` commands), with the description
  `"Auri hooks: the chatroom's edit and commit warnings"`. Task 12 adds the other hooks to this file.
- `agent-plugin/skills/` holds the app-feature skills, which are docs written ahead (plan.md § Docs written ahead).
  This task does not write or change them. When the docs commit has not created the folder, create no skill: the
  Codex manifest's `"skills": "./skills/"` then names an empty folder, so add `agent-plugin/skills/.gitkeep`.

### Text in the moved files

The moved files now ship with the app, so plan.md § Boundary rules applies to them. Change each of these, and no
other line of code:

- `relay.py`: the module docstring's first line names the `auri` MCP server. `SERVER_INFO` is
  `{"name": "auri", "version": "1.0.0"}`. The log prefix `wigley-forms relay:` becomes `auri relay:`.
  `_refused_text`'s last sentence becomes "When the reason is a protocol mismatch, the user updates the app, which
  carries the auri plugin, so both speak one relay protocol." `_PRIMER_WORDS`' fallback becomes "work through the
  primer's rows in chat". `_AUDIO_PICKER_WORDS`' fallback becomes "name the pick and its ranked alternatives in the
  reply".
- `tests/test_relay.py`: the `serverInfo` name assertion expects `"auri"`. Update any other assertion that pins a
  string changed above.
- `README.md` (the relay README): rename the server to `auri` and the tool names to
  `mcp__plugin_auri_auri__<tool>` (Claude Code) and `mcp__auri__<tool>` (Codex). Remove each personal pointer the
  plugin inventory lists at `scripts/forms/README.md` lines 8, 24, 54, 236, 283–287, 298, 334, 391, 405, 414, 418,
  457, 650 and 669 (line numbers measured at plan time, re-verify by grep): `~/wigley-agents/forms.md` becomes the
  `auri` plugin's forms skill; `wigley:visuals` becomes the `auri` plugin's visuals skill; the `retro` skill and
  `scripts/retro/*.py` become "readers of the saved files, such as a retro tool"; the `feature-primer` skill becomes
  "the skill that calls `open_primer`"; the "Registering the server" section describes the `auri` plugin's two
  manifests and the app's `--plugin-dir` launch (task 02); "Local commands" runs from `agent-plugin/scripts/relay`.
  Keep the paragraph that opens "The file is the contract with retro's readers" word for word apart from those
  names, because `test_record_fields.py` reads it.

### Removals from the wigley plugin

- Remove `mcpServers` from both wigley manifests. Delete `M/hooks/hooks.json`.
- Bump `version` in both wigley manifests, MAJOR: the plugin drops its MCP server and its hooks. Read the current
  number from `origin/main` after a fetch (`wigley-ai-marketplace/AGENTS.md` § Changing a plugin).
- `M/scripts/forms/` and `M/scripts/chatroom/` are left with no file; leave no empty folder.

### Every reference to the moved files

Each pointer to the old paths changes in this task, since the move breaks it.

- `M/skills/feature-primer/SKILL.md` (2 lines) and `M/skills/review/triage.md` (4 lines; counts measured at plan
  time, re-verify): each `../../scripts/forms/README.md` pointer becomes prose naming "the `auri` plugin's relay
  README (`scripts/relay/README.md`)" with the same § name. A relative link cannot cross from one plugin's install to
  another's.
- `M/scripts/retro/answers.py` and `digest.py` docstrings: `scripts/forms/README.md` becomes "the auri plugin's
  scripts/relay/README.md".
- `M/scripts/retro/tests/test_record_fields.py`: read the README at
  `Path(__file__).resolve().parents[6] / "wigley-ai-gui" / "agent-plugin" / "scripts" / "relay" / "README.md"`
  (the `ai` repo root, then the app folder), and update the docstring and failure message to that path. Task 17
  removes the app folder from `ai`, so this path stops resolving there (listed in task 17's scope by the lead).
- `wigley-ai-marketplace/AGENTS.md`: the layout tree's `hooks/hooks.json` line and the `scripts/` line drop the
  chatroom hook and the forms relay; the "One MCP entry per manifest" bullet drops its forms README link; the
  "Plugin hooks in `hooks/hooks.json`" bullet says the wigley plugin ships no hooks now and keeps the rule for a
  plugin that adds one; the "Portable tool names" bullet takes `auri` examples (`mcp__plugin_auri_auri__ask_round` in
  Claude, `mcp__auri__ask_round` in Codex, "the `auri` server's `ask_round` tool"); the Done list drops the
  `scripts/chatroom` and `scripts/forms` unittest lines.
- `wigley-ai-marketplace/README.md`: the Plugins row and the paragraph under it say the forms tools come from the
  `auri` plugin, which the wigley-ai-gui app carries and installs from the app repo's marketplace; the pre-approval
  line names `"mcp__plugin_auri_auri__*"`.
- `wigley-ai-gui/src/plugins/sessions/main/relay/connect-hold.ts`: the comment names `agent-plugin/scripts/relay/relay.py`.

### Docs

`wigley-ai-gui/AGENTS.md`: line 30 ("the only client of the `wigley-forms` tools") names the `auri` tools; the
paragraph at line 551 says each session runs the `auri` plugin's `relay.py` (`agent-plugin/scripts/relay/`, whose
README states the tool contract and the saved-round format), and drops "the `retro` skill" for "readers of the saved
files"; line 1261 runs `agent-plugin/scripts/relay/start_app.py`. Add `agent-plugin/` to the Architecture layout with
one line: the `auri` agent plugin, passed to Claude Code with `--plugin-dir` and listed in
`.claude-plugin/marketplace.json`. Line numbers measured at plan time, re-verify by grep. The `docs_index.py` mention
on line 33 is task 09's.

## Behaviour

GIVEN the app folder `/app` WHEN `agentPluginDir('/app', posixPaths)` runs THEN it returns `/app/agent-plugin`.
GIVEN `claudePluginToolName('auri', 'auri', 'permission_prompt')` THEN it returns `mcp__plugin_auri_auri__permission_prompt`.
GIVEN the two `auri` manifests WHEN the app's tests run THEN both carry the name `auri` and one MCP server keyed `auri`.
GIVEN the moved relay WHEN a host starts `relay.py` from `A/scripts/relay/` THEN its initialize reply names `auri`.

## Tests

- `src/shared/agent-plugin.test.ts`, one table test per function: `claudePluginToolName_JoinsPluginServerAndTool`
  (rows: `auri/auri/permission_prompt`, `wigley/wigley-forms/ask_round` → `mcp__plugin_wigley_wigley-forms__ask_round`),
  `agentPluginDir_JoinsTheFolderName` (posix and windows `Paths`). Catches a wrong separator or prefix in the one
  place every tool name is built.
- `src/shared/agent-plugin.test.ts`: `agentPluginManifests_NameTheConstants` reads
  `agent-plugin/.claude-plugin/plugin.json` and `agent-plugin/.codex-plugin/plugin.json` from the repo with `node:fs`
  and asserts `name === AGENT_PLUGIN_NAME` in both and the one `mcpServers` key `=== AGENT_SERVER_NAME` in both.
  Catches a server key that drifts from the name the app builds tool names from. The version check is task 15's.
- `A/scripts/relay/tests/test_relay.py`: the changed `serverInfo` row. `A/scripts/chatroom/tests/`: unchanged; they
  pass only when the new import path resolves.

## Verification

```
cd /Users/jonathonwigley/Documents/.worktrees/ai-shareable-app
(cd wigley-ai-gui/agent-plugin/scripts/relay && python3 -m unittest discover)
(cd wigley-ai-gui/agent-plugin/scripts/chatroom && python3 -m unittest discover)
(cd wigley-ai-marketplace/plugins/wigley/scripts/retro && python3 -m unittest discover)
(cd wigley-ai-marketplace && python3 scripts/check_manifests.py && python3 scripts/check_pointers.py && (cd scripts && python3 -m unittest discover -s tests))
claude plugin validate wigley-ai-marketplace
claude plugin validate wigley-ai-gui
claude plugin validate wigley-ai-gui/agent-plugin
(cd wigley-ai-gui && npm test -- src/shared/agent-plugin.test.ts src/main/plugin-catalog/plugin-types.test.ts)
(cd wigley-ai-gui && npm run typecheck && npm run lint)
git grep -n 'scripts/forms\|scripts/chatroom/hook' -- wigley-ai-marketplace wigley-ai-gui/src wigley-ai-gui/AGENTS.md
```

The last grep prints nothing outside `docs/features/` and `wigley-ai-marketplace/docs/` (history notes). `npx` is
denied on this machine: Vitest runs only through `npm test -- <path>`. `check_manifests.py --against origin/main`
runs at landing. The app's worktree `node_modules` is a symlink to the `ai` clone's; no install runs.

## Done when

- Every command above passes, and the grep prints nothing outside the exempt folders.
- `claude plugin validate` passes for the marketplace file and for `agent-plugin/` (warnings allowed only for an
  empty `skills/`).
- The wigley plugin's manifests hold no `mcpServers`, its `hooks/` folder is gone, and its version is one MAJOR up.

Commit: one commit for the group, touching both repos' folders in `ai`.

## Proof

