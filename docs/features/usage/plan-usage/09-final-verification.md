# 09 — Final verification

Status: done
Type: Batch
Wave: 7 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     none, unless a check finds a defect (a fix lands as its own commit and re-runs the check it failed)
Consumes:  every landed group, 01–08
Produces:  the checks below run and recorded in Proof, with the screenshots' paths
Decisions: the agent runs every check itself: `npm run selftest` and drive runs (`.claude/skills/drive/`, AGENTS.md §
           Running and testing), and `claude` probes with the nested-session variables stripped
           (`claude-stream.md` § How every probe ran). Each check is tagged **expected** (the change doing what it was
           made to do) or **low-confidence** (no test sees it), with its reason. A claim a task's test already pins
           is not here
           The real-Claude checks (C1–C5) run on the profiles this machine has signed in; they read state only. A
           drive run with `--harness claude` sends one short Haiku message (`Reply ok`) in a scratch project folder
           under the session scratchpad, never in a real project
Checks:
           **Self-test and screenshots (fake harness)**
           S1 expected: `npm run selftest` passes, the usage script's steps included; read `usage-status-line`,
              `usage-details`, `usage-details-narrow` and `usage-status-line-narrow` against `DESIGN.md` § Usage,
              Right bar, Status bar and Meter: line order (context `used/limit`, cache, spend, divider, plan rows),
              meter tones, tabular numerals, the right bar's dense glass and left hairline, the stale styling, the
              `differ` marker
           S2 low-confidence: every other plugin's `checksFit` and screenshots still pass now that the status bar is
              always shown (a new always-on strip shrinks every mode's height; no test reads layout)
           **Drive, fake harness**
           D1 expected: at start the line shows the default profile's `5h 35% · Week 97% · Fable 0%`; after one chat
              turn the session group appears and `5h` folds to 36 %
           D2 expected: `usage.failNextPoll` then `usage.pollNow` → that profile reads stale, its error shows in the
              details bar; `usage.seed` `error` shows the unavailable state
           D3 expected: `Space v u` opens the right bar beside main at the token width and closes it, main refilling
              the space; the open state survives a page reload (uiState)
           D4 low-confidence: dragging the right bar's handle widens it and stops where main keeps its minimum; the
              width survives a restart (01's end-sized divider is new, its clamp untested on a real window)
           D5 low-confidence: with the side bar beside and the right bar open, main stays at its minimum width at a
              mid width; below the side bar's over threshold the side bar goes over and the right bar stays beside,
              clamped (01's narrow-window rule)
           D6 low-confidence: the countdowns redraw after a minute (page timers; a fake clock in tests)
           D7 low-confidence: changing `usage.pollIntervalSeconds` with the drive `setting` command moves the next
              poll (hot reload through `onSettingsChanged`)
           D8 low-confidence: a new session started on the non-default profile shows that profile's plan from its
              first frame, before its first turn ends (the lead's revision in 05: profile known from chat's `sessionOpened`)
           **Real Claude**
           C1 expected: `claude -p /usage --output-format stream-json --verbose --no-session-persistence` under each
              signed-in profile prints the top-level `usage_report`, and no new transcript appears under that
              profile's `projects/` folder for the home folder
           C2 expected: in a `--harness claude` drive run, after the turn's `result` the harness sends
              `get_context_usage`, its reply arrives with `autoCompactThreshold`, and the session's `usage` event
              gains `reported`; the details bar shows both limits and the marker (300k configured, Claude's own
              reported value)
           C3 low-confidence: in that run `contextWindow` is not null (the `modelUsage` key matches the reply's
              model on a 1M-window model), so `configured` reads 300000 at the profile's 30
           C4 expected: in that run a real `rate_limit_event` updates the session and weekly rows between polls, and
              the poll's rows (including Fable) show with the server's severities
           C5 low-confidence: the cache countdown reads about 1 hour after the reply (real subscription replies write
              the 1-hour bucket); the chat's turn-events raw entry stays responsive with a `get_context_usage` reply
              in it (its payload is large)
GIVEN the landed plan WHEN each check above runs THEN each passes, or its failure is fixed and the check re-run
Tests:     none added; the self-test (S1, S2) is the suite this task runs
Done when: every check above recorded in Proof as passed, with the screenshot and drive capture paths; a check only
           the user's eyes or hands can settle goes in the run's wrap-up with its steps
Commit:    no commit unless a fix lands

## Proof

Commit none (no fix) · proof: D1–D8 (fake harness, run v09d) and C1–C5 (real Claude, run v09c, one Haiku 'Reply ok' in /tmp scratch) all PASS; S1/S2 from the b406bfb selftest; report /tmp/claude-usage-make/reports/09-1.md · concerns: usage.seed ignores unknown args; status line 'cache 59m' vs details 'expires in 58m' round differently; mid-first-turn context shows the reported limit (967k) until the result gives the window, then 300k configured; shell.ts:333-334 comment says the side bar gives way first; C1 probe must leave CLAUDE_CONFIG_DIR unset for ~/.claude
