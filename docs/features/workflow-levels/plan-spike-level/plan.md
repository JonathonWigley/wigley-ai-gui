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
  `git -C ~/Documents/ai-dev/.worktrees/wigley-ai-gui-spike-level log --oneline -2` → the plan commit, then `2142aa42 Docs ahead: the workflow-spike plugin…`.
- The GUI worktree links the clone's dependencies:
  `test -L ~/Documents/ai-dev/.worktrees/wigley-ai-gui-spike-level/node_modules` succeeds.
- The marketplace plugin version is `2.1.2` in both manifests:
  `grep '"version"' plugins/wigley/.claude-plugin/plugin.json plugins/wigley/.codex-plugin/plugin.json`.
- No other workflow uses the order `40` or the badge `X`:
  `grep -n "order: \|badge: '" src/plugins/workflow-*/stages/index.ts src/plugins/workflow-large/large-workflow.ts src/plugins/workflow-*/page/start.ts`
  → small 10, medium 20, large 30; badges S, M, L.
- The token `--wg-fg-secondary` exists: `grep -rl -- '--wg-fg-secondary' src/renderer/shell/shell.css`.

## Docs written ahead

- wigley-agents `78b501f`: `workflows.md` (Always Spike, the pick order, moving a spike),
  `decisions.md` (§ Asking spike line, § Reporting › Wrap-up), `AGENTS.md` (wrap-up pointer),
  `tools/workflow-gate/README.md` (level skills list).
- wigley-ai-marketplace `607bbc4`: `plugins/wigley/skills/spike/SKILL.md` (new),
  `skills/wrap-up/SKILL.md`, `skills/feature/SKILL.md` (§ The interview: a spike handed in).
- wigley-ai-gui `2142aa42`: `docs/features/workflow-levels/design.md`, `AGENTS.md` (plugin tree,
  self-test list), `DESIGN.md` (Workflow badge and token).

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
- [ ] [Gate accepts wigley:spike](01-gate-accepts-spike.md)
- [ ] [workflow-spike plugin](02-workflow-spike-plugin.md)
- [ ] [Marketplace version bump](03-marketplace-version-bump.md)

### Wave 2
- [ ] [Doc re-read](04-doc-re-read.md) — after 01, 02, 03

### Wave 3
- [ ] [Final verification](05-final-verification.md) — after 04

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
