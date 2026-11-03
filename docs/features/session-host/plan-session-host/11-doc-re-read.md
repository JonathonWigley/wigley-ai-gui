# 11 — Doc re-read against the landed code

Status: not started
Type: Task
Wave: 5 · Depends on: 03, 04, 06, 09, 10
Plan: [plan.md](plan.md)

Files:     modify (only where a line is untrue) wigley-ai-gui `docs/features/session-host/design.md` ·
           `docs/features/agent-chat/design.md` · `AGENTS.md` · `docs/keymap.md` · `docs/features/followups.md` ·
           wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md`
Consumes:  the landed code of every earlier task
Produces:  docs that state the landed behaviour
Decisions: docs were written ahead of the code (plan.md § Docs written ahead) and are hypotheses until this
           re-read (`wigley:writing-for-agents` § Doctrine before code)

Steps:

1. Read each doc below line by line against the landed code. Fix each line the code makes untrue.
   - `docs/features/session-host/design.md`: every section. Check the protocol operation names, the pipe log
     record, the host folder and channel name, the idle rule, the end grace, log deletion, the dev and packaged
     host script paths, and the older-host notice.
   - `docs/features/agent-chat/design.md`: § Vocabulary (Owned session), § Agent harness seam (Commands), the
     queued messages passage, § Saved sessions.
   - `AGENTS.md`: the layer map entries `local-channel/`, `session-host/` and `src/session-host/`, the owned
     session sentence in the relay passage, and the `install-app` paragraph.
   - `docs/keymap.md`: the `:` row.
   - wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md` § The relay: Starting the app (the Windows
     `app-*` lookup) and App gone mid-call (the 30 s poll, the re-send, the failure answer).
2. Remove the item **Keep sessions running when the app closes** from `docs/features/followups.md` § Features.
   This plan delivers it.
3. Add each name the code chose and no doc states (a new setting's label, the stop-all command label) only where
   the doc already lists its siblings.

Done when: every doc above agrees with the landed code; the follow-up is removed.
Commit:    one commit per repo, naming each doc fixed and what was untrue.

## Proof

