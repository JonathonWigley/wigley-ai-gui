# 14 — Workflow steps

Status: in progress
Type: Parallel
Rung: deep · `showSample` holds per-session state across a rows-slot listener, a handle's dispose order and chat's headless flag (async, through chat main), and task 17 marks checks 36 and 38 on these steps `low-confidence`
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files paths are written from the `ai` repo root; every other path in this document is relative to `wigley-ai-gui/`.

Files:
- modify `wigley-ai-gui/src/plugins/workflow/contract.ts`
- modify `wigley-ai-gui/src/plugins/workflow/page/start.ts`
- test `wigley-ai-gui/src/plugins/workflow/page/start.test.ts`
- test `wigley-ai-gui/src/plugins/workflow/page/demo-steps.test.ts`
- test `wigley-ai-gui/src/plugins/workflow-small/page/demo-steps.test.ts`
- test `wigley-ai-gui/src/plugins/workflow-medium/page/demo-steps.test.ts`
- test `wigley-ai-gui/src/plugins/workflow-spike/page/demo-steps.test.ts`
- test `wigley-ai-gui/src/plugins/workflow-large/page/demo-steps.test.ts`
- modify `wigley-ai-gui/src/plugins/workflow/main/start.ts`
- test `wigley-ai-gui/src/plugins/workflow/main/start.test.ts`
- create `wigley-ai-gui/src/plugins/workflow/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/workflow/page/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/workflow-small/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/workflow-small/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/workflow-small/main/start.ts`
- modify `wigley-ai-gui/src/plugins/workflow-small/page/start.ts`
- create `wigley-ai-gui/src/plugins/workflow-medium/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/workflow-medium/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/workflow-medium/main/start.ts`
- modify `wigley-ai-gui/src/plugins/workflow-medium/page/start.ts`
- create `wigley-ai-gui/src/plugins/workflow-spike/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/workflow-spike/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/workflow-spike/main/start.ts`
- modify `wigley-ai-gui/src/plugins/workflow-spike/page/start.ts`
- create `wigley-ai-gui/src/plugins/workflow-large/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/workflow-large/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/workflow-large/main/start.ts`
- modify `wigley-ai-gui/src/plugins/workflow-large/page/start.ts`
- modify `wigley-ai-gui/src/plugins/workflow-large/page/preview.ts`
- test `wigley-ai-gui/src/plugins/workflow-large/page/preview.test.ts`

This task adds no new plugin part, so 07's part lists gain nothing from it.

