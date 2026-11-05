# Workflow levels

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
`~/wigley-agents/workflows.md`; the steps of each live in the marketplace's `wigley:light`,
`wigley:medium` and `wigley:feature` skills.

## Vocabulary

- **Workflow** — a named set of stages a session runs, registered by one plugin. Light, Medium and
  Heavy are the first three.
- **Level** — the user's word for a workflow in its size order. The app's **Effort** control is
  Claude's reasoning effort, a different thing, so nothing here is called effort.
- **Engine** — the `workflow` plugin: it keeps each session's flow and hosts the row, composer and
  side parts. It names no skill, stage or plan.
- **Trail** — the composer's row of step words with the current step's progress.
- **Checklist** — the work items the side pane shows. Heavy's comes from `plan.md`; the others' from
  the agent.

## Shape

```
workflow          engine: flows, the fold, the tools, part hosts, the run log, addWorkflow
├─ workflow-light    stages, skill rule, layout
├─ workflow-medium   stages, skill rule, layout
└─ workflow-heavy    today's stages, plan reading, Clear & make, auto-start, layout
```

A plugin registers through `addWorkflow` in each process. Only the flow's current workflow folds its
stage rules, so two workflows may both have a `build` stage. Each plugin owns its layout folder
(`layouts/workflow-light/`), over a contract and kit the engine exports, so each hot reloads alone.

## How the app learns

- **The level** comes from the skill that started: each workflow claims its skills. Moving up is
  loading the next skill. This is one source of truth, and the edit gate reads the same thing.
- **The stage** comes from the workflow's own rules, including `set_workflow_step`.
- **The checklist** comes from `set_workflow_checklist`, each call replacing the whole list, so a
  missed call cannot leave the app out of step. Heavy never calls it: Heavy's skills are unchanged.

## Where it draws

- **Badge** — one letter, L, M or H, in the level's colour, with the full word in its tooltip, beside
  the stage text on the session row.
- **Trail** — in the composer for the whole run, as the `workflow-trail` work built it.
- **Checklist** — in the side pane once a list or a plan exists.
- **No workflow** — a warning tag on a row whose session finished a turn with no level skill started.

## The run log

The engine appends one line to its plugin data when a workflow finishes: the level, any level it
moved up from, active time, spend, and review fix cycles. Nothing draws it. An agent reads it when the
user asks to tune `workflows.md`, and it is the evidence for judging Heavy's agent count.

## Decisions

- **Three levels.** No study sets the number; ITIL's three change types and vendor guidance are the
  precedents. A fourth is one plugin away.
- **Heavy stays exactly as it was.** The user asked for no change to it. Published guidance argues
  against many agents on coding work, but it is vendor evidence, and the run log will give the user's
  own.
- **The edit gate is a hook, not prose alone.** The rule has no exceptions, which is what a hook is
  for. It covers the main agent's edit tools, not edits through a shell, and only Claude Code.
- **No hook blocks finishing until tests pass.** The suites here run past fifteen minutes, and the
  project rules run them filtered to the change.
- **Sessions outside the app draw nothing.** A tool call with the app closed would start the app, so
  only the note in app-started sessions tells an agent to call the tools.

## Out of scope

- Codex's adapter and a runtime plugin loader, both tracked elsewhere.
- A screen for the run log.
