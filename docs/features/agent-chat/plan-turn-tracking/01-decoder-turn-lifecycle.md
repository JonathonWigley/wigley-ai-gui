# 01 — Decoder reads turn lifecycle

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/main/claude-code/stream-decoder.ts` · test `src/main/claude-code/stream-decoder.test.ts`
Consumes:  nothing
Produces:  in `src/main/claude-code/stream-decoder.ts`, five new `DecodedLine` fields, exactly as `plan.md` § File
           Structure writes them:
           `turnStarted: boolean` · `capabilities: string[] | null` · `lifecycle: { uuid: string; state: string } | null` ·
           `turnOpener: string | null` · `turnMessages: string[]`
           a `command_lifecycle` entry in `DECODERS`
Decisions: the five fields (design review, Decided) · `command_lifecycle` lines join the turn's gathered events entry,
           not a raw entry each (Decided)

## Changes

- `DecodedLine`: add the five fields. Extend the interface's doc comment with one clause each, in the style of the
  existing comment. `emptyLine()` sets `turnStarted: false`, `capabilities: null`, `lifecycle: null`,
  `turnOpener: null`, `turnMessages: []`.
- `decodeSystem`, init branch: set `out.turnStarted = true` and `out.capabilities` to the string items of
  `event.capabilities` (`asArray`, keep items whose `typeof` is `string`). An init without `capabilities` gives `[]`.
- `decodeResult`: set `out.turnOpener` to `event.user_message_uuid` when it is a string, else null; set
  `out.turnMessages` to the string items of `event.user_message_uuids`.
- New `decodeLifecycle(event, out)` registered as `command_lifecycle` in `DECODERS`: set
  `out.lifecycle = { uuid: asString(event.command_uuid), state: asString(event.state) }` and push `gathered(event)`.
  A line whose `command_uuid` is empty sets no `lifecycle` and still gathers.

The measured shapes are in `docs/features/agent-chat/claude-stream.md` § Message lifecycle. Example lines:

```json
{"type":"command_lifecycle","command_uuid":"eeeeeeee-0000-4000-8000-000000000002","state":"started","uuid":"8b44…","session_id":"3245…"}
{"type":"result","subtype":"success","local_command":"effort","user_message_uuid":"eeeeeeee-0000-4000-8000-000000000002","user_message_uuids":["eeeeeeee-0000-4000-8000-000000000002"]}
```

GIVEN a `system/init` with `capabilities: ["msg_lifecycle_v1", "x"]` WHEN decoded THEN `turnStarted` is true and
`capabilities` is `["msg_lifecycle_v1", "x"]`
GIVEN an init without `capabilities` WHEN decoded THEN `capabilities` is `[]`
GIVEN any line that is no init WHEN decoded THEN `turnStarted` is false and `capabilities` is null
GIVEN a `command_lifecycle` line with no `command_uuid` WHEN decoded THEN `lifecycle` is null and the line still
joins the turn's events entry
GIVEN a `command_lifecycle` line WHEN decoded THEN `lifecycle` holds its `command_uuid` and `state`, and the line joins
the turn's events entry (same entry id as the turn's init)
GIVEN a result with `user_message_uuid` `"a"` and `user_message_uuids` `["a","b"]` WHEN decoded THEN `turnOpener` is
`"a"` and `turnMessages` is `["a","b"]`
GIVEN a result without the two keys WHEN decoded THEN `turnOpener` is null and `turnMessages` is `[]`

Tests:
- `decode_Init_ReportsCommandsAndControls` — add assertions `turnStarted` true and `capabilities` equal to the
  capabilities the test's init carries: add `capabilities: ['msg_lifecycle_v1', 7, 'x']` to its init and expect
  `['msg_lifecycle_v1', 'x']`.
- `decode_InitWithoutCapabilities_ReportsEmptyCapabilities` — new; `capabilities` is `[]`, `turnStarted` true.
- `decode_ResultOrigin_MarksTurnsClaudeRanOnItsOwn` (the `it.each` at the `turnUnrequested` assertion) — leave as is.
- `decode_ResultMessageUuids_ReportsOpenerAndMessages` — new `it.each`, rows: both keys present (`"a"`, `["a","b"]`);
  both keys absent (null, `[]`); `user_message_uuid` a number (null).
- `decode_CommandLifecycle_ReportsStateAndGathers` — new `it.each`; each row decodes an init, then a lifecycle
  line, and asserts `turnStarted` false, `capabilities` null, and that the entry is the init's events entry (same id,
  `raw` holds both lines). Rows: `command_uuid` `'u-1'`, `state` `'started'` → `lifecycle` `{ uuid: 'u-1', state:
  'started' }`; no `command_uuid` → `lifecycle` null.

Done when: `npm run typecheck` passes; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit 38ee7cc9 · proof: diff read: five DecodedLine fields and command_lifecycle in DECODERS present; typecheck passes · concerns: none
