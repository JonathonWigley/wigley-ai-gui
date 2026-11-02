# Workflow

**Contents**

- **Status** — what is built now and what it waits on.
- **Vocabulary** — flow, stage, signal, main action.
- **Stages** — each stage: when a session enters it, what it shows, and its actions.
- **Stage modules** — one folder per stage, registered through `addStage`, and how to change the workflow.
- **Signals** — the agent events and session events the flow folds.
- **Where it draws** — the row chip, the composer strip and the Flow tab.
- **Auto-start** — the setting that starts Clear & make by itself, and its countdown.
- **Keys** — the `<Leader>w` group.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope** — what waits for a later stage module or adapter.

The `workflow` plugin knows the user's wigley workflow — `wigley:feature-primer`, `wigley:feature`, a plan folder,
`wigley:make` with its `wigley:review`, then the plan folder's close — and shows each Chat-tab session's place in it,
with the next step one press away. A good outcome: the user never types `/clear` and a plan path again, and every
session row says where its run stands. The workflow changes often, so each stage is a module of its own, and changing
the workflow is editing or adding one stage folder.

## Status

Built, in `src/plugins/workflow/`, on the clear, the agent events and the row parts that earlier plans landed
(`chat.agentEvent`, `sessions.hostSessionChanged`, `addRowPart`). Its self-test script
(`src/plugins/workflow/main/selftest-script.ts`) drives the fake agent harness through the stages.

## Vocabulary

- **Flow** — one session's place in the workflow: its stage, its plan folder (or none) and the plan's progress. Main
  holds one flow per session and keeps it in the plugin data.
- **Stage** — one step of the workflow, one stage module (§ Stage modules). Chat's **step** (a tool, thinking or raw
  entry) and the tower's **plan step** are different things.
- **Signal** — one input the flow folds: an agent event, a clear, or a plan folder change (§ Signals).
- **Main action** — the one action of a stage that `ww` and the row chip's button run.

## Stages

| Stage | A session enters it when | Shows | Actions (main action first) |
|---|---|---|---|
| idle | it starts; Dismiss on closed; Make in new session hands its plan away | nothing on the row; a dim Start feature on the strip | Start feature |
| primer | `wigley:feature-primer` starts | the stage | Start feature |
| feature | `wigley:feature` starts | the stage, and the plan's name once one is written | Open plan, once a plan is written |
| plan ready | in feature, a turn ends or the plan changes while the session's `plan-*/plan.md` holds a box under Tasks and no turn or subagent runs | the plan's name and task count | Clear & make (Cancel during the countdown), Make in new session, Open plan |
| make | `wigley:make` starts | ticked over total, the current wave | Resume make, Open plan |
| review | `wigley:review` starts in make, or the plan's Run log gains a review round | the review round, ticked over total | Resume make, Open plan |
| closed | the plan folder is deleted in make or review | the plan's name, done | Retro, Dismiss |

- **Start feature** puts `/wigley:feature ` in the composer and focuses it, without sending.
- **Clear & make** clears the session (the row and its tabs stay, a new conversation starts) and sends
  `/wigley:make <plan folder>`. It is disabled while the session is busy: a turn or a main-agent subagent runs.
- **Make in new session** starts a background session in the same folder with `/wigley:make <plan folder>` through
  chat's `launch`, hands the plan to it, and returns this session to idle. One plan shows in one session.
- **Resume make** shows when the plan has open boxes, and is enabled only when the session is not busy, as after a
  relaunch or a crash. It clears and sends make again; make reads its own Run log back.
- **Open plan** opens `plan.md` in Docs mode (`openDoc`).
- **Retro** sends `/wigley:retro` in the same session, which holds the run's context.
- **Dismiss** returns a closed session to idle. A closed session also leaves on its next flow skill.

The last `plan.md` written in a session is its plan. `wigley:make`'s argument names the plan when it is a plan
folder. Only the main agent moves the stage: a subagent's skill or write is not a signal.

## Stage modules

`src/plugins/workflow/stages/<stage>/` holds one stage:

- `main.ts` — the stage's entry rule, a pure function of the flow and a signal, and its main-side actions (a send, a
  clear, a launch)
- `page.ts` — its label, what the row chip and the strip show, and its page-side actions (fill the composer, open the
  plan)

Each half registers through the workflow plugin's `addStage` export in its process; the built-in stages register the
same way a user plugin would. Each action names a command; `stages/index.ts` lists the commands (`WORKFLOW_COMMANDS`) and the manifest
joins them, so a key and a button run the same command. The plugin core names no stage: it folds every signal through the registered
entry rules in stage order (`foldFlow(flow, signal, stages)`), the first rule that answers wins, and the flow keeps
its stage when none answers.

