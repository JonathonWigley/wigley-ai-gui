# 11 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 10
Plan: [plan.md](plan.md)

Files:     none modified, unless a check fails and its fix is dispatched
Consumes:  everything above; the notes drive actions ← 09
Produces:  the run's verification report
Decisions: the agent runs every check its tooling reaches (AGENTS.md § Checks for the user); a check only a real
           keyboard or the user's eyes settle goes in the wrap-up, nowhere else · every drive run uses its own temp
           home, so no check writes to the user's features homes or starts a session in the user's folders

## Checks the agent runs

1. `npm run lint`, `npm run typecheck`, `npm test`, `npm run selftest`.
2. A drive run (`.agents/skills/drive/SKILL.md`), its captures read against `DESIGN.md`:
   - Popup (expected path): `Space n n` from Sessions mode, from Docs mode and from Backlog mode opens the popup
     over each; `Esc` closes it; reopening shows the typed draft.
   - GUI capture (low-confidence: hide, capture and reopen are wiring no unit test sees): the captured image shows
     the mode behind the popup and does not show the popup itself.
   - Markup (low-confidence: Fabric drawing has no unit test): pen, text, arrow and box each draw on an image;
     undo and redo step through them; reopening the image shows the markup still editable; the PNG written on send
     shows the markup at the image's own pixel size.
   - New follow-up (expected path): sending to a follow-up in the run's fixture home writes the item with its
     one line, tags, session line and image links, and each linked PNG exists at its path.
   - Append (expected path): appending to that item reuses its image folder and numbers on.
   - Launch (expected path): launching over the fake agent harness adds a session row, leaves the selected row as
     it was, and shows the toast; the new session's first entry holds the brief, the body, the session line and
     the images.
   - Backlog (low-confidence: delete changed in task 05): deleting the item in Backlog trashes its image folder.
     The commit taking images has no live check: task 05's `commit_ChangedImages_CommitsThemWithFollowups` pins
     the paths handed to `commitPaths`, and the git adapter's commit of named paths is unchanged.

Each finding is fixed through a dispatch, then the failed check runs again.

## Checks for the user's wrap-up

- Paste a screenshot taken with the OS screenshot tool (`Cmd+Shift+Ctrl+4` on macOS) into the popup with a real
  keyboard: synthetic keys reach no system clipboard shortcut.
- Drop an image file from Finder onto the popup: a drive run cannot drag from the OS.
- Draw with a real mouse or trackpad: pen strokes feel right and text boxes take typing.
- The popup and markup view look against `DESIGN.md` in the user's own theme.

Tests:     the checks above.
Done when: every check in "Checks the agent runs" passes, and the wrap-up lists the user's checks.
Commit:    none, unless a fix lands (its own commit).

## Proof
