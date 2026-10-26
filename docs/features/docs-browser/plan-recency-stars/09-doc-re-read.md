# 09 — Doc re-read

Status: in progress
Type: Batch
Wave: 5 · Depends on: 03, 08
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace and wigley-ai-gui

Files:     modify, only where a line is stale:
           wigley-ai-marketplace `plugins/wigley/scripts/docs-index/README.md` · `AGENTS.md` (§ Done)
           wigley-ai-gui `docs/features/docs-browser/design.md` · `docs/features/followups.md` · `AGENTS.md`
Consumes:  the landed code of 01–08
Produces:  no new interface
Decisions: the docs were written before the code (plan.md § Docs written ahead), so each is a hypothesis until this
           task checks it line by line against the landed code (`wigley:writing-for-agents` § Doctrine before code)
GIVEN the README's § Commands table, § The index file (`schemaVersion` 4, `lastLoaded`) and § Last loaded WHEN read
      against `loads.py`, `listing.py`, `session.py`, `model.py` and `docs_index.py` THEN every stated row shape, file
      glob, matching rule, cache field and cache rule matches the code, the `lastLoaded` bullet's offset wording
      included (task 01 keeps any UTC offset verbatim)
GIVEN marketplace `AGENTS.md` § Done WHEN read against the suites under `plugins/wigley/scripts/` and
      `plugins/wigley/skills/` THEN it lists a command for every test suite folder that exists then, and none for a folder that is gone
GIVEN design.md § Recency and stars (plan D), the Plans list and the `s` key in the Keys bullet WHEN read against
      `tree.ts`, `loaded-time.ts`, `page/starred-docs.ts`, `page/tree-view.ts`, `page/doc-view.ts`, `page/start.ts`
      and `src/plugins/keymap.ts` THEN the order rules, the time text and thresholds, the `Loaded …` line, the Starred
      group rules and the star set rules match the code
GIVEN wigley-ai-gui `AGENTS.md`, the `docs/` row WHEN read against the landed docs plugin THEN it names the Starred
      root correctly
GIVEN the Codex item in `docs/features/followups.md` WHEN read against `loads.py` THEN it is still true that no Codex
      session is read
Tests:     none (doc task)
Done when: every stale line found is fixed; the reply lists each fix with its file and line, or says none was stale
Commit:    one commit per repo for the fixes, by path only; none when nothing was stale

## Proof
