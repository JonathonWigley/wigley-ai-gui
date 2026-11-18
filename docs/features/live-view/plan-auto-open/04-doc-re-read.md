# 04 — Doc re-read

Status: done
Type: Task
Rung: standard · a doc-only task against landed code
Wave: 4 · Depends on: 01 (its parser rules are re-read), 02 (AGENTS.md and the watch are re-read), 03 (the self-test claims are re-read)
Plan: [plan.md](plan.md)

Files:     modify `wigley-ai-gui/docs/features/live-view/design.md` · modify `wigley-ai-gui/AGENTS.md` · modify `wigley-ai-marketplace/plugins/wigley/skills/unity-playtest/SKILL.md`
Consumes:  nothing
Produces:  nothing
Decisions: plan decision 8 · `wigley:writing-for-agents` § Doctrine before code

## Steps

1. Read `wigley-ai-gui/docs/features/live-view/design.md` line by line against the landed code of 01, 02 and 03:
   "What it is", "The agent's tools", "The playtest watch", "The sample" and "Rejected". Check each claim: the
   trigger forms, the live guard (`replayed: false` `toolStarted` paired by `toolUseId`; a `replace` never acts), the
   folder rule (the command's `--project-path` only; none gives a log line), acting on success only, the blocked
   pick, the precedence rule, and the close triggers (a stop closes only for the same project).
2. Drop every "planned in `plan-auto-open`, not built yet" mark once its code has landed: in `design.md`, one in
   "What it is" and one at the head of "The playtest watch"; in
   `wigley-ai-marketplace/plugins/wigley/skills/unity-playtest/SKILL.md` § Session setup, the one on the
   `--project-path` bullet. Check that bullet's claim against 02's watch.
   The skill change is a plugin change: read `wigley-ai-marketplace/AGENTS.md` § Changing a plugin, and run
   `python3 scripts/check_manifests.py --against origin/main` from `wigley-ai-marketplace/`. When it fails, bump the
   wigley version above whatever `origin/main` holds at landing, whichever change put it there, in both
   `plugins/wigley/.claude-plugin/plugin.json` and `plugins/wigley/.codex-plugin/plugin.json`, in this commit.
3. Read the `live-view/` entry of `wigley-ai-gui/AGENTS.md`'s source layout, the `livePicksSlot` comment in
   `src/plugins/live-view/contract.ts`, the header comments of `src/plugins/live-view/manifest.ts` and
   `src/plugins/live-view/main/start.ts`, and the `show_live_view` / `hide_live_view` descriptions in
   `src/plugins/live-view/main/live-tools.ts`, against the code. Fix a stale line in `design.md` or `AGENTS.md` here;
   a stale code comment goes to the run's review as a finding, since 02 owns those files.
4. Commit the fixes.

## GIVEN / WHEN / THEN

GIVEN 01–03 landed WHEN this task ends THEN `design.md` and the playtest skill hold no `plan-auto-open` mark, and
every claim in them and in the AGENTS.md entry matches the code.

Done when: `grep -n 'plan-auto-open' wigley-ai-gui/docs/features/live-view/design.md
wigley-ai-marketplace/plugins/wigley/skills/unity-playtest/SKILL.md` prints nothing; the fixes are committed.
Commit:    one commit for the group

## Proof

Commit 19db3b20d · proof: diff read; grep for plan-auto-open over design.md and SKILL.md prints nothing; check_manifests passed, no bump · concerns: none; hide_live_view description still correct since editor_stop closes only app-opened picks
