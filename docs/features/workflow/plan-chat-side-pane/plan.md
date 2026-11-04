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
- [x] [Chat side slot](01-chat-side-slot.md)
- [x] [Stage status and labels](02-stage-status-and-labels.md)

### Wave 2
- [x] [Workflow side pane part](03-workflow-side-pane-part.md) — after 02

### Wave 3
- [x] [Wire the pane and remove the Flow tab](04-wire-pane-remove-flow-tab.md) — after 01, 03

### Wave 4
- [x] [Doc re-read](05-doc-re-read.md)

### Wave 5
- [x] [Final verification](06-final-verification.md)

## Run log

Review base: 68948b9f7b94a2184562454202edd2584ea190ba

### Groups
- 02 · 72ec4d6b · diff read: every Produces present; typecheck: only the checking literal in workflow-view.test.ts, which task 03 owns · concerns: workflow-view.test.ts expects the old labels until task 03; runsTasks has no test until task 03 reads it
- 01 · 8a78aef6 · diff read: every Produces present; typecheck: only the checking literal task 03 owns · concerns: width rule relies on layout.css loading after chat.css, and containment, composer placement and hidden holder are unproved until a live run; a rebuild drops a surviving part local state
- 03 · 1f3ecac6 · diff read: every Produces present or logged as a contract change; typecheck clean · concerns: pulse restarts on each redraw, and the stepper and button wrapping at 264 px are unseen until a live run; DESIGN.md Workflow is stale; pane background differs from the hub docs
- 04 · 4b3b2c08 · diff read: both commands and binds present; typecheck clean; done-when grep prints only flow-store.test.ts:98 under src/plugins/workflow, no workflow scroll bind left in keymap.ts · concerns: done-when grep also matches other plugins lineDown binds; scrollsItself may need the side list for the fit check; uiState start-up read proved only live; createWorkflowKit scope is now always null; a user layout defining flowTab would throw, none on this machine
- 05 · 5c929ff8 · diff read: DESIGN.md, workflow design and keymap format match the code; Flow tab grep prints nothing; hub lines kept · concerns: mixed hub line kept in workflow design; the no-keyboard-focus line unverified, for the live run
- 06 · 5c929ff8 · selftest --plugin workflow --plugin chat all passed; screenshots read; drive checks 1-9 pass: list scroll held through a push, composer right 918 <= pane left 930, picker and dialog centred at 600 of 1200, split tabs 438 wide hide the holder and 892 restores it, preview labels pinned, stored hide survives a restart, fold and keys, no focus taken · concerns: pulse restart on a flow push unobserved; 1200x500 clips the composer strip, split swap hint draws over the pane, origin not checked
### Contract changes
- ChatSidePart: extends ContributedPart → standalone id and build, the same fields · why: scripts/check-layers.mts lets chat contract.ts import only src/contracts · consumers: 03, 04 (still assignable to ContributedPart) · group 01
- WorkflowView.sidePart: ContributedPart → ChatSidePart · why: matches stripPart: ChatComposerPart and its chat contract, and ChatSidePart is what addSidePart takes · consumers: 04 · group 03
- MarkState: StageStatus from contract.ts → layout.d.ts declares its own identical StageStatus · why: layout-contracts.test.ts rejects a relative import in layout.d.ts beside the kit, and a status added to contract.ts alone fails typecheck where the view assigns it · consumers: 04 · group 03
### Rulings
- Task 05 checks only the lines this plan owns; the session hub lines from 68948b9f (hub sections, title and order on a side part, Space v s, agent-skills) stay as written, because they are docs ahead for a later plan — if wrong, a hub plan must still widen addSidePart · lead
- The run is in worktree chat-side-pane on the user request, with node_modules symlinked as row-clock does; this project has no editor, so the test gate and self-test run in the worktree rather than waiting for the main tree — if wrong, re-run them after the merge · lead
- docs/keymap.md failed oxfmt --check at the review base, before any of this work; task 05 formats it as a plain correctness fix, so task 04 reads that one lint failure as known — if wrong, one formatting commit · lead
- statusText builds on detailLine, and each stage holds file-level label and status constants — the shared join and one status reference — a mechanical rewrite if wrong · group 02 · group 02
- position: relative moved from .chat-tab to .chat-main, the composer being its only absolute child — that element would position against a further ancestor if wrong · group 01 · group 01
- Pane width is calc(var(--wg-space-6) * 11), 264 px in the shipped theme, because check-styles rejects a raw length — the width scales with a theme that changes space-6 · group 03 · group 03
- The progress bar is kit.meter and the statusMark table sits in workflow-view.test.ts — reuse of a base primitive, and layout.test.ts has only a fake kit — one table or one element to move if wrong · group 03 · group 03
- Task 05 also checks DESIGN.md § Workflow, which still names three parts and the old strip, and its doc line on the plan title, which the pane shows through detail — no task owned that doc, and it would stay stale · lead
- stepState keeps its current === -1 branch after the Flow tab goes: a stage added with inStepper false reaches it through the strip, so its test moves to such a stage rather than leaving with idle — one branch and one row if wrong · lead
- manifest keeps scopes: {} since definePlugin requires the key — no cost if wrong · group 04 · group 04
- none needed beyond the lead rulings on the hub lines and DESIGN.md · group 05 · group 05
- No commit for this task; the proof records the tip it ran on · lead · group 06
- Review picks, per the repo's take-every-recommendation rule: scroll, survivors, status line, pulse, fold key and hidden state fixed; scroll and pulse repeats stepped back; pane width against 640 px left (settled); list shrinking to no overflow left at the cycle cap; side swap prompt and Esc on the Folder picker to follow-ups; hub docs lines stay for the later plan.
### Review rounds
- 1 · c6cbf380 · NEEDS FIXES: 1 Important (list scroll lost with no box), 15 Minor, 3 pre-existing; lead applied 4bac4707; workers 5653ffee, 5a0a6014
- 2 · 5a0a6014 · NEEDS FIXES: repeats on the scroll keep and the pulse; scroll stepped back in 2d31f3c0, scroll events its only writer; pulse accepted and comments limited in 8d6aa467
- 3 · 2d31f3c0 · NEEDS FIXES at the 2-cycle cap: stale test row name lead-applied; a list shrinking to no overflow keeps its old value, picked Leave it
### Test gate
- src/plugins/workflow (every edited and added test, and the stage, view, layout, preview and flow logic the diff changed) · src/plugins/keymap.test.ts (the binds changed) · src/plugins/chat/page/chat-view.test.ts (the tab shape and side parts) · src/shared/layouts/layout-contracts.test.ts (layout.d.ts changed) · 26 files, 366 tests pass
