# 25 — Hosted turn state: busy from open messages, a main turn and background work

Status: done
Type: Task
Wave: 5 · Depends on: 02, 07, 08, 13, 24
Rung: deep · changes the host's busy read, which the keep window, the drain, the exit rule and `skipWhileBusy` all rest on, and the `IdleRule` wire shape
Plan: [plan.md](plan.md)

Follow-up from `docs/features/followups.md` § Latent defects and tests: **Hosted process reads busy with no way out**.
The user chose the full fix, not a cap on the busy state. This task replaces the "busy until the next `result`" read
with a read of what is open. It matters to this plan: `skipWhileBusy` (task 07) skips a scheduled run while the
task's last run reads busy, so a run stuck busy today would skip every later run of its task.

Files:     modify `src/contracts/session-host.ts` (`IdleRule`) · modify `src/session-host/process-table.ts` ·
           test `src/session-host/process-table.test.ts` · modify `src/plugins/claude-code/main/claude-launch.ts`
           (`CLAUDE_IDLE_RULE`, which task 08 moved there) · test `src/plugins/claude-code/main/claude-launch.test.ts` ·
           test `src/plugins/claude-code/main/claude-code-harness.test.ts` · modify `src/session-host/session-host-test-doubles.ts` ·
           test `src/session-host/host-server.test.ts` · test `src/main/session-host/session-host-client.test.ts` ·
           test `src/shared/fake-session-host.test.ts` ·
           modify `docs/features/session-host/design.md` (§ The host: the busy and idle bullets) ·
           modify `docs/features/followups.md` (removes the entry)

Consumes:  `process-table.ts` with `isBusy` (← 07); `CLAUDE_IDLE_RULE` in `claude-launch.ts` (← 08);
           `src/contracts/session-host.ts` as 13 leaves it (← 13); `docs/features/session-host/design.md` as 24 leaves
           it (← 24). Evidence: `docs/features/agent-chat/claude-stream.md` § Message lifecycle, § Subagents (Probe 6,
           Probe 7, the system lines for a subagent), § Interrupt.

