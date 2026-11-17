# 07 — Config applied is logged only on a change

Status: not started
Type: Task
Rung: standard · one guard on an existing log line with `isSameJson`, as `applyKeys` in the same file compares
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md`, "Each page start logs `[config] applied a new config` again".

Files:
- modify `src/renderer/config-push.ts`
- test `src/renderer/config-push.test.ts`

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| The line logs on every push | `grep -n "log('config', 'applied a new config')" src/renderer/config-push.ts` | one line (≈111), unguarded |
| A part start re-applies the last push | `grep -n 'reapplyPush: () => applyLivePush(lastPush)' src/renderer/renderer.ts` | one line |
| `isSameJson` is already imported | `grep -n "import { isSameJson }" src/renderer/config-push.ts` | one line |
| Self-test steps wait on the line only after a real change | `grep -rln "applied a new config" src --include='*.ts' \| grep -v config-push` | the settings, forms and chat self-test scripts and `src/main/selftest-user-plugin.ts` |

Consumes: `isSameJson` in `src/shared/json.ts` (tree).

Produces: nothing new; `createConfigPush`'s pushed function keeps its signature.

Decisions:
- **Compare what was installed.** After `live.replace(config)`, the function logs `applied a new config` only when
  `!isSameJson(config, previous)`, `previous` being `live.current()` read before the replace, as now. A re-apply after a
  part start that brings no new bind, a restart's re-apply, and a push equal to the last leave no line; a push or
  re-apply that changes the installed config logs as before.
- **Self-test steps keep waiting on it.** Each step that expects the line follows a settings, keymap, project or
  manifest write that changes the installed config, so the line still comes. The final verification task runs them.
- **The function's comment** gains "and logs `applied a new config` when the installed config differs from the last".

GIVEN a push that changes the installed config
WHEN it applies
THEN the log holds `[config] applied a new config` once

GIVEN the same config pushed again
WHEN it applies
THEN no new `applied a new config` line is logged

Tests: `config-push.test.ts` — `fakeTargets` records each `log(source, message)` as `${source} ${message}` in a
returned `logged: string[]`; `push_SameConfigAgain_LogsAppliedOnlyOnChange`: `start(config('known'))`,
`push(config('other'))`, `push(config('other'))`, `push(config('known'))` → `logged.filter((line) =>
line === 'config applied a new config')` has length 2.

Done when: compiles; `npm test` runs `config-push.test.ts` and it passes.

Commit: one commit, "config push: log applied only when the installed config changed (repeated config log follow-up)".

## Proof
