# 05 — Doc re-read

Status: in progress
Type: Batch
Wave: 3 · Depends on: 01, 04
Plan: [plan.md](plan.md)

Files:     modify each doc below only where it is stale · modify both marketplace plugin manifests (the bump)
Consumes:  the landed code of 01, 02, 03 and 04
Produces:  every doc written ahead agrees with the landed code, line by line
Decisions: each doc was written before its code (`decisions.md` § Docs: a hypothesis until re-read)

Read each doc line by line against the landed code. Fix every line the code contradicts: a name, a flag, a default,
an order of steps, a file name, a reason that no longer holds.

- GUI `docs/features/auto-retro/design.md` — against `src/plugins/auto-retro/`, chat's `launch`/`close`/`isUserClose`,
  and sessions' `addSection`. Check the settle wait, the `folder` setting, `queue.json`, the slot name, the section
  look and its visibility rule.
- GUI `AGENTS.md` — the `sessions` page entry, the `auto-retro/` entry, chat's exports line.
- GUI `docs/features/session-log/design.md` — the `closed` row.
- GUI `docs/features/layouts/design.md` — the `sessions` and `auto-retro` Adopters rows.
- GUI `DESIGN.md` § Surfaces › Side bar — the plugin sections line.
- GUI `docs/features/session-groups/design.md` § Order and § Drawing — the plugin sections.
- GUI `docs/features/agent-chat/design.md` § Chat plugin — **Saved sessions** and **Permissions**, against task 02's
  `unattended` and `close`.
- GUI `src/plugins/sessions/layouts/layout.d.ts` header comment ("Both sections always draw", "the two `section`s")
  — 03 should have rewritten it; confirm.
- Marketplace `plugins/wigley/skills/retro/SKILL.md` — every `ledger.py` and `digest.py` command and its output
  (`short`, `lock acquire` exit codes and text, `runs`, `runs --clear`, `draft`, `ripe`'s `draft` values), and the
  step numbers it cites inside itself.
- Marketplace `plugins/wigley/skills/retro/criteria.md` § Candidate file — `## Draft`, `draft_target`, `draft_hash`, the step numbers; and the formats task 01 settled — the lock file, the `runs.md` line, lock messages on stderr.
- `/Users/jonathonwigley/wigley-agents/AgentsStandardMapping.md` line naming `learning/` — add `runs.md` only when
  that line lists the ledger's files.

Version: the marketplace commit of this task is the `auto-retro` series' last, so it carries the one version bump
(marketplace `AGENTS.md` § Changing a plugin), with or without a doc fix. Read `origin/main`'s version (`git show
origin/main:plugins/wigley/.claude-plugin/plugin.json`) and set `version` one minor above it (1.20.2 → 1.21.0 at
plan time, re-verify) in `plugins/wigley/.claude-plugin/plugin.json` and `plugins/wigley/.codex-plugin/plugin.json`,
then run `python3 scripts/check_manifests.py --against origin/main` from the marketplace worktree.

Done when: each doc above was read whole against the code, and each fix is committed in its repo with the message
"Doc re-read for auto-retro: <what changed>", or the task's Proof says no line changed.
Commit:    one commit per repo that changed; the marketplace always gets one, for the bump
