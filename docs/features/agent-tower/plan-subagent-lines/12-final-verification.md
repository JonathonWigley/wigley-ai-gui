# 12 — Final verification

Status: done
Type: Task
Wave: 7 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     none modified; captures under `.drive/<run>/` and `.selftest/screenshots/`
Consumes:  the landed work of 01–10
Decisions: runtime and visual checks for the whole plan collect here (`wigley:writing-tests` § What earns a live
           run instead); every task defers its on-screen checks to this task by name

Runs, in order:

1. `npm test`, `npm run lint` — green.
2. `npm run selftest` — green, including the agents group from 10; read
   `.selftest/screenshots/agents-subagent-lines.png` against `DESIGN.md`.
3. A drive run (`.agents/skills/drive/SKILL.md`), on the fake harness, with captures read before the work is done:

| Check | Kind | Why |
| --- | --- | --- |
| A Chat-tab session sent `fake: agents` shows two lines under its row: dot, type, description, elapsed, `1 tool` | expected | the feature's purpose |
| The elapsed time on both lines advances between two captures a few seconds apart | low-confidence | the ticker's wiring to the drawn lines is not under a test |
| The type reads in mono and the elapsed time and tool count in tabular numerals; the selected row's fill covers its lines | low-confidence | styling a test cannot see |
| Ending the turn or the process removes both lines | expected | `sessionEnded` finishing listed subagents |
| A long description ellipsizes within the side bar's width, at the narrowest and the default side bar width | low-confidence | layout a test cannot see |
| A click on a subagent line selects its session; the row's selected mark and the tab area follow | low-confidence | the wrapper sits inside the row's click target; wiring a test cannot see |
| `Space z l a` opens the `Agents preview` row with two lines (`42s` and `1 tool`, `3m 05s` and `12 tools`, as separate columns with no separator; the second's long description ellipsized), and its second press closes it, as sessions' preview does | expected | the preview key |
| A user layout at `~/.config/wigley-ai-gui/layouts/agents/<name>/layout.js` (in the drive run's own home) that throws in `line` draws with `default` | low-confidence | the fallback path for a new owner |
| After the session above, `plugins/agents/logs/<host session id>.jsonl` in the run's user data holds one JSON `AgentEvent` per line, in event order | expected | the replay log |

4. One live probe on the real Claude adapter, in a drive run started on the `claude` harness with a cheap model: a
   message asking for one subagent that reads a file. Check: one line appears with the Agent call's subagent type and
   description, its tool count rises, and it goes when the subagent returns. Low-confidence: 03's mapping is built
   from 01's probe, and only this run proves it on a live process.

Checks for the user (listed in the wrap-up, not waited on): none expected — every check above runs offscreen.

Done when: every check above passed, each capture read; a failure goes back to the task that owns it
Commit:    none, unless a fix lands in its owning task's files

## Proof

Commit be9f9ee · proof: Live drive /tmp/claude-subagent-lines/reports/12-1.md: 9/10 checks incl. real Claude adapter probe; check 5 (narrow side bar) failed and was fixed by 7e4ee8f + be9f9ee, proven by the self-test's held fit check at 160px (fails on the old CSS, passes now: /tmp/claude-subagent-lines/r1wrap/selftest-new.log) · concerns: Ending a session removes its row without a 'lines … 0' log (expected); a foreground interrupt in probe 6 exited 1, unexplained
