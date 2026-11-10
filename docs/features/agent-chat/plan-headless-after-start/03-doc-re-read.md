# 03 — Doc re-read and the workflows.md merge

Status: done
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify (when stale) `docs/features/agent-chat/design.md` · `AGENTS.md` · `~/wigley-agents/workflows.md`
           (in `../.worktrees/wigley-agents-headless-tool`)
Consumes:  the landed code of 01 and 02
Produces:  docs that match the code; wigley-agents `headless-tool` ready to merge

1. Re-read each doc written ahead, line by line, against the landed code, under `wigley:writing-for-agents`
   § Doctrine before code: `docs/features/agent-chat/design.md` § Start prompt, § Resume and archive,
   § Headless from an agent; `AGENTS.md`'s chat tool list; `workflows.md` § Headless (the tool name, argument and
   result lines it quotes must match `set-headless-tool.ts`). Fix every stale line and commit each repo's fixes.
2. Grep the gui repo's docs (`docs/`, `DESIGN.md`, `AGENTS.md`) and the marketplace's
   `plugins/wigley/scripts/forms/README.md` for "New headless session", "headless session" at start, and "at
   session start", and fix any line still saying a session can start headless from the prompt. The marketplace
   README had no such line at plan time: expect no edit there, and open no marketplace worktree unless the grep hits.
3. Merge nothing here. Both `headless-tool` branches merge at `wigley:make`'s landing, after task 04 and the
   review: gui first, then wigley-agents' branch rebased onto its main and fast-forwarded, in the same landing as
   the app's push, so the rule never names a tool the installed app lacks for longer than the install.

Done when: each doc matches the code; both `headless-tool` branches ready to merge
Commit:    one commit per repo for the fixes, when there are any

## Proof

Commit ddf11e8c · proof: diff read: one stale design.md line fixed; AGENTS.md, workflows.md (6f50ce7) and marketplace README match the code, no edit · concerns: none