To change the workflow:

- a renamed skill or a new trigger — edit that stage's `main.ts`
- a new stage — a new stage folder, its commands and keys, and its place in the stage order
- a stage dropped — delete its folder and its entries

## Signals

Main folds these, for owned sessions only:

| Signal | From | Carries |
|---|---|---|
| skill started | `chat.agentEvent` `skillStarted` (a Skill call, or a slash command the user typed) | skill (`wigley:make`), args |
| file written | `chat.agentEvent` `fileWritten` (a Write or Edit) | the full path |
| turn ended | `chat.agentEvent` `turnEnded` | — |
| turn started | `chat.agentEvent` `turnStarted` (every turn, a subagent's result turn included) | — |
| subagent started, finished | `chat.agentEvent` `agentSpawned` with the main agent as parent, `agentFinished` | the agent id |
| cleared | `sessions.hostSessionChanged` | — (the flow is rekeyed to the new host session id) |
| plan changed | main's watch on the flow's plan folder | the plan's progress: title, ticked, total, current wave, review rounds, the task lines |
| plan gone | the same watch, the folder deleted | — |
| handed off, dismissed | the Make in new session and Dismiss actions | — |

`skillStarted`, `fileWritten`, `turnStarted` and `turnEnded` are members of `AgentEvent` (`src/contracts/agent.ts`) that the Claude
adapter and the fake harness emit, so the fold never reads a harness's JSON. A `skillStarted` or `fileWritten` of a subagent is no signal. A `sessionEnded` of the flow's current host session
(a process that exits mid-turn) gives a subagent-finished signal for each running subagent, then a turn-ended signal. A cleared session keeps its stage:
Clear & make's own clear must not reset plan ready. `sessions.ended` (main's event for a closed row) drops the session's flow.

## Where it draws

Everything draws through the `workflow` layout, its built-in `default`, and the preview on `Space z l w`.

- **Row chip** — a row part (sessions' `addRowPart`): the stage, the progress and the main action's button. Idle draws
  nothing.
- **Composer strip** — a part above the Chat composer (chat's `addComposerPart`): the stepper, with the current stage
  lit, and the stage's buttons. Idle draws only a dim Start feature.
- **Flow tab** — a session tab (`addTab`) added when the session first leaves idle, kept from then on: the stepper,
  the plan's checklist by wave, and every action of the stage. Its status line is the stage, so a row shows it in text
  too.

## Auto-start

With `workflow.autoClearAndMake` on (default off), plan ready starts a countdown of `workflow.autoStartSeconds`
(default 10) on the strip and the row chip. During it the main action is Cancel. At zero, Clear & make runs. A turn
that starts, a clear, or a Cancel stops it.

## Keys

The `<Leader>w` group (which-key: workflow), each anchored on the strip and the Flow tab:

| Keys | Command |
|---|---|
| `<Leader>ww` | the current stage's main action (Cancel during the countdown) |
| `<Leader>wn` | Make in new session |
| `<Leader>wr` | Resume make |
| `<Leader>wo` | Open plan |
| `<Leader>wt` | Retro |
| `<Leader>wf` | Start feature |
| `<Leader>wd` | Dismiss |

In the Flow tab (scope `workflow.flow`), `<C-j>` and `<C-k>` scroll a line, and `<C-S-j>` and `<C-S-k>` scroll half a page.
The layout preview opens on `<Leader>zlw`.

## Decisions

- **Build on what landed.** The clear, the agent events and the row parts have their own plans and docs; the flow
  reads their exports and events and keeps no second copy.
- **The user presses, unless the setting is on.** Clear throws away the interview's conversation, so the default
  waits for the user, and the auto-start counts down with a Cancel.
- **Cancel is `ww`, not Esc.** The strip is a part inside the Chat tab and holds no key scope, and Esc already leaves
  the chat box.
- **Agent events, not chat entries.** Detection reads `AgentEvent` so a Codex or wigley-harness adapter drives the
  flow unchanged; `toolStarted` carries only the tool's name, no input, so skills and writes get members of their own.
- **A plan reader of its own.** Backlog reads only plan titles, and the docs index's counts carry no waves or Run log.

## Out of scope

- Terminal sessions: they reach the app only through the forms relay and carry no agent events.
- Codex and wigley-harness: their adapters emit the same events when they land.
- Stages for `wigley:debug`, `wigley:explore` and the rest: each is a stage module later.
