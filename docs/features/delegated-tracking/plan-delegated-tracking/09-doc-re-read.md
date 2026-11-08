# 09 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08
Plan: [plan.md](plan.md)

The docs below were written before the code, in commit `34a21fb3`. Each one is a hypothesis until this task reads it
against the landed code (`wigley:writing-for-agents` § Doctrine before code).

Files:     modify each doc below where a line is stale · modify `docs/features/followups.md`

Read each doc line by line against the landed code. Fix each line the code contradicts. Keep the doc's shape:

| Doc | The lines to check |
|---|---|
| `AGENTS.md` | the `src/shared/` entry (`plan-progress.ts`, `plan-copies.ts`), the `git/` entry (a clone's worktrees), the `workflow-heavy/` entry (no `plan-reader.ts`), the "An MCP tool" bullet (`addToolCallGuard`, main-agent-only tools) |
| `docs/features/workflow/design.md` | § Heavy's stages (busy, the newest copy, a subagent's calls), § Signals (the signal table's subagent row, the `fileWritten` sentence, the plan watch paragraph, the tools bullets), § Where it draws (the in-progress row), § Decisions, § Out of scope |
| `docs/features/workflow-levels/design.md` | § How the app learns (only the main agent, Heavy's checklist) |
| `docs/features/backlog/design.md` | § The mode (worktree homes), § Plans and features (the shared reader), § Git (the contract's methods), § Seams (the shared reader) |
| `docs/features/chat-bar/design.md` | § The agent strip, Lifetime (the held end, the late line) |
| `docs/features/agent-chat/design.md` | § Vocabulary, Chat entry (the agent id on text and thinking, the transcript rule) |
| `docs/features/auto-compact/design.md` | § Vocabulary, Agent wait (a subagent at any depth) and the Decisions bullet "Only sessions at a workflow level" |
| `docs/features/agent-chat/claude-stream.md` | the end-event bullet's last sentence (the held end and the late line) |

For each claim, find the code that makes it true: the exported name, the pinned text, the value. A claim with no code
behind it is stale.

Also:

- Check that task 05's commit removed the follow-up `Background subagent misattributed and dropped early` from
  `docs/features/followups.md`. Remove it here when it is still there.
- Check the strings the docs quote against the code: the skip text
  `Only the main agent's call changes this session, so this call changed nothing.`, the 2000 ms wait, the
  `Status: in progress` value.

Done when: each doc in the table has been read through against the code; each stale line is fixed; the follow-up is
gone; `git diff 34a21fb3 -- <the docs>` shows only true lines.
Commit:    one commit for the doc fixes, or none when no line is stale

## Proof
