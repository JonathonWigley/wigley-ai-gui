# 09 — Doc re-read

Status: in progress
Type: Task
Wave: 5 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08
Plan: [plan.md](plan.md)

Files:     modify, only where a line went stale: `docs/features/file-drop/design.md` · `AGENTS.md` (the **A drop target**
           bullet, the `src/shared/page/` listing's `file-drop/` entry) · `docs/features/agent-chat/design.md` (§ Images,
           **Attached image**) · `docs/features/notes/design.md` (§ Images, the send to a session) ·
           `docs/features/docs-browser/design.md` (§ Viewing and editing) · `DESIGN.md` (**File chip**)
Consumes:  the landed code of 01–08
Produces:  nothing new
Decisions: each doc written ahead (commits `09ced0c`, `b7230c4`) is read line by line against the landed code; every line the
           code contradicts is fixed — names (`api.drops.addTarget`, `pathForFile`, `savePasted`, `TextEditor.insert`),
           folder and file-name formats, the shrink rule, routing, each surface's table row. Known
           ahead: `docs-browser/design.md` § Viewing and editing must not say a pasted picture shows in the app — its
           docs view draws `![…]` as the alt text (08). A difference that is a code
           bug, not a stale line, goes in the Run log as a ruling instead of a doc edit.
Done when: every listed doc agrees with the code
Commit:    one commit for the doc fixes, or none when nothing was stale (say so in Proof)

## Proof
