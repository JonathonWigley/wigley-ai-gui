# 07 — Probe rect without the toolbar strip

Status: not started
Type: Task
Rung: deep · a root cause inside Unity's internal GameView geometry, checked only against a live editor's pixels
Wave: 4 (Unity phase) · Depends on: 03
Plan: [plan.md](plan.md)

Repo: wigley-ai-marketplace, worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-live-view`.
Paths below are under `plugins/wigley/skills/unity-playtest/`.

Files: modify `unity/WigleyCapture.cs`: `GameViewScreenRect()` (~lines 85-110) and its comment.

Consumes: `capture.py start`'s `game_view` ← 03. Today, `probe`'s `window` is the same rect.

Produces: `GameViewScreenRect()` returns the Game View's render area alone, with no toolbar or tab pixels, for a docked
Game View and for a floating one.

The symptom: the spike cropped the editor window to the probe's `window` rect. The crop showed a thin strip of the
Game View's toolbar along its top. So the rect's `y` is a few points too small, or its height is a few points too
large, or both.

Decisions:
- Load `wigley:debug` and follow it. The fix goes where the rect is computed. A fixed trim in the gui or in
  `capture.py` is rejected (`docs/features/live-view/design.md` § Rejected).
- Setup:
  - Claim a clone from the `new-games-prototypes` pool, per `~/.agents/AGENTS.local.md` § Projects and
    `~/wigley-agents/tools/unity-pool/README.md`.
  - Open it in Play Mode on a booted game, per `wigley:unity-playtest` § Session setup.
  - `WigleyCapture.cs` is compiled per call from a staged copy (`capturelib/unity.py`), so an edit in the worktree
    takes effect when `capture.py` runs from the worktree path. Run
    `python3 <worktree>/plugins/wigley/skills/unity-playtest/capture.py ...`.
- The observation that settles it:
  1. Run `capture.py start --project-path <clone>` and read `game_view`.
  2. Run `screencapture -x -R<x>,<y>,<w>,<h> <scratch>/probe.png` with that rect.
  3. Read the PNG. The fix is done when the PNG's top row is game pixels, and the PNG holds the whole frame (compare
     with a still from `capture.py mark`).
  4. Do this for a docked Game View and for a floating one: drag the Game View tab out, then run `start --append`.
  5. Put the layout back after.
- Hypotheses to test first, in this order:
  1. `window.position` for a docked window is the dock area's content rect, but `viewInWindow` is relative to the
     window's root including the tab strip, or the reverse: the offsets count the tab or toolbar height once too few.
  2. `targetInView` is in pixels, not points, on a Retina display (`EditorGUIUtility.pixelsPerPoint` = 2), so its `y`
     offset is half what it should be.
  3. The fallback branch (`GameViewToolbarPoints = 21f`) runs, because a reflected property is missing in this Unity
     version (6000.3.12f1), and 21 is short of the real toolbar height.

  Log each value (`frame`, `viewInWindow`, `targetInView`, `pixelsPerPoint`) once through a scratch `run_script` or a
  temporary reply field. Remove it before the commit.
- Keep the reply shape: `[x, y, width, height]` in top-left global screen points, or null.
- When the fix needs a new constant, it is a named, measured value with a one-line comment of what it measures. When
  the cause is a Unity property, read that property instead of a constant.
- Release the clone after the commit. Leave the Game View docked as it was, and list any size change as a forced value.

GIVEN a docked Game View in Play Mode WHEN `start` replies THEN `screencapture -R` of `game_view` shows no toolbar pixels in its top row
GIVEN a floating Game View WHEN `start --append` replies THEN the same holds

Tests: none. Correctness is pixels on screen, which a live run settles (`wigley:writing-tests` § What earns a live run
instead). The two PNGs and their paths go in Proof.

Done when: both PNGs show the frame with no toolbar strip, and the editor console shows no compile error from the
script.

Commit: one commit for the group.

## Proof
