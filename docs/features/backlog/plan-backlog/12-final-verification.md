# 12 — Final verification

Status: done
Type: Task
Wave: 7 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     none modified, unless a check fails and its fix is dispatched
Consumes:  everything above
Produces:  the run's verification report
Decisions: the agent runs every check its tooling reaches (AGENTS.md § Checks for the user); a check only a real
           keyboard or the user's eyes settle goes in the wrap-up, nowhere else

## Checks the agent runs

1. wigley-ai-gui: `npm run lint`, `npm run typecheck`, `npm test`, `npm run selftest`.
2. wigley-ai-marketplace: `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)`;
   `python3 scripts/check_manifests.py --against origin/main`.
3. Real index (expected path): run the marketplace clone's script,
   `python3 ~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/docs_index.py build`. The
   installed plugin copy (1.10.2 at plan time) predates task 03 and writes no `meta.tags`.
4. Real index contents (expected path): a read-only `python3` pass over `~/.agents/wigley-docs/index.json` confirms:
   - every features home from task 05's list has entries with `source: 'features'`
   - follow-up entries carry `meta.tags`, with `agent-ready` on the items task 05 tagged
   - each `plan-*/` folder on disk has a `plan` entry
   - no `source: 'features'` follow-up entry has a path under a repo's `docs/followups/`

Each finding is fixed through a dispatch, then the failed check runs again.

## Checks for the user's wrap-up

- Backlog over the real homes (low-confidence: grouping and plan headers over real, varied homes that no unit test
  covers): `Space k b`; every features home shows under its repo; new-games-prototypes' items show with their tags;
  each plan shows its target and progress; the repo `docs/followups/*.md` items do not show.
- `Cmd+Enter` saves the editor and `Esc` cancels it with a real keyboard (Cmd chords the drive run sends may not match
  a physical press).
- The Backlog look against `DESIGN.md` in the user's own theme.

Tests:     the checks above.
Done when: every check in "Checks the agent runs" passes, and the wrap-up lists the user's checks.
Commit:    none, unless a fix lands (its own commit).

## Proof

Commit none · proof: typecheck, lint, npm test 3448, python unittest, check_manifests, real index build and content check pass; selftest all passed on run 2 (run 1 forms-group flake) · concerns: stray .wigley-ai-gui-build/docs/features root indexed as a features home
