# Chat side pane and status labels — plan

Feature: workflow · Implements: none · Ticket: none
Target: main · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Show a session's plan checklist in a side pane beside the Chat transcript while the session runs. Replace the workflow's stage words with labels that state each step's status. Remove the Flow tab.

## Architecture

Systems touched:

- `chat` page plugin: a new contributed-part slot beside the transcript.
- `workflow` plugin: stage modules, the layout contract, the default layout, the view, the page start, the preview, the self-test, the fold's flow record.
- `keymap`: two new binds, four binds removed.

## Preconditions

| Claim | Command that verified it |
|---|---|
| The tree has no side-part slot | `grep -rnE 'addSidePart\|sidePart' src` prints nothing |
| `Space w s` and `Space w f` are free | `grep -nE '<Leader>w[sf]' src/plugins/keymap.ts` prints nothing |
| The codicons this plan names exist | `grep -cE 'codicon-(play-circle\|debug-pause\|pass-filled\|circle-large\|loading):before' node_modules/@vscode/codicons/dist/codicon.css` prints 5 |
| No user workflow layout depends on the old inputs | `ls ~/.config/wigley-ai-gui/layouts/workflow` lists only `layout.d.ts` |
| The doc commit is in the tree | `git merge-base --is-ancestor b257f388 HEAD` exits 0 |

`git fetch origin` failed at plan time with `Permission denied (publickey)`. The agent could not compare `main` with origin. Local `main` showed 49 commits ahead of its last known origin state.

## Docs written ahead

Commit `b257f388` holds:

- `docs/features/workflow/design.md`
- `AGENTS.md`
- `docs/keymap.md`
- `docs/features/layouts/design.md`

These docs are hypotheses until task 05 re-reads them against the landed code.

## Mandatory Reads

- `AGENTS.md`: § Architecture for the plugin rules, layouts and parts; § Running and testing for the commands.
- `docs/features/workflow/design.md`
- `docs/features/layouts/design.md`

## Design Overview

```
main: flow folded from agent events
        │ flows push
        ▼
workflow page view ── PageStage.status / statusLine ──► inputs
        │
        ├── chip part (sessions row)     `Make · running`
        ├── strip part (composer)        mark, status line, countdown, main action
        │                                stepper only while the session has no plan
        └── side pane part ──► chat `addSidePart` holder
                                         status line, detail, stepper, progress bar,
                                         checklist, every action

.chat-tab  (flex row, inline-size container)
  ├── .chat-main        entries + floating composer
  └── .chat-side-parts  hidden while empty, hidden below 640 px
```

Decisions from the interview:

- Labels are the skill + status set: `Primer`, `Feature`, `Make`, `Review`, `Close`, each with `running`, `paused`, `ready`, `done` or `pending`.
- The sidebar keeps its accent tag. Only the tag's words change, and they carry no progress count.
- Plan ready reads `Make · ready` and sits in the Make step.
- Running or paused comes from `isBusy`. No new signal is added.
- Chat gets a general slot, `addSidePart`, the same shape as `addComposerPart`.
- The pane hides below a fixed 640 px Chat tab width, set in the chat default layout's CSS.
- The Flow tab, its key scope and its scroll keys are removed.
- `Space w s` shows or hides the pane in every session. The choice is kept in `uiState`.
- `Space w f` opens or folds the selected session's finished waves. The fold state lives in memory, per session.
- The pane takes no keyboard focus.

Decisions the agent made in the design review:

- A stage owns its status and status line through its `PageStage`, so a stage added through `addStage` draws without a core edit.
- The strip and the pane both anchor an action's key. Anchors are independent, so the strip keeps its hint when the pane is hidden.
- The pane's fold row reads `3 waves · 3 done`, because finished waves may not be a continuous range.
- The pane's detail line is the stage's existing `detail`.

Out of scope:

- A label that separates a crash from an agent waiting on an answer. The attention dot marks a waiting round.
- A per-task running state and per-task timers.
- A row per review round.
- Keyboard scroll of the pane's list.

## File Structure

Modified:

- `src/plugins/chat/contract.ts`, `src/plugins/chat/page/start.ts`, `src/plugins/chat/page/chat-view.ts`, `src/plugins/chat/page/chat.css`, `src/plugins/chat/layouts/default/layout.css`
- `src/plugins/workflow/contract.ts`, `src/plugins/workflow/stages/*/page.ts`
- `src/plugins/workflow/layouts/layout.d.ts`, `src/plugins/workflow/layouts/default/layout.js`, `src/plugins/workflow/layouts/default/layout.css`
- `src/plugins/workflow/page/workflow-view.ts`, `src/plugins/workflow/page/workflow.css`, `src/plugins/workflow/page/start.ts`, `src/plugins/workflow/page/preview.ts`
- `src/plugins/workflow/page/layout/workflow-kit.ts`, `src/plugins/workflow/page/layout/workflow-parts.ts`, `src/plugins/workflow/page/layout/read-workflow-layout.ts`
- `src/plugins/workflow/flow.ts`, `src/plugins/workflow/main/flow-store.ts`, `src/plugins/workflow/main/selftest-script.ts`, `src/plugins/workflow/manifest.ts`, `src/plugins/keymap.ts`

Deleted: `src/plugins/workflow/page/flow-tab.ts`, `src/plugins/workflow/page/flow-tab.test.ts`.

New files: none.

Boundary rules:

- Chat names no workflow type and no stage.
- The workflow core names no stage. A stage's words live in its `page.ts`.
- Width policy lives in CSS. No code measures the Chat tab.

Shared names:

```ts
// src/plugins/workflow/contract.ts
export type StageStatus = 'running' | 'paused' | 'ready' | 'done';

// src/plugins/workflow/layouts/layout.d.ts
export type MarkState = StageStatus | 'pending';
```

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Chat side slot](01-chat-side-slot.md)
- [ ] [Stage status and labels](02-stage-status-and-labels.md)

### Wave 2
- [ ] [Workflow side pane part](03-workflow-side-pane-part.md) — after 02

### Wave 3
- [ ] [Wire the pane and remove the Flow tab](04-wire-pane-remove-flow-tab.md) — after 01, 03

### Wave 4
- [ ] [Doc re-read](05-doc-re-read.md)

### Wave 5
- [ ] [Final verification](06-final-verification.md)

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
