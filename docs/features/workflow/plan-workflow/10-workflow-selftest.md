# 10 — Workflow self-test

Status: done
Type: Task
Wave: 5 · Depends on: 05, 09
Plan: [plan.md](plan.md)

Files:     create `src/plugins/workflow/main/selftest-script.ts` · modify `src/plugins/workflow/main/start.ts`
Consumes:  the fake's workflow script ← 05: `FAKE_WORKFLOW_FEATURE_TEXT`, `FAKE_WORKFLOW_STEP_TEXT`,
           `FAKE_WORKFLOW_PLAN_PATH`, and the script's sends. A `/wigley:feature <FAKE_WORKFLOW_FEATURE_TEXT>` send
           runs the feature turn with one `skillStarted wigley:feature`, writes the plan and ends the turn. A
           `/wigley:make <folder>` send ticks box 1. Each `FAKE_WORKFLOW_STEP_TEXT` send runs the next make step: box
           2, then box 3 with a `wigley:review` skill and one review round, then the plan folder deleted.
           `markRun`, `FakeAgentProcessRecord.calls` / `ended` / `request` (in the tree)
           `ChatMainExports.launch` (in the tree)
           `WorkflowSelfTestHooks` (`resetFlows`, `onMainTurnEnded`), built in main's `start.ts` ← 08
           main's settings log line `[workflow] settings: autoClearAndMake <on|off>, autoStartSeconds <n>`, logged
           each time the workflow settings change ← 08
           the page's log lines, commands and Flow tab order (Chat and Docs in either order, then Flow) ← 09
           `SelfTestScript`, `SelfTestGroup`, `SelfTestStep` (`src/contracts/plugin.ts`), `services.selfTest`,
           `SessionsMainExports.activate`, `Files.makeFolder` / `realPath` / `trash` / `write` (in the tree)
Produces:  in `src/plugins/workflow/main/selftest-script.ts`:
           `export interface WorkflowSelfTestDeps { homeDir: string; files: Pick<Files, 'makeFolder' | 'realPath' | 'trash' | 'write'>; chat: Pick<ChatMainExports, 'launch'>; sessions: Pick<SessionsMainExports, 'activate'>; harnesses: readonly AgentHarness[]; hooks: WorkflowSelfTestHooks }`
           `export function workflowSelfTestScript(deps: WorkflowSelfTestDeps): SelfTestScript;`
Decisions:
- **The fake owns the plan.** 05's fake writes, ticks and deletes the plan file itself, and emits `fileWritten` for
  each write. The script writes no plan file and deletes nothing in a step. Each step sends one message and waits for
  the line the fake's reply causes. So the plan has one copy, the one 05's tests check.
- **Fixture.** One project folder, `workflow-selftest` under the home's real path (as chat's `makeProjects`), so every
  page line names the session `workflow-selftest`. Each `open(run)`:
  1. marks the run (`markRun(harnesses)`), so `problems` reads only this run's fake records;
  2. trashes `<project>/docs` (outside a live run `trash` deletes for good), and writes `{}` to the temp home's
     `.config/wigley-ai-gui/settings.json`. This undoes a run that failed before its last step;
  3. calls `hooks.resetFlows(project)`, so rows that an earlier run or app life left in this folder are idle and watch
     no plan (chat keeps rows across a relaunch, and their flows persist in `flows.json`);
  4. calls `hooks.onMainTurnEnded`, and counts each call for the session it launches next. It disposes the listener
     when the run's `result` settles;
  5. launches one session, `chat.launch({ projectDir: project, profile: 'work', message: { text: 'hello', images: [] } })`,
     then `sessions.activate(id)`. The script keeps the id for `problems`.
  `shownLine` is `[workflow] workflow-selftest shows idle`, logged by the page for the new session's first flow.
- **Keys.** `sendKeys(text)` is chat's: `['i', ...text, 'Escape', 'Enter']`. After `<Leader>wf` the box is in insert
  mode at the end of `/wigley:feature `, so that step types `FAKE_WORKFLOW_FEATURE_TEXT`, then `Escape`, `Enter`. The
  sent text is `/wigley:feature fake: workflow feature`. `<Leader>` is `' '`.
- **Tab steps.** The session's tabs are Chat and Docs in either order, then Flow last (09). The only tab that can sit
  between Chat and Flow is Docs. So each tab step presses one key with `repeat`, `expect` the Docs line and `until` the
  target line, and passes on either order.
