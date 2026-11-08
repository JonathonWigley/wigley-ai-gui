# 10 — Final verification

Status: done
Type: Task
Wave: 5 · Depends on: 09
Plan: [plan.md](plan.md)

The live checks of the plan, run in the app through the `drive` skill (`.agents/skills/drive/SKILL.md`), and the
self-test groups of the touched plugins. Every other task names this task for its live check. The list holds only the
checks `wigley:writing-tests` § What earns a live run instead admits. A claim a unit test already pins is not here.

Files:     none, unless a check finds a defect: then the fix lands under its task's rules, and this task runs again

## Self-test

Run the touched plugins' groups, filtered per `AGENTS.md` § Running and testing (no whole run):

```
npm run selftest -- --plugin workflow-heavy,backlog,agent-strip,workflow-light,chat
```

Expected: every group passes, the groups any task added or changed included. Chat is in the list because tasks 05
and 08 change chat code its self-test drives.

## Live checks

Each check runs in a drive run. A check under `--harness claude` spends tokens on the user's own login; the report
names each one that did.

1. **Heavy reads the worktree's copy** — expected path. Under `--harness fake`, start a session whose project folder
   is a temp git repo (`git init`, one commit). Send `fake: workflow feature`: the fake harness writes
   `docs/features/fake-flow/plan-fake-flow/plan.md` with three tasks, and the Heavy flow names that folder. Write the
   task documents `01-fake-first.md`, `02-fake-second.md` and `03-fake-third.md` beside it, each `Status: not started`,
   and commit the folder. Then `git worktree add` a worktree of the repo. In the worktree's copy only, tick task 1 and
   set `02-fake-second.md` to `Status: in progress` through a shell write (not the Write tool). Do not send
   `fake: workflow step`: it deletes the folder. Expected: the side pane shows `1/3`, task 1 done, task 2 with the
   running mark, task 3 pending. Capture a screenshot of the side pane.
2. **A worktree made mid-run joins** — low-confidence: the commonDir watch has no unit test against a real git folder.
   From check 1's state, without a turn end, add a second worktree and tick tasks 1 and 2 in its copy. Expected: the
   pane moves to `2/3` within a few seconds, before any turn ends.
3. **Backlog shows the worktree's count** — low-confidence: wiring between the index and the shared reader. The
   stand-in docs index serves only the Backlog fixture repo, so this check uses that repo, not check 1's. Open the
   Backlog fixture (its plan reads 1/2, task documents `Status: done` and `Status: not started`), `git worktree add` a
   worktree of the fixture repo, and in the worktree's copy tick the second box and set the second task document to
   `Status: in progress`. Rescan Backlog. Expected: the plan row shows `2/2`, and the second task row reads
   `in progress`.
4. **A subagent's step report changes nothing** — low-confidence: the guard, the map and the timing of two processes
   only meet live. Under `--harness claude`, start a session, load `wigley:light`, and ask the main agent to dispatch
   one general-purpose subagent that calls `set_workflow_step` with `land` and `set_session_title` with `Wrong title`.
   Record the session's title before the subagent runs. Expected: the session's stage stays Scope, its title equals
   the recorded one, and the subagent's two tool results read
   `Only the main agent's call changes this session, so this call changed nothing.` Read the results from the session
   host's pipe log (the `tool_result` lines whose `parent_tool_use_id` is the subagent's), since the transcript hides
   a subagent's lines. Then ask the main agent to call
   `set_workflow_step` with `build`. Expected: the stage moves to Build.
5. **A background subagent's box waits for its shell** — expected path for the fix; the follow-up's case. Under
   `--harness claude`, ask the main agent to start a background haiku subagent told to run `sleep 60` as a background
   shell, wait for it, then reply `done`. Expected: the strip shows the subagent's card until its shell ends, and no
   reply from the subagent shows in the transcript as the main agent's. Record the `task_notification` raw line from
   the session host's pipe log in the Proof, since the follow-up asked for it. The pipe log is deleted when its
   process closes (`docs/features/session-host/design.md`), so copy the line out of the run's `home/` before `quit`.
6. **The Worktrees fact catches a Bash touch** — low-confidence: it reads a real Bash tool input. Under
   `--harness claude` in a clone with a linked worktree, ask the main agent to run `ls <worktree root>` through Bash.
   Expected: after the turn ends, the session's facts list the worktree's name.

Checks 4, 5 and 6 may share one real-Claude session to save tokens.

Done when: the self-test groups pass; each live check passes, with its screenshot or log lines named in the Proof; a
failed check has its defect fixed and the check run again.
Commit:    none, unless a fix lands

## Proof

Commit e58a4601 (fix for check 6) · proof: selftest --plugin workflow-heavy,backlog,agent-strip,workflow-light,chat: 41 groups all passed; live checks 1-5 pass (evidence in scratch: check1-side-pane.png, check2, check3-backlog.png, check4 pipe seq 156/159 skip text, check5 task_notification seq 324); check 6 failed on a /tmp symlink spelling, fixed in e58a4601, rerun PASS (check6-rerun.png, log 'repo6 wrote in worktree repo6-wt2'); real-Claude spend 0.77 + 0.29 USD · concerns: Backlog task row shows the worktree copy's status but its detail pane shows the main checkout's doc; empty 'Turn ended' divider after a final hand-back (likely CLI); only a symlink at or above the row folder is mapped
