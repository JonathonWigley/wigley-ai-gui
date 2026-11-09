# Spike level — plan

Feature: workflow levels · Implements: none · Ticket: none
Target: branch `spike-level` in three worktrees (Preconditions) · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Add Spike, a fourth workflow level for throwaway prototype work. The skill and the rules are
already written (Docs written ahead). This plan makes the edit gate accept `wigley:spike`, adds the
`workflow-spike` plugin to wigley-ai-gui so a spike session shows badge X and its looping trail,
bumps the marketplace plugin version, and checks the docs against the landed code.

## Architecture

Three repos change. They join on two strings:

- The skill name `wigley:spike`: `workflows.md` names it, the gate's `LEVEL_SKILLS` accepts it, and
  the `workflow-spike` plugin claims it.
- The step words `interview`, `build`, `check`, `land`, `done`: `wigley:spike` § Reporting sends
  them, and the plugin's stages answer them. A word the stages do not answer is ignored in silence,
  so the two lists must match exactly.

```
wigley:spike (marketplace skill)
  │ loads ──────────────► workflow-gate LEVEL_SKILLS (wigley-agents)  → edits pass
  │ loads ──────────────► workflow-spike claims()   (wigley-ai-gui)   → badge X, stage interview
  │ set_workflow_step ──► workflow-spike stages
  │                        interview ⇄ build ⇄ check (any order, per ask) → land → done
```

## Preconditions

Each was verified at plan time. `wigley:make` re-runs each before the first dispatch.

- The three worktrees exist on branch `spike-level`, each holding its docs-ahead commit:
  `git -C ~/Documents/ai-dev/.worktrees/wigley-agents-spike-level log --oneline -1` → `78b501f Docs ahead: Spike…`;
  `git -C ~/Documents/ai-dev/.worktrees/wigley-ai-marketplace-spike-level log --oneline -1` → `607bbc4 Docs ahead: wigley:spike skill…`;
  `git -C ~/Documents/ai-dev/.worktrees/wigley-ai-gui-spike-level log --oneline -4` → the plan's cold-read fix commit, `1784f662 Docs ahead: workflow and layouts design docs…`, `91b9c9b6` (the plan), then `2142aa42 Docs ahead: the workflow-spike plugin…`.
- The GUI worktree links the clone's dependencies:
  `test -L ~/Documents/ai-dev/.worktrees/wigley-ai-gui-spike-level/node_modules` succeeds.
- The marketplace plugin version is `2.1.2` in both manifests:
  `grep '"version"' plugins/wigley/.claude-plugin/plugin.json plugins/wigley/.codex-plugin/plugin.json`.
- No other workflow uses the order `40` or the badge `X`:
  `grep -n "order: \|badge: '" src/plugins/workflow-*/stages/index.ts src/plugins/workflow-large/large-workflow.ts src/plugins/workflow-*/page/start.ts`
  → small 10, medium 20, large 30; badges S, M, L.
- The token `fg-secondary` is defined: `grep -n "'fg-secondary'" src/config/theme-tokens.ts` prints its entry.
- The plan `docs/features/workflow/plan-paused-needs-you/` is open and unlanded, and its task 01 edits Small's and
  Medium's `layout.js`: `test -d docs/features/workflow/plan-paused-needs-you`. Task 02 § Decisions handles the overlap.

## Docs written ahead

- wigley-agents `78b501f`: `workflows.md` (Always Spike, the pick order, moving a spike),
  `decisions.md` (§ Asking spike line, § Reporting › Wrap-up), `AGENTS.md` (wrap-up pointer),
  `tools/workflow-gate/README.md` (level skills list).
- wigley-ai-marketplace `607bbc4`: `plugins/wigley/skills/spike/SKILL.md` (new),
  `skills/wrap-up/SKILL.md`, `skills/feature/SKILL.md` (§ The interview: a spike handed in).
- wigley-ai-gui `2142aa42`: `docs/features/workflow-levels/design.md`, `AGENTS.md` (plugin tree,
  self-test list), `DESIGN.md` (Workflow badge and token).
- wigley-ai-gui `1784f662` (after the cold read): `docs/features/workflow/design.md` (four workflows, § Spike's
  stages, the claim, step-word, order, pane and trail lines), `docs/features/layouts/design.md` (the
  `workflow-spike.layout` row).

## Mandatory Reads

- `~/wigley-agents/WigleyRepos.md` § Landing — every task works in the named worktree.
- wigley-ai-gui `AGENTS.md`: § Architecture (plugins, layers, the layer check), § Review (every
  recommendation taken without a round), § Running and testing (`npm test`, `npm run lint`,
  `npm run typecheck`, filtered `npm run selftest`, the drive run).
- wigley-ai-gui `DESIGN.md` § Workflow (the chip, the trail, the side pane).
- wigley-ai-gui `docs/features/workflow/design.md` (the engine and stages) and
  `docs/features/workflow-levels/design.md`.
- wigley-ai-marketplace `AGENTS.md` § Changing a plugin and § Done.
- `~/wigley-agents/tools/workflow-gate/README.md`.

## Design Overview

