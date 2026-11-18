# Workflow

**Contents**

- **Status** — what is built now and where each workflow lives.
- **Vocabulary** — workflow, level, flow, stage, status, signal, checklist, run log, main action.
- **Large's stages** — each Large stage: when a session enters it, what it shows, and its actions.
- **Small's stages**, **Medium's stages** and **Spike's stages** — the same columns for the other three workflows.
- **Stage modules** — one folder per stage, handed over through `addWorkflow`, and how to change or add a workflow.
- **Signals** — the agent events, session events and reported steps the flow folds, the two tools, the claim rule and the run log.
- **Where it draws** — the row chip, the composer strip with its trail, and the side pane.
- **Auto-start** — Large's setting that starts Clear & make by itself, and its countdown.
- **Keys** — the `<Leader>w` group.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope** — what waits for a later workflow or adapter.

The `workflow` plugin is the engine for the user's wigley workflows. It shows each Chat-tab session's place in the
workflow that session runs, with the next step one press away. Four plugins register a workflow with it: `workflow-small`
(Scope › Build › Check › Land), `workflow-medium` (Interview › Build › Review › Fix › Land) and `workflow-large`
(Primer or Explore › Interview › Plan › Cold read › Make › Review › Fix › Close) and `workflow-spike` (Interview › Build ›
Check › Land, looping per ask). The level skill a session starts picks
its workflow; skill starts and plan folders mark Large's big moves, and the agent reports the steps between them. A good
outcome: every session row says where its run stands, and a new workflow or a changed stage is one plugin folder or one
stage folder, with no engine edit. This doc holds the engine and every stage; `docs/features/workflow-levels/design.md` is
the short why of the levels.

## Status

Built. The engine is `src/plugins/workflow/`; Large is `src/plugins/workflow-large/`, Small `src/plugins/workflow-small/`,
Medium `src/plugins/workflow-medium/` and Spike `src/plugins/workflow-spike/`. All five build on the clear, the agent events and the row parts that earlier
plans landed (`chat.agentEvent`, `sessions.hostSessionChanged`, `addRowPart`). Each workflow plugin hands its own
self-test script to the fake agent harness: `src/plugins/workflow-large/main/selftest-script.ts`,
`src/plugins/workflow-small/main/selftest-script.ts`, `src/plugins/workflow-medium/main/selftest-script.ts` and
`src/plugins/workflow-spike/main/selftest-script.ts`.

## Vocabulary

- **Workflow** — a named set of stages a session runs, registered by one plugin. Spike, Small, Medium and Large are the
  first four.
- **Level** — the user's word for a workflow: Small, Medium and Large in their size order, and Spike outside it. The app's **Effort** control is Claude's reasoning
  effort, a different thing, so nothing here is called effort.
- **Flow** — one session's place in its workflow: the workflow, its stage, its checklist and the workflow's own state
  (`flow.state`; for Large `LargeState`: the plan folder, the plan's progress and the countdown). Main holds one flow per
  session and keeps it in the plugin data. A session starts with no workflow, and a flow holds none until a workflow
  claims a skill.
- **Stage** — one step of a workflow, one stage module (§ Stage modules). Chat's **step** (a tool, thinking or raw
  entry) and the tower's **plan step** are different things.
- **Status** — what a stage is doing now: running, paused, ready or done. A step not reached is pending.
- **Signal** — one input the flow folds: an agent event, a clear, a reported step or checklist, or a workflow's own event
  (§ Signals).
- **Trail** — the stepper's row of step words, each workflow's own steps: Scope to Land for Small, Interview to Land for
  Medium and Spike, Primer or Explore to Close for Large.
- **Checklist** — the work items the side pane shows. Large's comes from `plan.md` once a plan is read; the others',
  and Large's until then, from the agent through `set_workflow_checklist`.
- **Run log** — `runs.jsonl`, one line per finished workflow (§ Signals).
- **Main action** — the one action of a stage that `ww` runs, the strip's one button and the first of the side pane's buttons. A stage with no button has none.
- **Key-only action** — an action that runs from its own `Space w` key and draws no button (`keyOnly`).

## Large's stages

