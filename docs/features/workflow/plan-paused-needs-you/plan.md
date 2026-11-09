# Paused run shows Needs you — plan

Feature: workflow · Implements: none · Ticket: none
Target: main · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A session that stops mid-workflow with nothing running shows Needs you on its sidebar row. Today the row shows no
label when an agent ends its turn with a question in chat instead of a forms round. A make run that asked the user to
focus the Unity editor sat unnoticed this way.

## Architecture

- Workflow plugin page side only: `shownRowActivity` in `src/plugins/workflow/contract.ts` decides the label. The
  workflow page already sets that label through sessions' `setActivity` under its own source id
  (`src/plugins/workflow/page/workflow-view.ts` `showRowActivity`, `src/plugins/workflow/page/start.ts`).
- No sessions, chat, forms or stage change. The sessions plugin shows the highest rank of a session's activities.

## Preconditions

Each command runs from the repo root. Re-run each one before the first dispatch.

- `shownRowActivity` reads `isBusy(flow) ? null : (stage.rowActivity ?? null)`:
  `grep -n "return isBusy(flow) ? null : (stage.rowActivity ?? null);" src/plugins/workflow/contract.ts` prints one line.
- `STAGE_ACTIVITY_RANK` is 15: `grep -n "export const STAGE_ACTIVITY_RANK = 15;" src/plugins/workflow/contract.ts`.
- `NEEDS_YOU_ACTIVITY` has rank 40 and emphasis `urgent`, and chat's working rank is 20 and error rank is 30:
  `sed -n '/export const NEEDS_YOU_ACTIVITY/,/};/p' src/plugins/sessions/contract.ts` and
  `sed -n 40,75p src/plugins/chat/page/chat-state.ts`.
- Every stage that runs mid-run uses `busyStatus`; done and closed return `'done'`, plan ready `'ready'` and idle
  `null`: `grep -rn "status[:(]" --include=page.ts src/plugins/workflow-small src/plugins/workflow-medium src/plugins/workflow-large`.
  Measured at plan time: 17 `busyStatus` stages, 3 `'done'`, 1 `'ready'`, 1 `null`. Re-verify.
- The existing row-label table holds the row `{ stage: 'make', fields: {}, word: null, tag: true }`:
  `grep -n "stage: 'make', fields: {}, word: null, tag: true" src/plugins/workflow-large-page.test.ts`.
- `src/plugins/workflow/contract.test.ts` does not exist: `test ! -e src/plugins/workflow/contract.test.ts`.
- Only Large's chip reads `onRowLabel`: `grep -n "onRowLabel\|stageTag" src/plugins/workflow-*/layouts/default/layout.js`
  prints Large's guard (line 111) and an unguarded `kit.stageTag` in Small and Medium (line 63).

## Docs written ahead

Commit `86b02cc0` and the commit that adds this plan folder hold them:

- `docs/features/workflow/design.md` — the Running/Paused paragraph and the Row label's **Paused run** bullet
- `docs/features/session-titles/design.md` — the rank table's workflow rows
- `DESIGN.md` — the Needs you colour row

## Mandatory Reads

- `AGENTS.md` (repo root): Architecture § A row activity, § A plugin talks; Running and testing (the self-test and
  drive rules)
- `DESIGN.md`: the status colour table and the row label line (search `Needs you`)
- `docs/features/workflow/design.md` § Where it draws (Row label, Paused run, Row chip)

## Design Overview

After the change, the workflow page decides a session's row label from its flow like this:

```
flow changes ─► showRowActivity(flow) ─► shownRowActivity(stage, flow)
                                          busy?                     → null
                                          stage.rowActivity set?    → that activity (rank 15)
                                          stage.status(flow) paused → PAUSED_RUN_ACTIVITY (needs you, rank 18)
                                          otherwise                 → null
            ─► sessions.setActivity(sessionId, 'workflow', activity)
sessions row shows the highest rank: needs you 40 > error 30 > working 20 > paused run 18 > stage 15 > done 10
```

Decisions:

- The label is the same Needs you as a permission prompt or an open round: word `needs you`, tone `attention`,
  emphasis `urgent` (interview round 1, the user picked "fix both").
- Rank 18: under chat's working (20), so a session that waits on its own background command or Monitor still reads
  Working, and under chat's error (30), so an unseen error shows first. Above the stage labels (15) and chat's done
  (10). No extra check on background tasks is needed (Decided notice, round 2).
- Large's plan ready keeps its own `Ready to make` label (round 2, question 1). Its `rowActivity` wins over the paused
  rule, and its status is `ready`, not `paused`.
- The label stays until a turn or a subagent starts, or the stage moves to one that is not paused. Viewing the session
  does not clear it (round 2, question 2).
- The rule reads the stage's existing paused status. It needs no new stage flag: every mid-run stage already reports
  `busyStatus`, and done, closed, plan ready and idle never read `paused` (design review).
- Interview Decided notice "finishes flag" is replaced by the paused-status rule above: same stages excluded, no new
  field.
- When the row shows the paused-run label, the chip leaves out its stage tag (`onRowLabel`), the same as for plan
  ready's and closed's labels today. Only Large's layout reads `onRowLabel` today; Small's and Medium's gain the same
  guard, which `docs/features/workflow/design.md` § Row chip already states for every built-in layout (cold read).

Out of scope:

- Rule changes that make an agent ask through a round. They landed already in wigley-agents (`a14c64f`) and
  wigley-ai-marketplace (`115e29d`, plugin 2.1.2).
- Any dismiss-on-view state for the new label.

## File Structure

- modify `src/plugins/workflow/contract.ts` — `PAUSED_RUN_ACTIVITY` and the new branch in `shownRowActivity`
- create `src/plugins/workflow/contract.test.ts` — the rule's table at the seam that owns it
- modify `src/plugins/workflow-large-page.test.ts` — the existing row-label table's `make` row
- modify `src/plugins/workflow-small/layouts/default/layout.js` and `src/plugins/workflow-medium/layouts/default/layout.js`
  — the `onRowLabel` guard on the stage tag, with a row each in their `layout.test.ts`
- Boundary: the workflow contract already imports `RowActivity` and `NEEDS_YOU_ACTIVITY`'s module
  (`src/plugins/sessions/contract.ts`); no new import crosses a layer.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Paused run row label](01-paused-run-row-label.md)

### Wave 2
- [ ] [Doc re-read](02-doc-re-read.md) — after 01

### Wave 3
- [ ] [Final verification](03-final-verification.md) — after 02

## Run log

Review base: 631595fa

### Groups
- 01 · b7244ddc, a728f9d8 · diff read: both Produces present in contract.ts; tsc failed on the test's partial PageStage cast, fixed in a728f9d8; typecheck and lint pass · concerns: page-level Small/Medium tests drawing a paused stage were not run by the worker; left to the test gate
### Contract changes
### Rulings
- contract.test.ts builds a whole PageStage literal in stageWith, since stageOf is private to workflow-view.test.ts — a later shared builder could replace it · group 01
### Review rounds
### Test gate
