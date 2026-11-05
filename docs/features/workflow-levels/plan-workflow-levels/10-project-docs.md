# 10 — Project docs and follow-ups

Status: not started
Type: Batch
Wave: 8 · Depends on: 08, 09
Plan: [plan.md](plan.md)

Repo paths are relative to the wigley-ai-gui worktree. Every edit follows `wigley:writing-for-agents`. Line numbers are from `abe4d1d6`: find each passage by its words, because earlier tasks may move it.

Files:     modify `AGENTS.md` · modify `docs/features/workflow/design.md` · modify `docs/features/workflow-levels/design.md` · modify `docs/features/followups.md` · modify `~/.agents/AGENTS.local.md` (never committed)

           Left unchanged, checked at plan time:
           - `~/wigley-agents/AgentsStandardMapping.md`: § Tools holds no list of tools. It names `unity-pool` only as the example of a one-command install, and `command grep -n wigley-repo-files` finds nothing in it. § Setting up a machine has no tool step.
           - `plugins/wigley/scripts/forms/README.md`: it documents the forms tools only. `command grep -c set_workflow` prints 0, and the plan does not change the relay.

Consumes:  `workflow-light` ← 07 · `workflow-medium` ← 08 · `tools/workflow-gate/workflow-gate`, `tools/workflow-gate/README.md` ← 09 · `workflow-heavy`, its `HEAVY_COMMANDS` and its settings ← 05 · `SET_WORKFLOW_CHECKLIST_TOOL` in `workflow/main/checklist-tool.ts` and the scoped `set_workflow_step` ← 03 · `runs.jsonl` ← 04 · `addWorkflow`, `createWorkflowDraw` ← 01, 02

Produces:  no code name. The doc changes below.

Decisions:

**`AGENTS.md`**

- § Architecture plugin list, the `workflow/` entry (lines 269–276): rewrite it as the engine. It holds flows, the fold, the row, composer and side part hosts, `set_workflow_step` and `set_workflow_checklist` through `contributeTools`, `runs.jsonl` and `addWorkflow`. It names no skill, stage or plan. Point at `docs/features/workflow/design.md` and `docs/features/workflow-levels/design.md`.
- Add three entries after it, in the list's shape: `workflow-heavy/` (Heavy's stages, plan reading, the plan watch, Clear & make, the auto-start, its layout), `workflow-light/` and `workflow-medium/` (each its stages, its skill rule, its layout, its self-test).
- The row part list (line 382, "workflow's stage chip … are five"): make it name what the row draws now: the badge, the stage text and the `No workflow` tag. Take the wording and the count from the `addRowPart` calls as landed.
- The chat exports line (line 243, "`send`, `clear`, `launch` and `profileOf` to workflow"): `workflow-heavy` takes these now. Name each plugin as the code imports it.
- The composer part (line 393) and side part (line 399) passages: keep "the workflow plugin" only if the engine still registers the part, which task 02 decides. Read the code.
- The layout preview line (line 437, `Space z l w`): keep the chord. Name what the preview shows now.
- § Running and testing self-test list (lines 808–809): replace `src/plugins/workflow/main/selftest-script.ts` with `src/plugins/workflow-heavy/main/selftest-script.ts` for Heavy, `src/plugins/workflow-light/main/selftest-script.ts` for Light and `src/plugins/workflow-medium/main/selftest-script.ts` for Medium.
- Run `command grep -n -E 'set_workflow|workflow' AGENTS.md`. Check each hit against the code, and fix what is stale.

**`docs/features/workflow/design.md`**

This doc becomes the engine's doc, with Heavy's stages kept in it. A change that adds a stage to Heavy still needs the table. `docs/features/workflow-levels/design.md` stays the short why.