Produces:
- In `src/contracts/session-host.ts`, `IdleRule` gains four fields (each null turns its part off):
  ```ts
  export interface IdleRule {
    key: string;
    value: string;
    busyStdoutValues: readonly string[];
    busyStdinValues: readonly string[];
    // A stdout line whose top-level `sideKey` holds a value that is not null belongs to side work and opens no turn
    // (Claude: `parent_tool_use_id`, set on a subagent's own lines).
    sideKey: string | null;
    // A busy stdin line whose top-level `messageIdKey` holds a string opens that message (Claude: `uuid`). A busy
    // stdin line with no id opens the turn, as a busy stdout line does.
    messageIdKey: string | null;
    // Ends an open message: a stdout line whose `key` equals `value`, whose `idKey` names the message and whose
    // `stateKey` holds one of `endStates` (Claude: `command_lifecycle`, `command_uuid`, `state`, `completed`,
    // `cancelled`, `discarded`, `refused`). A turn-end line also ends each message its `turnEndIdsKey` list names
    // (Claude: `user_message_uuids`).
    messageEnd: { value: string; idKey: string; stateKey: string; endStates: readonly string[] } | null;
    turnEndIdsKey: string | null;
    // Background work: a stdout line whose top-level keys equal every pair of `match` sets the background count to
    // the number of items of its `listKey` array whose `kindKey` holds one of `kinds` (Claude: `{ type: 'system',
    // subtype: 'background_tasks_changed' }`, `tasks`, `task_type`, the kinds in Decisions).
    background: {
      match: Readonly<Record<string, string>>;
      listKey: string;
      kindKey: string;
      kinds: readonly string[];
    } | null;
  }
  ```
- In `process-table.ts`: `TableProcess` keeps `isIdle` as the one busy read, now derived (Decisions). `isBusy` (07)
  reads it unchanged.

Decisions:
- **The cause** (from the follow-up and claude-stream.md). Today an `assistant` line sets busy and only a `result`
  clears it. A background subagent's `assistant` line after the turn's `result` sets busy. An interrupt then kills
  the subagent and prints `task_updated` (killed), `task_notification` (stopped), `background_tasks_changed` `[]`,
  the control reply and a subagent-side marker, and no `result` (Probe 6, background subagent). The process reads busy
  for good: the keep window never arms, a drain never ends it, and the host never exits.
- **The new read.** A process is busy while any of these holds; it is idle when none does:
  - **a main turn is open**: opened by a stdout line whose `key` value is in `busyStdoutValues` and whose `sideKey`
    value is absent or null, or by a busy stdin line with no message id; closed by a turn-end line (`key` = `value`).
  - **a message is open**: opened by a busy stdin line with a message id; closed by its `messageEnd` line with an end
    state, or by a turn-end line whose `turnEndIdsKey` list names it.
  - **background work runs**: the last background line counted more than 0 items.
  Each line updates these three parts, then the table calls `turnBusy` or `turnIdle` when the derived state changed.
  So the keep window, the drain and `isBusy` keep reading one value.
- **The crossing message** (the follow-up's second case) is fixed by the open-message part: a message written during
  a turn stays open past that turn's `result` until its own lifecycle end. Every stdin user line the Claude adapter
  writes carries `uuid` (`userMessage` in `claude-controls.ts`), and the opening lines of a prepared run do too (08).
- **Background kinds.** `CLAUDE_IDLE_RULE.background.kinds` is `['local_agent']`: a background subagent holds the
  process busy, a background Bash does not, as today's design keeps silent background shells to the keep window.
  This is the plan's pick pending the user's answer to the open question in the lead's report; a change of the pick
  is one constant.
- **`CLAUDE_IDLE_RULE`** becomes: `key: 'type'`, `value: 'result'`, `busyStdoutValues: ['assistant', 'stream_event']`,
  `busyStdinValues: ['user']`, `sideKey: 'parent_tool_use_id'`, `messageIdKey: 'uuid'`, `messageEnd: { value:
  'command_lifecycle', idKey: 'command_uuid', stateKey: 'state', endStates: ['completed', 'cancelled', 'discarded',
  'refused'] }`, `turnEndIdsKey: 'user_message_uuids'`, `background` as above.
- **Parsing cost.** Every stdout line is read today by `valueAtKey`, one `JSON.parse`. Parse each line once and read
  every key from that one object; do not parse a line twice.
- **Validation.** `requireIdleRule` also checks the four new fields' shapes (null or the shape above). A bad one
  refuses the spawn with the existing message `process <id> has no well-formed idle rule`.
- **Wire shape and protocol.** `IdleRule` travels in `HostedSpawn` and in the pending file. Task 07 bumps the protocol
  to 4 in this run, and this task changes the rule under that same protocol: no second bump. If the user installed a
  build between task 07 and this task, a protocol-4 host from that build refuses a spawn from this one. The lead
  then bumps to 5 in this task; record it in the Run log either way.
- **`skipWhileBusy` (07).** The skip reads `isBusy`, which reads `isIdle`. After this task: a last run with a
  background subagent still at work reads busy, so the next run is skipped, as the overlap rule means; a last run
  that an interrupt left with no turn and no background work reads idle, so the next run fires; a last run whose
  only background work is a Bash reads idle, so the next run fires beside it. Task 07 needs no change.
- **Fake host and doubles.** The fake host does not read the idle rule. Every literal `IdleRule` in the test files
  above gains the four fields as null, except where a case tests them.
- **Design doc.** Rewrite the § The host bullets that state the busy rule ("A process starts idle, reads busy on a
  line that starts a turn…" and the idle rule's description) to the three parts above, and drop the sentence that a
  subagent's `assistant` lines hold the process busy until a later `result`.
- Test names follow the files' existing form.

GIVEN a process that ended a turn with `result`, then printed a subagent `assistant` line with `parent_tool_use_id` set
and `background_tasks_changed` listing one `local_agent` task
WHEN it prints `background_tasks_changed` with `tasks: []` and a control reply, and no `result`
THEN it reads idle, and the keep window arms

GIVEN stdin user line `uuid` A, then stdin user line `uuid` B while A's turn runs
WHEN stdout prints `result` with `user_message_uuids: ['A']` and `command_lifecycle` A `completed`
THEN the process reads busy until `command_lifecycle` B reaches an end state

GIVEN a turn that ended, with `background_tasks_changed` listing one `local_bash` task
WHEN no other line comes
THEN the process reads idle

GIVEN a rule with every new field null
WHEN the same lines as today's process-table cases arrive
THEN every existing busy and idle case holds

Tests:
- `process-table.test.ts`, one table over line sequences (`it.each`), each row a list of `in`/`out` lines and the
  expected `isBusy` after the last: the four GIVEN/WHEN/THEN above; a self-started turn (`system/init`, a main
  `assistant`, `result`) after a background end; a folded message ended by `completed` before its turn's `result`; a
  `discarded` message; a `stream_event` with `parent_tool_use_id` set (opens nothing). Break: the stuck busy of the
  follow-up.
- `process-table.test.ts`, `spawn_Throws_ClosesWithTheMessageAndKeepsNoEntry`: rows for a bad `messageEnd` and a bad
  `background`.
- `process-table.test.ts`: a drain ends a process when its background count reaches 0, not before.
- `claude-launch.test.ts`: `CLAUDE_IDLE_RULE` holds the values in Decisions (one assertion on the whole object).

Done when: `npm run lint` and `npm run typecheck` pass; `npm test` passes for the test files above. The follow-up
entry "Hosted process reads busy with no way out" is gone from `docs/features/followups.md`. Live check in task 21:
a session with a background subagent, interrupted, then the app quit, ends at the keep window (an amendment the lead
adds to 21).

Commit:    one commit for the group: "Session host reads busy from open messages, a main turn and background work".

## Proof

Commit 144ac8dc0 · proof: diff read: Produces present; wave 5 typecheck and lint pass after formatter pass · concerns: drain ends a process at background_tasks_changed [] and can cut the self-started report turn ~20 ms later (the task's drain test asks for it); touched fake-agent-harness.ts FAKE_IDLE_RULE outside Files for typecheck; dropped-keys pre-filter removed
