# 19 — Claude adapter: interrupt and hand-back

Status: in progress
Type: Batch
Rung: deep · two stream-protocol edge cases in the adapter's pure state machines; each fix moves when a working state or an events entry opens, against measured CLI line orders
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-ups:
- **Interrupt in the gap before a message's init** (`followups.md` L104).
- **A hand-back's join counts one step short** (`followups.md` L644).

Files:
- A (interrupt): modify `src/plugins/claude-code/main/turn-tracker.ts` · test
  `src/plugins/claude-code/main/turn-tracker.test.ts` · modify `docs/features/agent-chat/claude-stream.md` (§ Interrupt,
  the "Idle process" paragraph's last sentence)
- B (hand-back): modify `src/plugins/claude-code/main/stream-decoder.ts` · test
  `src/plugins/claude-code/main/stream-decoder.test.ts`

Mandatory reads beyond plan.md: `docs/features/agent-chat/claude-stream.md` § Message lifecycle (the frame order of a
message with its own turn, and of a local slash command) and § Subagents (the hand-back result and the empty turn
after it).

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main` from the `wigley-ai-gui/` folder):
- `grep -n -A4 "    interruptAnswered() {" src/plugins/claude-code/main/turn-tracker.ts` → `if (!turnOpen) {
  open.clear(); }`: every open uuid closes, a `started` one included.
- `grep -n "still holds between an interrupted" src/plugins/claude-code/main/turn-tracker.ts` → one line, in the
  header comment, which states today's clear.
- `grep -n "closes every open message when no turn is open" docs/features/agent-chat/claude-stream.md` → one line.
- `grep -n "gathered(event, event.subtype === 'init' && !isAfterHandback)" src/plugins/claude-code/main/stream-decoder.ts`
  → one line, in `decodeSystem`: the init after a hand-back joins the hand-back turn's events entry whatever the turn
  holds.
- `grep -n "'decode_EmptyResultAfterHandback_DrawsNoDivider (\$given)'" src/plugins/claude-code/main/stream-decoder.test.ts`
  → one line; its second row expects `['turn-events-1', 'result-2']`.

Consumes: `DecodedLine.lifecycle` (`stream-decoder.ts`), `TurnLine`, `TERMINAL_STATES` — in the tree.

Produces: no new export. `TurnTracker`'s interface is unchanged.

Decisions (A):
- **A uuid taken into a turn survives the interrupt reply.** The tracker keeps `const takenIn = new Set<string>()`: a
  `lifecycle` line with state `started` adds its uuid when `open` holds it; every path that deletes a uuid from `open`
  (a terminal state, `endTurn`'s opener and `turnMessages`, the fallback `open.clear()`, `abandon`) deletes it from
  `takenIn` too, through one local `close(uuid)` and a `closeAll()`. `interruptAnswered`, with no turn open, closes
  every open uuid not in `takenIn`; one in `takenIn` stays open until its own init, result or terminal state. A
  `started` frame proves lifecycle mode, so the rule needs no `mode` check.
- **Why the old clear goes.** A message that `started` after the interrupted turn's result is the CLI's next turn
  (§ Message lifecycle: "`started` comes right after the earlier turn's `result` and is followed by `system/init`";
  `/compact` took 6.5 s from `started` to its init). Clearing it showed idle and fired the turn-finished mark, then the
  init showed working again. A `queued` uuid still closes: the plain interrupt cannot say whether the CLI keeps it,
  and `interrupt while no turn is open` (written only) keeps its expectation.
- **A stuck uuid.** A `started` message always ends in a terminal state (§ Message lifecycle), which closes it; a
  process that ends closes everything through `abandon` as today.
- **Docs.** The header comment's `interruptAnswered` bullet becomes: "`interruptAnswered` closes every uuid no turn
  took in (`started`) when no turn is open, and changes nothing while one is. A message that `started` before its
  init, such as `/compact`'s or one queued behind the interrupted turn, stays open, so activity reads working until
  its own turn ends." `claude-stream.md`'s "the reply (success or error) closes every open message when no turn is
  open" becomes "the reply (success or error) closes every open message not yet `started` when no turn is open".

Decisions (B):
- **Hold the init's entry until the turn shows what it is.** From a hand-back result (`isAfterHandback`), the next
  `system/init` and every gathered system line after it (`GATHERED_SYSTEM_SUBTYPES`) are held in `let heldEvents:
  Json[] | null` instead of joining an events entry; every other field the init sets on `out` (`turnStarted`,
  `capabilities`, `commands`, `reported`) is set at once as today. The held lines go out at the first of:
  - the next `result`: when it is the empty follow-up (`isEmptyFollowUp`), each held line joins the hand-back turn's
    events entry (`gathered(event)`), then the result does, as today; any other result first opens a new events entry
    with the held lines (`gathered(first, true)`, then `gathered(rest)`), then draws its divider;
  - any line of the turn's content before a result (`assistant`, `stream_event`, `user`, `tool_progress`, or a system
    line outside `GATHERED_SYSTEM_SUBTYPES`): the held lines open a new events entry first, then the line decodes.
  The flush runs in `decode` before the line's decoder, through one helper `releaseHeld(out, opensTurn: boolean)` that
  pushes each `gathered` snapshot to `out.entries` and sets `heldEvents` back to null.
  `gathered`'s `startsTurn` call in `decodeSystem` becomes `gathered(event, event.subtype === 'init')` when nothing
  is held. This keys the join on the next result being empty, as the item says, and a second hand-back right after
  the first gets its own events entry because its turn's content flushes its init.
- **Lines with no turn content are held too, in wire order.** `command_lifecycle`, `control_response`,
  `control_request` and `rate_limit_event` do not flush, but while `heldEvents` is not null their events-entry line
  joins `heldEvents` instead of the hand-back turn's entry; every other field their decoder sets (`lifecycle`,
  `controlResponse`, `hostRequest`, `planRows`) is set at once. Reason: they call `gathered(event)` today, which would
  put them in the hand-back entry while the init that came before them lands in a later one, out of wire order. One
  helper `gatherOrHold(event, out)` (push to `heldEvents` when it is not null, else `out.entries.push(gathered(event))`)
  replaces the `out.entries.push(gathered(event))` in those four decoders and in `decodeSystem`'s gathered branch
  (whose init, when `isAfterHandback` and nothing is held, starts `heldEvents` as `[event]`). A `control_response`
  `isKeptOut` skips stays skipped.
- **One empty-follow-up test.** `releaseHeld` for a `result` line runs in `decode` before `decodeResult`, so before
  `decodeResult` resets `isAfterHandback`. Today's `isEmptyFollowUp` expression (`isAfterHandback`, `origin.kind ===
  'task-notification'`, `result === ''`, `num_turns === 0`) moves into one local function `isEmptyFollowUp(event:
  Json): boolean`, called by `decode` (to pick the flush) and by `decodeResult` (to pick the entry); no second copy.
- **A process that ends while lines are held** loses only those init and status lines' events entry. Accepted: the
  measured follow-up is an init and an empty result, a few milliseconds apart.

GIVEN lifecycle mode, no turn open, uuid `a` written, `queued`, `started` WHEN the interrupt reply arrives THEN
activity stays `working`; WHEN `a`'s init and its result follow THEN `idle`.
GIVEN a written-only (or `queued`-only) uuid and no turn open WHEN the interrupt reply arrives THEN activity is `idle`.
GIVEN a hand-back result WHEN an init then an empty task-notification result follow THEN both join `turn-events-1`
and no divider is drawn. WHEN instead an init then a result with replies follow THEN the init opens `turn-events-2`
before `result-2`. WHEN an init then an assistant line follow THEN the assistant line's decode returns
`turn-events-2` first.

Tests:
- `turn-tracker.test.ts`, `activity_LineSequence_FollowsTurnAndOpenUuids ($name)` gains rows:
  - `interrupt after a message started, before its init`: `[{ read: lifecycleInit }, W]`, `[{ read: result(null, []) },
    I]`, `[{ written: 'a' }, W]`, `[{ read: state('a', 'queued') }, W]`, `[{ read: state('a', 'started') }, W]`,
    `['interruptAnswered', W]`, `[{ read: lifecycleInit }, W]`, `[{ read: result('a', ['a']) }, I]`.
  - `interrupt with a queued message`: `[{ read: lifecycleInit }, W]`, `[{ read: result(null, []) }, I]`,
    `[{ written: 'a' }, W]`, `[{ read: state('a', 'queued') }, W]`, `['interruptAnswered', I]`.
  - `started then cancelled`: `…[{ read: state('a', 'started') }, W]`, `['interruptAnswered', W]`,
    `[{ read: state('a', 'cancelled') }, I]`.
- `stream-decoder.test.ts`, `decode_EmptyResultAfterHandback_DrawsNoDivider ($given)`: the second row's `expected`
  becomes `['turn-events-2', 'result-2']` (the init's own decode now returns no entry). New test
  `decode_InitAfterHandback_OpensItsOwnEntryAtTheTurnsFirstContent`: decode `INIT_LINE`, `handbackResult(…)`,
  `INIT_LINE` (expect `entries` `[]`), then an assistant line built with `assistantEvent` → its first entry's id is
  `turn-events-2`. New row or test for a second hand-back: `INIT_LINE`, `handbackResult('a')`, `INIT_LINE`, an
  assistant line, `handbackResult('b')` → the second hand-back turn's init sits in `turn-events-2`.
  New test `'keeps the lines after a hand-back's init in wire order ($given)'` (a sentence title, `typescript-vitest.md`
  § Naming; the file's existing titles keep their form), an `it.each` whose rows each decode `INIT_LINE`,
  `handbackResult('a')`, then the row's `after` lines; it collects every entry the `after` lines return, keeps the
  last entry per id, and asserts each kept entry's `raw` mapped to `subtype ?? type`:
  - `given: 'status lines, then an empty result'`: `after` = `INIT_LINE`, `line({ type: 'system', subtype: 'status'
    })`, `line({ type: 'system', subtype: 'hook_started' })`, the empty task-notification result (`subtype:
    'success'`, `result: ''`, `num_turns: 0`, `origin: { kind: 'task-notification', producer: 'session-task' }`, as the
    table above builds it) → `turn-events-1` raw `['init', 'init', 'status', 'hook_started', 'success']`, and no
    `result-2` id.
  - `given: 'a lifecycle frame, then an empty result'`: `after` = `INIT_LINE`, `line({ type: 'command_lifecycle',
    command_uuid: 'u1', state: 'started' })`, the same empty result → `turn-events-1` raw `['init', 'init',
    'command_lifecycle', 'success']`, no `result-2` id; the lifecycle line's own decode returns no entry and its
    `lifecycle` is `{ uuid: 'u1', state: 'started' }`.
  - `given: 'a status line, then a result with replies'`: `after` = `INIT_LINE`, the status line, the task-notification
    result with `result: 'done'`, `num_turns: 1` → the result line's entries' ids are `['turn-events-2', 'result-2']`
    in that order, and `turn-events-2` raw is `['init', 'status']`.
- The rest of both files and `session-fold.test.ts` pass unchanged; a fold test that pinned the old idle after an
  interrupt with a `started` uuid stops the task and is reported (none found at plan time:
  `foldPipeLine_CompactQueuedBehindAnInterruptedTurn_StillRuns` writes `/compact` with no `started` frame before the
  reply).

Done when: compiles (`npm run typecheck`); `npm test` runs `turn-tracker.test.ts`, `stream-decoder.test.ts`,
`session-fold.test.ts` and `claude-code-harness.test.ts` green; `npm run lint` clean.

Commit: one commit for the group, e.g. "Claude adapter: a started message stays working through an interrupt reply,
and the init after a hand-back joins it only when the next result is empty (follow-ups: interrupt before a message's
init, hand-back join)"
