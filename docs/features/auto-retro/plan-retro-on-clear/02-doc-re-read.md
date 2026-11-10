# 02 — Doc re-read

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify (only for a stale line) `docs/features/auto-retro/design.md` · `AGENTS.md` · wigley-ai-marketplace `plugins/wigley/skills/retro/SKILL.md`
Consumes:  the landed code of 01
Produces:  no code

Read each doc below line by line against the code that 01 landed. Fix every line that the code contradicts. Commit
the fixes, one commit per repo.

- `docs/features/auto-retro/design.md` — § Intent, § Flow, § The queue, § Done, § Decisions.
- `AGENTS.md` — the `auto-retro/` line of the Architecture tree.
- `~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/skills/retro/SKILL.md` — the frontmatter description and the
  `auto <session ids>` row of § Modes. A fix there bumps the plugin version in both manifests, per that repo's
  `AGENTS.md` § Changing a plugin.

Done when: every line in these docs matches the landed code; each fix is committed.
Commit:    one commit per repo with a fix, or none

## Proof

