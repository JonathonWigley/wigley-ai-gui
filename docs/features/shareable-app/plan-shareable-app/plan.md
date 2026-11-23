# Shareable app — plan

Feature: shareable-app · Implements: none · Ticket: none
Target: `main` of the `ai` repo (`~/Documents/ai`), then `main` of `JonathonWigley/wigley-ai-gui` from task 17 on · Written: 2026-11-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Make wigley-ai-gui (shown as Auri) work for anyone. Concretely:

- No app feature depends on the user's `wigley` plugin, `~/wigley-agents`, or the user's machine tools.
- The app ships its own agent plugin, `auri`. It holds the MCP relay, the hooks, the app-feature skills, and a setup README an agent can follow.
- Every feature that served only the user's workflow stays in the app as a generic feature. A plugin's `auri.json` configures it, and the feature shows an empty state until something binds it. The user's four workflow levels become pure config in the `wigley` plugin.
- Every app session keeps a task list. A built-in Checklist flow shows it, and a hook gates edits until the agent sends one.
- The README and a changelog stay current through a lint check and a coverage test, with no manual upkeep.
- The app moves back to `JonathonWigley/wigley-ai-gui`. Its history is scrubbed first, then it replaces that repo's `main`. The app is MIT-licensed.

## Architecture

Systems touched:

- **App core and plugins** (`wigley-ai-gui/src/`):
  - the claude-code harness launch;
  - sessions' relay server name;
  - a new contributions registry;
  - the workflow engine (made declarative) with a new plan capability;
  - auto-retro, backlog, docs, live-view, primer, audio-picker, unity-pool, chat, visual and chatroom, each losing its hard-coded personal bindings;
  - the four `workflow-*` level plugins, which are removed.
- **The `auri` agent plugin** (new, `wigley-ai-gui/agent-plugin/`), with a marketplace file at `wigley-ai-gui/.claude-plugin/marketplace.json`:
  - the relay, endpoint and start scripts and the forms README, moved from the marketplace;
  - the chatroom hook;
  - the checklist gate and AskUserQuestion hooks;
  - the app-feature skills.
- **The `wigley` plugin** (`wigley-ai-marketplace/plugins/wigley/`): drops its MCP entry and chatroom hook, gains an `auri.json` declaring the user's strategies, and renames its references to the forms tools.
- **The user's rules and tools** (`wigley-agents/`, `~/.claude/`, `~/.agents/AGENTS.local.md`): rename references to the `auri` tools, cut generic text that now lives in app skills, and make workflow-gate read the declared workflows.
- **Repo move** (task 17): split the folder's history out of `ai`, scan it, rewrite it, force-push it to `JonathonWigley/wigley-ai-gui`, clone it at `~/Documents/wigley-ai-gui`, and remove `ai`'s copy of the folder.

## Preconditions

Each was verified on 2026-11-23. `wigley:make` re-runs each command before the first dispatch.

- `claude --help | grep -- --plugin-dir` prints `--plugin-dir <path>  Load a plugin from a directory or .zip`.
- `git ls-remote git@github-personal:JonathonWigley/wigley-ai-gui.git` shows `refs/heads/main` at `7a18ac69…`.
- `git -C ~/Documents/ai cat-file -t 7a18ac69efadae898ca711b89690631ad7a14459` fails, so that commit is not in `ai`.
- `git -C ~/Documents/ai log --format='%ae' -- wigley-ai-gui | sort -u` prints only `17443783+JonathonWigley@users.noreply.github.com`.
- `command -v gitleaks git-filter-repo trufflehog betterleaks` prints nothing: none of these tools is installed.
- `find ~/Documents/ai/wigley-ai-gui -maxdepth 1 -iname 'license*'` prints only `LICENSE`, the MIT file the docs-ahead commit added.
- `~/.claude/settings.json` deny-lists `brew install`, so the agent runs no install: each scan tool is the user's to install (task 17).
- `grep -n '"license"\|"email"' ~/Documents/ai/wigley-ai-gui/package.json` shows `"license": "MIT"` and the user's work email.

## Docs written ahead

Commit: `18112bbb1` — README.md, CHANGELOG.md, LICENSE, the nine `agent-plugin/skills/`, `docs/features/feature-contributions/design.md`, and `AGENTS.md` § README, changelog and boundary. README.md and AGENTS.md mark what the code lacks yet as planned in shareable-app, and task 16 drops those marks. The skills and design.md describe the built state and carry no marks: no session loads them until the `auri` plugin ships in task 01.

## Mandatory Reads

- `wigley-ai-gui/AGENTS.md` in full (about 157k bytes: read it with `allow_large`). A worker reads the sections its task names.
- `wigley-ai-gui/DESIGN.md` for any task that draws UI.
- `wigley-ai-marketplace/AGENTS.md` for any task that edits the marketplace.
- `~/wigley-agents/WigleyRepos.md` and `~/wigley-agents/AgentsStandardMapping.md` for tasks 01, 14 and 17.
- `wigley-ai-gui/docs/features/feature-contributions/design.md`, the `auri.json` contract, for every task that reads or writes a contribution.

## Design Overview

After-state flow:

