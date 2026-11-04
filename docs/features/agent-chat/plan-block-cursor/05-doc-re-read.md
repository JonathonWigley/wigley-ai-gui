# 05 — Doc re-read

Status: done
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     modify `DESIGN.md` · modify `docs/features/agent-chat/design.md` · modify `docs/features/followups.md`
Consumes:  the landed code of 01–04
Produces:  docs that match the landed code

Decisions:

- Check each line of the block cursor text in `DESIGN.md` § Keys and focus and in the Chat tab keys paragraph of `docs/features/agent-chat/design.md` against the landed code. Fix each stale line.
- Remove the entry "One rule for the chat cursor, scroll and keys" from `docs/features/followups.md`. The cursor rules now live in the `EntryList` comment and `focusAfterChange`.
- Another follow-up in that file names this entry ("Settle it with **One rule for the chat cursor…"). Reword that line so that it names `focusAfterChange` in `entry-focus.ts`.
- Another session may hold edits in `followups.md`. When `git diff` shows lines this task did not write, make a patch of this task's hunks and stage it with `git apply --cached`. Otherwise stage by pathspec.

Done when: each line matches the code; the follow-up entry is gone; no line names it.
Commit:    one commit for the group

## Proof

Commit 341909ba · proof: diff read; follow-up gone, no line outside the plan names it · concerns: none