- The opening and § Status: the engine, the three workflow plugins, and where each lives. The opening's stage list starts at Primer or Explore, since they share the first step. The Status line names `workflow-heavy/main/selftest-script.ts`.
- § Vocabulary: add workflow, level, checklist and run log, in the words of the `workflow-levels` doc. The Trail line says "Explore to Close": make it each workflow's steps.
- § Stages: rename it Heavy's stages. Add one table each for Light and Medium, in the same columns, from their `stages/*/{main,page}.ts`. Add the rule that a session with `workflow === null` draws nothing but the `No workflow` tag after a live turn ends.
- **The Heavy table.** Each row matched `stages/*/{main,page}.ts` at `abe4d1d6` (plan-time check), so what goes stale is what this plan moves. Check each row again against `workflow-heavy/stages/*/{main,page}.ts` and correct it:
  - The idle row: a session starts with no workflow, so a Heavy flow enters `idle` only on `handedOff` or Dismiss.
  - The sentence "A report moves the flow only from one of them, so a session outside a run shows no feature step": plan.md's decision replaces that rule's reason. A standalone skill shows its level through the level skill.
  - "`wigley:make` starting moves any stage to make": it now also claims the flow for Heavy.
  - Plan fields live in `flow.state` (`HeavyState`).
- § Stage modules: remove `addStage`. A workflow plugin hands `stages` through `addWorkflow` in each process. `WORKFLOW_COMMANDS` becomes each owner's commands (`HEAVY_COMMANDS`). `foldFlow` runs only the flow's current workflow's rules. The test path `stages/main-stages.test.ts` moves under `workflow-heavy`. Add how to add a workflow: a new plugin folder, its claims, its stages, its layout, no engine edit.
- § Signals: add `checklistReported` and `custom`; add `set_workflow_checklist`; the plan rows name `workflow-heavy`'s plan watch; `set_workflow_step`'s `step` values are the current workflow's `reportedAs`, not one fixed list. Add the claim rule: a claim by another workflow sets `movedUpFrom`, and `state` starts at null. Add the run log, with its pinned keys.
- § Where it draws: the badge, the `No workflow` tag in `--wg-status-error`, and the side pane's section title per workflow (`Plan` for Heavy, `Checklist` for Light and Medium). Each workflow draws through its own layout folder (`layouts/workflow-light/<name>/`), over the engine's contract and kit.
- § Auto-start: `workflow-heavy.autoClearAndMake` and `workflow-heavy.autoStartSeconds`.
- § Keys: chords do not change; the five ids are now `workflow-heavy.*`.
- § Decisions: add "Actions are commands of the owner plugin". The Decisions entries for the side pane's plan checklist stay as Heavy's.
- § Out of scope: "Stages for `wigley:debug`, `wigley:explore` and the rest: each is a stage module later" becomes: they run inside a level and claim nothing.

**`docs/features/workflow-levels/design.md`**

- Add a pointer list after the opening paragraph: `docs/features/workflow/design.md` (the engine and every stage), `src/plugins/workflow-{light,medium,heavy}/`, `~/wigley-agents/tools/workflow-gate/README.md` (the edit gate), `~/wigley-agents/workflows.md` (the rules), `wigley:light`, `wigley:medium`.
- Do not change its decisions here. Task 11 re-reads it.

**`docs/features/followups.md`**

This file stays list-shaped, and its head says "Remove an item when its work lands".

