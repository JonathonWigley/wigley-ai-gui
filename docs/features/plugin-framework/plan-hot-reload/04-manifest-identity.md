# 04 — Manifests declare a label and a description

Status: not started
Type: Parallel
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/plugin.ts` (`PluginManifest`) · `src/shared/define-plugin.ts` (the parameter type and its comment)
- modify every built-in manifest, `src/plugins/<id>/manifest.ts`: 25 files (measured at plan time, re-verify with `ls src/plugins/*/manifest.ts | wc -l`). The table below names each one.
- modify the test fixtures the compiler then flags. Measured at plan time (re-verify with `npm run typecheck`, and fix every file it names):
  - `definePlugin(` calls: `src/shared/define-plugin.test.ts` · `src/shared/define-plugin.test-d.ts` · `src/shared/plugin-part-harness.test.ts` · `src/shared/plugin-part-harness.test-d.ts` · `src/shared/page/fake-list-picker-service.test.ts` · `src/shared/state/slot-store.test-d.ts` · `src/main/config/user-config.test.ts` · `src/main/config/config-store.test.ts`
  - object literals typed `PluginManifest`: `src/shared/plugin-manifests.test.ts` (`manifest()`) · `src/shared/plugin-host.test.ts` (`part()`) · `src/shared/plugin-part-harness.test-support.ts` (`providerManifest()`) · `src/renderer/plugins/page-api.test.ts` · `src/main/plugins/main-api.test.ts` · `src/main/config/config-store.test.ts` (`clashing`)
  - a fixture that spreads a real manifest (`...sessionsPagePart.manifest`) or casts through `as unknown as` needs no change.
- test `src/plugins/manifests.test.ts`

Consumes:
- `src/contracts/plugin.ts` after task 02 (`ready?` and `mayStop?` on `MainStart` and `PageStart`) ← 02. This task edits only `PluginManifest` in that file.
- The manifests after Wave 3 ← Wave 3 (re-verify). Wave 3 tasks 01, 02, 04, 05 and 06 add commands to the agent-strip, visual, sessions, docs, notes, backlog, settings, unity-pool, forms, primer, workflow and workflow-heavy manifests. This task adds two fields beside `id` and touches nothing else, so apply it to the landed files.

Produces:
- `PluginManifest` in `src/contracts/plugin.ts` gains, directly after `id`:
  ```ts
  // The plugin's name as Settings' Plugins section shows it, in sentence case (`Agent lines`).
  label: string;
  // One sentence on what the plugin adds for the user, as Settings' Plugins section shows it.
  description: string;
  ```
- `definePlugin`'s parameter type in `src/shared/define-plugin.ts` gains `label: string; description: string;` after `id: Id;`. Both are required. Its comment gains one sentence: `` `label` and `description` name the plugin in Settings' Plugins section. ``

Decisions:
- **Sentence case.** The first word capitalised, a proper name (`Unity`) kept.
- **The words are copy.** The agent wrote them from each manifest's header comment and the `AGENTS.md` Architecture list. The user can change them later. Write each one verbatim from the table.
- **No runtime check.** The compiler requires both fields. `definePlugin` adds no throw for a blank string; the content check in Tests covers the shipped manifests.
- **Settings' section titles stay.** `userConfigSchema` in `src/main/config/user-config.ts` keeps `capitalised(manifest.id)` for each plugin's settings section. This task changes nothing the user sees.
- **Placement.** Each manifest puts `label` and `description` directly after `id`, in that order.
- **Fixtures.** A fixture's label is its id (`label: 'p'`). Its description is `'A test plugin.'`. A builder that takes overrides keeps them.

The pattern, once: open `src/plugins/<id>/manifest.ts`, and add the two lines after `id: '<id>',`:

```ts
  label: '<label>',
  description: '<description>',
```

Each manifest's values:

| Manifest | `label` | `description` |
|---|---|---|
| `agent-lines` | `Agent lines` | `Shows a working line under each session row while its agents run subagents or tasks.` |
| `agent-skills` | `Agent skills` | `Lists the skills each session's agents started, in the Skills section of the session hub.` |
| `agent-strip` | `Agent strip` | `Shows a box for each subagent and task above the Chat composer.` |
| `agents` | `Agents` | `Tracks the subagents, tasks and skills each session runs, for the views that draw them.` |
| `auto-compact` | `Auto compact` | `Compacts an idle session whose prompt cache is cold before the next message, when its context is large.` |
| `backlog` | `Backlog` | `Adds Backlog mode, with the follow-ups, plans and primed features of every features home.` |
| `chat` | `Chat` | `Runs agent sessions in the Chat tab, with the transcript, the composer and the start prompt.` |
| `docs` | `Docs` | `Adds Docs mode and a Docs tab in each session, to browse and edit agent docs.` |
| `forms` | `Forms` | `Shows each review round an agent asks in a Form tab, where you answer it.` |
| `gallery` | `Gallery` | `Adds Gallery mode, a debug view of every design primitive in every state.` |
| `keys` | `Keys` | `Shows key hints: which-key while a key sequence waits, and the help overlay of every key.` |
| `notes` | `Notes` | `Adds a note popup over every mode that sends a note to a follow-up or to a new session.` |
| `primer` | `Primer` | `Shows each feature primer an agent opens in a Primer tab, where you answer it.` |
| `session-log` | `Session log` | `Records each session's start and end, and offers closed sessions again in the start prompt.` |
| `sessions` | `Sessions` | `Adds Sessions mode, with a sidebar row for each agent session beside its panes and tabs.` |
| `settings` | `Settings` | `Adds Settings mode, to change every setting and key bind.` |
| `unity-pool` | `Unity pool` | `Shows which Unity pool clone each session holds, with Hold and Release buttons.` |
| `usage-tab-line` | `Usage tab line` | `Shows each session's usage line in its tab bar.` |
| `usage` | `Usage` | `Shows plan usage in the status bar, and each session's context and spend.` |
| `visual` | `Visuals` | `Draws the html code blocks an agent writes as live visuals, with a full-size view.` |
| `window` | `Window` | `Adds the command that brings the app forward from any other app.` |
| `workflow-heavy` | `Heavy workflow` | `Tracks a planned run from primer to close, with its stage actions and Clear & make.` |
| `workflow-light` | `Light workflow` | `Tracks a small change through scope, build, check and land.` |
| `workflow-medium` | `Medium workflow` | `Tracks a change with one review through interview, build, review, fix and land.` |
| `workflow` | `Workflow` | `Shows each session's workflow on its row, above the composer and in a side pane.` |

A manifest the tree holds that this table does not name stops the task: report it, and add no words for it.

GIVEN a manifest without `label` or `description` WHEN the project compiles THEN the compile fails at that manifest.
GIVEN the 25 built-in manifests WHEN the content check runs THEN each has a label and a description that are not blank, and no two labels are equal.

Tests:
- `src/plugins/manifests.test.ts`, new `manifests_LabelsAndDescriptions_FilledAndLabelsUnique`. This is a content check: it reads the shipped `manifests` list on purpose. It asserts that each manifest's `label.trim()` and `description.trim()` are not `''`, and that the set of labels has one member per manifest. Its failure message names the plugin id and the field, for example `agent-lines has a blank description`, or names both ids that share a label. It catches a manifest added with an empty string, and two plugins that Settings would show under one name.
- No type test. The compiler already rejects a manifest without the fields (`wigley:writing-tests` § What earns neither).

Done when: `npm run typecheck` passes; `grep -c "^  label: '" src/plugins/*/manifest.ts` prints 1 for each of the 25 files; the test gate runs `manifests.test.ts` and every test file this task edited.
Commit: one commit for the group.

## Proof
