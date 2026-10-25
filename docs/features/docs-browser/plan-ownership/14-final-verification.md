# 14 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 13
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui (reads wigley-ai-marketplace's clone)

Files:     none changed; captures under the drive run's folder and the session scratchpad
Consumes:  everything 01–13 landed
Produces:  the verification report in the Proof section
Decisions: the app normally runs the installed `docs_index.py`, which stays on schema 2 until the user pushes and
           updates the plugin, so the live checks run the clone's script (`docs.scriptPath`). The user's own settings
           file is not edited: the drive run sets `docs.scriptPath` in its own config (AGENTS.md § Running and testing)
Approach:  run in this order; each check is tagged expected or low-confidence with its reason

1. **Real index, from the clone** (expected: tasks 01–04 unit tests pin each rule; this proves it on this machine's
   real installs). Run `python3 -X utf8 D:/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/docs_index.py
   build --stdout` into a scratch file. It writes `~/.agents/wigley-docs/index.json` too. That file is app-written
   cache data that the next build rewrites, so this is not a destructive step. Check with a short Python reading of the
   output:
   - `schemaVersion` is 3.
   - No entry has a path under `~/.claude/plugins/cache/wigley-ai-marketplace/` or
     `~/.codex/plugins/cache/wigley-ai-marketplace/` except installed-only files (`source: plugin`, `owner: mine`)
     and the two `kind: plugin` install entries.
   - Entries under `D:\ai-dev\wigley-ai-marketplace\plugins\wigley\skills\` have `source: repo`,
     `plugin: wigley@wigley-ai-marketplace`, `owner: mine` and a non-empty `meta.installed` naming harness `claude`
     version `1.9.1`, and for skills Codex still holds, harness `codex` version `0.17.1` (versions measured at plan
     time, re-verify).
   - Every `openai-curated-remote` plugin entry and every `skills/synced/` entry has `owner: third-party`.
   - `skill-file` entries exist (for example, this plan's `wigley:feature` skill has `plan-folder.md` and
     `plan-reader.md` in the clone).
   - In the home context, the clone's `skills/feature/SKILL.md` has claude state `listed` (taken from its installed
     copy), not `not-loaded`.
   Report the counts per owner and source.
2. **Session loaded plugins** (expected): run `docs_index.py session <this session's id>`. `loadedPlugins` holds
   `wigley@wigley-ai-marketplace` → `1.9.1`.
3. **Statuses against the real clone** (low-confidence: git output, CRLF and the Codex cache's layout meet in a real
   run for the first time). In a drive run (`drive` skill) with `docs.scriptPath` set to the clone's `docs_index.py`
   and the real home: if the drive run's temp home cannot reach the real index, run `readPluginStatus` against the
   real index instead, through a scratch vitest file in the scratchpad that imports it with the node processes and
   files adapters, and delete the file after. Expect for wigley: entries changed since 1.9.1 show
   `Not installed · Claude`; most skills show `Not installed · Codex` (0.17.1 is far behind); the committed-but-unpushed
   README change from this plan's series shows `unpushed`; a clean file unchanged since 1.9.1 shows no Claude status.
   Spot-check one claim per status by hand with `git diff`/`git show`.
4. **Self-test** (expected): `npm run selftest` passes, the docs groups included (task 12's steps).
5. **Docs view look** (low-confidence: new rows and chips are visual). In the drive run, capture Docs mode with Mine
   expanded to wigley-ai-marketplace › wigley › Skills, Third-party collapsed, then expanded; open one skill with
   statuses and one synced skill. Check each capture against DESIGN.md: chip tones, the rollup's muted text, the
   read-only line. Fix what fails and say so in the report.

Done when: every check above passes or its failure is fixed and re-run; the report lists each check, its result and
           the capture paths
Commit:    none, unless a fix was needed (then one commit per fix, in its repo, by path only)

## Proof