- Spike is outside the size order Small › Medium › Large. It is throwaway work with no review.
- The plugin is a copy of `workflow-small` with Spike's own id, skill, stages, badge and token. A
  shared stage factory in the engine is out of scope: the copy is about 400 lines, and no third
  consumer is named.
- Spike's stages loop. Each stage's `enter` answers its own step word at any time, so the trail
  goes `build → check → build` for each ask, and back to `interview` for a round mid-loop. The
  engine already supports this: each stage's rule answers each signal on its own.
- The `done` page stage draws as Land (`stepSlot: 'land'`), the same as Small's.
- Badge `X`, token default `var(--wg-fg-secondary)`: a neutral tone that marks the work as not for
  keeps and clashes with no level's colour.
- Out of scope: the Codex adapter, a run-log screen, a Spike action (Spike has none).

## File Structure

wigley-agents (`.worktrees/wigley-agents-spike-level`):
- modify `tools/workflow-gate/workflow-gate` — `LEVEL_SKILLS`, `DENIAL`.
- modify `tools/workflow-gate/tests/test_workflow_gate.py`.

wigley-ai-marketplace (`.worktrees/wigley-ai-marketplace-spike-level`):
- modify `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json`.

wigley-ai-gui (`.worktrees/wigley-ai-gui-spike-level`):
- create `src/plugins/workflow-spike/` — the plugin (task 02 lists each file).
- modify `src/plugins/main.ts`, `src/plugins/page.ts`, `src/plugins/manifests.ts` — register it.
- modify `src/plugins/manifests.test.ts`, `src/plugins/workflow-levels.test.ts`.
- modify `scripts/check-layers.mts` — the plugin's layer rules.
- modify `src/plugins/workflow/contract.ts` — the `order` comment.

Boundary rule: `workflow-spike` imports only the engine's contract (`../workflow/contract` and its
layouts kit), `chat` and `sessions` contracts for its self-test, and its own files — the same as
`workflow-small`. It never imports from `workflow-small`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Gate accepts wigley:spike](01-gate-accepts-spike.md)
- [x] [workflow-spike plugin](02-workflow-spike-plugin.md)

### Wave 2
- [x] [Doc re-read](04-doc-re-read.md) — after 01, 02

### Wave 3
- [x] [Marketplace version bump](03-marketplace-version-bump.md) — after 04, so the bump is the series' last marketplace commit

### Wave 4
- [x] [Final verification](05-final-verification.md) — after 03

## Run log

Review base: e0a14b8a

### Groups
- 01 · wigley-agents 817afc6 · diff read: LEVEL_SKILLS holds wigley:spike and spike, DENIAL matches the pinned text; unittest 14 OK · concerns: none beyond line numbers drifting; no other level-skill list in the gate
- 02 · wigley-ai-gui f7e76347 · diff read: all five Produces present; typecheck clean; worker ran npm test, lint and filtered selftest (workflow-spike) green · concerns: none
- 04 · none (no doc stale) · every named claim checked true against 817afc6 and f7e76347; check_pointers passes; trees clean · concerns: gui AGENTS.md says build, check and interview re-enter per ask; land and done also answer any time — loose, not false
- 03 · wigley-ai-marketplace 3ea99a0 · diff read: both manifests 2.3.0; check_manifests and --against origin/main pass · concerns: origin/main moved to 2.2.0 mid-run; marketplace branch rebased onto origin/main (8a981dd docs-ahead) before the bump
- 05 · none (no fix needed) · every check passed; drive captures read against DESIGN.md § Workflow: the idle row draws no stage word (per DESIGN.md), Build is paused rather than running because the fake session is idle, and a re-left Check draws plain pending, the same as Land · concerns: none
### Contract changes
- one new version in both manifests: 2.2.0 → 2.3.0 · why: origin/main reached 2.2.0 (f16f7a2) mid-run; the task's rule gives 2.3.0 · consumers: 05 · group 03
### Rulings
- Rebased all three spike-level branches onto main before dispatch (gui e0a14b8a, wigley-agents 103e260, marketplace 40b959f); review bases for the other repos are those SHAs — main had moved, no conflicts · lead
- plan-paused-needs-you landed on main before the run (folder gone after the rebase), so task 02's Open plan overlap step is moot: the copy of Small's layout files carries its change — lead
- Marketplace origin/main is at 2.1.3 (not 2.1.2), so task 03's rule gives 2.2.0 — lead
- Spike entries go first in each LEVEL_SKILLS group, matching the denial order — set order is not behaviour · group 01 · group 01
- Small's table already had check→build and build→review rows, so only build→interview was added · group 02 · group 02
- Self-test full-run why adds one clause naming the build-after-check loop · group 02 · group 02
### Review rounds
### Test gate
- workflow-gate unittest (task 01's change, 14 OK) · marketplace AGENTS.md § Done, all lines (manifest, version, pointers, scripts tests, plugin validate, five script suites — OK) · gui npm test, typecheck, lint (pass) · selftest --plugin workflow-spike,workflow-small,workflow-medium (shared registries changed; exit 0) · drive run 20261109-135611-146a: badge X in fg-secondary, trail Interview › Build › Check › Land, after build-check-build Interview done, Build current, Check and Land pending — pass