| Stage | A session enters it when | Label and status | Status line | Button actions (main action first) | Key-only actions |
|---|---|---|---|---|---|
| idle | a plan is handed away (Make in new session), or Dismiss on closed | none: nothing draws | none | none: a feature starts from its skill call | none |
| primer | `wigley:feature-primer` starts | Primer, running or paused | `Primer · running` | none | none |
| explore | `wigley:feature` starts, which forgets any earlier plan; the agent reports `explore` in a feature run | Explore, running or paused | `Explore · paused` | none | Open plan, once a plan is written |
| interview | the agent reports `interview` in a feature run | Interview, running or paused | `Interview · running` | none | Open plan, once a plan is written |
| plan | the agent reports `plan` in a feature run | Plan, running or paused | `Plan · running` | none | Open plan, once a plan is written |
| cold read | the agent reports `cold_read` in a feature run | Cold read, running or paused | `Cold read · running` | none | Open plan, once a plan is written |
| plan ready | in explore, interview, plan or cold read, a turn ends or the plan changes while the session's `plan-*/plan.md` holds a box under Tasks and no turn or subagent runs | Make, ready | `Make · ready` | Clear & make (Cancel during the countdown), Make in new session | Open plan |
| make | `wigley:make` starts | Make, running or paused | `Make · running 3/8`, counting every box but the final verification task, which make runs after its review | none | Resume make, Open plan |
| review | `wigley:review` starts in make or fix, or, in make, the plan's Run log gains a review round logged after make started (Resume make from review stays in make until the next round) | Review, running or paused | `Review · running · round 2` | none | Resume make, Open plan |
| fix | the agent reports `fix` in make or review | Fix, running or paused | `Fix · running · cycle 2` | none | Resume make, Open plan |
| closed | in make, review or fix, a plan folder that was read goes missing (`wigley:make` naming a folder not written yet waits in make for its `plan.md`) | Close, running while a turn or subagent runs, then done | `Close · done · 9/9` | Retro | Dismiss |

A **feature run** is the stages explore, interview, plan, cold read and plan ready. A report moves the flow only from
one of them. A session in no workflow starts at no stage: Large's flow enters idle only through a handed-off plan or
Dismiss. `wigley:make` starting moves any stage to make, fix included, and claims the flow for Large when another
workflow or none holds it. A standalone `wigley:explore` or `wigley:review` shows its level and trail through the level
skill that started the run.

Running means the flow is busy: a turn or a subagent at any depth runs. A permission prompt or an open round waits inside a running turn, so it reads as running, and chat or forms puts Needs you on the row. Paused means nothing runs. A paused run sets no Needs you: a turn that waits on the user ends on a round, which sets it, so a paused run is an agent that replied, and the row keeps chat's Done or Error (Row label, below).

- **Clear & make** clears the session (the row and its tabs stay, a new conversation starts) and sends
  `/wigley:make <plan folder>`. It is disabled while the session is busy: a turn or a subagent runs.
- **Make in new session** starts a background session in the same folder with `/wigley:make <plan folder>` through
  chat's `launch`, hands the plan to it, and returns this session to idle. One plan shows in one session.
- **Resume make** shows when the plan has open boxes, and is enabled only when the session is not busy, as after a
  relaunch or a crash. It clears and sends make again; make reads its own Run log back.
- **Open plan** opens `plan.md` in Docs mode (`openDoc`).
- **Retro** sends `/wigley:retro` in the same session, which holds the run's context.
- **Dismiss** returns a closed session to idle. A closed session also leaves on its next flow skill, and goes back to
  the stage it closed from (make, review or fix) when its plan folder is read again while its turn or a subagent
  runs: the folder left with a branch switch or checkout and came back, so the run never ended. A closed session reads
  its plan folder again at each turn or subagent start or end.

The last `plan.md` written in a session is its plan. `wigley:make`'s argument names the plan when it is a plan
folder. Only the main agent moves the stage, with one exception: a subagent's write of a `plan-*/plan.md` names the
plan, since `wigley:feature` drafts the plan in a subagent. Any other skill or write by a subagent is not a signal, and
a subagent's `set_workflow_step` or `set_workflow_checklist` call succeeds and changes nothing (§ Signals).

A plan folder has a copy in each checkout of its repo: the same repo-relative folder in the main clone and in each git
worktree of that clone. A `wigley:make` run in a worktree ticks the worktree's copy, often through a shell, so the app
must learn which copy the run writes. The run reports it two ways, and the latest report wins:

