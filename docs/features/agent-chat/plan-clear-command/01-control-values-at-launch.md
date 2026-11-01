# 01 — Control values at launch

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/claude-launch.ts` · modify `src/main/claude-code/claude-code-harness.ts` · modify `src/shared/fake-agent-harness.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · test `src/main/claude-code/claude-launch.test.ts` · test `src/main/claude-code/claude-code-harness.test.ts` · test `src/shared/fake-agent-harness.test.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  `SessionControl.value` (`src/contracts/agent.ts`, in the tree) · `ChatSessionState.controls` (in the tree)
Produces:  `controls: Readonly<Record<string, string>>` on `export interface AgentStart` in `src/contracts/agent.ts`
Decisions: carry values as launch settings on every start (round 2) · harness-neutral `id → value` map, each adapter maps it (design review)

- `AgentStart.controls`: the row's control values, one key per control whose `value` is not null. Its comment
  says so, and that an adapter starts with each value it knows and ignores an id it does not declare.
- `claudeLaunch`: `controls.model` → `--model <value>`, `controls.effort` → `--effort <value>`, `controls.mode` →
  `--permission-mode <value>`; with no `mode` key the launch keeps `--permission-mode auto`, in its current slot.
  `--model` and `--effort` are appended after `--permission-prompt-tool <tool>`, so the session flag stays at
  `args.slice(7, 9)` (`claudeLaunch_Resume_ResumeFlagAndInheritedConfigDir`). Values pass through unchanged (the
  control values are Claude's CLI values, `manual` included). Unknown ids are ignored. Update the function's
  comment, which today says "auto permission mode".
- `claude-code-harness.ts` `startClaudeProcess`: each declared control starts at `request.controls[id] ?? null`
  instead of `null`, so the `controls` event it emits at once carries the launch values and the chips show them
  before the first turn (a later report from Claude still wins). The fake harness does the same: a value in
  `request.controls` replaces that control's fixed starting value in `startingControls()`.
- `chat-sessions.ts` `startProcess`: passes `controls` built from `session.state.controls` (non-null values only).
  Every caller of `startProcess` gets it through that one place. Every `AgentStart` literal in tests gains
  `controls: {}` or the values the test needs (`claude-code-harness.test.ts:18`, `fake-agent-harness.test.ts`
  `:24`, `:483`, `:521-539`, measured at plan time, re-verify).

GIVEN controls `{ model: 'sonnet', effort: 'high', mode: 'plan' }` WHEN `claudeLaunch` runs THEN args hold `--model sonnet`, `--effort high`, `--permission-mode plan` and no `--permission-mode auto`
GIVEN controls `{}` WHEN `claudeLaunch` runs THEN args hold `--permission-mode auto` and no `--model` or `--effort`
GIVEN a row whose process reported model `sonnet` and then exited WHEN the next message starts its process THEN the harness's start request carries `controls.model === 'sonnet'` and `resume: true`

Tests:     `claudeLaunch_Controls_BecomeLaunchFlags` — `it.each` table: all three keys; empty; mode only (`manual`); an unknown id ignored. Each row asserts the flag pairs present and absent.
           `start_RequestControls_SeedStartingValues` in `claude-code-harness.test.ts` — the first `controls` event holds `model: 'sonnet'` for a start with `controls: { model: 'sonnet' }`, and `null` for the controls it did not name.
           A row in the fake harness's starting-controls test (or a new `start_RequestControls_ReplaceStartingValues` there if none owns that rule) for the same rule.
           `resume_AfterExit_StartCarriesHeldControlValues` in `chat-sessions.test.ts` — the fake harness's second process record's `request.controls` holds the reported values; a control with `value: null` has no key.
Done when: compiles; the test gate runs the tests above plus every edited case that builds an `AgentStart`.
Commit:    one commit for the group

## Proof

