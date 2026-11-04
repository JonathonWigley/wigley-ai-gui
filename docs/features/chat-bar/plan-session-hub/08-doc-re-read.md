# 08 — Doc re-read

Status: in progress
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06, 07
Plan: [plan.md](plan.md)

Files:     modify any line these docs get wrong: `docs/features/chat-bar/design.md` · `DESIGN.md` · `AGENTS.md` · `docs/features/agent-chat/design.md` · `docs/features/layouts/design.md` · `docs/features/usage/design.md` · `docs/features/workflow/design.md` · `docs/keymap.md` · `docs/features/agent-tower/design.md` · `docs/features/followups.md` (the short-tab entry names the dock's slot and its 97 px)
Consumes:  the landed code of 01–07
Produces:  each doc true against the landed code
Decisions:
- Check each doc written ahead, line by line, against the landed code. Fix every stale line. Prioritize names, section order, sizes, keys, log wording and the plugin list.
- Check `docs/features/chat-bar/design.md` § Rejected and § Decisions still state what landed.
- Check that `src/plugins/keymap.ts` and the `docs/keymap.md` table agree on `<Leader>vs`.
- Run `grep -rn "chat-working-slot\|activity dock\|side pane\|agent-skills\|session line\|<Leader>vs" docs AGENTS.md DESIGN.md --include='*.md'`, leaving out plan folders. Read each hit against the landed code.
Done when: every doc above is checked; every grep hit is read; each fix is committed; the Proof names the lines changed, or says none changed
Commit:    one commit for the group

## Proof

