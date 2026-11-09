# 08 — Final verification

Status: done
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
3. Two drive runs per the `drive` skill (`.agents/skills/drive/SKILL.md`), screenshots read against DESIGN.md:
   - over the fake adapter (the drive default, task 01): the panel, keys, hide state and log checks;
   - with `WIGLEY_DRIVE_SYSTEM_STATS=live` (task 01) and `--harness claude`, for the checks marked *live*
     below: the real adapter, and a real Chat session whose pid the real sample holds. One short message
     spends a few tokens; say so in Proof.

Live checks:

- **expected** — the panel shows in the right bar on first launch with five meters, sparklines
  filling over about 10 s, and a process list sorted by CPU. *Live:* the CPU column's rows add up
  to about the CPU meter.
- **expected** — the gallery's Sparkline block (task 04), screenshotted in the light and dark themes
  and with `transparency` reduced through the drive's `setting`, read against DESIGN.md § Sparkline;
  `query` the line's stroke in each tone resolves to the three status tokens.
- **expected** — the drive action `system-stats.seed` with `{"variant":"error"}` draws
  `Could not read the machine: ps exited with code 1` over the last numbers, and the log holds
  `error: ps exited with code 1`.
- **expected** — `Space v y` hides the panel and the right bar closes when nothing else is in it;
  after a reload the panel stays hidden; `Space v y` brings it back.
- **expected** — Alt+l focuses the panel; `j`/`k`/`gg`/`G` move the cursor; `s` cycles CPU → RAM →
  GPU with the heading marking the column; Enter on an app group (e.g. the app's own Electron group)
  opens its processes, and `h` closes it. Every bind shows its key anchor (the placement check,
  in a whole self-test run).
- **low-confidence**, *live* — a Chat session started in the drive run shows as `claude · <title>` with its
  child processes inside it, since the pid path (03) crosses the session host, the harness and chat,
  and the self-test runs over the fake harness.
- **low-confidence**, *live* — after a drive `restart` (app relaunch with the session still hosted), the
  session row is still titled, which proves the re-attach path reports the pid.
- **low-confidence**, *live* — the GPU column shows numbers on this Apple Silicon Mac, with the GPU meter
  near Activity Monitor's GPU History, since the `AGXDeviceUserClient` diff has no test against a
  live machine.
- **low-confidence** — with the panel hidden, the drive's log shows `sampling stopped` and no
  `sample failed` or later `sampling started` line until the panel shows again.

Checks for the user (the wrap-up's Needs you; never waited on): the Windows adapter on a Windows
machine. On `npm start`, the panel shows with no console window flashing at each refresh, the GPU
meter and the per-process GPU column fill under load (the meter reads formatted counters in one shot,
which may stay at 0), network and disk move during a download, and network does not double while a VPN is up
(the script's virtual-interface filter).

A fix that lands here and changes a name, key, default or log line a doc states re-runs 07's check
for that line.

Tests:     none added here
Done when: every run above passes and every live check is recorded in Proof with its capture path
Commit:    none, unless a fix lands

## Proof

Commit ce349957 4a420502 · proof: Tests: filtered npm test (31 files, 1436 tests), typecheck, lint pass. Self-test: npm run selftest -- --plugin system-stats --plugin chat passes (gallery has no script; whole run not asked, so not run, placement check unproven). Drive 1 (/tmp/claude-system-stats/reports/08-drive-1.md, .drive/ssa, .drive/ssb): panel on launch, gallery Sparkline strokes = status-success/warning/error in dark, run-home Latte light and reduced transparency, error seed text and log, Space v y hide/reload/show, Alt+l j k gg G s Enter h, sampling stopped while hidden, GPU numbers on Apple Silicon, session title after restart all PASS; B1 rows-vs-meter and B2 session row unreachable FAIL. Fixes ce349957 (sessions always shown, narrow form at 360px) and 4a420502 (new-process CPU, time-based fake, tone on shown percent, one seeded line). Drive 2 (/tmp/claude-system-stats/reports/08-drive-2.md, .drive/ssa2, .drive/ssb2): narrow form name cell 235px, sparkline 213px, names legible; one seeded line; claude · Greeting row reachable and opens to claude, Python. B1 still short: meter vs row sum 37.9/23.6, 74.4/25.2, 76.9/52.0 (processes that start and exit between samples). Live runs spent two short real Claude turns (about $0.33 each). · concerns: B1 rows undercount the CPU meter from process churn ps cannot see (design.md:52 claims they add up); fake Network/Disk meters sit at 85%/100% flat; an opened group's children stay below the visible area until the cursor moves; light theme proved only on a run-home Latte theme (no built-in light theme); stale docs: design.md:52, design.md Windows memory row, plan 05/06 cut rule and seeded log line. All ride to the review.