- **Auto-start settings.** Main parts start on the defaults, and the script's `settings` reach only the page
  (AGENTS.md § Running and testing). Main runs the countdown. So the script's `settings` stay `{}`, and group 6 writes
  `settings.json` itself (`writeFile` `.config/wigley-ai-gui/settings.json`), which the ConfigStore hot-reloads into
  main. After each write, the step waits for main's settings line, so the next step runs on the new settings. The
  auto-start text is `{"workflow":{"autoClearAndMake":true,"autoStartSeconds":30}}`. 30 s keeps the countdown from
  running out while the steps wait (each step's own timeout is shorter). Group 6 ends with a `{}` write, so no later
  script runs with auto-start on.
- **Groups** (each `why` verbatim; every `expect` is a whole page line; `alsoExpect` patterns are anchored with `^`
  and `$`):
  1. `idle and start feature` — why: `An idle session offers Start feature, which fills the composer without sending.`
     - `[' ', 'w', 'f']` → `[workflow] ran startFeature in workflow-selftest`, screenshot `strip-idle`.
  2. `feature to plan ready` — why: `A wigley:feature turn that writes a plan and ends moves the session to plan ready on the chip and the strip.`
     - keys `[...FAKE_WORKFLOW_FEATURE_TEXT, 'Escape', 'Enter']` → `[workflow] workflow-selftest shows planReady`,
       `alsoExpect` `progress 0/3 wave 1`, screenshot `strip-plan-ready`.
     - keys `['<A-o>']`, `expect` `[sessions] showed Docs tab in workflow-selftest`,
       `repeat: { until: '[workflow] Flow tab shown in workflow-selftest', max: 3 }`, screenshot `flow-tab-plan-ready`.
     - keys `['<A-i>']`, `expect` `[sessions] showed Docs tab in workflow-selftest`,
       `repeat: { until: '[chat] Chat tab shown in workflow-selftest', max: 3 }`.
  3. `clear and make` — why: `ww runs Clear & make: the session clears and sends /wigley:make with the plan folder, and make shows progress.`
     - `[' ', 'w', 'w']` → `[workflow] workflow-selftest shows make`, `alsoExpect` `progress 1/3 wave 1`.
     - `sendKeys(FAKE_WORKFLOW_STEP_TEXT)` → `[workflow] workflow-selftest progress 2/3 wave 2`, screenshot
       `strip-make`.
  4. `review` — why: `A review round in the Run log lights review.`
     - `sendKeys(FAKE_WORKFLOW_STEP_TEXT)` → `[workflow] workflow-selftest shows review`, `alsoExpect`
       `progress 3/3 review 1`.
  5. `close and dismiss` — why: `The plan folder deleted closes the run, and wd returns the session to idle.`
     - `sendKeys(FAKE_WORKFLOW_STEP_TEXT)` → `[workflow] workflow-selftest shows closed`, screenshot `strip-closed`.
     - `[' ', 'w', 'd']` → `[workflow] workflow-selftest shows idle`.
  6. `auto-start countdown` — why: `With auto-start on, plan ready counts down, and ww during it cancels without clearing.`
     - writeFile the auto-start `settings.json`, keys `[]` →
       `[workflow] settings: autoClearAndMake on, autoStartSeconds 30`.
     - `[' ', 'w', 'f']` → `[workflow] ran startFeature in workflow-selftest`.
     - keys `[...FAKE_WORKFLOW_FEATURE_TEXT, 'Escape', 'Enter']` → `[workflow] countdown shown in workflow-selftest`,
       `alsoExpect` `shows planReady`, screenshot `strip-countdown`.
     - `[' ', 'w', 'w']` → `[workflow] countdown stopped in workflow-selftest`.
     - writeFile `{}` to `settings.json`, keys `[]` → `[workflow] settings: autoClearAndMake off, autoStartSeconds 10`.
- **`problems(result)`** reads this run's fake records whose `request.projectDir` is the project, and lists what is
  wrong, empty when all hold:
  - `no workflow session: <error>` when `launch` rejected.
  - `sends were <texts>` when the `send` texts across those records, in order, are not exactly: `hello`,
    `/wigley:feature fake: workflow feature`, `/wigley:make <planFolder>`, `FAKE_WORKFLOW_STEP_TEXT` three times,
    `/wigley:feature fake: workflow feature`. `<planFolder>` is `<project>/` joined with `FAKE_WORKFLOW_PLAN_PATH`
    less `/plan.md`. A second `/wigley:make` means that the cancelled countdown ran Clear & make anyway; none means
    that Clear & make never sent. The two feature sends prove that `wf` filled the composer with
    `/wigley:feature ` and the typed text joined it.
  - `make was not sent after a clear` when the record that holds the `/wigley:make` send is the first record, or an
    earlier record of the session has `ended` false.
  - `<n> main turn ends for <m> sends` when the count from `onMainTurnEnded` is below `m - 1`, `m` being the number
    of sends. The first reply (`hello`) can end before main opens the session's flow, so one turn end may be
    unheard. This catches a `turnEnded` that never reaches main.
- **`scrollsItself`**: `[]` (the strip wraps; the chip ellipsizes inside its row).
- **Registration.** Main's `start.ts` calls `services.selfTest?.run(workflowSelfTestScript({ … }))` during `start`.
  It passes the `WorkflowSelfTestHooks` that 08 builds there when `services.selfTest` is non-null.

GIVEN the fake harness and a fresh session WHEN the script runs THEN every group's lines are logged in order, and
`problems` is empty.
GIVEN the countdown is shown WHEN `ww` is pressed THEN the countdown stops and no second `/wigley:make` is sent.
GIVEN a settings write WHEN the next step runs THEN main has logged its settings line for that write.

Tests:     none of its own: the script is the test, run by `npm run selftest` in 12. The self-test's own group check
           checks its group names and whys.
Done when: compiles; `npm run lint` passes; `npm run selftest` (12) runs the workflow groups green
Commit:    one commit for the group

## Proof

Commit a3bbd8e · proof: diff read: selftest-script with six groups, each with a why; main hands it the hooks; worker's npm run selftest ended '[selftest] all passed'; lint clean (08's unused warning gone); six screenshots checked · concerns: a second run in one page life may match '<name> shows idle' early off the earlier run's still-open row; the Flow tab shows the plan title twice (heading and 'Fake flow · 3 tasks'); other plugins' toasts cover composer chips in two screenshots
