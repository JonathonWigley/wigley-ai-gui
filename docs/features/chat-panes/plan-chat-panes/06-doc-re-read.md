# 06 — Doc re-read

Status: done
Type: Task
Wave: 4 · Depends on: 05b
Plan: [plan.md](plan.md)

Files:     modify as needed `docs/features/chat-panes/design.md` · `AGENTS.md` · `docs/keymap.md`

Consumes:  the landed code of 01–05b

Produces:  each doc below true to the landed code

Decisions:
- Read each doc line by line against the code:
  - `docs/features/chat-panes/design.md` (the whole file)
  - `AGENTS.md` § Architecture: the session tab bullet (icons), **A chat pane**, **A resize
    target**, **A focus target**, the `src/shared/` block's `pane-tree/` line, and the sessions
    plugin folder line
  - `docs/keymap.md` § Layers: `Alt+hjkl`, `Alt+Shift+hjkl`, the split, swap and close line
- Fix every line the code contradicts. A command name, log line, icon or key that the run changed
  under a ruling is the code's value.
- Add the leader-group row only if a task added a leader bind (none is planned).
- `DESIGN.md` held another session's uncommitted edits at plan time. When `git status` still shows
  it modified, leave it alone and report any stale line in it as a concern.

Done when: every listed doc line agrees with the code; the fixes are committed.
Commit:    one commit for the group, holding only the listed docs

## Proof

Commit 2b44679 · proof: Diff read: AGENTS.md 4 hunks (sessions folder line, least sizes, chord keys, resize/focus edge logs), docs/keymap.md 2 lines, chat-panes design.md 2 bullets; oxfmt clean on AGENTS.md and design.md, keymap.md fails identically at HEAD (pre-existing) · concerns: DESIGN.md ~388 omits Alt+Shift+j/k; keymap.md Raw key bullet does not name docs.backToTree; design.md key table misaligned (pre-existing)
