# 16 — Doc re-read

Status: done
Type: Task
Wave: 13 · Depends on: 15
Plan: [plan.md](plan.md)

Files:     modify `docs/features/agent-harnesses/design.md` · modify `AGENTS.md` · modify `docs/features/followups.md` ·
           modify `.agents/skills/drive/SKILL.md` ·
           modify `/Users/jonathonwigley/Documents/ai/wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md`
           (each only where the landed code disagrees with it)
Consumes:  the landed code of tasks 01–15
Produces:  no code; each doc agrees with the landed code
Decisions: The docs were written ahead of the code (commits `6da8397b8` and `8b85b743f`), so each is a hypothesis until this
           task reads it against the code (plan.md § Docs written ahead; `wigley:writing-for-agents` § Doctrine before
           code). The code wins over the doc, except where the code breaks a settled decision in plan.md: then the
           code is the bug, and the task reports it to the lead instead of rewriting the doc.
Mandatory: AGENTS.md (whole); `docs/features/agent-harnesses/design.md`; plan.md § Design Overview
GIVEN a line in a doc below names a path, member, setting key, slot, id or behaviour
WHEN the task reads it against the landed tree
THEN the line is true, or the task rewrites it to the tree
Tests:     none (no code changes)
Approach:  Read each doc line by line and check each claim in one batched grep call per doc:
           - `design.md`: every section, the fake's id `fake`, `claude-code.command` and `claude-code.profiles`,
             `services.agentEnvironment`, `processes.spawn`, `events.sessionId`, `events.permission`,
             `answerPermission`, `row_id`, the join rule, `installedPlugins`, `configRoots`, the reload behaviour
           - `AGENTS.md`: the `claude-code/` tree entry, chat's tools and exports, usage's line, the owned-session
             paragraph, `core.agentHarnesses`, the agent harness paragraph, the transcripts path, the session control
             paragraph, and the chat layout renderer order task 14 added
           - `docs/features/followups.md` § Harness seams: every item this lane landed is gone; every item left names
             today's files
           - `.agents/skills/drive/SKILL.md`: step 2 of § Loop. At plan time line 36 says `chat.start` uses the first
             profile in chat's `profiles` setting; task 05 rewrites it to the first profile of the run's harness. Check
             that sentence, and `WIGLEY_DRIVE_HARNESS` / `--harness` (`fake` or `claude`) against the landed
             composition root.
           - the marketplace forms `README.md`: the hello's `row_id` (task 09)
           Also grep `docs/`, `AGENTS.md` and `.agents/skills/drive/SKILL.md` for `src/main/claude-code`,
           `claude.command`, `chat.profiles`, `CHAT_HARNESS_ID`, `CLAUDE_PERMISSION_TOOL`, `permission-tool.ts`,
           `HARNESSES` and the phrase "chat's `profiles` setting"; each hit outside a closed plan's history is
           rewritten to the landed name.
Done when: every claim above is checked, and each doc that changed is committed
Commit:    one commit in wigley-ai-gui ("Doc re-read after Lane H: …" naming each doc fixed); one in the marketplace if
           its README changed. No commit when no doc changed: record "no change" in plan.md's Run log.

## Proof

Commit 4c9570a3b · proof: Every claim in the Approach checked against the landed tree; design.md, AGENTS.md, drive SKILL.md and the worktree forms README agree; one followups line rewritten · concerns: drive-commands.ts:67 and :378 still say Claude in user copy; old names remain only in Lane P's open plan docs
