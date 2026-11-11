# 03 — `capture.py start` replies with `game_view`

Status: not started
Type: Task
Rung: standard · follows the existing probe call in `start`, and adds one reply field that the fakes already model
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: wigley-ai-marketplace, worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-live-view`.
Paths below are under `plugins/wigley/skills/unity-playtest/`.

Files:
- modify `capturelib/commands.py`: `Capture.start` (~lines 96-163)
- modify `tests/fakes.py`: the fake editor's `probe` reply (~line 46), if it needs a `window` value that changes after `start`
- test `tests/test_capture.py`

Consumes: the `window` field of the `probe` action. `WigleyCapture.cs` `Probe()` sets it from
`GameViewScreenRect()`: `[x, y, width, height]` in top-left global screen points, or null with no Game View.

Produces: a `game_view` field in `start`'s reply: a list of four numbers, or `None`. The contract is the one written
ahead in `capture.md`'s `start` row.

Decisions:
- After the `start` action succeeds and the segment is open, `start` sends a second `{"action": "probe"}` call. The
  reply's `game_view` is that probe's `window`.
- The Recorder resizes the Game View to its "Recording Resolution" at start, so the first probe's `window` (taken
  before `start`) is stale. Use only the second probe.
- `--append` replies with `game_view` too.
- When the second probe fails, `start` still succeeds. `game_view` is `None` and a `warning` part says
  `game view probe failed: <error>`, joined into `warning` like the other parts. The video already runs, and the
  agent can still call `show_live_view` without `gameRect`.
- The screencapture fallback keeps using the first probe's `window`, as today. This task does not change it.

GIVEN a fake editor whose probe `window` changes after `start` WHEN `start` runs THEN the reply's `game_view` is the post-start value
GIVEN a fake editor with no Game View (probe `window` null) WHEN `start` runs THEN `game_view` is `None` and the run starts
GIVEN `start --append` after `stop` WHEN it runs THEN its reply carries `game_view`

Tests: add these cases to `test_capture.py` beside `test_start_opens_a_run_folder_and_points_current_at_it` and
`test_start_append_after_stop_adds_a_segment_to_the_same_run`. They can be a parameterised table when the fake
supports it. Run `python3 -m unittest discover -s tests` from the skill folder. Check the folder's own runner first;
the tests in `tests/` show it.

Done when: the tests above pass, and the whole `tests/` folder passes. It is small and runs in seconds.

Commit: one commit for the group. No version bump here; task 08 bumps once for the run.

## Proof
