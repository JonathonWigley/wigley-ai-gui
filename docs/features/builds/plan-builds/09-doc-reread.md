# 09 — Doc re-read

Status: done
Type: Batch
Rung: standard · a doc-only task that writes prose against landed code
Wave: 5 · Depends on: 07 (it reads the landed code of every code task), 08 (it reads the landed README)
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/docs/features/builds/design.md`
- modify `wigley-ai-gui/agent-plugin/skills/builds/SKILL.md`
- modify `wigley-ai-gui/AGENTS.md`
- modify `wigley-ai-gui/docs/keymap.md`
- modify `wigley-agents/machine-skills/teamcity-builds/SKILL.md`
- modify `wigley-agents/machine-skills/create-rcs/SKILL.md`
- modify `wigley-ai-marketplace/plugins/wigley/skills/wrap-up/SKILL.md`
- modify `wigley-ai-marketplace/plugins/wigley/.claude-plugin/plugin.json`
- modify `wigley-ai-marketplace/plugins/wigley/.codex-plugin/plugin.json`

Consumes: the landed code of tasks 01–08.

Decisions:
- Each doc in plan.md § Docs written ahead was written before the code (commit `74643ff2c`). Treat
  each line as a hypothesis (`wigley:writing-for-agents` § Doctrine before code).
- Read each doc line by line against the landed code. Check every command id, argument shape,
  slot key, setting key, message format, key bind, file path, poll cadence and capability.
- Fix every line that the code contradicts. The code wins, except where the code contradicts a
  decision in plan.md § Design Overview: report that as a concern and do not change the doc.
- Remove every "planned in `builds`, not built yet" mark, and the "Planned in `builds`, not built
  yet" lines, once the code they name has landed. A mark whose code did not land stays, and the
  task reports it.
- `design.md` keeps its sections. Change its status line to say the feature is built.
- The wrap-up skill is in the `wigley-ai-marketplace` folder. A change to it bumps the PATCH
  part of the version in both plugin manifests. Read the current number from `origin/main` after
  `git fetch`, since other runs bump the same manifests. Then run
  `python3 /Users/jonathonwigley/Documents/ai/wigley-ai-marketplace/scripts/check_manifests.py`
  from the repo root that holds the run's tree (read its `--help` first for the path argument).
  Skip the bump when the wrap-up skill needs no change: removing its planned mark is a change.
- Apply `wigley:writing-for-agents` to each edit of a skill or `AGENTS.md`.

GIVEN the landed code WHEN each doc is read THEN every line agrees with the code, and no planned
mark names code that landed.

Tests: none. A doc change picks no test (`wigley:writing-tests` § Picking tests for a gate).

Done when: `grep -rniE "planned in (the app's )?.?builds|not built yet"` over the nine files
lists only marks whose code did not land. Each hit left is such a mark; name each one in the
report. `check_manifests.py` passes when the manifests changed.

Commit: one commit for the group: `builds: re-read the docs against the landed code`.

## Proof

Commit dc1fa4dd3 · proof: diff read: every builds planned mark removed; the one left (AGENTS.md shareable-app) is another plan's; check_manifests.py passes at 2.28.4 · concerns: Builds mode side-bar dots and filter-chip layout lines not checked line by line
