# 11 — Control roles

Status: in progress
Type: Task
Wave: 8 · Depends on: 10
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/chat/page/control-commands.ts` · test `src/plugins/chat/page/control-commands.test.ts`
- modify `src/plugins/chat/page/composer-input.ts` · test `src/plugins/chat/page/composer-input.test.ts`
- modify `src/plugins/chat/page/composer-kit.ts` · test `src/plugins/chat/page/composer-kit.test.ts`
- modify `src/plugins/chat/page/chat-commands.ts` · test `src/plugins/chat/page/chat-commands.test.ts`
- modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
- modify `src/plugins/chat/layouts/layout.d.ts` · test `src/plugins/chat/layouts/default/layout.test.ts` (fixture
  inputs gain `role`)
- test `src/plugins/chat/page/session-part.test.ts` (its `control(id, value)` helper gains `role: null`)
- modify `src/plugins/chat/main/preview/preview-session.ts`
- modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md`

Consumes:
- `SessionControl.role?: string` in `src/contracts/agent.ts` ← 04
- `CONTROL_ROLES = { model: 'model', permissionMode: 'permissionMode', effort: 'effort' } as const` in
  `src/contracts/agent.ts` ← 04
- The Claude adapter's controls carry roles (`mode` → `permissionMode`, `effort` → `effort`, `model` → `model`) in
  `src/plugins/claude-code/main/claude-controls.ts` ← 04
- `AgentStart.controls: Readonly<Record<string, string>>`, keyed by control id (tree today)

Produces:
- `export const ROLE_COMMANDS` in `src/plugins/chat/page/control-commands.ts`
- `export function controlCommand(role: string | null): ChatCommandName` in `src/plugins/chat/page/control-commands.ts`
- `export function chipKeyCommands(controls: readonly { role: string | null }[]): (ChatCommandName | null)[]` in
  `src/plugins/chat/page/composer-input.ts`
- `role: string | null;` on `ComposerControlInput` in `src/plugins/chat/layouts/layout.d.ts`

Decisions:
- A control's role is an optional open string. The pick keys bind only `model`, `permissionMode` and `effort`. A
  control with any other role, or no role, is reachable through `pickControl` (`c`). Source: plan.md Decisions.
- The pick commands keep their names (`pickMode`, `pickEffort`, `pickModel`, `pickControl`) in
  `src/plugins/chat/manifest.ts` and their keys in `src/plugins/keymap.ts`. Neither file changes. Source: dispatch,
  AGENTS.md § A session control.
- `CONTROL_IDS` goes. `ROLE_COMMANDS` replaces it: `{ pickMode: CONTROL_ROLES.permissionMode, pickEffort:
  CONTROL_ROLES.effort, pickModel: CONTROL_ROLES.model } as const`. (drafter: same shape as `CONTROL_IDS`.)
- Control ids stay the adapter's own keys. `setControl(sessionId, controlId, value)`, `AgentStart.controls`,
  `pendingPicks` and `confirmedPicks` stay keyed by id. Only the lookups that find a control for a key change to
  role. Source: plan.md File Structure (`AgentStart.controls` unchanged), AGENTS.md § A session control.
- `ComposerControlInput.role` is `string | null`: null for a control with no role. A layout input uses null, not an
  optional field, for an absent value (`branch: string | null` beside it). (drafter.) The change is additive: a user
  layout that reads only `id`, `label`, `value` and `enabled` keeps working. Source: dispatch.
- When two controls declare one role, the first in declared order gets the role's key. That is the rule
  `chipKeyCommands` and `Array.find` already keep for ids. (drafter.)
- The held mode that `controlValuesOf` passes at each start is the value of the control whose role is
  `CONTROL_ROLES.permissionMode`, stored under that control's id. `MODE_CONTROL_ID` goes. Source: dispatch.
- The fake's controls already carry the roles from task 04 (`mode` → `permissionMode`, `effort` → `effort`, `model`
  → `model`; `verbosity` none), and their ids do not change. This task does not edit `src/shared/fake-agent-harness.ts`;
  it verifies: `grep -n 'role' src/shared/fake-agent-harness.ts` shows those three roles and none on `verbosity`. If
  it does not, task 04 is incomplete: stop and report it to the lead.
