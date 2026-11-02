# 07 — The seven built-in stage modules

Status: done
Type: Batch
Wave: 2 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:     create `src/plugins/workflow/stages/<stage>/main.ts` · `page.ts` · test `main.test.ts`, for each `<stage>` of
           `idle`, `primer`, `feature`, `plan-ready`, `make`, `review`, `closed`
           create `src/plugins/workflow/stages/index.ts`
           test `src/plugins/workflow/stages/page-stages.test.ts`
Consumes:  `StageId`, `IDLE_STAGE`, `SessionFlow`, `WorkflowSignal`, `MainStage` (with `autoCommand` and
           `clearsPlan`), `isBusy`, `StageActionSpec` (with `enabled`), `PageStage` (with `order`) ← 03 · `foldFlow`, `newFlow` ← 03 (tests only) · `PlanProgress` ← 02
           `CommandDecl` in `src/contracts/plugin.ts` (in the tree)
Produces:  in each `stages/<stage>/main.ts`: `export const <name>MainStage: MainStage`
           in each `stages/<stage>/page.ts`: `export const <name>PageStage: PageStage`
           where `<name>` is `idle`, `primer`, `feature`, `planReady`, `make`, `review`, `closed`
           in `src/plugins/workflow/stages/index.ts`:
           `export const BUILT_IN_MAIN_STAGES: readonly MainStage[]` — the seven main halves, in stage order
           `export const BUILT_IN_PAGE_STAGES: readonly PageStage[]` — the seven page halves, in stage order
           `export const WORKFLOW_COMMANDS` — the command table below, `as const satisfies Record<string, CommandDecl>`
Decisions:
- **Every file here is pure**: no I/O, no clock, no DOM (plan.md boundary rules). `page.ts` holds data and pure
  functions only; the page part (09) draws. A stage file imports only `../../contract` and `../../plan-reader`
  (types); `index.ts` imports the stage files and `src/contracts/plugin.ts`.
- **Stage ids and orders** (`MainStage.id` = `PageStage.id`, `MainStage.order` = `PageStage.order`, folder name in
  brackets): `idle` 0 (`idle`),
  `primer` 10 (`primer`), `feature` 20 (`feature`), `planReady` 30 (`plan-ready`), `make` 40 (`make`), `review` 50
  (`review`), `closed` 60 (`closed`). Idle's main half uses `IDLE_STAGE` for its id.
