# 12 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     none modified; captures under `.drive/<run>/` and `.selftest/screenshots/`
Consumes:  the landed work of 01–10
Decisions: runtime and visual checks for the whole plan collect here (`wigley:writing-tests` § What earns a live
           run instead); every task defers its on-screen checks to this task by name.

Runs, in order:

1. `npm test` and `npm run lint` — green.
2. `npm run selftest` — green, the workflow groups from 10 included. Read the workflow screenshots
   (`.selftest/screenshots/workflow-*.png`) against `DESIGN.md`.
3. A drive run (`.agents/skills/drive/SKILL.md`) on the fake harness, with each capture read before the work is done:

| Check | Kind | Why |
| --- | --- | --- |
| A new Chat-tab session shows no row chip and a dim Start feature on the strip; `<Leader>wf` puts `/wigley:feature ` in the composer, focused, unsent | expected | idle, round 2 |
| The fake's workflow script (05), sent `/wigley:feature fake: workflow feature`, takes the session to plan ready: the row chip shows Plan ready, the plan's task count and a Clear & make button; the strip lights Plan ready on the stepper; a Flow tab exists after the Chat tab, was not selected when added, and its status reads the stage | expected | the feature's purpose; the Flow tab is never a session's first tab |
| The row chip's button, the strip's button and `<Leader>ww` each run Clear & make: the Chat tab empties, `/wigley:make <plan folder>` is the first message, the stage moves to make. With two sessions in plan ready, the chip button of the row that is not selected clears and makes that row, not the selected one | expected | the headline action; every button runs for its own session |
| Clear & make is disabled while busy (a turn or a subagent runs), and `ww` runs nothing: the page logs `[workflow] nothing to run for mainAction in <name>` and no clear happens | low-confidence | busy comes from live turn and subagent events, which only a run produces |
| Make shows ticked over total and the current wave, and both change as the fake ticks boxes | low-confidence | the plan folder watch on a real file system |
| Review lights on the stepper when the fake starts `wigley:review` | expected | review stage |
| The plan folder deleted → closed with Retro and Dismiss; `<Leader>wd` returns to idle and the Flow tab stays | expected | round 2 |
| With `workflow.autoClearAndMake` on and `autoStartSeconds` 5 (main logs `[workflow] settings: autoClearAndMake on, autoStartSeconds 5`), plan ready shows a countdown on the strip and the chip, ticking each second, and at zero Clear & make runs | low-confidence | the timer's wiring to the drawn countdown |
| During the countdown `<Leader>ww` and the Cancel button each stop it, and nothing is cleared | expected | round 3 |
| Make in new session (`<Leader>wn`) starts a second row whose first message is `/wigley:make <plan folder>`; the first row returns to idle | low-confidence | chat `launch` and the hand-off together |
| A relaunch of the drive run's app keeps each row's stage and plan (the flows in plugin data) | low-confidence | persistence across a restart |
| Every `<Leader>w` bind shows its key prompt where it acts, and the self-test's placement gate logged no `unplaced` line for them | expected | the keys rule |
| The chip ellipsizes at the narrowest side bar width; the strip wraps no button out of view at the narrowest Chat pane | low-confidence | layout a test cannot see |
| `Space z l w` opens the preview with a sample in every stage, the countdown included, and a second press closes it | expected | the layout preview |
| A user layout at `~/.config/wigley-ai-gui/layouts/workflow/<name>/layout.js` in the drive run's home that throws in the strip draws with `default` | low-confidence | the fallback path for a new owner |

4. One live probe on the real Claude adapter, in a drive run started on the `claude` harness with a cheap model: send
   `/wigley:make` with a path, and ask the agent to write a small file. Check: the stage moves to make (a typed slash
   command is `skillStarted`), and a Write of a `plan-x/plan.md` is seen (`fileWritten`). Low-confidence: 04's
   mapping is built from the stream doc, and only this run proves it on a live process.

Checks for the user (in the wrap-up, never waited on): none expected. Every check above runs offscreen.

Done when: every check above has passed and each capture has been read. A failure goes back to the task that owns it.
Commit:    none, unless a fix lands in its owning task's files.

## Proof
