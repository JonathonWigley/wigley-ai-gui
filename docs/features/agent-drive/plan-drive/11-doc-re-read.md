# 11 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
Plan: [plan.md](plan.md)

Files:     modify as needed `AGENTS.md` · `.agents/skills/drive/SKILL.md` · `~/wigley-agents/AGENTS.md` · wigley-ai-marketplace `plugins/wigley/skills/make/SKILL.md` and `plugins/wigley/scripts/forms/README.md`
Consumes:  the landed code of 01–10
Produces:  each doc written ahead true to the landed code
Decisions: a doc written before its code is a hypothesis (`wigley:writing-for-agents` § Doctrine before code)

## What to check, line by line

- `AGENTS.md` (this repo): § Contents' Running and testing line; § Architecture's `src/main` tree (`drive/`); the plugin data bullet (a drive run's temp home); the ambient service bullet (does `runMode` belong in its list); § Running and testing's drive-run and real-keyboard bullets — the command name, the offscreen accessory behaviour, `api.drive`, the skill path.
- `.agents/skills/drive/SKILL.md`: every command, flag and argument against `npm run drive -- help` and `scripts/drive-args.mts` (`start` flags, `--run`, `key` notation and `Space`, `screenshot` with a selector, `record start`/`stop`, `fit [width]`, `restart`, `quit`); the run folder layout; that `.claude/skills/drive` still links to it.
- `~/wigley-agents/AGENTS.md` § Checks for the user: still matches how the drive skill and `wigley:make` word it.
- wigley-ai-marketplace: the make line names a skill route that exists (`drive` here); the README's `WIGLEY_AI_GUI_ENDPOINT_DIR` sentence matches `endpoint_dir` in `start_app.py`.

Done when: every stale line is fixed, and each repo's fixes are committed in that repo (none pushed)
Commit:    one commit per repo that changed

## Proof
