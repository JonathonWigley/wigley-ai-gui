# Workflow

**Contents**

- **Status** — what is built now and what it waits on.
- **Vocabulary** — flow, stage, status, signal, main action.
- **Stages** — each stage: when a session enters it, what it shows, and its actions.
- **Stage modules** — one folder per stage, registered through `addStage`, and how to change the workflow.
- **Signals** — the agent events and session events the flow folds.
- **Where it draws** — the row chip, the composer strip and the side pane.
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
- **Status** — what a stage is doing now: running, paused, ready or done. A step not reached is pending.
- **Signal** — one input the flow folds: an agent event, a clear, or a plan folder change (§ Signals).
- **Main action** — the one action of a stage that `ww` runs, the strip's one button and the first of the side pane's buttons.

## Stages

| Stage | A session enters it when | Label and status | Status line | Actions (main action first) |
|---|---|---|---|---|
| idle | it starts; Dismiss on closed; Make in new session hands its plan away | none: nothing draws | none | none: a feature starts from its skill call |
| primer | `wigley:feature-primer` starts | Primer, running or paused | `Primer · running` | none |
| feature | `wigley:feature` starts | Feature, running or paused | `Feature · paused` | Open plan, once a plan is written |
| plan ready | in feature, a turn ends or the plan changes while the session's `plan-*/plan.md` holds a box under Tasks and no turn or subagent runs | Make, ready | `Make · ready` | Clear & make (Cancel during the countdown), Make in new session, Open plan |
| make | `wigley:make` starts | Make, running or paused | `Make · running 3/9` | Resume make, Open plan |
| review | `wigley:review` starts in make, or the plan's Run log gains a review round logged after make started (Resume make from review stays in make until the next round) | Review, running or paused | `Review · running · round 2` | Resume make, Open plan |
| closed | in make or review, a plan folder that was read goes missing (`wigley:make` naming a folder not written yet waits in make for its `plan.md`) | Close, done | `Close · done · 9/9` | Retro, Dismiss |

Running means the flow is busy: a turn or a main-agent subagent runs. Paused means it is not. A crash and an agent waiting on an answer both read as paused, and the row's attention dot marks a waiting round.

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
folder. Only the main agent moves the stage, with one exception: a subagent's write of a `plan-*/plan.md` names the
plan, since `wigley:feature` drafts the plan in a subagent. Any other skill or write by a subagent is not a signal.

## Stage modules

`src/plugins/workflow/stages/<stage>/` holds one stage:

- `main.ts` — the stage's entry rule, a pure function of the flow and a signal, and its main-side actions (a send, a
  clear, a launch)
- `page.ts` — its label, its status, what follows the status in its status line, what the strip and the side pane
  show, and its page-side actions (fill the composer, open the plan)

Each half registers through the workflow plugin's `addStage` export in its process; the built-in stages register the
same way a user plugin would. Each action names a command; `stages/index.ts` lists the commands (`WORKFLOW_COMMANDS`)
and the manifest joins them, so a key and a button run the same command. The plugin core names no stage: it folds every
signal through the registered entry rules in stage order (`foldFlow(flow, signal, stages)`), the first rule that answers
wins, and the flow keeps its stage when none answers.

To change the workflow:

- a renamed skill or a new trigger — edit that stage's `main.ts`
- a new stage — a new stage folder, its commands and keys, and its place in the stage order
- a stage dropped — delete its folder and its entries
- a renamed stage id — edit every rule that names it, in every stage's `main.ts`; `stages/main-stages.test.ts` turns red
  on one left behind

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

`skillStarted`, `fileWritten`, `turnStarted` and `turnEnded` are members of `AgentEvent` (`src/contracts/agent.ts`) that
the Claude adapter and the fake harness emit, so the fold never reads a harness's JSON. A subagent's `skillStarted` is
no signal, and neither is its `fileWritten` unless the path is a `plan-*/plan.md`. A `sessionEnded` of the flow's current host session (a process that exits
mid-turn) gives a subagent-finished signal for each running subagent, then a turn-ended signal. A cleared session keeps
its stage: Clear & make's own clear must not reset plan ready. `sessions.ended` (main's event for a closed row) drops
the session's flow.

