# 08 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none modified, unless a check fails and its fix lands here with its own test
Consumes:  everything 01–07 landed
Produces:  the live checks below, run, with their captures read
Decisions: the runtime and visual checks every task deferred here by name; claims a Vitest test
           already pins earn no live check (`wigley:writing-tests` § What earns a live run instead)

Runs, in order:

1. `npm test` filtered to the files 01–06 added or changed, then `npm run lint`.
2. `npm run selftest -- --plugin system-stats --plugin chat --plugin gallery`. A whole self-test runs only
   when the user asks for it in the current turn (AGENTS.md § Running and testing); the filtered run skips
   the placement check and the other plugins' screenshots, which the default-shown panel narrows. Ask for
   the whole run in chat at this step; without a yes, the wrap-up names it as not run, with that reason.
3. A drive run per the `drive` skill (`.agents/skills/drive/SKILL.md`), over the real macOS adapter
   (a packaged-mode or live-adapter drive start if the fake is the drive default, otherwise the fake
   plus one live sample read by the drive's eval), with screenshots read against DESIGN.md.

Live checks:

- **expected** — the panel shows in the right bar on first launch with five meters, sparklines
  filling over about 10 s, and a process list sorted by CPU; the CPU column's rows add up to about
  the CPU meter.
- **expected** — `Space v y` hides the panel and the right bar closes when nothing else is in it;
  after a reload the panel stays hidden; `Space v y` brings it back.
- **expected** — Alt+l focuses the panel; `j`/`k`/`gg`/`G` move the cursor; `s` cycles CPU → RAM →
  GPU with the heading marking the column; Enter on an app group (e.g. the app's own Electron group)
  opens its processes, and `h` closes it. Every bind shows its key anchor (the placement check,
  in a whole self-test run).
- **low-confidence** — a Chat session started in the drive run shows as `claude · <title>` with its
  child processes inside it, since the pid path (03) crosses the session host, the harness and chat,
  and the self-test runs over the fake harness.
- **low-confidence** — after a drive `restart` (app relaunch with the session still hosted), the
  session row is still titled, which proves the re-attach path reports the pid.
- **low-confidence** — the GPU column shows numbers on this Apple Silicon Mac, with the GPU meter
  near Activity Monitor's GPU History, since the `AGXDeviceUserClient` diff has no test against a
  live machine.
- **low-confidence** — with the panel hidden, the drive's log shows `sampling stopped` and no
  `sample failed` or later `sampling started` line until the panel shows again.

Checks for the user (the wrap-up's Needs you; never waited on): the Windows adapter on a Windows
machine. On `npm start`, the panel shows with no console window flashing at each refresh, the GPU
meter and the per-process GPU column fill under load (the meter reads formatted counters in one shot,
which may stay at 0), and network and disk move during a download.

Tests:     none added here
Done when: every run above passes and every live check is recorded in Proof with its capture path
Commit:    none, unless a fix lands

## Proof