```
installed agent plugins (each profile's installed_plugins.json)   + app's own agent-plugin/ (--plugin-dir)
        │  each may hold auri.json
        ▼
contributions registry (app) ── per-feature readers ──► workflows · retro · backlog · docs · liveView
        │                                                     │
        │  Settings: one choice per single-strategy feature;   ▼
        │  workflows on/off list                     features show an empty state until bound
        ▼
claude-code launch: --plugin-dir <app>/agent-plugin, --permission-prompt-tool mcp__plugin_auri_auri__permission_prompt
        ▼
agent session ── auri MCP server (relay.py) ──► app tools
             ── auri hooks: checklist edit gate (WIGLEY_SESSION_ROW), Stop reminder, compact reminder,
                chatroom pre/post, AskUserQuestion → forms
             ── auri skills: forms, visuals, chatroom, workflows and checklist, backlog format, primer,
                audio picker, live view, writing auri.json
workflow engine: built-in Checklist flow ◄─ replaced when a declared workflow's skill starts
                 declared workflows (stages, guards, predicates, actions, optional plan pane)
                 plan capability: watch the reported plan, follow its worktree copies, read it per planFormat
```

Decisions, each settled in the interview:

- The app carries its own agent plugin. It reaches the sessions the app starts through `--plugin-dir`, and terminal and Codex sessions get it through a marketplace install (round 1).
- The plugin is named `auri` and its server is `auri`, so Claude Code tools read `mcp__plugin_auri_auri__*` (round 1). `RELAY_SERVER_NAME` and `CLAUDE_PERMISSION_TOOL` derive from one constant.
- No feature moves out of the app. Workflows, plan, retro, backlog, primer, docs, live view, unity-pool and practice all stay as generic features, each showing an empty state until bound. Unity-pool is off by default, with its CLI path as a setting (rounds 1 and 2).
- Any agent plugin may carry an `auri.json` with contributions for any number of features. When several strategies are installed for a single-strategy feature, Settings shows one choice per feature, picked automatically when only one is installed. Workflows get an on/off list (rounds 2 and 3).
- The user's `wigley` plugin keeps its shape and declares every strategy in one `auri.json` (round 3).
- Every workflow is declarative config, Large included, and a generic plan capability serves them. The user's plan format becomes `planFormat` options, with no change to the `wigley:feature` or `wigley:make` skills (round 3).
- Declared actions become commands, and the user's config declares today's keys for them. The auto-start countdown settings move to the engine, keyed by workflow id. Agent plugins carry no app UI code (round 3 notices).
- The generic doctrine skills stay in the `wigley` plugin. The `auri` plugin ships skills only for app features (round 1).
- Every app session starts on a built-in Checklist flow. The `auri` hook denies edits until the first `set_workflow_checklist` call, reminds the agent at turn end while items are open, and shows the checklist again after a compaction. It recognises an app session by `WIGLEY_SESSION_ROW` (rounds 1 and 4).
- The README and changelog are kept current by four things together: a rule in the app's `AGENTS.md`, a lint check that fails when the branch changes app code or `agent-plugin/` but not `CHANGELOG.md`, a Vitest test that fails when the README leaves out a built-in plugin, contributed MCP tool, setting, `auri` skill or hook, and a version heading on each landing (round 1).
- The relay, chatroom hook and docs index stay Python. Data folders keep their paths (`~/.agents/wigley-forms/` and the others). Every reference to the old tool names is renamed in one pass. The AskUserQuestion hook moves into `auri`. The backlog file format is documented once, in the app (round 4 notices).
- The refactor lands in `ai` with today's tooling, and the repo move runs last (round 4 notices).
- Repo move: split the folder's full history with `git subtree split`, then scan it with TruffleHog and Betterleaks. The findings go to the user before any rewrite. Rewrite with `git-filter-repo`, re-scan a fresh clone, and replace `JonathonWigley/wigley-ai-gui`'s `main` with one force push, keeping no copy of the old history on GitHub. Each install and the force push are per-run asks (rounds 2 and 3).
- From then on, the app repo keeps the standing yes for `wigley-land` landings. Its landing check runs Betterleaks over new commits, and the user switches on GitHub secret scanning and push protection in the repo's settings (rounds 2 and 3).
- The app clone lives at `~/Documents/wigley-ai-gui`. The repo's visibility stays the user's call (round 2 notices).
- License: MIT, with a LICENSE file. `package.json` drops the user's work email and its boilerplate description (rounds 1 and 4).

Out of scope:

