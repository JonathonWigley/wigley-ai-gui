# 06 — Doc re-read

Status: done
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify `docs/features/agent-chat/design.md` (only where stale)

- Read `docs/features/agent-chat/design.md`, written ahead in `e485c3b`, line by line against the landed code: the
  glossary's App slash command entry, § Flow Saved sessions' control-values sentence, § Flow Clear, and § Plans
  Plan F. Fix every line the code contradicts — names, order of steps, the notice and log text, what a resting row
  does — and commit the fixes.

Done when: every line checked; fixes committed, or "no changes" recorded in the Proof.
Commit:    one commit, if any line changed

## Proof

Commit 4fa6000 · proof: glossary, Saved sessions, Clear, App slash commands, Plan F checked line by line; start diagram, control-values sentence and Clear fixed · concerns: worker doubted --permission-mode manual; claude 2.1.316 --help lists manual among the choices, so it holds