- The preview's controls (`previewControls` in `preview-session.ts`) gain the same roles; `verbosity` gets none.
  (drafter.)

Mandatory: AGENTS.md § A session control, § An agent harness, § A chat layout;
`docs/features/agent-harnesses/design.md`; `docs/features/layouts/design.md` § What a layout draws.

GIVEN a control with role `effort` and id `reasoning` WHEN `controlCommand('effort')` runs THEN it returns
`pickEffort`.
GIVEN a control with no role WHEN `controlCommand(null)` runs THEN it returns `pickControl`.
GIVEN a running session whose controls hold one with role `permissionMode` and id `approval` WHEN `pickMode` runs
THEN the picker opens that control, and a pick invokes `setControl` with id `approval`.
GIVEN a running session with no control of role `model` WHEN `pickModel` runs THEN the log reads
`<session name> has no model control` and no picker opens.
GIVEN controls whose model-role control has id `llm` and effort-role control has id `depth` WHEN `composerInputOf`
runs THEN `modelEffort` pairs those two and `controls` holds the rest in order.
GIVEN a session whose permission-mode control has id `approval` and value `plan` WHEN the process restarts THEN the
start's `controls` holds `{ approval: 'plan' }`.
GIVEN a control chip with role `effort` WHEN the status line draws THEN the chip runs `pickEffort` and holds its keys.

Tests:
- `control-commands.test.ts`: replace both tests with one table test `controlCommand_Role_ItsPickCommand` whose rows
  are `'permissionMode'` → `pickMode`, `'effort'` → `pickEffort`, `'model'` → `pickModel`, `'sandbox'` →
  `pickControl`, `null` → `pickControl`.
- `composer-input.test.ts`: `control(id, label)` gains a third argument `role: string | null`, written to
  `SessionControl.role` (left out when null), and `chipOf` copies `role` as `role ?? null`. `MODE`, `EFFORT`, `MODEL`
  take roles `permissionMode`, `effort`, `model`; `VERBOSITY` takes null. Add one row to the `composerInputOf` table:
  given controls `control('llm', 'Model', 'model')`, `control('depth', 'Effort', 'effort')`, `VERBOSITY`, it expects
  `modelEffort` `{ model: chipOf(llm), effort: chipOf(depth) }` and `controls` `[chipOf(VERBOSITY)]`. Rewrite
  `chipKeyCommands_Controls_KeysOnFirstChipPerCommand` over roles: input
  `[{ role: 'permissionMode' }, { role: 'sandbox' }, { role: 'effort' }, { role: null }]`, expected
  `['pickMode', 'pickControl', 'pickEffort', null]`.
- `chat-commands.test.ts`: the `mode` fixture gains `role: 'permissionMode'`. Add
  `pickMode_ControlFoundByRole_SetsTheControlById`: a running session whose only control is the `mode` fixture with id
  `approval`; `pickMode`, then pick choice 1; expect `run.invoked` `[['setControl', 'row-1', 'approval', 'plan']]`.
  Add a table test `pickControlKey_NoControlOfTheRole_LogsAndOpensNothing`, one row per command, each expecting
  `run.opened` `[]` and the log line below, the name as the file's `session()` helper sets it: row `pickModel` on a
  running session holding only the `mode` fixture → `<session name> has no model control`; row `pickMode` on a running
  session holding only a control `{ id: 'llm', role: 'model', … }` built like the `mode` fixture → `<session name> has
  no permissionMode control`.
- `composer-kit.test.ts`: every `ComposerControlInput` fixture gains `role` (`'permissionMode'` on the `mode` ones,
  `'effort'` on the `effort` ones, `'model'` on the model ones). At plan time they are the literals near lines 104,
  400, 408, 522 and 540 (the `effort` object in the `enabled: false` row). Existing chip-key assertions stay as they
  are.
