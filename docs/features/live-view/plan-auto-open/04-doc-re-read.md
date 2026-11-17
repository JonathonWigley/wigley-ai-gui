# 04 — Doc re-read

Status: not started
Type: Task
Rung: standard · a doc-only task against landed code
Wave: 4 · Depends on: 01 (its parser rules are re-read), 02 (AGENTS.md and the watch are re-read), 03 (the self-test claims are re-read)
Plan: [plan.md](plan.md)

Files:     modify `wigley-ai-gui/docs/features/live-view/design.md` · modify `wigley-ai-gui/AGENTS.md`
Consumes:  nothing
Produces:  nothing
Decisions: plan decision 8 · `wigley:writing-for-agents` § Doctrine before code

## Steps

1. Read `wigley-ai-gui/docs/features/live-view/design.md` line by line against the landed code of 01, 02 and 03:
   "What it is", "The agent's tools", "The playtest watch", "The sample" and "Rejected". Check each claim: the
   trigger forms, the live guard (`replayed: false` `toolStarted` paired by `toolUseId`; a `replace` never acts), the
   folder order, the blocked pick, the precedence rule, the close triggers, and the `reads` entry.
2. Drop every "planned in `plan-auto-open`, not built yet" mark once its code has landed: one in "What it is", one at
   the head of "The playtest watch".
3. Read the `live-view/` entry of `wigley-ai-gui/AGENTS.md`'s source layout, the `livePicksSlot` comment in
   `src/plugins/live-view/contract.ts`, the header comments of `src/plugins/live-view/manifest.ts` and
   `src/plugins/live-view/main/start.ts`, and the `show_live_view` / `hide_live_view` descriptions in
   `src/plugins/live-view/main/live-tools.ts`, against the code. Fix a stale line in `design.md` or `AGENTS.md` here;
   a stale code comment goes to the run's review as a finding, since 02 owns those files.
4. Commit the fixes.

## GIVEN / WHEN / THEN

GIVEN 01–03 landed WHEN this task ends THEN `design.md` holds no `plan-auto-open` mark, and every claim in it and in
the AGENTS.md entry matches the code.

Done when: `grep -n 'plan-auto-open' wigley-ai-gui/docs/features/live-view/design.md` prints nothing; the fixes are
committed.
Commit:    one commit for the group

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
