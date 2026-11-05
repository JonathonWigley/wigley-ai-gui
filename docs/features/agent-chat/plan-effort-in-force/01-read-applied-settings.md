# 01 — Read the applied model and effort from `get_settings`

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/main/claude-code/claude-controls.ts` · modify `src/main/claude-code/session-fold.ts` · modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-controls.test.ts` · test `src/main/claude-code/session-fold.test.ts` · test `src/main/claude-code/claude-code-harness.test.ts`
Consumes:  `controlValue(id, reported)` in `claude-controls.ts` · `setControlValue` and `reportedControls` in `session-fold.ts` · `asJson` and `asString` in `json-fields.ts`
Produces:  `export function appliedControlsOf(reply: Json): { model: string; effort: string | null } | null` in `src/main/claude-code/claude-controls.ts`
           `{ kind: 'appliedSettings' }` in `PendingRequest` in `src/main/claude-code/session-fold.ts`
           `{ kind: 'requestAppliedSettings' }` in `FoldEffect` in `src/main/claude-code/session-fold.ts`
           `isSettingsRequestOwed: boolean` in `SessionFoldState` in `src/main/claude-code/session-fold.ts`

Decisions:

- `appliedControlsOf` returns null when the reply has no `applied` object, or when `applied.model` is not a non-empty string. It returns `effort: null` when `applied.effort` is not a non-empty string. A model with no effort support replies `"effort": null`.
- Fold of a reply to a pending `appliedSettings` request, in `answerControlResponse`:
  - An error pushes a `log` effect, `get_settings failed: <error>`. Held values do not change.
  - A null from `appliedControlsOf` pushes a `log` effect, `get_settings reply has no applied model`. Held values do not change.
  - Else set `model` to `controlValue('model', model)` and `effort` to `effort === null ? null : controlValue('effort', effort)` through `setControlValue`. Push one `controls` effect when either value changed.
- `foldRequestLine` handles subtype `get_settings`: set the pending kind and set `isSettingsRequestOwed` to false.
- The `isKeptOut` argument that `createSessionFoldState` passes to `createStreamDecoder` is true for kinds `contextUsage` and `appliedSettings`, so a reply draws no chat entry. `stream-decoder.ts` does not change.
- `appliedControlsOf` does not check the value against the control's choices. A raw value is held and shown raw. `controlValue('effort', …)` returns it unchanged.
- In `foldControlValues`, a successful `/effort` or `/model` command with a known value pushes a `controls` effect even when the value did not change. `confirmPicks` runs only on that event, so a pick of the shown default stays unconfirmed without it.
- Update the comments this change makes false: the `get_context_usage` comment in `createSessionFoldState`, the comment on `requestContextUsage`, and the comment on `open`. Comment `isSettingsRequestOwed` as `isContextRequestOwed` is commented.
- `isSettingsRequestOwed` starts true. The block for `decoded.turnEnded` in `session-fold.ts` sets it to true and pushes `requestAppliedSettings` after `requestContextUsage`.
- In `claude-code-harness.ts`:
  - Add `requestAppliedSettings` beside `requestContextUsage`: one `control_request`, `request_id` from `nextRequestId()`, `request: { subtype: 'get_settings' }`.
  - `open` calls it after `requestContextUsage`.
  - `answerOwed` calls it when `state.isSettingsRequestOwed` is true.
  - `runEffect` handles the effect with the same `!isEndCalled && !hasClosed` check as `requestContextUsage`.
  - `reportEffect` adds the kind to its no-op cases, beside `requestContextUsage`.
- The existing branch in `foldControlValues` that sets a control from a command's value stays. `confirmPicks` reads its report. A `/effort auto` sets null there, and the reply that follows sets the applied value.
- Replies are not ordered against a queued command. The next turn end's request corrects any stale value, so no ordering code is added.

GIVEN a process start WHEN the session opens THEN the adapter writes `get_settings` after `get_context_usage`
GIVEN a reply with `applied` `{ model: 'claude-opus-5-5', effort: 'medium' }` WHEN it folds THEN a `controls` effect holds model `opus` and effort `medium`, and no chat entry appears
GIVEN a held effort `high` and a reply with `effort: null` WHEN it folds THEN the effort is null
GIVEN held values equal to the reply WHEN it folds THEN no `controls` effect appears
GIVEN an error reply WHEN it folds THEN held values stay and a `log` effect appears
GIVEN any turn end, a local command's included WHEN it folds THEN `isSettingsRequestOwed` is true and a `requestAppliedSettings` effect appears
GIVEN a pipe log holding a `get_settings` line and its reply WHEN it replays THEN the controls hold the reply's values, `isSettingsRequestOwed` is false, and attach writes no `get_settings`
GIVEN a pipe log with no `get_settings` line WHEN the process attaches THEN attach writes one `get_settings`
GIVEN a session with no pick WHEN a reply reports effort `medium` and the process restarts THEN the start does not pass `--effort`
GIVEN a reply with effort `ultra` WHEN it folds THEN the held effort is `ultra`
GIVEN a held effort `medium` WHEN `/effort medium` succeeds THEN a `controls` effect appears

Tests:

- `claude-controls.test.ts`: a table test for `appliedControlsOf`. Rows: model and effort; `effort: null`; `effort` missing; effort `ultra`; no `applied`; `applied.model` empty.
- `session-fold.test.ts`: a table test for the reply's fold. Rows are the reply GIVENs above, with the asserted `controls` values and effect kinds. The fixture nests the values as the CLI does: `{"type":"control_response","response":{"subtype":"success","request_id":"wigley-2","response":{"effective":{},"sources":[],"applied":{"model":"claude-opus-5-5","effort":"medium"}}}}`. The row for the first GIVEN asserts that the effects hold no `entry`. Add the turn-end row to the test at the `isContextRequestOwed` assertions. Add `isSettingsRequestOwed` to the state snapshot helper that lists `isContextRequestOwed`. Add the same-value command row to the test that owns `foldControlValues`.
- `claude-code-harness.test.ts`: one test for the writes at start. One test for attach with both log shapes, as rows. The fake pipe's request ids in existing tests shift by each new write: update them. Keep `get_context_usage` at `wigley-1`. Update `attach_OwedWhileDetached_WritesEachOnce`: its exact `written` lists gain the owed `get_settings`. Update `attach_RecordedLiveSession_EqualsTheLiveRun`: the live run gains a `get_settings` reply line, so the replay's controls equal the live run's.
- `src/plugins/chat/main/chat-sessions.test.ts`: read for a test that a reported value is not passed at a later start. If none exists, add one there. Its break: a report added to `userSetControls`.

Done when: `npm run lint` passes, and the test gate runs the tests above.
Commit: one commit for the group.

## Proof

