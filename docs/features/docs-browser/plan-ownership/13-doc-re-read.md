# 13 — Doc re-read

Status: not started
Type: Batch
Wave: 6 · Depends on: 05, 12
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace and wigley-ai-gui

Files:     modify, only where a line is stale:
           wigley-ai-marketplace `plugins/wigley/scripts/docs-index/README.md`
           wigley-ai-gui `docs/features/docs-browser/design.md` · `docs/features/followups.md` · `AGENTS.md`
Consumes:  the landed code of 01–12
Produces:  no new interface
Decisions: the docs were written before the code (plan.md § Docs written ahead), so each is a hypothesis until this
           task checks it line by line against the landed code
GIVEN the README's § What is indexed, § The index file and § Load states WHEN read against `model.py`,
      `discover.py`, `environment.py`, `claude_rules.py`, `codex_rules.py` and `session.py` THEN every stated rule,
      field and value matches the code (the `owner` rule, the URL match, the merge counterpart, `meta.installed`,
      `skill-file` and its NUL-byte skip, `loadedPlugins`, the merged-entry load rule, `schemaVersion` 3)
GIVEN design.md's Tree, Read-only docs and § Ownership and plugin-source status bullets WHEN read against `tree.ts`,
      `path-guard.ts`, `kinds.ts`, `plugin-status.ts` and the page THEN node names, ids, the read-only text, the
      status names, the rollup text, the fetch cap and the `origin as of` text match the code
GIVEN wigley-ai-gui `AGENTS.md` § Architecture, the `docs/` row and the docs index source bullet WHEN read against
      the landed docs plugin THEN they name the owner split and the git statuses in main where a reader needs them
Tests:     none (doc task)
Done when: every stale line found is fixed; the reply lists each fix with its file and line, or says none was stale
Commit:    one commit per repo for the fixes, by path only; none when nothing was stale

## Proof