- **Entry rules** (`enter`), from design.md § Stages. `flow` is the flow after the fold's bookkeeping. Each rule
  returns its own id or null:

  | Stage | Returns its id when |
  |---|---|
  | idle | `handedOff`, from any stage; `dismissed` while `flow.stage` is `closed` |
  | primer | `skillStarted` with skill `wigley:feature-primer`, from any stage |
  | feature | `skillStarted` with skill `wigley:feature`, from any stage |
  | planReady | `turnEnded` or `planChanged` while `flow.stage` is `feature`, `isBusy(flow)` is false, `flow.planDir` is non-null, `flow.progress` is non-null and `flow.progress.total > 0` |
  | make | `skillStarted` with skill `wigley:make`, from any stage |
  | review | `skillStarted` with skill `wigley:review` while `flow.stage` is `make`; `planChanged` while `flow.stage` is `make` and `signal.progress.reviewRounds` > 0 |
  | closed | `planGone` while `flow.stage` is `make` or `review` |

  The planReady rule waits for nothing busy and a plan with a box. `wigley:feature` writes `plan.md` before its task
  documents and drafts them in background subagents, so the turn that dispatches them ends with a half-drafted plan
  and subagents running. The flow enters plan ready on a later turn end (Claude's turn after the last drafter ends)
  or on the plan change that the watch sends after a turn end. `planChanged` is in the rule because the fold sets
  `progress` null on a new plan's first write (03), and the watch reads the plan after that.
  "From any stage" covers closed: a flow skill starting moves closed to that skill's stage (design.md: "A closed
  session also leaves on its next flow skill"). Skill names compare exactly. `planChanged` for review reads only the
  new progress (the fold hands no earlier one), so a session back in make through Resume make returns to review on
  the next plan change once a round is logged; that is accepted, since review rounds come at the end of a run.
- **`autoCommand`**: only plan ready sets it, to `'clearAndMake'`.
- **`clearsPlan`**: primer and feature set it to `true`; the other stages leave it out. Entering either one starts a
  new plan, so the fold clears `planDir` and `progress` (03 step 8). A plan from a closed run, or a `plan.md` edited
  while idle, then never makes the interview's first turn end plan ready.
- **Page halves** — label, stepper, order, actions in order (main action first), each with `side`, `available` and
  `enabled`. `available` decides whether the action shows; `enabled` decides whether a shown action can run. The
  turn state never hides an action: it only disables one. Every `enabled` the table does not name is `() => true`.

  | Stage | `label` | `inStepper` | Actions: `command` · `label` · `side` · `available` · `enabled` |
  |---|---|---|---|
  | idle | `Idle` | false | `startFeature` · `Start feature` · page · always · always |
  | primer | `Primer` | true | `startFeature` · `Start feature` · page · always · always |
  | feature | `Feature` | true | `openPlan` · `Open plan` · page · `planDir` non-null · always |
  | planReady | `Plan ready` | true | `cancelCountdown` · `Cancel` · main · `countdownEndsAt` non-null · always; `clearAndMake` · `Clear & make` · main · always · `!isBusy(flow)`; `makeInNewSession` · `Make in new session` · main · always · always; `openPlan` · `Open plan` · page · `planDir` non-null · always |
  | make | `Make` | true | `resumeMake` · `Resume make` · main · `progress` non-null and `progress.checked < progress.total` · `!isBusy(flow)`; `openPlan` · `Open plan` · page · `planDir` non-null · always |
  | review | `Review` | true | `resumeMake` (same spec as make); `openPlan` (same) |
  | closed | `Closed` | true | `retro` · `Retro` · main · always · `!isBusy(flow)`; `dismiss` · `Dismiss` · main · always · always |

  Each page half's `order` is its main half's order from the list above (idle 0 … closed 60).
  Cancel comes first in plan ready and shows only during the countdown, so `ww` runs Cancel during it and Clear &
  make otherwise. `ww` and the chip's button run the first available action; when that action is disabled, they run
  nothing (09). So while the session is busy, `ww` in plan ready, make or review runs nothing; it never falls
  through to Make in new session or Open plan. Stage folders do not import each other, so each stage
  file defines its own `openPlan`, `startFeature` and `resumeMake` specs; the page-stages table test pins them equal
  in behaviour.
- **`detail`** formats, with `p` the flow's `progress`; every stage returns `''` when `p` is null:

  | Stage | `detail` |
  |---|---|
  | idle | `''` always |
  | primer | `''` always |
  | feature | `` `${p.title}` `` |
  | planReady | `` `${p.title} · ${p.total} tasks` `` |
  | make | `` `${p.checked}/${p.total} · wave ${p.wave}` ``; `` `${p.checked}/${p.total}` `` when `p.wave` is null |
  | review | `` `round ${p.reviewRounds} · ${p.checked}/${p.total}` ``; `` `${p.checked}/${p.total}` `` when `p.reviewRounds` is 0 |
  | closed | `` `${p.title} · done` `` |

  The separator is ` · ` (space, U+00B7, space). The countdown's seconds left are not in `detail`: they need a clock,
  so the page draws them from `countdownEndsAt` (09).
- **`WORKFLOW_COMMANDS`** — every command a built-in action or key runs, each `group: 'workflow'`, `runsIn: 'page'`
  (plan.md Decisions). Short id → label:
  `mainAction` → `run the stage's next step` · `clearAndMake` → `clear the session and make the plan` ·
  `cancelCountdown` → `cancel the auto-start` · `makeInNewSession` → `make the plan in a new session` ·
  `resumeMake` → `clear the session and resume make` · `openPlan` → `open the plan` · `retro` → `run a retro` ·
  `startFeature` → `start a feature` · `dismiss` → `dismiss the closed run`. In that order. The manifest (08)
  spreads it into its `commands`, so it must keep its literal types (`as const`).
- **The lists** are in stage order (ascending `order`, on both halves); main and the page register them through their own
  `addStage` (08, 09), as a user plugin would.

GIVEN a flow in feature with a plan written, its progress read with at least one box, and nothing busy WHEN
`turnEnded` folds through `BUILT_IN_MAIN_STAGES` THEN the stage is
`planReady`
GIVEN a flow in closed WHEN `skillStarted` `wigley:feature` folds THEN the stage is `feature`
GIVEN a flow in feature with a plan written and a subagent running WHEN `turnEnded` folds THEN the stage stays
`feature`
GIVEN a plan-ready flow with a countdown running and no turn WHEN the page reads its available actions THEN they are
`cancelCountdown`, `clearAndMake`, `makeInNewSession`, `openPlan`, in that order
GIVEN a plan-ready flow with a turn running WHEN the page reads its actions THEN `clearAndMake` is the first
available action and is not enabled

Tests:     each stage folder's `main.test.ts`: `describe('<name>MainStage')`, one `it.each` table `'$name'` driving
           `foldFlow(flow, signal, BUILT_IN_MAIN_STAGES)` and asserting the returned `stage`. Flows come from one
           helper per file over `newFlow('s1', '/r')` with the fields a row needs. Rows:
           · idle: `handedOff` from `make` → `idle`; `handedOff` from `planReady` → `idle`; `dismissed` from `closed`
             → `idle`; `dismissed` from `make` → `make`
           · primer: `skillStarted wigley:feature-primer` from `idle` and from `closed` → `primer`
           · feature: `skillStarted wigley:feature` from `idle`, `primer`, `closed` → `feature`; `skillStarted
             wigley:featurex` → stage kept
           · plan-ready: a `feature` flow with `planDir`, a progress with `total: 3` and nothing busy:
             `turnEnded` → `planReady`; `planChanged` with `total: 3` → `planReady`. Each case below leaves it
             `feature`: `planDir` null; `progress` null; `total: 0` (a `## Tasks` with no box yet); a turn running
             at `planChanged`; `runningSubagents: ['a1']` at `turnEnded` (a drafter still running); a
             `subagentFinished` of the last subagent (it waits for the turn after it); `fileWritten` of a plan.md
             (it waits for the turn's end). `turnEnded` in `make` with `planDir` → `make`
             · primer and feature clear the plan: `skillStarted wigley:feature` from `closed` with `planDir` and a
             progress → `feature` with `planDir` null and `progress` null; the same for `wigley:feature-primer` →
             `primer`; then `turnEnded` → `feature` (a closed run's plan never makes the interview plan ready)
           · make: `skillStarted wigley:make` from `planReady`, `idle`, `review`, `closed` → `make`
           · review: `skillStarted wigley:review` in `make` → `review`; in `feature` → `feature`; `planChanged` with
             `reviewRounds: 1` in `make` → `review`; with `reviewRounds: 0` → `make`
           · closed: `planGone` in `make` and in `review` → `closed`; in `feature` and in `planReady` → kept
           `stages/page-stages.test.ts`: `describe('BUILT_IN_PAGE_STAGES')`, two tables over the real page stages:
           · `detail`: one row per format above and per null-progress case, with the exact expected string
             (`'3/7 · wave 2'`, `'3/7'`, `'round 2 · 6/7'`, `'Claim grants · 7 tasks'`, `'Claim grants · done'`, `''`)
           · available and enabled actions: rows `{ stage, flow, actions }` asserting, in order, each available
             action as `[command, enabled]` from `actions.filter((a) => a.available(flow))` — plan ready with and
             without a countdown, with a turn running (`['clearAndMake', false]` first) and with a subagent running;
             make with `checked < total`, with `checked === total`, with null progress, with a turn running
             (`['resumeMake', false]`) and with a subagent running; review the same as make; feature with and
             without `planDir`; closed with a turn running (`['retro', false]`, `['dismiss', true]`). They catch an
             action hidden while busy (so `ww` falls through to the next one) and an action left enabled while
             busy.
           One more `it` in that file: the stage ids of `BUILT_IN_PAGE_STAGES` equal those of `BUILT_IN_MAIN_STAGES`,
           in the same order; each page half's `order` equals its main half's `order`; and every action's `command`
           is a key of `WORKFLOW_COMMANDS`. It catches a page half drawn at another place in the stepper than its
           main half's place in the fold.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit 6456472 · proof: diff read: seven stage halves, BUILT_IN_MAIN_STAGES/BUILT_IN_PAGE_STAGES/WORKFLOW_COMMANDS present; typecheck and lint clean; workflow tests 122 pass · concerns: stage folders name other stages' ids as string literals (idle checks 'closed', review and closed check 'make'); a rename edits them too