- `layout.test.ts`: the `ComposerControlInput` fixtures near lines 1370 (`model`) and 1385 (`mode`) (measured at plan
  time, re-verify) gain `role` the same way.
- `session-part.test.ts`: the `control(id, value)` helper near line 22 returns `{ id, label: id, value, enabled: true,
  role: null }`.
- The list of every `ComposerControlInput` literal (measured at plan time by `grep -rn "enabled: \(true\|false\)"
  src/plugins/chat src/shared --include='*.ts'`): `composer-kit.test.ts`, `layout.test.ts` and `session-part.test.ts`
  above, and `composer-input.test.ts`, whose `chipOf` copies `role` (above). `src/shared/fake-agent-harness.ts:401`
  is the usage fixture's `extraUsage: { enabled: true, … }`, not a control: the fake's `SessionControl` literals (`startingControls`) carry no `enabled`. `npm run typecheck` fails on any literal left without
  `role`.
- `chat-sessions.test.ts` › `restart_StartCarriesHeldModeAndConfirmedPicks`: the reported controls gain a role from a
  table `REPORTED_ROLES = { mode: 'permissionMode', approval: 'permissionMode', model: 'model', effort: 'effort' }`
  (`role: REPORTED_ROLES[id]`). Add a row `ModeHeldByRoleNotId`: no picks, confirms, no clear, reported
  `{ approval: 'plan', model: 'opus', effort: 'high' }`, expected controls `{ approval: 'plan' }`.
- Self-test: the existing chat group "session controls" (`src/plugins/chat/main/selftest-script.ts`) already presses
  the pick keys on the fake's session. With the fake's roles they pass only through the role lookup, so no new step
  is added. Run `npm run selftest -- --plugin chat`; the 8 minimum-width failures listed in
  `docs/features/followups.md` § Bugs seen in use ("Chat self-test fails the minimum-width fit") predate this lane.

Approach:
- `controlCommand(role)` returns the `ROLE_COMMANDS` key whose value equals `role`, else `'pickControl'`.
- `chat-commands.ts`: `pickControlOf(role: string)` finds `session.state.controls.find((held) => held.role === role)`.
  The missing-control log reads `` `${session.name} has no ${role} control` ``. `pickMode`, `pickEffort` and
  `pickModel` pass `ROLE_COMMANDS.pickMode`, `ROLE_COMMANDS.pickEffort` and `ROLE_COMMANDS.pickModel`. The
  `setControl` invoke keeps `control.id`.
- `composer-input.ts`: `composerInputOf` maps `role: control.role ?? null` into each `ComposerControlInput`.
  `pairModelAndEffort` finds by `controlCommand(control.role)`. `chipKeyCommands` reads `control.role`.
- `composer-kit.ts` `controlChip`: `controlCommand(control.role)`. The index lookup by `held.id === control.id` stays.
- `chat-sessions.ts` `controlValuesOf` (lines 574–585): the held mode is the control whose role is
  `CONTROL_ROLES.permissionMode`, stored under that control's id. The function's test becomes `control.role ===
  CONTROL_ROLES.permissionMode ? control.value : confirmedPicks.get(control.id)`; `MODE_CONTROL_ID` and the comment
  over it (`A held mode narrows nothing…`) move onto the function's own comment, naming the role in place of the id.
  Every other control keeps its confirmed pick, keyed by its id.
- `layout.d.ts`: the `ComposerControlInput` comment adds that `role` is the control's role (`model`,
  `permissionMode`, `effort` or another the harness declares), null when it declares none.

Done when: `npm run lint` and `npm run typecheck` pass; `grep -rn 'CONTROL_IDS\|MODE_CONTROL_ID' src` prints
nothing; the test gate runs the test files above and `npm run selftest -- --plugin chat`.

Commit: one commit. It removes the "Control roles" item from `docs/features/followups.md` § Harness seams and ticks
`[ ] Control roles` to `[x] Control roles` in `docs/features/intent-alignment/master-plan.md` (the chat-pass line,
line 133 at plan time).

## Proof
