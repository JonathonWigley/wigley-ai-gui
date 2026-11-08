# 07 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 01, 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     none modified; captures under the drive run's folder
Consumes:  the landed code of 01–05
Produces:  the drive captures below, read and judged against `docs/features/leader-keys/design.md` and
           `docs/features/settings/design.md`
Decisions: every check is a drive run (`.agents/skills/drive/SKILL.md`), run in this plan's worktree since it holds
           its own `.vite`; the user's real-keyboard checks go in the wrap-up only (`AGENTS.md` § Running and testing)

Checks, each tagged with why it earns a live run (`wigley:writing-tests` § What earns a live run instead):

1. **The shelf, top level and inside a group** (expected: the look is a judgement on screen). In a Chat tab press
   `Space`, capture; then `b`, capture. It should be a full-width glass shelf on the bottom edge with the header
   `Space` then `Space b  Session`, up to four columns, tertiary mono keys, a `›` after each group, no key-cap boxes,
   and the content readable through the glass. Then press Esc and confirm it closes with nothing run.
2. **The shelf over a narrow window and in a text box** (low-confidence: the column count and the box route have no
   test). At 640 px width press `Space`; at the default width focus the chat box, press Esc, then `Space` (the box
   route), and capture both.
3. **`Space /` search** (expected). Press `Space /` and type `rename`; the picker shows "Rename session" with `Space
   b r` as its detail; Enter opens the rename dialog. Capture the picker.
4. **Moved keys still run** (low-confidence: wiring across plugins). `Space b n` opens the start prompt, `Space b h`
   hides the session hub, `Space b p` hides the session's popup on a session with a round open, `Space ;` closes and
   `Space :` does nothing (which-key shows no `:`).
5. **Keybindings section: reassign by recording** (expected; low-confidence on focus while recording). Open Settings › Keybindings,
   go to "Rename session", press Enter, then `Ctrl+t`. Capture the row with the struck old key and the recorded one,
   then press Enter. `keymap.json` in the run's home should hold the new bind, and `Ctrl+t` should open the rename
   dialog. Then press `r` on the row to reset it.
6. **Keybindings section: `?` find and the `f` chips** (expected). Press `?` then `Ctrl+k` and capture the "runs" list. Then
   press `f` until Unbound shows and capture it.
7. **Leader menu: add an item and move one** (expected). Open Settings › Leader menu, pick the Session group, add `t`
   → "Next tab", and capture the items pane and the shelf from `Space b`. Then move "Toggle hub" to View (`m`) and
   capture both panes.

Real-keyboard checks for the user (listed in the wrap-up with their steps; the agent does not wait on them):

- Recording an Option chord on macOS (`⌥t`) in Settings › Keybindings: synthetic keys never compose a dead key, so only a
  real keyboard shows whether `⌥n`/`⌥e`/`⌥u` record as `<A-n>` rather than a dead-key compose.
- The shelf's glass over real content at the user's own transparency setting.

GIVEN the landed plan WHEN each drive check above runs THEN its captures match the design docs; a mismatch is a fix
in the task that owns it, re-driven after.
Tests:     none: live checks only.
Done when: every check above driven, its captures read, and each mismatch fixed or reported.
Commit:    none (captures are not committed).

## Proof

