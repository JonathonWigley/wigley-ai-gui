# Workflow levels

The four level plugins this describes were replaced by declarations in `auri.json` (shareable-app): see `docs/features/feature-contributions/design.md`.

**Contents**

- **Vocabulary** — workflow, level, engine, trail, checklist.
- **Shape** — the engine and its workflow plugins.
- **How the app learns** — the skill start, the two tools.
- **Where it draws** — the badge, the trail, the checklist, the No workflow tag.
- **The run log** — one line per finished workflow.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope** — what waits.

Every session runs one of several workflows, and the app shows which one and where it stands. A good
outcome: a glance down the session list says how heavy each run is, and a new workflow or a new look
for one is a new plugin folder or layout, with no engine edit. The rules for picking a level live in
`~/wigley-agents/workflows.md`; the steps of each live in the marketplace's `wigley:spike`, `wigley:small`,
`wigley:medium` and `wigley:feature` skills.

Where each part lives:

- `docs/features/workflow/design.md` — the engine and every stage.
- `src/plugins/workflow/declared/` — turns each `auri.json` workflow into its main and page halves;
  `declared/fixtures/sample-auri.json` holds the sample four, and the wigley plugin's `auri.json` the real ones.
- `~/wigley-agents/tools/workflow-gate/README.md` — the edit gate.
- `~/wigley-agents/workflows.md` — the rules for picking a level.
- `wigley:spike`, `wigley:small` and `wigley:medium` — the steps of the three smaller workflows.

## Vocabulary

- **Workflow** — a named set of stages a session runs, declared in an agent plugin's `auri.json`. Spike, Small,
  Medium and Large are the wigley plugin's four.
- **Level** — the user's word for a workflow in its size order. The app's **Effort** control is
  Claude's reasoning effort, a different thing, so nothing here is called effort.
- **Engine** — the `workflow` plugin: it keeps each session's flow and hosts the row, composer and
  side parts. It names no skill and no workflow's stages beyond idle.
- **Trail** — the composer's row of step words with the current step's progress.
- **Checklist** — the work items the side pane shows. Large's comes from `plan.md` once a plan is read,
  and from the agent until then; the others' from the agent.

## Shape

```
workflow          engine: flows, the fold, the tools, part hosts, the run log, addWorkflow
├─ declared/      builds a workflow from each auri.json declaration (spike, small, medium, large)
└─ plan/          plan reading, the plan watch, set_workflow_plan
```

The engine registers each declared workflow through `addWorkflow` in each process. Only the flow's current workflow
folds its stage rules, so two workflows may both have a `build` stage. One layout, set by `workflow.layout`
(`layouts/workflow/<name>/`), draws every workflow, over a contract and kit the engine exports.

## How the app learns

- **The level** comes from the skill that started: each workflow claims its skills. Moving up is
  loading the next skill. This is one source of truth, and the edit gate reads the same thing.
- **The stage** comes from the flow's current workflow's own rules, including `set_workflow_step`.
  The tool accepts the step words of every workflow, and the current workflow's rules answer it, so
  a word outside that workflow's stages is ignored.
- **The checklist** comes from `set_workflow_checklist`, each call replacing the whole list, so a
  missed call cannot leave the app out of step. The item marked `running: true` takes the stage's state,
  else the first open item does, and the other open items show pending. Large calls it while it explores and plans; once a plan is read,
  Large's checklist comes from `plan.md`.
- **Only the main agent** moves the stage and sets the checklist. A subagent's call of either tool succeeds and changes
  nothing, so delegated work never overwrites the session's own step.
- **Large's checklist** reads the copy of the plan the run reported, through `plan.py` or `set_workflow_plan`, else
  the moved copy across the clone and its worktrees (`docs/features/workflow/design.md` § Large's stages), and shows
  a task as running while its task document reads `Status: in progress`.

## Where it draws

- **Badge** — one letter, X, S, M or L, in the level's colour, with the full word in its tooltip, beside
  the stage text on the session row.
- **Trail** — in the composer for the whole run, as the `workflow-trail` work built it.
- **Checklist** — in the side pane once a list or a plan exists.
- **No workflow** — a red tag on a row whose session finished a turn with no level skill started.

## The run log

The engine appends one line to its plugin data when a workflow finishes: the level, any level it
moved up from, active time since the first claim, spend through the last finished turn, and review
fix cycles. Nothing draws it. An agent reads it when the
user asks to tune `workflows.md`, and it is the evidence for judging Large's agent count.

## Decisions

- **Three levels, and Spike beside them.** No study sets the number; ITIL's three change types and vendor
  guidance are the precedents. Spike is not a size: it is throwaway work with no review, so it sits outside the
  size order. Its badge is X, for experiment, since S is Small's. Spike's stages loop — each ask goes back to
  `build`, and a round mid-loop back to `interview` — so its stages accept a step word earlier in the trail.
  A fifth level is one more workflow in an `auri.json`: the gate reads each installed
  `auri.json`'s workflow claims, so it needs no gate edit, only a row in `~/wigley-agents/workflows.md` for picking it.
- **Large stays exactly as it was.** The user asked for no change to it. Published guidance argues
  against many agents on coding work, but it is vendor evidence, and the run log will give the user's
  own.
- **The edit gate is a hook, not prose alone.** The rule has no exceptions, which is what a hook is
  for. It covers the main agent's edit tools, not edits through a shell, and only Claude Code.
- **No hook blocks finishing until tests pass.** The suites here run past fifteen minutes, and the
  project rules run them filtered to the change.
- **Spike, Small and Medium report only in sessions the app started.** A tool call with the app closed would
  start the app, so only the note in app-started sessions tells an agent to call the tools, and
  `wigley:spike`, `wigley:small` and `wigley:medium` report only there. Large's skills do not change: `wigley:feature`
  and `wigley:make` call `set_workflow_step` on any host that has the tool, so a terminal Large run
  can start a closed app.

## Out of scope

- Codex's adapter and a runtime plugin loader, both tracked elsewhere.
- A screen for the run log.
