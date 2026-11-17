# 06 — A failing worktree list is logged

Status: done
Type: Task
Rung: standard · adds an optional callback to `PlanCopyDeps` and logs it the way `plan-watch.ts`'s `logFailure` logs
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md`, "A failing worktree list goes unreported".

Files:
- modify `src/shared/plan-copies.ts`
- test `src/shared/plan-copies.test.ts`
- modify `src/plugins/workflow-large/main/plan-watch.ts`
- test `src/plugins/workflow-large/main/plan-watch.test.ts`

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| A rejected `git.worktrees` falls back silently | `sed -n 86,91p src/shared/plan-copies.ts` | `try { trees = await deps.git.worktrees(top); } catch { return copyAtPlanDir(…) }` |
| `PlanCopyDeps` has no log | `grep -n 'log' src/shared/plan-copies.ts` | no output |
| `plan-watch.ts` is the only production builder of the deps | `grep -rn 'PlanCopyDeps = ' src --include='*.ts' \| grep -v test` | one line, `plan-watch.ts` (≈110) |

Consumes: `PluginLog` (`log`) and `errorText` already in `plan-watch.ts` (tree).

Produces: `PlanCopyDeps.worktreesFailed?: (top: string, error: unknown) => void` in `src/shared/plan-copies.ts`.

Decisions:
- **The shared function reports; the caller logs once.** `planCopies` has no state across calls, so its `catch`
  binds the error, calls `deps.worktreesFailed?.(top, error)`, then falls back to `copyAtPlanDir` as now.
  `createPlanWatch` builds `copyDeps` once for its life, with a `worktreesFailed` that logs only the first failure per
  clone top, kept in a `Set<string>` beside `copyDeps`. Pinned log text:
  `git worktree list failed in <top>: <errorText(error)>; reading the plan's own copy only`.
- **Once per clone for the watch's life.** A list that recovers and fails again logs nothing more; the first line
  already names the cause.
- **Optional.** Tests and any other caller that passes no callback see today's behaviour.

GIVEN a clone whose `git worktree list` rejects
WHEN `planCopies` lists a plan's copies
THEN `worktreesFailed` receives the clone top and the error, and the result is the plan's own copy, as now

GIVEN a plan watch over that clone
WHEN the copies are listed twice (a `follow`, then a `check`)
THEN the watch's log holds the failure line once

Tests:
- `plan-copies.test.ts`: the existing `planCopies_WorktreesRejects_ReturnsTheNamedCopy` passes a recording
  `worktreesFailed` in its deps and also expects one call, `['/w1', <the rejected error>]` (the top of `/w1/<PLAN>`
  under `setUp`'s git)
- `plan-watch.test.ts`: `follow_WorktreesRejects_LogsOncePerClone` — `cloneGit(['/r'])` with `worktrees` replaced by
  one that rejects `new Error('git worktree exited 128')`, a plan at `/r/docs/features/f/plan-a`; `follow`, settle,
  `check`, settle → `logs.filter((line) => line.startsWith('git worktree list failed'))` equals
  `["git worktree list failed in /r: git worktree exited 128; reading the plan's own copy only"]`

Done when: compiles; `npm test` runs both tests and they pass.

Commit: one commit, "plan copies: log a failing worktree list once per clone (failing worktree list follow-up)".

## Proof

Commit 3a036f014 · proof: diff read against Produces; wave 1 typecheck clean; diff read sent back once for a non-sentence test title and a comment wrap · concerns: none
