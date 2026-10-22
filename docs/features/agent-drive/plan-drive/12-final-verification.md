# 12 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     delete `docs/features/ui-design/live-checks.md` · modify `docs/features/ui-design/design.md` · any fix a failing check needs, through `wigley:make`'s fix loop
Consumes:  the drive run of 01–10 and the `drive` skill (`.agents/skills/drive/SKILL.md`), which the verifier loads first
Produces:  every check below settled with its observation in the Run log's Test gate or the run's report
Decisions: the final verification runs every reachable live-checks row, then deletes the doc (round 2) · user-only checks go in the wrap-up only (round 1 note)

Every check runs in a drive run (`npm run drive -- …`), offscreen; none takes the user's foreground. Captures are read, not only taken: each screenshot is opened, and each claim with a number is settled by `query`.

## The driver itself

| # | Check | Settles it | Tag |
|---|---|---|---|
| V1 | `start`, then `actions` | `run <id>` printed; the list holds `sessions.connect`, `sessions.end`, `sessions.activate`, `forms.openRound`, `forms.answers`, `chat.start`, `chat.askPermission`, `docs.seed`, `docs.connectSession` | expected |
| V2 | `do forms.openRound`, `screenshot round`, `query .session-row` | the PNG shows the sample round in the Form tab; the query returns a box and classes | expected |
| V3 | `key`, `click` on a covered element (open a dialog over a row, click the row) | `key` returns the lines it caused; the covered click does not reach the row | low-confidence: hit-testing through `sendInputEvent` on an offscreen window is untested |
| V4 | `drag` a split handle by 80 px, `restart`, `query` the pane's width | the width survives the restart | low-confidence: `quit` → `will-quit` flush, then the same home |
| V5 | `record start`, open and close a picker, `record stop` | an MP4 exists with a non-zero size; `ffprobe` reports a duration over 0 | low-confidence: offscreen `paint` frame timing |
| V6 | `setting transparency '"reduced"'`, `screenshot` | the chrome turns opaque without a restart | expected |
| V7 | `fit` and `fit 900` passing the plugins' self-test `scrollsItself` union (measured at plan time, re-verify against the scripts: `.md pre,.md table,.docs-path,.docs-status,.session-row-status,.chat-json,.chat-tool-result,.docs-frontmatter-box,.docs-editor`) | both return lists; on the self-test's screens, the minimum-width list matches what the self-test's fit check reports | expected |
| V13 | `log` after `start` | no `[relay] channel … failed` line: the relay opened on its `/tmp` fallback socket | low-confidence: the socket-length fallback (06) |
| V8 | `npm run package`, `start --packaged`, `do forms.openRound`, `screenshot` | the packaged app serves the same commands | low-confidence: env and paths in an asar build |
| V9 | `start --user-config`, `query :root '--wg-…'` on one token the user's config changes, if any | the user's theme or keys apply; with no user config the CLI says so and starts | expected |
| V10 | `start --harness claude`, `do chat.start`, type a short prompt, `wait-log` for the turn's end | the reply streams from the real Claude CLI, logged in as the user (tokens spent: one short turn) | low-confidence: the adapter's profile expansion against the real home (03) |
| V11 | Two runs at once (`start` twice, `--run` each) | both answer; neither touches the other's home | expected |
| V12 | `npm run selftest` | `[selftest] all passed` | expected |

## live-checks.md rows

Run every row of `docs/features/ui-design/live-checks.md` (measured at plan time: C1–C7, P1–P3, S1–S10, F1–F16, L1–L8, T1–T11, D1–D13 with D4b and D9b, E1–E6, K1; re-verify) through the driver, standing in fixtures for the terminal sessions the rows name (`sessions.connect` and `forms.openRound` with `harness` `claude` and `codex` for S1–S10; `chat.start` and `chat.askPermission` for T1–T11; `docs.connectSession` for D6–D13). P3's toasts come from L2's layout copy (success) and L3's `layout.js` syntax error (error); when no route raises an info toast, P3's info half becomes a follow-up. L6 is settled by reading the `layouts/layout.d.ts` the app writes into forms' plugin data for the kit's parts. A row's "restart" is `restart`; a rebind (K1, D13) is a `keymap.json` written into the run's home config, which hot reloads.

These rows stay the user's: S5 (Option chords from the real keyboard), F13 (Option+n dead key in INSERT), and F12's from-a-box half on macOS when the synthetic chord passes (the dead key never composes synthetically).

Each row that fails becomes a fix in this run when it is local to one surface, and a follow-up in `docs/features/followups.md` when it is its own work. When every reachable row has passed or been settled so, delete `live-checks.md`, and in `docs/features/ui-design/design.md` replace "Its live checks wait in [live-checks.md](live-checks.md) for the user's run." with a line saying the agent ran them through the drive run in agent-drive's final verification.

## Wrap-up for the user

The run's report lists, with steps, and records nowhere else (`~/wigley-agents/AGENTS.md` § Checks for the user):

- S5 and F13 and F12's box half, from the real keyboard in a visible `npm start`
- the global summon shortcut
- a real Claude session's `ask_round` opening in a drive run, which needs wigley 1.8.0 (task 04) pushed and the plugin updated: start `--harness claude`, ask the session to send a round, see it in the drive run's screenshot and not in the user's app

Done when: every check above is settled; the fixes are committed; `live-checks.md` is deleted and `design.md` updated in one commit
Commit:    one commit for the doc changes; fixes per `wigley:make`

## Proof