- Remove the whole item **Workflow stage actions as commands** (lines 437–443, § Plugin extension points). Its work lands in tasks 01 to 05.
- In the item **`$name_<suffix>` vitest titles lose their case name** (line 752 onward): `src/plugins/workflow/layouts/default/layout.test.ts:117` moves to `src/plugins/workflow-heavy/layouts/default/layout.test.ts`. Correct it, then correct each line number that moved in that item's workflow paths.
- Run `command grep -n -E 'plugins/workflow/(plan-reader|stages|main/(actions|countdown|plan-watch|selftest-script)|page/(countdown|preview))|addStage|MAKE_SKILL' docs/features/followups.md`, and fix each hit to its path after this plan.
- Add one item at the end of § Features, in triage's list-item shape. Pinned title, tag and decisions; the wording follows `wigley:writing-for-agents`:

  `- **Judge Heavy's agent count from the run log** — *needs a feature plan*:`, then these facts, wrapped as the file wraps:
  - The question: does Heavy use more agents than its results earn?
  - The evidence: `runs.jsonl` in the `workflow` plugin's data folder of the stable app (`plugins/workflow/` in the app's user data folder), one JSON object per finished workflow with `at`, `sessionId`, `projectDir`, `workflow`, `movedUpFrom`, `activeMs`, `costUsd`, `fixCycles`. Compare Heavy's lines against Medium's.
  - When to plan it: the file holds 20 Heavy lines, so that one odd run does not set the answer.
  - Every option: keep Heavy's agents as they are; reduce the plan drafters and cold readers in `wigley:feature`; reduce the review lanes in `wigley:review`.
  - Why it waited: `docs/features/workflow-levels/design.md` § Decisions, "Heavy stays exactly as it was". Published guidance against many agents on coding work is vendor evidence, and the log gives the user's own.

**`~/.agents/AGENTS.local.md`** (never committed)

- § Tools: add `` `workflow-gate` — symlink `~/.local/bin/workflow-gate`; no config ``.
- § Claude Code settings: add a bullet in the style of the `wigley-repo-files` one. The `workflow-gate hook` entry on `PreToolUse` (`Edit|Write|NotebookEdit`) denies a main agent's edit until the transcript holds a level skill. The rule is in `~/wigley-agents/workflows.md`, and the tool is in `~/wigley-agents/tools/workflow-gate/README.md`. It fails open with the reason stated, and a subagent passes.
- § Claude Code profiles: add the fact that `~/.claude-personal/settings.json` is a symlink to `~/.claude/settings.json`, so one write wires both.
- The Contents line for § Claude Code settings: add `the `workflow-gate` hook`.
- These lines go live before task 12 installs the tool. That is safe: a session reads them, and the tool's own absence only means the hook is not wired yet. If task 12 stops before its install, its report names these lines as ahead of the machine.

Also true after the engine move, and in this task's Files:
- `DESIGN.md` § Workflow: the three parts are drawn by each workflow's own `default` layout, the chip draws a badge, and the screenshot names follow task 05.
- `.agents/skills/drive/SKILL.md`: the example setting reads `workflow-heavy.autoStartSeconds`.
- `docs/features/layouts/design.md`: the row naming `workflow.layout` lists the three owners.

The AGENTS.md line numbers above are approximate: find each passage by its words.

GIVEN the landed plugins WHEN an agent reads `AGENTS.md`'s plugin list THEN it finds the engine and the three workflow plugins, each with its real paths
GIVEN `docs/features/followups.md` WHEN the Backlog reads it THEN the Heavy item carries the tag `needs a feature plan` and the closed item is gone

Tests:     none new: these are doc changes, and no test reads them. Each command prints the pinned value from the worktree root:
           `command grep -c 'Workflow stage actions as commands' docs/features/followups.md` — `0`
           `command grep -c -F '**Judge Heavy'"'"'s agent count from the run log** — *needs a feature plan*:' docs/features/followups.md` — `1`
           `command grep -c 'addStage' docs/features/workflow/design.md` — `0`
           `command grep -c -F '`workflow.autoClearAndMake' docs/features/workflow/design.md` — `0`
           `command grep -c 'workflow/main/selftest-script' AGENTS.md` — `0`
           `command grep -c 'workflow-gate' ~/.agents/AGENTS.local.md` — `3` or more

Done when: each command above prints its value; `git diff --stat` holds only the four repo docs and the three below.

Commit:    one commit for the group on `workflow-levels` of wigley-ai-gui, by pathspec. `~/.agents/AGENTS.local.md` is never committed.

## Proof

