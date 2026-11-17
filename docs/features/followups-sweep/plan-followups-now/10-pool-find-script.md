# 10 — The pool runner survives a failed stat

Status: done
Type: Task
Rung: standard · wraps one call in the try/catch shape `runPoolCommand` already uses, answering `cli-failed`
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md`, "`findScript` lets a failed `stat` reject the pool runner".

Files:
- modify `src/plugins/unity-pool/main/pool-cli.ts`
- test `src/plugins/unity-pool/main/pool-cli.test.ts`

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| `findScript` awaits `stat` outside a try | `sed -n 121,131p src/plugins/unity-pool/main/pool-cli.ts` | `if ((await deps.files.stat(script)) === null)` with no `try` |
| `runPoolCommand` returns `findScript`'s failure as is | `grep -n 'const script = await findScript(deps);' src/plugins/unity-pool/main/pool-cli.ts` | one line (≈104) |

Lane P task 04 later rewrites this file's `pythonCommand` use; this edit stays inside `findScript`.

Consumes: `errorText` (already imported), `CliFailure` (tree).

Produces: nothing new; `findScript` keeps its signature.

Decisions:
- `findScript` wraps the `stat` in a try; a rejection answers
  `{ ok: false, error: 'cli-failed', message: \`unity-pool could not be checked at ${script}: ${errorText(error)}\` }`.
  A `null` stat still answers `no-cli` as now. The panel's `run` handler then logs and rescans as for any failure.

GIVEN a `stat` that rejects with `permission denied`
WHEN `runPoolCommand` runs `hold`
THEN it resolves `{ ok: false, error: 'cli-failed', message: 'unity-pool could not be checked at /s/unity-pool: permission denied' }` and runs no process

Tests: `pool-cli.test.ts`, `runPoolCommand_StatRejects_CliFailed`: `deps(['/s/unity-pool'], '/s/unity-pool')` with
`files.stat` replaced by one rejecting `new Error('permission denied')` → the result above, and `processes.runs` equals
`[]`.

Done when: compiles; `npm test` runs `pool-cli.test.ts` and it passes.

Commit: one commit, "unity-pool: a failed stat of the CLI answers cli-failed (findScript follow-up)".

## Proof

Commit 5af596fd4 · proof: diff read against Produces; wave 1 typecheck clean · concerns: none
