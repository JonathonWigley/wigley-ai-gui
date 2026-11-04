# 05 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     modify `DESIGN.md` · modify `docs/features/agent-chat/design.md` · modify `docs/features/followups.md`
Consumes:  the landed code of 01–04
Produces:  docs that match the landed code

Decisions:

- Check each line of the block cursor text in `DESIGN.md` § Keys and focus and in the Chat tab keys paragraph of `docs/features/agent-chat/design.md` against the landed code. Fix each stale line.
- Remove the entry "One rule for the chat cursor, scroll and keys" from `docs/features/followups.md`. Another session may hold edits in that file: stage only this hunk.

Done when: each line matches the code; the follow-up entry is gone.
Commit:    one commit for the group

## Proof