- **`plan.py`** — every progress write (`base`, `start`, `land`, `strike`, `log`) in a session the app started writes
  `{"planDir": <absolute folder>}` to `plan-runs/<row id>.json` in the app's endpoint folder, read
  from `WIGLEY_AI_GUI_ENDPOINT_DIR` and `WIGLEY_SESSION_ROW`. It writes the file directly, with no temp file and
  rename, since the macOS watcher can miss a rename's target name. A failed write warns and never fails the command, and
  `close` writes nothing.
- **`set_workflow_plan`** — the agent's tool, which `workflow-large` contributes. It takes `folder`, refuses one with no
  `plan.md`, and a subagent's call changes nothing. `wigley:make` calls it once it knows the folder it works in.

A reported folder is read alone. With no report, or once the reported folder holds no `plan.md`, Large reads the
**moved copy**: a copy whose progress differs from the main tree's copy and is not behind it (no fewer ticked boxes, and no task's `Status` ranked before main's for the same task document; the order is not started, in progress, done, and a status outside that order is never behind), the most recently
modified of them when several differ, else the main tree's copy. A fresh worktree checks out the main tree's progress,
and an idle worktree left behind main has fewer ticked boxes or an earlier `Status`, so neither wins, however new its files' modified times
are. A report that moves the flow off an unreported folder with the same plan folder name under the same feature folder keeps that folder in the flow's state, saved with it, and a report of any other folder keeps none; once a reported folder lists no copies, as a worktree removed after its merge does, the watch lists the copies, and decides whether the plan is gone, from the main tree's copy it last listed, else from that kept folder, so an app restart still finds the main tree's copy. A plan outside a git clone (`~/wigley-features/`) has one copy. A report
applies when its file changes; a row's file stays after the row ends, since the live `Files.trash` would fill the
user's Trash, and a new row never reuses an old row's id.

## Small's stages

The first claim of `wigley:small` puts the flow in scope. A report moves the flow from any Small stage, since the agent
reports each step as it reaches it. The status line is the label, the status and the progress, as for Large's rows.

| Stage | A session enters it when | Label and status | Status line | Button actions | Key-only actions |
|---|---|---|---|---|---|
| scope | `wigley:small` starts, the first time or again in the session | Scope, running or paused | `Scope · running` | none | none |
| build | the agent reports `build` | Build, running or paused | `Build · running 2/5`, the checklist's `<checked>/<total>` once a checklist holds items | none | none |
| check | the agent reports `check` | Check, running or paused | `Check · running` | none | none |
| land | the agent reports `land` | Land, running or paused | `Land · running` | none | none |
| done | the agent reports `done`, which writes the run log line | Land, running while a turn or subagent runs, then done | `Land · done` | none | none |
| answered | the agent reports `answered` for a session that only answered and built nothing, which writes the run log line | Answered, no status: a neutral tag with no check, off the trail, so every step reads pending; a turn ending here while another session is viewed reads `answered` on the row until the user views it (Row label, below) | `Answered` | none | none |

## Medium's stages

The first claim of `wigley:medium` puts the flow in interview, and a second ask in the session returns it there and resets
the fix count.

| Stage | A session enters it when | Label and status | Status line | Button actions | Key-only actions |
|---|---|---|---|---|---|
| interview | `wigley:medium` starts, the first time or again in the session | Interview, running or paused | `Interview · running` | none | none |
| build | the agent reports `build` | Build, running or paused | `Build · running 2/5`, the checklist's `<checked>/<total>` once a checklist holds items | none | none |
| review | the agent reports `review` | Review, running or paused | `Review · running` | none | none |
| fix | the agent reports `fix`; entering fix from another stage counts one fix cycle | Fix, running or paused | `Fix · running · cycle 2` after the first cycle | none | none |
| land | the agent reports `land` | Land, running or paused | `Land · running` | none | none |
| done | the agent reports `done`, which writes the run log line | Land, running while a turn or subagent runs, then done | `Land · done` | none | none |

## Spike's stages

The first claim of `wigley:spike` puts the flow in interview. Each stage answers its own reported step from any stage,
so the flow loops: build and check repeat for each ask, and a round in the middle of the loop goes back to interview.
A second claim in the session, or a claim after done, returns the flow to interview.

