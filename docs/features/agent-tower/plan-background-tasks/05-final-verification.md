# 05 — Final verification

Status: done
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the landed run
Produces:  the live checks below, with their captures read
Decisions:
- `npm run selftest` takes `.drive/start.lock`; another session in this tree may hold it for its own run. Wait on the
  lock as the script does; never delete a live holder's lock.
Checks:
- Expected: `npm run selftest` passes the agents `roster lines` group (fake harness, 2 subagents + 2 tasks). Read
  `.selftest/screenshots/agents-subagent-lines.png` and `agents-subagent-lines-narrow.png` against `DESIGN.md`: task
  lines show the terminal icon, description and elapsed time; the nested task sits indented under its subagent; every
  line fits at the side bar's least width.
- Low-confidence (decoder against real lines, wiring no unit test sees): a drive run (`npm run drive -- start --harness claude`, the
  `drive` skill's § Real Claude in `.agents/skills/drive/SKILL.md`; it spends tokens) whose Chat session is asked to run
  `python3 -c 'import time; time.sleep(20)'` with `run_in_background` true. A task line appears under the row while it
  runs and is gone after it ends, past the turn's result. Before sending, set the session's Mode chip (its permission mode
  control) to one that runs Bash without a prompt, or answer the prompt through the drive run. A stall on a permission prompt is a "cannot reach", not a failure: no line can show
  before the command runs. When the drive run cannot reach a real Claude session, say so and list the check in the
  wrap-up for the user (in a visible `npm start`).
Done when: both checks pass with their captures read, or the second is listed for the user with its steps
Commit:    none, unless a check turns up a fix (that fix is its own commit)

## Proof

Commit none · proof: selftest all passed (roster lines 4/4/0), agents-subagent-lines(.png, -narrow.png) read: icon, description, elapsed, nested indent, one row at least width; real-Claude drive run .drive/20261102-182642-15b9: task-line.png shows the line after end_turn, task-gone.png shows it gone after the 20 s command · concerns: drive wait-log missed the [agents] lines-in line (the captures settled both points); Claude ran a second turn on its own to report the finished task
