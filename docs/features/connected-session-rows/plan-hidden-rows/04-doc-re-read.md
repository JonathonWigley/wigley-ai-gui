# 04 — Doc re-read

Status: done
Type: Task
Wave: 3 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` only where a line is stale
Consumes:  the landed code of 01, 02, 03
Produces:  none
Decisions:
- Re-read the relay paragraph in `AGENTS.md` § Architecture (written ahead in `b6aff9f`: connected sessions, `mark`,
  `release`) line by line against the landed `session-list.ts`, `contract.ts` and `channel-presenter.ts`. Fix every
  stale line.
- Also grep the docs for any other claim that a connected session gets its row at connect:
  `grep -rn -i "row" AGENTS.md docs/features/agent-chat/design.md docs/features/docs-browser/design.md | grep -i connect`.
  Fix what is stale; leave plan folders of other features alone.
- Re-read the comments 01 and 03 changed (`SessionsMainExports`, `SessionRow`, `createSessionList`, the presenter,
  the drive action descriptions, the previews) against the landed behaviour.
Done when: every line checked; fixes committed, or no change needed and said so in the Proof
Commit:    one commit for the group, when there is a change

## Proof

Commit 5c54dac · proof: diff read: AGENTS.md relay paragraph and docs-browser sidebar bullet match landed code; drive SKILL.md:62 true, unchanged; typecheck clean · concerns: presenter doc comment rewrap still leaves one line past width; docs-browser design.md sidebar bullet line past 120 cols; preview-round.ts:28 sample finding cites 'mark … with no row ignored', which no path emits now (fictional sample, left)