| Stage | A session enters it when | Label and status | Status line | Button actions | Key-only actions |
|---|---|---|---|---|---|
| interview | `wigley:spike` starts, the first time or again in the session, or the agent reports `interview` | Interview, running or paused | `Interview · running` | none | none |
| build | the agent reports `build` | Build, running or paused | `Build · running 2/5`, the checklist's `<checked>/<total>` once a checklist holds items | none | none |
| check | the agent reports `check` | Check, running or paused | `Check · running` | none | none |
| land | the agent reports `land` | Land, running or paused | `Land · running` | none | none |
| done | the agent reports `done`, which writes the run log line | Land, running while a turn or subagent runs, then done | `Land · done` | none | none |

Small's, Medium's and Spike's stages have no actions: their `runAction` rejects with `Small has no actions`, `Medium has
no actions` and `Spike has no actions`. `done` shares its trail slot with `land`, so the trail still ends at Land.

A session with `workflow === null` draws nothing but the `No workflow` tag, after a live turn with agent work ends while
no level skill has started.

## Stage modules

`src/plugins/<workflow plugin>/stages/<stage>/` holds one stage:

- `main.ts` — the stage's entry rule, a pure function of the flow and a signal
- `page.ts` — its label, its status, what follows the status in its status line, what the strip and the side pane show,
  and its actions

A main half that declares `reportedAs` takes that value of `set_workflow_step`'s `step`: the tool's accepted values
derive from the registered stages (§ Signals). Its entry rule still decides whether a report moves the flow. A stage with
`finishes` writes the run log line when a flow enters it: Large's `closed`, Small's `done` and `answered`, Medium's and Spike's `done`.

A workflow plugin hands its stages to the engine through the engine's `addWorkflow` export, once in each process: main
takes a `MainWorkflow` (its claims, first stage and `MainStage`s, and optionally its state fold), the page a
`PageWorkflow` (its label, badge, `PageStage`s and its draw). The engine names no skill and no workflow's stages beyond idle (`IDLE_STAGE`). It folds each
signal through the flow's current workflow alone (`foldFlow(flow, signal, workflows)`): the claim first, then the
checklist, the workflow's state and that workflow's stages in order, the first entry rule that answers wins, and the flow
keeps its stage when none answers. Two workflows may hold a stage with one id or one `reportedAs`.

Each action names a command of the owner plugin, which its key runs: `workflow-large`'s commands are `LARGE_COMMANDS`,
which its manifest joins. A button, a fold and a key all run the engine's `workflow.stageAction` with the session and
the action (`{ sessionId, action }`: the action's short id, `mainAction` or `toggleFinishedWaves`), so one intercept on
it sees every stage action of every workflow. The engine's gate (`runFor`) checks the action, and the flow's workflow
runs it through its `runAction`. Small, Medium and Spike declare none.

To change a workflow:

- a renamed skill, a new trigger or a new reported step — edit that stage's `main.ts`
- a new stage — a new stage folder in its plugin, its commands and keys, and its place in the stage order
- a stage dropped — delete its folder and its entries
- a renamed stage id — edit every rule that names it, in every stage's `main.ts` of that workflow;
  `workflow-large/stages/main-stages.test.ts` turns red on one left behind in Large

To add a workflow: add a plugin folder (`manifest.ts`, `contract.ts`, `main/start.ts`, `page/start.ts`) that depends on
`workflow` in both processes, with the skills it claims, its stages and its layout folder, and call `addWorkflow` in each
process. It joins `manifests.ts`, `main.ts` and `page.ts`, and the engine needs no edit. The new level's skill also joins
`LEVEL_SKILLS` in `~/wigley-agents/tools/workflow-gate/workflow-gate`, with a row in `~/wigley-agents/workflows.md`;
without both, the gate denies that level's sessions' edits.

## Signals

Main folds these, for owned sessions only:

| Signal | From | Carries |
|---|---|---|
| skill started | `chat.agentEvent` `skillStarted` (a Skill call, or a slash command the user typed) | skill (`wigley:make`), args |
| file written | `chat.agentEvent` `fileWritten` (a Write or Edit) | the full path |
| turn ended | `chat.agentEvent` `turnEnded` | — |
| turn started | `chat.agentEvent` `turnStarted` (every turn, a subagent's result turn included) | — |
| subagent started, finished | `chat.agentEvent` `agentSpawned` of any agent, a subagent's own included, and `agentFinished` | the agent id |
| cleared | `sessions.hostSessionChanged` | — (the flow is rekeyed to the new host session id) |
| step reported | the `set_workflow_step` tool | the stage the step names |
| checklist reported | the `set_workflow_checklist` tool | the whole list of `{ text, done }` items |
| custom | a workflow plugin's own event, through the engine's `signal` export | the event, which only that workflow reads (Large's plan changed, plan gone, handed off and dismissed) |

`skillStarted`, `fileWritten`, `turnStarted` and `turnEnded` are members of `AgentEvent` (`src/contracts/agent.ts`) that
the Claude adapter and the fake harness emit, so the fold never reads a harness's JSON. A subagent's `skillStarted` is
no signal. Every agent's `fileWritten` is a signal, and Large reads only a `plan-*/plan.md` path from it. A `sessionEnded` of the flow's current host session (a process that exits
mid-turn) gives a subagent-finished signal for each running subagent, then a turn-ended signal. A cleared session keeps
its stage: Clear & make's own clear must not reset plan ready. `sessions.ended` (main's event for a closed row) drops
the session's flow.

Large's plan rows come from `workflow-large`'s plan watch: it watches every copy of the flow's plan folder, reads the
reported copy or else the moved copy, and signals `planChanged` with the plan's progress (title, ticked, total, current wave, review rounds, the
task lines, each with the `Status:` line of its task document) and `planGone` when no copy is left. It lists the repo's
worktrees again at each plan check and when git's worktree list changes, so a worktree made during the run joins. A report from `plan.py` or `set_workflow_plan` signals `planReported` with the folder, which sets the flow's plan
folder and marks it reported. Make in new session and Dismiss signal `handedOff` and `dismissed`. All five ride
`custom`.

**The claim.** A workflow claims the skills that start it: Small `wigley:small`, Medium `wigley:medium`, Large
`wigley:feature`, `wigley:feature-primer` and `wigley:make`, Spike `wigley:spike`. `wigley:review` and every other skill claim nothing, so they
run inside the level. A claim by a workflow other than the flow's current one sets `movedUpFrom` to the current workflow
(null for a session in none), sets the new workflow, its first stage, a null `state` and a null checklist, and clears
`missedLevel`. The engine does not check that the move is upward: moving down is the user's word, by the same skill
load. A claim by the current workflow (an own claim) nulls the checklist, so a second ask shows no old list; it changes nothing
else on the flow's identity (`movedUpFrom` stays), and its stage rules may restart it. A claim from a stage with
`finishes` starts a new run, so `movedUpFrom` is null for it, whichever workflow claims. When two workflows claim one
skill, the lowest `order` wins (Small 10, Medium 20, Large 30, Spike 40).

The engine contributes `set_workflow_step` and `set_workflow_checklist` through sessions' `contributeTools`, so every
session's agent can call them. A wigley skill calls the step tool at each step boundary; a skill that does not call it
leaves the flow in its last step.

- `set_workflow_step`'s one required string `step` takes a `reportedAs` value of any registered workflow: Large's are
  `explore`, `interview`, `plan`, `cold_read` and `fix`, Small's `build`, `check`, `land`, `done` and `answered`, Medium's `build`,
  `review`, `fix`, `land` and `done`, Spike's `interview`, `build`, `check`, `land` and `done`. The flow's current workflow's stage rules answer the report, so a value outside that
  workflow's stages is ignored.
- `set_workflow_checklist`'s one required `items` is an array of `{ text, done }`. Each call replaces the whole list,
  so a missed call cannot leave the app out of step. Large calls it while it explores and plans; once a plan is read,
  Large's checklist comes from `plan.md`.
- Only the main agent's call counts. The engine contributes both tools as main-agent-only. Sessions asks its tool-call
  guards before it runs a contributed tool, and chat's guard names the agent behind the call's tool-use id from the
  stream's tool events. A subagent's call succeeds with a
  text saying that only the main agent's report changes the session, and changes nothing. The same guard covers
  sessions' `set_session_title`. A call whose agent chat has not seen yet waits up to 2 s for the stream, then counts as
  the main agent's. A session with no stream (a terminal session) counts every call as the main agent's.
- An unknown step answers with a tool error naming the accepted values.
- A report the stage rules ignore, or one for a session with no flow, succeeds and says it was ignored, so a skill run
  outside the app's workflow carries on.
- A plan survives a report: only `wigley:feature` or `wigley:feature-primer` starting (`clearsPlan`) and a return to idle
  forget one, so a report back to explore keeps the plan the run wrote.

**The run log.** When a fold enters a stage with `finishes`, main appends one JSON line to `runs.jsonl` in the engine's
plugin data. The keys are pinned: `at`, `sessionId`, `projectDir`, `workflow`, `movedUpFrom`, `activeMs`, `costUsd` and
`fixCycles`. `activeMs` is active time since the run began (the session's first claim, or the last finished run), `costUsd` is
spend since then (null when no spend arrived since the run began; a process figure that falls counts as a new process
and carries), and `fixCycles` is the workflow's own review fix count. Nothing draws the log.

`costUsd` runs one turn behind. Spend updates at a turn's result and a finishing stage lands mid-turn, so a run's last turn
is not in the figure, and a one-turn run logs null. The user accepted this at landing, after the real Small check logged null
ahead of $0.36 of spend: the log compares levels. A level whose runs are often one turn, as Small's can be, needs the line
written at the turn's end before its cost can be compared.

A re-attach replays its process's whole log, each event flagged `replayed`, over the saved flow. `flows.json` holds each
flow's save time, stamped by a change from a live event or from Make in new session or Dismiss, not by a plan read, a
replay or a countdown's Cancel or firing. A replayed event
at or before that time is already in the flow, so it updates only the running turn and subagents; a later one, from a
turn that ended while the app was closed, folds as usual. A flow saved without the time counts as saved when it loaded.

A flow opens when chat opens its row (`chat.sessionOpened`, paired with the host id `sessions.connected` gave). The
engine restarting on its own while chat and sessions run hears neither for the rows already open, so its `ready()`
opens each row in `chat.session` whose profile is in chat's settings, under the host id and folder its
`sessions.rows` entry holds, after `flows.json` loads; an open event for a row already opened under the same host id
opens nothing more. Every change writes the whole file, and the part's stop waits for the last write, so the flow a
restart opens is the one the stopped engine held.

## Where it draws

Each workflow draws through its own layout, over the engine's contract and kit: the built-in `default` of each workflow
plugin, a user's override in `layouts/<workflow plugin>/<name>/` (for Large `layouts/workflow-large/<name>/`), set by the
plugin's own `layout` setting. The layout preview is on `Space z l w`. One exception to Intent's layout rule: the
`No workflow` tag is drawn by the engine with no layout, since no workflow owns such a flow, so a layout cannot restyle it.

- **Row label** — a stage that waits on the user declares a `rowActivity`, set through sessions' `setActivity` while
  the flow is not busy: plan ready's `Ready to make` in `attention` and closed's `Closed` in `success`. Each is
  `raised`, so the built-in sessions layout draws it as a tinted Tag in place of a finished turn's `Done`, with a status
  edge on the card, one step under the solid Tag of an `urgent` Needs you. Its rank sits above chat's done and below chat's working, so a running turn, an error and a waiting round still
  take the label.
- **Unseen word** — a stage that declares an `unseenActivity` sets it when a turn ends there while another session is
  the active one, as chat's `Done` does, and clears it when the user views the session or the flow is busy again:
  Small's answered reads `answered` in `success`, untagged as `Done` is, at the stage rank, so it replaces `Done` and
  the chip keeps its neutral `Answered` tag. A page reload drops it, as it drops chat's `Done`. Unlike `Done`, it also
  marks a turn that ended with background tasks still running once the flow goes idle, since the flow sees only the
  turn and its subagents; those tasks' Working outranks it while they run.
- **Paused run** — sets nothing of its own. Needs you comes only from what blocks on the user: an open round or primer,
  and a permission prompt.
- **Row chip** — a row part (sessions' `addRowPart`): the built-in layouts draw the level's badge (one letter, S, M or L,
  in the level's colour, `--wg-workflow-<level>-badge`, with the full word in its tooltip), then the stage's label and
  the progress its stage gives the chip (`chipProgress`: make's build count, `Make 3/8`) as one tag toned by its status (`running`, pulsing, while running; `success` with a check when done; neutral while
  paused or ready), unless the row label says it, and Large's countdown. The row's own label shows no Working: this tag
  says it. On a row too narrow for it, usage's
  bar shrinks away first, then the tag ellipsizes. A user layout can also draw the
  progress and the main action's button, which the chip's input carries. Idle draws no stage. A session in no workflow
  draws the **`No workflow`** tag, an error Tag in `--wg-status-error`, once a live turn with agent work has ended with no
  level skill started, and nothing before. While the session's row holds a running activity (chat's
  working, which counts background tasks too), the chip ends on a running `Working` tag, pulsing, unless its stage tag
  is already running: so a busy session with no stage, or at a done or ready stage, still says it works.
- **Composer strip** — a part above the Chat composer (chat's `addComposerPart`): the trail, the countdown, the main
  action and last the Headless chip, a toggle Tag reading `Headless` (accent while on, muted while off) that runs
  `workflow.toggleHeadless` (`Space w h`) on its session. While the session is headless its row's chip ends on an accent
  `Headless` tag in every stage, idle and no workflow included. A stage outside the stepper keeps the status mark and line, since the trail does not show it. Once a plan is
  read the side pane holds the detail and the other actions, so a hidden pane leaves the trail, the main action and the
  `Space w` keys. Idle draws nothing.
- **Side pane** — one section of the session hub beside the Chat tab's transcript (chat's `addSidePart`,
  `docs/features/chat-bar/design.md` § The session hub) for each workflow, drawn only while a session's flow is of that
  workflow. The section's title is `Plan` for Large and `Checklist` for Small, Medium and Spike.
  - Large's pane shows once the agent has set a checklist or a plan is read, until Dismiss, and a new plan swaps the agent's list back in until that plan is read: the status line, the detail, a progress bar, the checklist and every button of the stage. Until a plan is read the
    checklist is the agent's own, as Small's is. A read plan's checklist shows every wave in full: the finished waves
    under a fold row that starts open, then the current wave, then each later wave.
    A task in the current wave whose task document reads `Status: in progress` shows the stage's state — running while make runs, paused while it pauses, pending in a stage that runs no tasks; every other open task shows pending.
  - Small's, Medium's and Spike's pane shows once the agent has set a checklist: the status line, a `<checked>/<total>` line, a
    progress bar and the list as one flat list.
  - Each checklist row leads with its number, counted from 1 down the whole list across every group, then its mark, so
    an agent's "task 3" names one row. A plan's tasks, numbered `01`, `02`… in plan order, keep the same numbers.
  - The trail stays on the strip alone.

  `<Leader>ws` shows or hides the pane in every session, and the choice survives a relaunch. The pane also hides with
  the hub: while the Chat tab is narrower than 640 px, set in the chat layout's CSS, so the transcript keeps a readable
  width in a split, and on `<Leader>bh`. The pane takes no keyboard focus, so `Alt+h/j/k/l` still moves between chat panes, and its list scrolls with
  the mouse and keeps its scroll while the pane is out of view or hidden.

Primer and explore share the first step: the one the session is in, otherwise Explore. Plan ready and make share the
Make step, and Small's, Medium's and Spike's `done` and `land` share Land. Spike's trail can go back: a report of an earlier step makes it the current one, and every later step reads pending again. The trail is words alone: a step's weight and colour show its status (`DESIGN.md` § Workflow), and the
current step also carries what follows the status in its status line (`Make 3/7`, `Fix · cycle 1`). On a narrow pane the
trail wraps.

## Auto-start

With `workflow-large.autoClearAndMake` on (default off), plan ready starts a countdown of `workflow-large.autoStartSeconds`
(default 10) on the strip and the row chip. During it the main action is Cancel. At zero, Clear & make runs. A turn
that starts, a clear, a Cancel or a replayed event stops it. A replayed event starts none, and neither does the plan
read a replayed turn end causes, until a live turn starts or ends.

## Keys

The `<Leader>w` group (which-key: workflow), each button action's key anchored on its button. The chords did not change
when the workflow plugins split; `ww`, `ws` and `wf` stay engine commands (`workflow.*`), and `wn`, `wr`, `wo`, `wt` and
`wd` are `workflow-large.*`.

| Keys | Command |
|---|---|
| `<Leader>ww` | the current stage's main action (Cancel during the countdown); with no button, log `nothing to run` |
| `<Leader>wn` | Make in new session |
| `<Leader>wr` | Resume make |
| `<Leader>wo` | Open plan |
| `<Leader>wt` | Retro |
| `<Leader>wd` | Dismiss |
| `<Leader>ws` | Show or hide the side pane, in every session |
| `<Leader>wf` | Fold or open the selected session's finished waves, which start open; with no finished group, log `nothing to run`; on a Small, Medium or Spike flat list the key flips the fold and nothing shows |

The layout preview opens on `<Leader>zlw`.

## Decisions

- **Build on what landed.** The clear, the agent events and the row parts have their own plans and docs; the flow
  reads their exports and events and keeps no second copy.
- **The engine owns one command for every stage action; the level owns the actions.** Every stage button, fold and key
  runs `workflow.stageAction`, so one intercept or listener sees every stage action, and each action's key stays a
  command its own plugin declares, with its bind and Settings row. The flow's workflow runs the action through its
  `runAction`, so the engine holds no closed switch of stage actions, names no stage or skill, and a new workflow adds its
  actions without an engine edit.
- **The user presses, unless the setting is on.** Clear throws away the interview's conversation, so the default
  waits for the user, and the auto-start counts down with a Cancel.
- **Cancel is `ww`, not Esc.** The strip is a part inside the Chat tab and holds no key scope, and Esc already leaves
  the chat box.
- **Agent-reported steps, not inferred ones.** The user chose exact step boundaries over inferring them. Interview,
  plan, cold read and fix leave no event of their own: an inference from tools, writes or subagents would guess, and a
  wrong step on the trail reads as fact. The agent knows which step it is in, so it says so through a tool. The cost is
  a skill that must call the tool, and a step that lags when one does not.
- **Agent events, not chat entries.** Detection reads `AgentEvent` so a Codex or wigley-harness adapter drives the
  flow unchanged; `toolStarted` carries only the tool's name, no input, so skills and writes get members of their own.
- **Buttons only for the moves between runs.** Only plan ready to make and closed to retro earn a button. Open plan, Resume
  make and Dismiss keep their keys, so a stage with nothing to move to draws no button and `ww` runs nothing there.
- **One checklist.** The side pane replaced a Flow tab that drew the same stepper, checklist and actions; a second copy
  added upkeep and showed nothing new. Open plan shows the whole plan.
- **Review rounds stay a count.** The Run log gives the number of logged rounds, so the status line names the round and
  the checklist draws no row per round.
- **One plan reader.** `src/shared/plan-progress.ts` reads a plan's boxes, waves, Run log and task
  statuses, and `src/shared/plan-copies.ts` finds a plan's copies and picks the moved one, so every Large run shows the
  same copy. The docs index's counts take every checkbox in the file and carry no waves or Run log.
- **A reported copy, not a guessed one.** A run in a worktree ticks that worktree's copy, often through a shell that
  sends no write event, so following the session's own path or its agents' write paths would miss it. Picking the
  copy with the newest modified time failed too: every new worktree checks the plan out with fresh times. `plan.py`
  is the one writer of a run's progress, so its report rides on writes that already happen; the agent's tool covers a
  resumed run before its first write. The moved-copy rule is the fallback for terminal sessions.
- **Only the main agent reports.** A subagent's step or checklist describes its own task, not the session's, and the
  user asked for no per-agent surface: its call changes nothing.
- **Only scroll events move the side list's kept scroll.** A draw writes the kept value and never reads the list. A
  list with no box drops the write and reads 0, so a draw that read it back jumped the list to the top. A list that
  shrinks until it stops overflowing keeps its old value and returns there when it grows.
- **The pane's width follows the theme, the 640 px rule does not.** The width is a spacing token times a number, because
  the style check rejects a raw length. Only a theme that rescales spacing can make them disagree, and none ships.

## Out of scope

- Terminal sessions: they reach the app only through the forms relay and carry no agent events.
- Inferring a step from tools, writes or subagents: the agent reports its steps (§ Decisions).
- Migrating a saved flow from an older shape: a `flows.json` that fails validation starts the app with no flows.
- Codex and wigley-harness: their adapters emit the same events when they land.
- Stages for `wigley:debug`, `wigley:explore` and the rest: they run inside a level and claim nothing.
- A timer per task, and which agent works a task: the task document names neither.
- A record or surface per subagent: the agent strip shows what runs, and the user asked only that the existing views
  stay correct.
- Keyboard scroll of the side list: the pane takes no keyboard focus.
- A screen for the run log.