A re-attach replays its process's whole log, each event flagged `replayed`, over the saved flow. `flows.json` holds each
flow's save time, stamped by a change from a live event or from Make in new session or Dismiss, not by a plan read, a
replay or a countdown's Cancel or firing. A replayed event
at or before that time is already in the flow, so it updates only the running turn and subagents; a later one, from a
turn that ended while the app was closed, folds as usual. A flow saved without the time counts as saved when it loaded.

## Where it draws

Everything draws through the `workflow` layout, its built-in `default`, and the preview on `Space z l w`.

- **Row chip** — a row part (sessions' `addRowPart`): the built-in layout draws the label and status as one accent tag
  (`Make · running`) and the countdown. A user layout can also draw the progress and the main action's button, which
  the chip's input carries. Idle draws nothing.
- **Composer strip** — a part above the Chat composer (chat's `addComposerPart`): the status mark, the status line, the
  countdown and the main action. It draws the stepper only until the session has a plan. After that the side pane holds
  the stepper, the detail and the other actions, so a hidden pane leaves the status line, the main action and the
  `Space w` keys. Idle draws nothing.
- **Side pane** — the Plan section of the session hub beside the Chat tab's transcript (chat's `addSidePart`,
  `docs/features/chat-bar/design.md` § The session hub), from the first read of a plan until
  Dismiss or a new plan: the status line, the detail, the stepper, a progress bar, the checklist and
  every action of the stage. The checklist folds finished waves into one row, shows the current wave in full, and shows
  each later wave as one line. The current wave's open tasks show running or paused only in make, because the plan file
  does not say which task an agent works on.

  `<Leader>ws` shows or hides the pane in every session, and the choice survives a relaunch. The pane also hides with
  the hub: while the Chat tab is narrower than 640 px, set in the chat layout's CSS, so the transcript keeps a readable
  width in a split, and on `<Leader>vs`. The pane takes no keyboard focus, so `Alt+h/j/k/l` still moves between chat panes, and its list scrolls with
  the mouse and keeps its scroll while the pane is out of view or hidden.

Primer and feature share one step: the one the session is in, otherwise feature. Plan ready and make share the Make
step. Each step reads its label, then its status or `pending`, and draws one mark per status.

## Auto-start

With `workflow.autoClearAndMake` on (default off), plan ready starts a countdown of `workflow.autoStartSeconds`
(default 10) on the strip and the row chip. During it the main action is Cancel. At zero, Clear & make runs. A turn
that starts, a clear, a Cancel or a replayed event stops it. A replayed event starts none, and neither does the plan
read a replayed turn end causes, until a live turn starts or ends.

## Keys

The `<Leader>w` group (which-key: workflow), each action's key anchored on its button:

| Keys | Command |
|---|---|
| `<Leader>ww` | the current stage's main action (Cancel during the countdown) |
| `<Leader>wn` | Make in new session |
| `<Leader>wr` | Resume make |
| `<Leader>wo` | Open plan |
| `<Leader>wt` | Retro |
| `<Leader>wd` | Dismiss |
| `<Leader>ws` | Show or hide the side pane, in every session |
| `<Leader>wf` | Open or fold the selected session's finished waves; with no fold to draw, log `nothing to run` and leave it |

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
- **One checklist.** The side pane replaced a Flow tab that drew the same stepper, checklist and actions; a second copy
  added upkeep and showed nothing new. Open plan shows the whole plan.
- **Review rounds stay a count.** The Run log gives the number of logged rounds, so the status line names the round and
  the checklist draws no row per round.
- **A plan reader of its own.** Backlog reads only plan titles, and the docs index's counts carry no waves or Run log.

## Out of scope

- Terminal sessions: they reach the app only through the forms relay and carry no agent events.
- Codex and wigley-harness: their adapters emit the same events when they land.
- Stages for `wigley:debug`, `wigley:explore` and the rest: each is a stage module later.