- Rewriting the doctrine skills to stand alone.
- Splitting the `wigley` plugin into several plugins.
- Per-project strategy picks.
- Agent plugins shipping app UI code.
- Making the repo public.
- A Codex harness adapter (only the `auri` plugin's Codex manifest ships).

## File Structure

The `auri.json` contract, the registry API and every type below are specified in full in
`wigley-ai-gui/docs/features/feature-contributions/design.md`. That document is the one source. This section
lists the names, and a task that needs a field reads the design.

### New folders and files

Paths are under `wigley-ai-gui/` unless they say otherwise.

- `agent-plugin/` — the `auri` agent plugin. It is the app's own plugin, passed to Claude Code with `--plugin-dir`
  and installable from the app's marketplace file.
  - `agent-plugin/.claude-plugin/plugin.json` — the plugin manifest: name `auri`, and the MCP server `auri` that runs
    `scripts/relay/relay.py`.
  - `agent-plugin/.codex-plugin/plugin.json` — the Codex manifest. Task 01 checks the path against the Codex plugin docs.
  - `agent-plugin/scripts/relay/` — `relay.py`, `endpoint.py`, `start_app.py` and the forms `README.md`, moved from
    `wigley-ai-marketplace/plugins/wigley/scripts/forms/` with their tests.
  - `agent-plugin/scripts/chatroom/` — `hook.py`, moved from the marketplace's `scripts/chatroom/` with its tests.
  - `agent-plugin/scripts/checklist/` — the checklist edit gate, the Stop reminder and the compact reminder.
  - `agent-plugin/scripts/ask-user-question/` — the hook that sends an AskUserQuestion call to a forms round.
  - `agent-plugin/scripts/docs-index/` — the docs index, moved from the marketplace's `scripts/docs-index/`, because
    only the app runs it.
  - `agent-plugin/hooks/hooks.json` — the chatroom, checklist and AskUserQuestion hooks.
  - `agent-plugin/skills/<skill>/SKILL.md` — the app-feature skills: forms, visuals, chatroom, workflows and checklist,
    backlog format, primer, audio picker, live view, writing `auri.json`.
- `.claude-plugin/marketplace.json` — the app repo's marketplace, listing `auri` at `./agent-plugin`, for terminal and
  Codex sessions.
- `src/shared/agent-plugin.ts` — the agent plugin's names and its folder helper.
- `src/contracts/contributions.ts` — the `auri.json` file types. Every feature and the registry import them.
- `src/plugins/contributions/` — the registry plugin (id `contributions`): `manifest.ts`, `contract.ts`, `main/`
  (scan, watch, dedupe, readers, problems) and `page/` (the `strategy:<feature>` and `strategy-list:workflows` control
  kinds). It is a plugin, not core, because AGENTS.md § Architecture puts every feature in a plugin.
- `src/plugins/workflow/declared/` — the workflows reader and the build of a `MainWorkflow` and a `PageWorkflow` from a
  `WorkflowDecl`, with the Checklist flow and one shared default layout.
- `src/plugins/workflow/plan/` — the plan capability: plan bookkeeping, the plan watch, `readPlan`, the plan side pane
  and `set_workflow_plan`. It lives in the `workflow` plugin, because the engine's predicates and templates read plan
  state directly, and a separate plugin would need a capability seam with one adapter.
- `docs/features/feature-contributions/design.md` — the `auri.json` contract.
- `README.md` — what the app is, setup an agent can follow, and every built-in plugin, contributed MCP tool, setting,
  `auri` skill and hook.
- `CHANGELOG.md` — a version heading per landing.
- `LICENSE` — MIT.
- `wigley-ai-marketplace/plugins/wigley/auri.json` — the user's strategies: four workflows, `planFormat`, `retro`,
  `backlog`, `docs`, `liveView`.

### Removed

- `src/plugins/workflow-small/`, `workflow-medium/`, `workflow-large/`, `workflow-spike/`, and the tests
  `src/plugins/workflow-large-main.test.ts`, `workflow-large-page.test.ts` and `workflow-levels.test.ts`, once their
  self-tests and demo samples run on fixture configs.
- `src/shared/wigley-install.ts` (`WIGLEY_PLUGIN_KEY`, `locateWigleyFile`).
- `src/shared/plan-progress.ts`, which moves into `src/plugins/workflow/plan/`.
- The marketplace's `scripts/forms/`, `scripts/chatroom/`, `scripts/docs-index/` and `hooks/hooks.json`, and the
  `mcpServers` entry in `plugins/wigley/.claude-plugin/plugin.json`.

### Existing files most changed

- Launch and naming: `src/plugins/claude-code/main/claude-launch.ts`, `src/plugins/claude-code/main/permission-route.ts`,
  `src/shared/platform.ts`.
- Engine: `src/plugins/workflow/contract.ts`, `flow.ts`, `main/start.ts`, `main/step-tool.ts`, `main/session-note.ts`,
  `manifest.ts`, `src/shared/plan-copies.ts`.
- Features: `src/plugins/auto-retro/manifest.ts` and `main/retro-queue.ts`; `src/plugins/backlog/main/assistant.ts`
  and `main/homes.ts`; `src/plugins/docs/kinds.ts`, `tree.ts`, `wiki-main.ts`, `main/doc-files.ts`,
  `main/script-locator.ts`, `main/index-sources.ts`; `src/plugins/live-view/main/start.ts`, `main/game-view-probe.ts`,
  `playtest-command.ts`.
- Wording: `src/plugins/chat/main/start.ts`, `src/plugins/chat/contract.ts`, `src/plugins/agent-strip/main/start.ts`,
  `src/plugins/visual/main/session-note.ts`, `src/plugins/chatroom/main/start.ts`,
  `src/plugins/forms/main/tool-definitions.ts`, `src/plugins/forms/main/kinds/question/question-format.ts`,
  `src/plugins/primer/main/tool-definitions.ts`.
- Unity pool off by default: `src/config/settings.ts` (`plugins.disabled`), `src/plugins/unity-pool/manifest.ts`,
  `main/pool-cli.ts`.
- Registration lists: `src/plugins/manifests.ts`, `main.ts`, `page.ts`, `keymap.ts`.
- Config problems: `src/main/config/config-store.ts` and the main services record.
- `package.json` (license, email, description), `AGENTS.md`.

### Shared names

The agent plugin (`src/shared/agent-plugin.ts`):

- `AGENT_PLUGIN_NAME = 'auri'`, `AGENT_SERVER_NAME = 'auri'`, `AGENT_PLUGIN_FOLDER = 'agent-plugin'`,
  `APP_PLUGIN_KEY = 'auri@app'`, `CONTRIBUTIONS_FILE = 'auri.json'`, `CONTRIBUTIONS_VERSION = 1`.
- `claudePluginToolName(plugin: string, server: string, tool: string): string` — gives
  `mcp__plugin_<plugin>_<server>__<tool>`.
- `agentPluginDir(appDir: string, paths: Paths): string` — gives `<appDir>/agent-plugin`.
- `RELAY_SERVER_NAME` equals `AGENT_SERVER_NAME`. `CLAUDE_PERMISSION_TOOL` equals
  `claudePluginToolName(AGENT_PLUGIN_NAME, AGENT_SERVER_NAME, PERMISSION_TOOL_NAME)`, which is
  `mcp__plugin_auri_auri__permission_prompt`.

The file types (`src/contracts/contributions.ts`): `FeatureKey` (`'workflows' | 'planFormat' | 'retro' | 'backlog' |
'docs' | 'liveView'`), `AuriFile`, `WorkflowDecl`, `StageDecl`, `TriggerDecl`, `PredicateDecl`, `CounterDecl`,
`ActivityDecl`, `ActionDecl`, `PlanFormat`, `RetroContribution`, `BacklogContribution`, `DocsContribution`,
`CommandPattern`, `LiveViewContribution`.

The registry (`src/plugins/contributions/contract.ts`):

- `ContributionSource { pluginName; pluginKey; version; root; harnessId }`.
- `FeatureReader<V> { label; read(section: unknown, source: ContributionSource): ReadResult<V> }` and
  `ReadResult<V> = { ok: true; value: V } | { ok: false; reasons: string[] }`.
- `Strategy<V> { id; label; source; value }` and `FeatureStrategies { key; label; strategies }`.
- `ContributionsMainExports`:
  - `registerFeature<V>(key: FeatureKey, reader: FeatureReader<V>): Disposable`
  - `strategies<V>(key: FeatureKey): readonly Strategy<V>[]`
  - `onChanged(key: FeatureKey, listener): Disposable`
  - `ready: Promise<void>`
- `contributionsMainKey` (`{ id: 'contributions', process: 'main' }`).
- `contributionsFeaturesSlot` (`contributions.features`, main, keyed by feature key).
- `pickStrategy<V>(strategies, setting: string): StrategyPick<V>`, where `StrategyPick` is `picked`, `none`, `choose` or
  `missing`.
- `strategyControlKind(key: FeatureKey): string`, which gives `strategy:<key>`, and
  `WORKFLOW_LIST_CONTROL_KIND = 'strategy-list:workflows'`.

The main service `services.configProblems: ConfigProblemsService { set(problems: readonly ConfigProblem[]): void }`,
one view per plugin. The ConfigStore serves these problems after the plugin catalog's problems.

The engine (`src/plugins/workflow/contract.ts`):

- `CHECKLIST_WORKFLOW_ID = 'checklist'` and `CHECKLIST_WORKFLOW: WorkflowDecl`.
- `qualifiedWorkflowId(pluginName, id)`, which gives `wigley:large`.
- `actionCommandShortId(workflowId, actionId)`, which gives `wigley-large-clearAndMake`.
- `DeclaredWorkflow { id; pluginName; decl; planFormat }`.
- New `SessionFlow` fields: `checklistReported`, `plan: PlanState | null`, `counters`, `enteredFrom`,
  `countdownEndsAt`.
- `PlanState`, `PlanProgress`, `PlanTaskLine`.
- `readPlan(text, taskDocs, format): PlanProgress`.

Setting paths:

| Path | Default | Control kind |
|---|---|---|
| `auto-retro.strategy` | `''` | `strategy:retro` |
| `backlog.strategy` | `''` | `strategy:backlog` |
| `workflow.off` | `[]` | `strategy-list:workflows` |
| `workflow.autoStart` | `[]` of `{ workflow, seconds }` | `json` |
| `workflow.layout` | `'default'` | `layout` |
| `unity-pool.scriptPath` | `''` | `string` |

Removed settings: `auto-retro.folder`, `workflow-large.autoClearAndMake`, `workflow-large.autoStartSeconds` and the four
`workflow-*.layout`. The task that removes a setting also edits `~/.config/wigley-ai-gui/settings.json` to match.

Slot and tool names: `contributions.features`, and `workflow.flows` (unchanged). `set_workflow_step` lists the `step`
values of every enabled declared workflow. `set_workflow_checklist` is contributed to every session.
`set_workflow_plan` is contributed while an enabled workflow uses the plan capability.

Names the drafting added (each with the task that produces it):

- `MainServices.appDir: string` (`app.isPackaged ? process.resourcesPath : app.getAppPath()`) and `agent-plugin` in
  `forge.config.mts` `extraResource` ← 01. `src/shared/agent-plugin.ts` itself, and the `appFolder()` helper in
  `plugin-types.ts` ← 01.
- `claudeLaunch(…, pluginDir: string)` and `ClaudeSpawnInput.pluginDir` ← 02.
- `HarnessConfigRoots.installedPluginsFile`, `ConfigStore.setServiceProblems`, `FEATURE_KEYS`,
  `src/shared/contributions-schema.ts` (`auriFileSchema`), and `pickProblemText(featureLabel, pick)` ← 03.
  `qualifiedWorkflowId` is defined in `src/contracts/contributions.ts` (← 03) and re-exported from
  `workflow/contract.ts`. The `ActivityTone` and `RowEmphasis` unions move into `src/contracts/contributions.ts`
  (← 03), since the layer check refuses the import the other way, and `sessions/contract.ts` re-exports them.
- `workflowDeclaredSlot` (`workflow.declared`), `WorkflowChannel`, `AutoStartSetting`, `MainWorkflow.foldFields` and
  `afterStage`, the new `WorkflowSignal` variants, `WorkflowSelfTestHooks.addDeclared`, `WorkflowDrawOptions.badgeColor`,
  and the `declared/` seams `PlanFold`/`NO_PLAN_FOLD`, `PlanPane`/`NO_PLAN_PANE`, `usesPlan`, `buildMainWorkflow`,
  `buildPageWorkflow` ← 04. `EnabledWorkflows` (`enabledWorkflows()`, `onWorkflowsChanged()`, `workflowOf()`) and
  `createEnabledWorkflows()` in `declared/enabled-workflows.ts`, and the test-only `designDeclared` in
  `declared/fixtures.test-support.ts` ← 04. `createPlanFold()` and `createPlanPane` replace the two `NO_*` values ← 05.
- `registerSampleDemoSteps(services, deps)` in `page/sample-demo-steps.ts` ← 06.
- `AUTO_ANSWER_GATE_CLAUSE` in `chat/contract.ts` ← 11.
- `CHECKLIST_HOOK = 'workflow.checklist'` ← 04. Request: any line. Reply: `{ reported: boolean, open: number, items:
  { text, done, running? }[] }`. `reported` is true once a checklist or a plan (`set_workflow_plan`) was reported; with
  only a plan, `open` and `items` come from the plan's task lines. No flow → `{ reported: false, open: 0, items: [] }`.
- `DocsMainExports.setFeaturesHomes(homes)`, `src/plugins/docs/features-homes.ts` (`templateProblem`,
  `inRepoHomeParts`, `outOfRepoHomeFolders`), `docsBindingSlot` ← 09. The marketplace's own pointer parser copy
  `wigley-ai-marketplace/scripts/pointer_parser/` ← 09.
- `agent-plugin/scripts/relay/hook_client.py`, `agent-plugin/scripts/checklist/`, `agent-plugin/scripts/ask-user-question/`
  ← 12.
- The `auri` skill folders under `agent-plugin/skills/` (docs written ahead): `audio-picker`, `backlog-format`,
  `chatroom`, `forms`, `live-view`, `primer`, `visuals`, `workflows-and-checklist`, `writing-auri-json`.
- npm scripts `lint:changelog`, `lint:boundary` (both chained by `lint`) and `changelog:release` ← 15.
- The app marketplace in `.claude-plugin/marketplace.json` is named `auri`: terminal installs use `auri@auri` ← 01.
  The `auri` manifests' version equals `package.json`'s, settled by `changelog:release` and checked by
  `lint:changelog` ← 15.
- The `wigley` plugin bumps MAJOR once, in task 01. Tasks 13 and 14 bump only when 01's bump is already on origin
  (13 § Version).

### Boundary rules

- Nothing under `wigley-ai-gui/` names `~/wigley-agents`, `wigley-features`, `wigley-ai-marketplace`, a `wigley:` skill,
  the `wigley` plugin key, `WigleyCapture`, `capture.py`, `plan.py` or a `unity-pool` path. The exceptions are test
  fixtures, the demo's sample data, and the docs under `docs/features/`. Task 15's check greps for these names.
- Every personal binding comes from a contribution, and every feature reads contributions only through the
  `contributions` plugin's exports or slot.
- No reader reads a file. A feature that needs a file under a plugin resolves it against `ContributionSource.root`.
- An agent plugin carries no app UI code. `auri.json` is data only.
- The relay, the hooks and the docs index stay Python, with the standard library only.
- Data folders keep their paths, and task 15's boundary check allows them (`~/.local/state/unity-pool/` included): `~/.agents/wigley-forms/`, `~/.agents/wigley-docs/`, `~/.agents/wigley-primer/` and
  the others.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 01 → 03 → 04 → 05 → 06 → 13 → 14 → 17 → 16 → 18

### Wave 1
- [x] [The auri agent plugin scaffold](01-auri-agent-plugin.md)

### Wave 2
- [x] [Contributions registry](03-contributions-registry.md) — after 01
- [x] [wigley-land lands the app repo](19-wigley-land-app-repo.md) — after 01

### Wave 3
- [x] [Launch wiring](02-launch-wiring.md) — after 01, 03
- [x] [Declarative workflow engine and Checklist flow](04-workflow-engine.md) — after 03
- [x] [Retro](07-retro.md) — after 03
- [x] [Docs and the docs index](09-docs.md) — after 01, 03
- [x] [Live view](10-live-view.md) — after 03

### Wave 4
- [x] [Plan capability](05-plan-capability.md) — after 04
- [x] [Backlog](08-backlog.md) — after 03, 09
- [x] [App notes and tool wording](11-app-notes.md) — after 01, 02, 04
- [x] [The auri hooks](12-auri-hooks.md) — after 01, 04

### Wave 5
- [x] [Retire the level plugins](06-retire-level-plugins.md) — after 04, 05

### Wave 6
- [x] [The wigley plugin's auri.json](13-wigley-auri-json.md) — after 01, 06, 07, 08, 09, 10

### Wave 7
- [x] [Personal rules rename](14-personal-rules-rename.md) — after 01, 12, 13
- [x] [README and changelog checks](15-readme-changelog-checks.md) — after 01–13

### Wave 8
- [ ] [Repo move](17-repo-move.md) — after 01–15, 19

### Wave 9
- [x] [Doc re-read](16-doc-reread.md) — after 17

### Wave 10
- [ ] [Final verification](18-final-verification.md) — after 16, 17

## Run log

Review base: 35f62ddac

### Groups
- 01 · hard · 8f40515f6 b64e14f07 · diff read: every Produces present (agent-plugin.ts names, appFolder, MainServices.appDir, manifests, hooks, marketplace, moves, wigley 3.0.0); typecheck, lint, check_manifests, claude plugin validate x3 pass; Python and npm tests wait for the test gate · concerns: check-layers had no entry for agent-plugin.test.ts (fixed in b64e14f07, same rung); oxfmt also flagged 5 pre-existing Markdown files from main, formatted; check_pointers fails only on 4 pre-existing ~/wigley-agents/learning/candidates headings, outside this diff; retro ledger files and forms.md line 14 still name old paths (task 14)
- 03 · deep · 9125a450a 95fe3eef5 · diff read: every Produces present in contracts/contributions.ts, contributions/contract.ts, plugin.ts, agent.ts, config-store, plugin-types; wave 2 typecheck and lint pass after the fix commit; tests wait for the test gate · concerns: TS2589 on the slot publish fixed with a local cast key (values unknown) in main/start.ts; start.test.ts debounce rows rest on harness timer assumptions, never run; page/start.ts slot sync untested; tell now iterates the live listener set; no-thenable warning on ActionDecl then left
- 19 · hard · 87f2f1e05 · diff read: repo_kind, APP_REPO, scan_secrets, auri update with installed-only skip, README modes present; both files parse; suite waits for the test gate · concerns: a landing with no pull scans main..branch but pushes origin/main..main, so earlier unpushed main commits go unscanned; betterleaks --redact/--exit-code unchecked against the binary (task 17); skip-betterleaks test PATH assumption
- 02 · standard · bda3396a9 · diff read: Produces present per report and spot reads; wave 3 typecheck and lint pass; tests wait for the test gate · concerns: liveStart test asserts on the fake session host's spawn (the ProcessRunner route the plan named is never reached)
- 10 · hard · 9fec618a4 6883c8d0b · diff read: Produces present per report and spot reads; wave 3 typecheck and lint pass; tests wait for the test gate · concerns: wigley-ai-gui/AGENTS.md 339-341 still describe capture.py; oxfmt fixes rode in task 09's fix commit
- 07 · deep · 0e5e7039c · diff read: Produces present per report and spot reads; wave 3 typecheck and lint pass; tests wait for the test gate · concerns: wigley-ai-gui/AGENTS.md 347-351 and docs/features/auto-retro/design.md still name /wigley:retro auto and the folder setting; tsconfig is not strict, so StrategyPick narrowing is checked loosely
- 09 · deep · 05e68a119 6883c8d0b · diff read: Produces present per report and spot reads; wave 3 typecheck and lint pass; tests wait for the test gate · concerns: AGENTS.md line 116 still says docs reads wigley-install.ts; marketplace followups.md holds docs-index follow-ups now owned by the app
- 04 · deep · 2ec509037 ef5ca1ea4 · diff read: Produces present per report and spot reads; wave 3 typecheck and lint pass; tests wait for the test gate · concerns: level page tests may trip on the Checklist flow's page half; strategyOf now lives in declared/fixtures.test-support.ts, which 06 replaces
- 05 · deep · ebbcb3765 2545d311d · diff read: startPlanCapability, createPlanFold, createPlanPane present and wired in main/page start.ts; wave 4 typecheck + lint pass after one test fix (AppInstance id literal, two spreads) · concerns: capability test builds the engine from foldFlow/buildMainWorkflow, so main/start.ts wiring is unexercised until 06/18; stage expectations rest on 04's engine rules, unrun
- 08 · hard · e01c387f6 · diff read: backlogReader, strategy setting, contributions dependency, setFeaturesHomes call, assistantInstructions present; wave 4 typecheck + lint pass · concerns: fixtureStrategy throws if DOCS_FIXTURE_BINDING.features is null; pickProblemText ?? '' only for the type
- 11 · hard · 83b612921 · diff read: notes and tool descriptions name auri: skills (folders checked in agent-plugin/skills/); AUTO_ANSWER_GATE_CLAUSE shared; unity-pool in default plugins.disabled; resolveScriptPath gone; one quoting break in the primer description fixed before commit; wave 4 typecheck + lint pass · concerns: stale docs outside the task: docs/features/unity-pool/design.md:123-125 and docs/features/followups.md:350 describe the removed scriptPath fallbacks (to task 16)
- 12 · hard · 3e205f034 · diff read: hook_client.py shared by chatroom and checklist hooks; checklist edit/stop/compact and AskUserQuestion hooks; four hooks.json entries checked by agent-plugin.test.ts; wave 4 typecheck + lint pass · concerns: Stop row compares matcher: undefined to an entry with no matcher key (toEqual should match, unrun); reminder reads '1 open items' for one item
- 06 · hard · 5af2b120a c7288b4c8 · diff read: sample-auri.json, SAMPLE_AURI_FILE, SAMPLE_PLUGIN_NAME, sampleDeclared present; four plugins and shared plan-progress/plan-copies removed; wave 5 typecheck + lint pass after one fixture fix round · concerns: plan-watch-driven sample Large rows (RunLog_LargeClosed fixCycles 2, Open_SavedCountdown_RunsNone) unrun; docs/features/agent-chat/design.md:577 still says one self-test script per plugin (task 16); ~/.config/wigley-ai-gui/layouts/workflow-{large,medium,small,spike}/ left as user state
- 13 · standard · ca20d7316 · python3 parse: key order version..liveView; workflows and planFormat equal sample-auri.json; retro/backlog/docs/liveView match the pinned values; check_manifests.py passes · concerns: none
- 14 · hard · e03dd181d · diff read: personal files keep only additions and point at auri skills; wigley visuals/chatroom skills deleted; workflow-gate reads declared_level_skills from installed auri.json and is_app_session from WIGLEY_SESSION_ROW, checklist halves removed; py_compile + check_manifests pass; its pytest suites wait for the test gate (no pytest on python3 here) · concerns: machine edits (settings.json AskUserQuestion group and workflow-gate Stop group, ask-user-question-to-forms hook, AGENTS.local.md) held in scratchpad machine-edits-14.md for the landing; once on main the old checklist gate stops until the app ships auri hooks; the gate passes every edit until the installed wigley plugin carries auri.json; Verification grep needs one more exclusion for answers.py:36; wiki/Main.md visuals link is a file path for task 17's sweep
- 15 · hard · c15be8077 · diff read; wave 7 typecheck + full lint pass: layers, styles, changelog (entry under Unreleased), boundary (2176 files clean), oxlint, oxfmt · concerns: forms-tools.golden.txt edited by hand; readme-coverage.test.mts unrun; docs/features/live-view/design.md:92 names the deleted wigley-install.ts (task 16); the exits-1 proof must first remove the branch's own Added line
- 16 · standard · 924dfd766 · Five lanes (reports/16-agents-1, 16-readmes-1, 16-skills-1, 16-ai-1, 16-design-1): app AGENTS.md, READMEs and CHANGELOG, every agent-plugin and .agents skill, keymap, DESIGN.md, and 14 feature designs read and checked against landed src; the ai side's 40-odd skills and agent docs hunk-checked plus a stale-name grep, its six core docs read in full. Lead diff read. npm run lint passes; readme-coverage test passes; the planned-mark grep leaves only README.md:21 (the repo split, task 17). check_pointers.py fails only in wigley-agents/learning/candidates (wigley:visuals, wigley:chatroom names, three § headings), which the retro owns. · concerns: Path references to the app inside ai left for 17's sweep. builds-marked lines (README auri:builds row, keymap km/m, agent-plugin/skills/builds) wait on the Builds run. followups' isStringOrNull copy list may be stale. learning/ candidates name retired wigley:visuals/chatroom skills; the retro owns them. The 1.1.0 release commit was undone and is re-cut after the Builds land.
### Contract changes
### Rulings
- test_record_fields.py's README opening sentence kept verbatim since the test matches it · group 01
- relay README 'Registering the server' describes the built state, including task 02's --plugin-dir launch · group 01
- registerFeature<V>(key, reader: FeatureReader<V> & JsonSlot<V>) replaces V extends JsonValue: interface values cannot extend the recursive JsonValue (consumers 04 07 08 09 10, call sites unchanged) · group 03
- JsonValue defined in contracts/contributions.ts (no app-wide type existed) · group 03
- userValue moved from settings setting-rows.ts to shared/json.ts so the workflow-list control kind can use it · group 03
- several reasons from one refused section make one problem, lines joined by newline · group 03
- RepoKind namedtuple (AI_REPO, APP_REPO) chosen once by repo_kind replaces require_ai_clone · group 19
- secrets stage is a sub-item of README step 4 so steps keep their numbers · group 19
- the row 'unity --project-path P command editor_play' now expects start(P), the planned widening · group 10
- PlaytestWatchDeps gains patterns(); live-view-reader exports playtestPatternsOf and probeScriptOf · group 10
- with no pick, one 'retro not queued' line per distinct pick JSON; a strategies or settings change re-commits the queue · group 07
- createTarget, placesFor, buildTree, buildWikiTree, locateScript take the docs binding or pluginDir (contract changes inside docs only) · group 09
- check_pointers.py imports a copy of the parser at wigley-ai-marketplace/scripts/pointer_parser/ · group 09
- PageBuildDeps gains openDoc(path) and paths (consumers 05, 06): declared/ is the root layer · group 04
- counters reset on any claim; a countdown starts only on a stage change into an auto stage; addDeclared ignores workflow.off and an already enabled id wins · group 04
- 05: FollowedPlan is {dir, reported, unreportedDir, format}; a format change reopens the watch · group 05
- 05: PlanCopyDeps gains format and drops files.list (changedAt from linked task docs); PlanReporterDeps is {workflow, workflowOf}, planWorkflowOf exported; PlanToolDeps gains planWorkflowOf · group 05
- 05: set_workflow_plan answers Ignored before it stats the plan file; counter snapshots fill only in a stage that records them; the plan endpoint folder is computed only while a plan workflow is enabled · group 05
- 08: the pick is held as a BacklogBinding in start.ts; a pick change with the same binding does not redraw; setFeaturesHomes is called when the registry first answers, then only when homes change · group 08
- 08: with no pick the load reads no machine index; check-layers lets backlog main import docs features-homes.ts and docs' selftest-fixture.ts (its own sublayer); repo-folder.ts exports climbFolder and endsWithParts · group 08
- 11: user settings.json gained plugins.disabled (without unity-pool, so it stays on for the user) and unity-pool.scriptPath ~/.local/bin/unity-pool; backup in the scratchpad · group 11
- 11: an empty scriptPath answers no-cli 'No unity-pool script is set' with no stat; the start-test harness defaults to a set script path · group 11
- 12: the fake hook app is shared as relay/tests/fake_hook_app.py; over the 10,000-char cap the compaction list ends on the … line without the footer; is_gated runs before the app is contacted · group 12
- 06 (lead): one plugin may hand several self-test scripts; selftest.ts drops its second-script throw, a plugin filter runs every script of that plugin, the four sample scripts' groups carry a level prefix; src/contracts/plugin.ts, selftest.ts, selftest-config(.test).ts edited outside Files · group 06
- 06: SampleDemoDeps is {showSample, addWorkflow, createDraw(workflow), planPane, runAction, openDoc}; demo page halves register no commands or keys · group 06
- 06: sample Large main rows live in main/start.test.ts ('the sample Large'); fixtures.test-support.ts renamed sample-fixtures.test-support.ts; SessionFlow drops state · group 06
- 06: engine behaviour now asserted: an untitled closed stage's detail is ''; {plan} actions hide while a flow has no plan dir; a template whose every variable is 0 renders '' · group 06
- 14 (lead): machine files are not edited during the task; the edits wait for the landing · group 14
- 14: no version bump, task 01's 3.0.0 bump covers the deleted skills · group 14
- 15: addedEntryLines also counts entries in a version section origin/main lacks, so a branch passes after changelog:release · group 15
- 15: sample-auri.json moves to declared/fixtures/; SAMPLE_PLUGIN_NAME and sampleQualified live in src/shared/sample-plugin.ts; check-layers lets notes main import docs' selftest-fixture.ts · group 15
- Pre-split land: main merged into shareable-app (7078d72af); the suite went green with 969c2a731 (workflow page drew each flow twice on a live restart; four stale tests; readme-coverage reads leaf setting paths). Landed dda8d291b, then Auri reinstalled and task 14's machine edits applied on the user's form yes. 17 step 3's changelog:release ran after that land, in a fresh worktree, and lands on its own.
- 17 scans (user's pick): both scanners run offline first (trufflehog --no-verification --no-update, betterleaks without --validation); only if findings turn up does the user pick which to verify. The plan's betterleaks '--validate' flag is '--validation' in 1.10.1. Tools checked before running: trufflehog 3.100.1, betterleaks 1.10.1, git-filter-repo 2.47.0, no open advisory touching this use.
- 17 peer: Builds Plan Run's 'builds' branch holds 21 app commits main lacks; asked in chat (msg 1227) whether it lands before the split or is carried as a split branch.
- 16 moved ahead of 17 (wave move): Builds Plan Run asked the split to wait 60–90 min for its land, so 16 runs now in ai; its edits are path-neutral (references to the app inside ai stay for 17's sweep) and land after builds so its README/AGENTS.md edits don't conflict with that run. Four lanes by size (~790k chars): app AGENTS.md; app READMEs, changelog and known-stale design lines; app skills, keymap, DESIGN.md; the ai side plus personal files. The ai-side skills and agent docs, touched only for renames, get a hunk check plus stale-name greps rather than a full read.
- Review moved ahead of 17 while the split waits on the Builds land: wigley:review covers 01–16 and 19 (35f62ddac..HEAD, main's merged commits excluded by the lanes' commit list), its fixes land with 16 before the split, and 17's own commits get a separate review range after the move.
### Review rounds
### Test gate