Consumes:
- `DemoStep`, `DemoStage`, `DemoBeat`, `DemoPageContext`, `DemoMainStep`, `DemoMainStage`, `DemoMainContext`, `DEMO_PROFILE` in `src/contracts/demo.ts` ← 01
- `PageServices.demoSteps` and `MainServices.demoSteps` ← 01
- `DemoMainContext.launchSession` ← 01 (the type; 06 implements it in the same wave: it launches on `DEMO_PROFILE`, ephemeral, in the scratch folder)
- tree members:
  - `SessionFlow`, `ChecklistItem`, `IDLE_STAGE`, `WorkflowPageExports`, `workflowPageKey` (`src/plugins/workflow/contract.ts:49,65,438,446`)
  - `newFlow` (`src/plugins/workflow/flow.ts:12`)
  - the page part's `flowOf`, `isPreview`, `drawFlow` and `createPreview` (`src/plugins/workflow/page/start.ts:80-120,172`)
  - the rows slot's `on` listener, as `flows.on` is used (`src/plugins/workflow/page/start.ts:232`)
  - `SessionsPageExports.activate` (`src/plugins/sessions/contract.ts:668`)
  - `ChatPageExports.setHeadless(sessionId, headless): Promise<void>` (`src/plugins/chat/contract.ts:969`; the main exports' `setHeadless` at `:497` is a different member)
  - workflow main's `openFlow`, the `chat.sessionOpened` handler and `openRowsAlreadyOpen` (`src/plugins/workflow/main/start.ts:324-368`); `apply` returns on a session with no flow (`:166-169`), and so does the `chat.agentEvent` handler (`:393-396`)
  - `chat.sessionOpened`'s payload `profile`
  - `SMALL_WORKFLOW_ID`, `MEDIUM_WORKFLOW_ID` and `MediumState`, `SPIKE_WORKFLOW_ID`, `LARGE_WORKFLOW_ID`
  - `PREVIEW_SAMPLES` and `previewFlow` (`src/plugins/workflow-large/page/preview.ts:13,70`)
  - Large's `autoStartSeconds` setting, default 10

Produces:
- `src/plugins/workflow/contract.ts`:
  - `export function sampleFlow(sessionId: string, projectDir: string, fields: Partial<Omit<SessionFlow, 'sessionId' | 'projectDir'>>): SessionFlow`. A field `fields` leaves out takes `newFlow`'s value (`src/plugins/workflow/flow.ts:12`): `workflow: null`, `movedUpFrom: null`, `stage: IDLE_STAGE`, `checklist: null`, `state: null`, `missedLevel: false`, `turnRunning: false`, `runningSubagents: []`. `contract.ts` writes these values itself and does not import `flow.ts`, because `flow.ts` imports `contract.ts`. Small and Spike beats pass no `state`, so it stays `null`. Every sample `ChecklistItem` sets `text` and `done` only; `running` is left out.
  - `WorkflowPageExports.showSample(flow: SessionFlow): Disposable`
- `src/plugins/workflow-large/page/preview.ts`:
  - `export interface SamplePlan { projectDir: string; planDir: string; title: string }`
  - `export const PREVIEW_PLAN: SamplePlan`
  - `previewFlow(index: number, sessionId: string, now: number, autoStartSeconds: number, plan: SamplePlan = PREVIEW_PLAN): SessionFlow`
- in each of `workflow`, `workflow-small`, `workflow-medium`, `workflow-spike` and `workflow-large`:
  - `main/demo-steps.ts`: `export function registerDemoSteps(services: MainServices): Disposable`
  - `page/demo-steps.ts`: `export function registerDemoSteps(services: PageServices, deps: <Plugin>PageDemoDeps): Disposable` and its `<Plugin>PageDemoDeps` interface

## Shared pattern

Every step in this task follows the plan's per-plugin pattern (`plan.md` › Per-plugin step files) and these rules:

- **Main half.** It launches one demo session with plain text (`launchSession('A sample session for the <title> step.')`, `<title>` the step's title). The fake answers with an echo turn. The stage's sessions are `{ session: <id> }`. Dispose does nothing: when the run leaves the step, the demo main (06) disposes the page stage, then the main stage, then closes every session id in the main stage's `sessions` map with chat's `close(id, 'finished')`.
- **No real flow.** Workflow main opens no flow for a session whose profile is `DEMO_PROFILE` (§ Workflow main guard). So the demo session has no entry in `flows.json`, and no signal folds into one.
- **Page half.** Each beat calls `workflow.showSample(flow)` with a whole sample flow for `context.sessions.session`, built with `sampleFlow` and `projectDir: context.scratchDir`. The stage holds the latest handle. Each beat disposes the previous handle after it shows its own. The stage's dispose disposes the last one.
- **No fake workflow triggers.** No step sends `fake: workflow …` or `/wigley:make`.

### `showSample(flow)` in the workflow page part

- It holds `samples: Map<string, SessionFlow>`.
- `isPreview(id)` is true when `preview.flowOf(id) !== null` or `samples.has(id)`. So the view's `runFor` and `toggleHeadless` run nothing on a sample, and `drawFlow` does not redraw a real flow over it.
- `flowOf(id)` checks `preview.flowOf(id)`, then `samples.get(id)`, then `flows.get(id)`, then `newFlow`.
- `showSample(flow)`:
  1. It sets `samples.set(flow.sessionId, flow)`.
  2. When `rows.get(flow.sessionId)` exists, it calls `view.setFlow(flow)`. Else it draws once on the rows slot's first change that adds that row.
  3. It calls `sessions.activate(flow.sessionId)`.
- Dispose:
  - It drops its row listener.
  - When `samples.get(id)` is still this flow, it deletes it and, when the row exists, calls `view.setFlow(flowOf(id))`.
  - A newer sample on the same session is left as it is.

### Workflow main guard

- The `chat.sessionOpened` handler returns before `openFlow` when the payload's `profile` is `DEMO_PROFILE`.
- `openRowsAlreadyOpen` skips a row whose chat info `profile` is `DEMO_PROFILE`.

These are the only two callers of `openFlow` (`src/plugins/workflow/main/start.ts:337,360`; measured at plan time, re-verify).

## Per-plugin values

### workflow — step `workflow.engine`

| Field | Value |
|---|---|
| section | `workflows` |
| order | `10` |
| title | `Workflow` |
| caption | `Workflow: each session's row shows its workflow state, and warns when an agent works with no level` |
| files | `src/plugins/workflow/page/start.ts`, `src/plugins/workflow/page/workflow-view.ts`, `src/plugins/workflow/main/start.ts`, `src/plugins/workflow/flow.ts`, `src/plugins/workflow/contract.ts` |

`WorkflowPageDemoDeps` holds `showSample` (the part's own) and `setHeadless` (chat's page export).

| name | show() |
|---|---|
| `No level` | `setHeadless(id, false)`, then `showSample(sampleFlow(id, dir, { missedLevel: true, turnRunning: true }))` |
| `Headless` | `showSample(sampleFlow(id, dir, {}))`, then `setHeadless(id, true)` |

Stage dispose: `setHeadless(id, false)`, then the last handle's dispose.

### workflow-small — step `workflow-small.run`

| Field | Value |
|---|---|
| section | `workflows` |
| order | `20` |
| title | `Small workflow` |
| caption | `Small workflow: a clear change scoped, built, checked and landed in one go` |
| files | `src/plugins/workflow-small/main/start.ts`, `src/plugins/workflow-small/page/start.ts`, `src/plugins/workflow-small/stages/index.ts` |

Checklist items, in order:
- `Find where the quest timer reads the clock`
- `Fix the drift after a clock change`
- `Run the timer tests`

Beats (`workflow: SMALL_WORKFLOW_ID`; `done` counts the leading items with `done: true`):

| name | stage | done | turnRunning |
|---|---|---|---|
| `Scope` | `scope` | 0 | true |
| `Build` | `build` | 1 | true |
| `Check` | `check` | 2 | true |
| `Land` | `land` | 3 | true |
| `Done` | `done` | 3 | false |

### workflow-medium — step `workflow-medium.run`

| Field | Value |
|---|---|
| section | `workflows` |
| order | `30` |
| title | `Medium workflow` |
| caption | `Medium workflow: an interview, a build, one review and its fixes, then land` |
| files | `src/plugins/workflow-medium/main/start.ts`, `src/plugins/workflow-medium/page/start.ts`, `src/plugins/workflow-medium/contract.ts` |

Checklist items, in order:
- `Agree the quest reset rules`
- `Build the reset`
- `Fix the review's findings`

Beats (`workflow: MEDIUM_WORKFLOW_ID`; `state: MediumState`):

| name | stage | done | fixCycles | turnRunning |
|---|---|---|---|---|
| `Interview` | `interview` | 0 | 0 | true |
| `Build` | `build` | 1 | 0 | true |
| `Review` | `review` | 2 | 0 | true |
| `Fix` | `fix` | 2 | 1 | true |
| `Land` | `land` | 3 | 1 | true |
| `Done` | `done` | 3 | 1 | false |

### workflow-spike — step `workflow-spike.run`

| Field | Value |
|---|---|
| section | `workflows` |
| order | `40` |
| title | `Spike workflow` |
| caption | `Spike workflow: a throwaway prototype, built and checked fast for the user to try` |
| files | `src/plugins/workflow-spike/main/start.ts`, `src/plugins/workflow-spike/page/start.ts`, `src/plugins/workflow-spike/contract.ts` |

Checklist items, in order:
- `Agree what the prototype must feel like`
- `Build the quest board prototype`
- `Check it runs`

Beats (`workflow: SPIKE_WORKFLOW_ID`):

| name | stage | done | turnRunning |
|---|---|---|---|
| `Interview` | `interview` | 0 | true |
| `Build` | `build` | 1 | true |
| `Check` | `check` | 2 | true |
| `Land` | `land` | 3 | true |
| `Done` | `done` | 3 | false |

### workflow-large — step `workflow-large.run`

| Field | Value |
|---|---|
| section | `workflows` |
| order | `50` |
| title | `Large workflow` |
| caption | `Large workflow: a planned feature from primer to plan, then make, review and close` |
| files | `src/plugins/workflow-large/main/start.ts`, `src/plugins/workflow-large/page/start.ts`, `src/plugins/workflow-large/page/preview.ts`, `src/plugins/workflow-large/page/countdown.ts`, `src/plugins/workflow-large/main/countdown.ts` |

Sample plan: `{ projectDir: context.scratchDir, planDir: paths.join(context.scratchDir, 'docs', 'features', 'daily-quests', 'plan-daily-quests'), title: 'Daily quests' }`. `PREVIEW_PLAN` keeps today's `PREVIEW_PROJECT`, `PREVIEW_PLAN_DIR` and `PREVIEW_TITLE` values, so the layout preview does not change.

One beat per `PREVIEW_SAMPLES` row (13 rows, measured at plan time, re-verify). Each beat shows `previewFlow(index, id, services.clock.now(), autoStartSeconds, plan)`, with `autoStartSeconds` read from `api.settings()` at `enter`:

| index | name |
|---|---|
| 0 | `Idle` |
| 1 | `Primer` |
| 2 | `Explore` |
| 3 | `Interview` |
| 4 | `Plan` |
| 5 | `Cold read` |
| 6 | `Plan ready` |
| 7 | `Countdown` (`dwellSeconds: autoStartSeconds`) |
| 8 | `Make` |
| 9 | `Make idle` |
| 10 | `Review` |
| 11 | `Fix` |
| 12 | `Closed` |

Names follow the rows. A test asserts the two lists have the same length.

## Decisions

- **Page-side samples, not fake triggers.** The fake's `fake: workflow feature` writes a plan under the scratch folder, but four things rule it out:
  - The real flow it drives is saved in `flows.json` in workflow's data, the user's real state.
  - The last `fake: workflow step` calls `files.trash(folder)`, which in the live app moves the folder to the OS Trash.
  - Small, Medium and Spike have no fake triggers.
  - A fake run cannot step backward for `Space d p`.

  Sample flows set each beat's whole state, so every beat can show in any order.
- **Main guard.** Demo sessions open no flow. Every demo chat session would otherwise write `flows.json` on open and on every signal, from every step in every section. With no flow, `apply` and the `chat.agentEvent` handler return early.
- **`showSample` over the existing preview.** The workflow preview (`createPreview`) steps chat's preview session through every workflow's samples, and only Large has `previewFlows` (`src/plugins/workflow/page/start.ts:119`; Small, Medium and Spike register none). A per-session override keyed by the demo row's id lets each step show its own level on its own row.
- **`isPreview` covers samples.** The chip's and side pane's buttons run nothing on a sample flow, as they run nothing on the preview.
- **The engine step's beats.** The strip and the side pane draw only for a flow with a level (`src/plugins/workflow/page/workflow-view.ts:539`), so the engine step shows the chip only: the no-level warning (`No workflow`, `:141`, `:365`) and the headless tag. The level steps show the strip and the pane.
- **Headless.** The `Headless` beat sets the demo session's headless flag through chat, since that flag lives in chat. The session is ephemeral, so the flag is never saved, and the stage sets it back at dispose.
- **Large countdown.** It is page-drawn text (`src/plugins/workflow-large/page/countdown.ts`). Main's auto-start fires only for a stored flow, so the sample countdown starts nothing. The `Countdown` beat dwells for the countdown's length, so autoplay shows it run down.
- **One main half per level plugin.** Each level shows on its own demo row, so leaving one step closes only that step's row.

GIVEN a `chat.sessionOpened` with `profile: 'demo'` WHEN workflow main handles it THEN `store.get(sessionId)` is null and `flows.json` is not written.
GIVEN a demo row chat already holds WHEN workflow main starts THEN `openRowsAlreadyOpen` opens no flow for it.
GIVEN a session row `s1` with a stored flow WHEN `showSample(sample)` runs THEN the view draws `sample` and `sessions.activate('s1')` is called; WHEN a stored-flow change for `s1` arrives THEN the view still shows `sample`; WHEN the handle is disposed THEN the view draws the stored flow.
GIVEN two samples shown on `s1` in turn WHEN the first handle is disposed THEN the second stays drawn.
GIVEN `showSample` on a session with no row yet WHEN the row is added THEN the sample draws once.
GIVEN `previewFlow` with no `plan` THEN its `projectDir`, `planDir` and title are today's preview values; GIVEN a `plan` THEN the flow carries the plan's values.

## Tests

Workflow main tests name `method_Condition_Result` (`src/plugins/workflow/main/start.test.ts`).

- `src/plugins/workflow/main/start.test.ts`:
  - `it.each` `'$entry_$condition_$result'`, rows:
    - `{ entry: 'sessionOpened', condition: 'DemoProfile', result: 'OpensNoFlow' }`
    - `{ entry: 'openRowsAlreadyOpen', condition: 'DemoProfile', result: 'OpensNoFlow' }`
    - `{ entry: 'sessionOpened', condition: 'OtherProfile', result: 'OpensFlow' }`

    The demo rows assert no flow is held and `flows.json` is not written. The other row asserts the flow opens, so a guard that skips every profile fails. Break: a demo session writing the user's `flows.json`.
- `src/plugins/workflow/page/start.test.ts`:
  - `it.each` `'showSample $name'`, rows:
    - `{ name: 'draws over a stored flow' }`
    - `{ name: 'keeps the sample over a stored-flow change' }`
    - `{ name: 'redraws the stored flow at dispose' }`
    - `{ name: 'leaves a newer sample at an older dispose' }`
    - `{ name: 'draws once its row is added' }`

    Breaks: a sample a live signal overwrites, a dispose that strands the sample, or one that clears another step's sample.
  - `'showSample makes the chip buttons inert'`: `runFor` runs no command on a sample. Break: a click on a demo row that runs a real stage action.
- `src/plugins/workflow-large/page/preview.test.ts`:
  - `it.each` `'previewFlow plan: $name'`, rows `{ name: 'default', plan: undefined }` and `{ name: 'demo plan', plan: <Daily quests> }`. Break: a demo plan leaking into the layout preview, or the reverse.
  - `'demo beat names match PREVIEW_SAMPLES'`. Break: a sample added without a beat.
- `src/plugins/workflow-small/page/demo-steps.test.ts`, `src/plugins/workflow-medium/page/demo-steps.test.ts`, `src/plugins/workflow-spike/page/demo-steps.test.ts`: each registers its steps into a recording `services.demoSteps`, enters the step with a fake context (`sessions: { session: 's1' }`, `scratchDir: '/scratch'`) and a `showSample` fake that records each flow, and runs each beat's `show()`.
  - `it('registers <step id>')`: the registered step's `id`, `section` (`workflows`) and `order` match the Per-plugin values table. Break: a step in the wrong section or order.
  - `it.each` `'beat $name shows its flow'` over that level's beat table, one row per table row: the recorded flow's `workflow`, `stage`, number of leading `done: true` items, `turnRunning`, and, for Medium, `state` equal to `{ fixCycles: <the row's fixCycles> }` (`MediumState` holds only `fixCycles`); for Small and Spike `state` is `null`. Break: a wrong `done` count or stage that ships with no other check.
- `src/plugins/workflow-large/page/demo-steps.test.ts`: `it('registers workflow-large.run')` as above, and `it('Countdown dwells for autoStartSeconds')`: the `Countdown` beat's `dwellSeconds` equals the `autoStartSeconds` setting the fake `api.settings()` returns. Break: autoplay leaving the countdown before it runs down.
- `src/plugins/workflow/page/demo-steps.test.ts`, with fakes for `showSample` (each returns a handle that records its dispose) and `setHeadless`, all appending to one ordered call log:
  - `it('registers workflow.engine')` as above.
  - `it('each beat disposes the previous handle after showing its own')`: run `No level` then `Headless`; the log holds `showSample#2` before `dispose#1`. Break: a dropped handle, or a gap where the row draws the stored flow.
  - `it('stage dispose clears headless, then disposes the last handle')`: after `Headless`, stage dispose logs `setHeadless(s1, false)` before `dispose#2`, and `dispose#2` runs once. Break: a stranded headless flag on the demo row.

Done when: `npm run typecheck` and the tests above pass; `npm run lint` passes apart from the known composition-root failure on the parts tasks 11, 12 and 13 create, when any of them has landed in this wave (plan.md, lint line); `grep -rln "registerDemoSteps" src/plugins/workflow src/plugins/workflow-small src/plugins/workflow-medium src/plugins/workflow-spike src/plugins/workflow-large` lists both `demo-steps.ts` files in each of the five plugins.

Commit: one commit for the group.

## Proof
