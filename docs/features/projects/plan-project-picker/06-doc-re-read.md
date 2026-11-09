# 06 — Doc re-read

Status: in progress
Type: Task
Wave: 4 · Depends on: 04, 05
Plan: [plan.md](plan.md)

Files:     modify, only where a line is stale: `docs/features/projects/design.md` · `docs/features/agent-chat/design.md` ·
           `docs/features/session-groups/design.md` · `docs/features/unity-pool/design.md` · `AGENTS.md` ·
           `docs/features/workflow/design.md` · `docs/features/docs-browser/design.md` ·
           `docs/features/session-log/design.md` · `docs/features/usage/design.md` ·
           `docs/features/session-stash/design.md`
Consumes:  the landed code of 01–05
Produces:  docs that state what the code does
Decisions: docs were written ahead at `caee8922` as a hypothesis (`~/wigley-agents/decisions.md` § Docs); the code wins
           unless it contradicts a decision in plan.md, which is then a finding for the lead, not a doc edit

Read each doc written ahead line by line against the landed code:

- `docs/features/projects/design.md` — every section; set **Status** to built, naming the files that hold it
  (`src/plugins/chat/main/projects.ts`, the start path in `chat-sessions.ts`, the page steps, `pool-provider.ts`,
  sessions' namer and `relocate`). Check each pinned text (`Claiming a Unity clone on <branch>…`, `Waiting for a
  Unity clone…`, the error notice, `Other folder…`, step titles) against the code.
- `docs/features/agent-chat/design.md` — the Flow block, the Start prompt bullet, the Resume and archive bullet, and
  the `start_session` bullet (§ Starting a session from an agent: add `project` and `branch` if 03 landed them and the
  bullet names the tool's inputs).
- `docs/features/session-groups/design.md` § Projects — the namer, the `changed()` re-ask, the fallback.
- `docs/features/unity-pool/design.md` § Claims for a project and § Status (add `pool-provider.ts`).
- Docs not written ahead that the plan makes stale (read each line that names `sessionOpened`, `hostSessionChanged`
  or a row's folder):
  - `docs/features/workflow/design.md` (~line 250, a flow opening at `chat.sessionOpened` in the row's folder) and
    `docs/features/docs-browser/design.md` (~line 92, the session source re-read on `hostSessionChanged`): add the
    `sessions.relocated` re-read 01b landed.
  - `docs/features/session-log/design.md` (the `opened` row), `docs/features/usage/design.md` and
    `docs/features/session-stash/design.md`: a pool project's session fires `sessionOpened` when its claim lands,
    in the claimed clone, and a row whose claim never lands fires neither `sessionOpened` nor `sessionClosed` (03).
- `AGENTS.md` — the chat, sessions and unity-pool lines of the plugin map; sessions' exports line gains
  `addProjectNamer` and `relocate` to chat if the map lists sessions' exports.

Done when: every stale line is fixed, or the run log names each doc as checked with no change.
Commit:    one commit, `Projects docs re-read against the landed code` plus what changed.

## Proof
