# Turn tracking — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A Claude session shows working exactly while Claude runs a turn or holds a message the app wrote, and shows idle
otherwise. A message folded into a running turn, a turn Claude runs on its own after a background task, and an
interrupt sent to an idle process all end with the session idle. Ctrl+C always ends working: within 5 s by Claude's
answer or the adapter's grace timer, and at once by a second Ctrl+C, which ends the `claude` process.

**The bug.** The Claude adapter (`src/main/claude-code/claude-code-harness.ts`, `pendingTurns`) counts one `result` per
message it writes. Two measured cases break the count:

- A message written during a tool-making turn folds into that turn. It gets no `system/init` and no `result` of its
  own (`docs/features/agent-chat/claude-stream.md` § Queued messages). Its `pendingTurns` item is never shifted, so
  the session stays working forever.
- A turn Claude runs on its own after a background task (`result.origin.kind` `task-notification` or `peer`) shows
  idle, because the adapter sets working only on its own writes. Chat main then writes its held message into that
  turn, the message folds, and the count breaks as above.

When the session is stuck, the interrupt writes a control request to an idle CLI. The CLI answers
`{"still_queued":[]}` and sends no `result`, so nothing clears the count. Every new message goes into the pending
queue of chat main.

## Architecture

```
chat main ──send / setControl / interrupt──► Claude adapter (claude-code-harness.ts)
                                               │ uuid from deps.randomUuid on every stdin user message
                                               │ tracker.written(uuid, command)
                                               ▼
claude stdout ──line──► stream decoder ──DecodedLine──► turn tracker (turn-tracker.ts, pure)
                         turnStarted, capabilities,      open turn + open uuids → activity()
                         lifecycle, turnOpener,          result → the command the turn answers
                         turnMessages                    │
                                                         ▼
                                     adapter emits events.activity only when activity() changes
```

Systems touched: the Claude adapter in `src/main/claude-code/` (stream decoder, a new turn tracker, the stdin message
builders, the harness) and the composition root `src/main/main.ts`. Chat main (`src/plugins/chat/main/chat-sessions.ts`)
does not change: its pending-message queue already follows the harness's activity.

## Preconditions

Each re-run by `wigley:make` before the first dispatch.

- The installed CLI is `2.1.317 (Claude Code)`: `claude --version`. The lifecycle shapes in
  `docs/features/agent-chat/claude-stream.md` § Message lifecycle were measured on it.
- A `/effort` or `/model` slash command sent with a client `uuid` gets its own `system/init`, `command_lifecycle`
  frames `queued`, `started`, `completed`, and a `result` whose `user_message_uuid` is that uuid and whose
  `local_command` is `effort` or `model`. `/status`, `/mcp`, `/context` and `/compact` take the same shape. Measured
  at plan time with `/tmp/claude-stuck-busy/p6.py` and `p7.py` (python3 stdlib scripts; the `/tmp` path does not
  survive a reboot, so re-run them only when the CLI version changed) and recorded in `claude-stream.md`
  § Message lifecycle (commit `e38f1bb7`).
- `RandomUuid` is `export type RandomUuid = () => string;` in `src/contracts/ambient.ts`, and `src/main/main.ts`
  declares `const randomUuid: RandomUuid = () => randomUUID();`: `grep -n "RandomUuid" src/contracts/ambient.ts src/main/main.ts`.
- `createClaudeCodeHarness` has one production caller, `src/main/main.ts` (`claudeHarness`), and three test callers in
  `src/main/claude-code/claude-code-harness.test.ts`: `grep -rn "createClaudeCodeHarness(" src` (measured at plan
  time, re-verify).
- `userMessage(` and `controlMessage(` are called only from `claude-controls.ts`, `claude-controls.test.ts`,
  `claude-code-harness.ts` and `claude-code-harness.test.ts`: `grep -rn "userMessage(\|controlMessage(" src`
  (measured at plan time, re-verify).
- **Overlap with the background-tasks branch** (`.claude/worktrees/background-tasks`, a peer's run, not merged into
  `main` at plan time): it adds `startTask`/`finishTask` and two `subagentTasks`/`startedTasks` maps to
  `src/main/claude-code/stream-decoder.ts` and cases to `stream-decoder.test.ts`. Its hunks sit in `decodeSystem` and
  beside `writePaths`; task 01's hunks sit in `DecodedLine`, `emptyLine`, the init branch of `decodeSystem`,
  `decodeResult` and `DECODERS`. Check `git log --oneline main..background-tasks -- src/main/claude-code` before task
  01: if that branch merged into `main` first, task 01 builds on it; if not, the later merge resolves two adjacent
  hunks in `decodeSystem`.

## Docs written ahead

Commits `33b38475` and `21ef5f8a`: `docs/features/agent-chat/claude-stream.md` (header, § Result, § Interrupt,
§ Queued messages, § Message lifecycle, § Subagents), `docs/features/agent-chat/design.md` (§ Pending messages),
`AGENTS.md` (the Claude adapter readings line). Commit `ad630fd7`: `docs/features/agent-chat/design.md` (the
Claude adapter's **Interrupt** bullet: the Ctrl+C guarantee).

## Mandatory Reads

- `AGENTS.md` — layers, ambient services, the Claude adapter readings line, tests, drive runs
- `docs/features/agent-chat/claude-stream.md` § Init, § Result, § Interrupt, § Queued messages, § Message lifecycle
- `docs/features/agent-chat/design.md` § Pending messages
- `.agents/skills/drive/SKILL.md` — task 05's drive run
- No `CLAUDE*.md` and no `.claude/rules/` exist in this repo outside `.drive/` and `.claude/worktrees/` copies.

## Design Overview

**After-state flow.**

1. Every stdin user message — a typed message, a typed `/effort` or `/model`, and `setControl` for effort or model —
   carries `uuid`, read from `deps.randomUuid()`. The adapter calls `tracker.written(uuid, command)`; `command` is the
   effort or model command the message carries, or null.
2. Each stdout line goes through the decoder, then `tracker.read(decoded)`.
3. The tracker holds an **open turn** flag and the **open uuids** (each with its command):
   - `system/init` (`turnStarted`) opens the turn.
   - A `command_lifecycle` line in a terminal state — `completed`, `cancelled`, `discarded`, `refused` — closes its
     uuid. `queued`, `started` and any other state leave it open.
   - A `result` (`turnEnded`) closes the turn. In **lifecycle mode** it returns the command of the open uuid
     `turnOpener` names (or null), then closes `turnOpener` and every uuid in `turnMessages`. In **fallback mode** it
     returns the oldest open uuid's command when the result is not `turnUnrequested` (else null), then closes every
     open uuid.
   - The mode is decided at the first `system/init`: lifecycle when its `capabilities` include `msg_lifecycle_v1`,
     fallback when not. Before the first init, results follow the fallback rule.
4. `tracker.activity()` is `working` while the turn is open or any uuid is open, and `idle` otherwise.
5. The adapter emits `events.activity` only when `activity()` differs from the last emitted value.
6. `interrupt()` keeps the plain interrupt control request. Its `control_response`, success or error, calls
   `tracker.interruptAnswered()`: while no turn is open it closes every open uuid; while a turn is open it does
   nothing (the interrupted turn's `result` closes it).
7. **Ctrl+C guarantee.** `interrupt()` while working also starts a 5 s grace timer (`INTERRUPT_GRACE_MS = 5000`).
   When activity reaches idle the timer is cleared. When it fires and activity is still working, the adapter calls
   `tracker.abandon()` (closes the turn and every open uuid), posts an info notice, and shows idle. A second
   `interrupt()` while that timer is pending and activity is working calls `kill()`: the process ends, chat main
   rests the row (its `ended` handler, unchanged), and the row resumes on the next message. Chat main already hands
   held messages back to the box on every Ctrl+C (`returnAllQueued`), so no change there.

**Decisions** (round numbers are the interview's):

- Track each message by its client uuid and the `command_lifecycle` frames, not by counting results (round 1).
- A turn Claude runs on its own shows working, and the messages chat main holds wait through it (round 1).
- The tracker is a deep pure module: four calls, no I/O, no clock, table-tested without a process (Decided).
- The uuid source is the injected `RandomUuid` ambient service, added to `ClaudeCodeHarnessDeps` (Decided).
- The decoder adds `turnStarted`, `capabilities`, `lifecycle`, `turnOpener`, `turnMessages`; `command_lifecycle`
  lines join the turn's gathered events entry instead of a raw entry each (Decided).
- The interrupt stays the plain interrupt; the tracker recovers an idle process through `interruptAnswered`. This
  replaces the round-1 notice that proposed a named interrupt (`for_user_message_uuids`) (Decided).
- Fallback, for a CLI without `msg_lifecycle_v1`: the result rule above. The adapter logs under `claude` and posts one
  info notice per process on the init that decides fallback (Decided). Copy, pinned:
  `This Claude Code version reports no message lifecycle; the working state follows turn results only.`
- `userMessage(message, uuid)` adds `uuid`; `controlMessage`'s third parameter is the request id for mode and the
  message uuid for effort and model (Decided).
- Ctrl+C always ends working: a 5 s grace timer, then the adapter drops its turn state and shows idle; a second
  Ctrl+C while still working ends the `claude` process (round 2, the user's pick). The grace and the second press
  live in the Claude adapter, which owns the activity; the `AgentProcess.interrupt` doc comment states the guarantee.
  The fake harness answers every interrupt at once, so it meets the guarantee unchanged (Decided). Copy, pinned:
  grace notice `Claude did not stop within 5 s; showing the session idle.`, second-press notice
  `Interrupted again; ending the Claude process.`
- Fallback closes every open uuid on any result, Claude's own turns included. Today's rule (an unrequested result
  closes nothing) is the rule that stuck the session: chat main writes only while idle, so a message open across
  Claude's own turn has almost always folded into it. A message that did not fold opens a turn again with its own
  init (Decided, reader gap).
- `interruptAnswered` may close a message the CLI holds between an interrupted turn's `result` and the next `init`.
  That message's init reopens the turn, so the session shows idle for that gap only. Chat main hands its held
  messages back on Ctrl+C, so it writes none in that gap (Decided, reader gap).

**Out of scope.**

- Chat main's pending-message queue and the interrupt's `returnAllQueued`: unchanged.
- A named interrupt (`for_user_message_uuids`).
- A `/effort` or `/model` folded into a running turn: unmeasured; its uuid closes by its terminal lifecycle state and
  the control keeps its old value.
- Showing the lifecycle states (queued, folded) in the chat view.

**Architecture.** The tracker lives in `src/main/claude-code/turn-tracker.ts`, inside the Claude adapter: only the
adapter knows `system/init`, `result` and `command_lifecycle`. It reads a `Pick` of `DecodedLine`, so its tests build
plain objects. `ControlCommand` moves from the harness into the tracker module, since the tracker returns it. The
`AgentHarness` contract does not change.

## File Structure

Existing files modified:

- `src/main/claude-code/stream-decoder.ts` + `stream-decoder.test.ts` — the five new `DecodedLine` fields;
  `command_lifecycle` gathered (01)
- `src/main/claude-code/claude-controls.ts` + `claude-controls.test.ts` — the `uuid` parameter (03)
- `src/main/claude-code/claude-code-harness.ts` + `claude-code-harness.test.ts` — `pendingTurns` replaced by the
  tracker; `randomUuid` dep; activity on change; interrupt recovery; grace timer and second-press kill; fallback
  notice (03)
- `src/contracts/agent.ts` — the `AgentProcess.interrupt` doc comment states the Ctrl+C guarantee (03)
- `src/main/main.ts` — `claudeHarness` passes `randomUuid` (03)

New files:

- `src/main/claude-code/turn-tracker.ts` + `turn-tracker.test.ts` — the turn tracker; its own module so its rules are
  table-tested without a child process (02)

Shared names (used by more than one task):

```ts
// stream-decoder.ts — added to DecodedLine
turnStarted: boolean;                                // true on a system/init line
capabilities: string[] | null;                       // init's `capabilities` strings; null on any other line
lifecycle: { uuid: string; state: string } | null;   // a command_lifecycle line's command_uuid and state
turnOpener: string | null;                           // a result's `user_message_uuid`, when a string
turnMessages: string[];                              // a result's `user_message_uuids` strings; [] otherwise

// turn-tracker.ts
export interface ControlCommand { id: 'effort' | 'model'; value: string; }
export type TurnLine = Pick<DecodedLine,
  'turnStarted' | 'capabilities' | 'lifecycle' | 'turnEnded' | 'turnUnrequested' | 'turnOpener' | 'turnMessages'>;
export interface TurnRead { command: ControlCommand | null; fellBack: boolean; }
export interface TurnTracker {
  written(uuid: string, command: ControlCommand | null): void;
  read(line: TurnLine): TurnRead;
  interruptAnswered(): void;
  abandon(): void;                                   // closes the turn and every open uuid
  activity(): ProcessActivity;
}
export function createTurnTracker(): TurnTracker;

// claude-controls.ts
export function userMessage(message: UserMessage, uuid: string): object;
// `lineId`: the control request's `request_id` for mode; the user message's `uuid` for effort and model
export function controlMessage(id: ClaudeControlId, value: string, lineId: string): object;
```

Boundary rules: `turn-tracker.ts` imports only types (`DecodedLine` from `./stream-decoder`, `ProcessActivity` from
`../../contracts/agent`); no file outside `src/main/claude-code/` learns `command_lifecycle`, `capabilities` or the
uuid keys; the `AgentHarness` contract is unchanged.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Decoder reads turn lifecycle](01-decoder-turn-lifecycle.md)

### Wave 2
- [x] [Turn tracker](02-turn-tracker.md) — after 01

### Wave 3
- [x] [Harness tracks turns by uuid](03-harness-turn-tracking.md) — after 01, 02

### Wave 4
- [x] [Doc re-read](04-doc-re-read.md) — after 01, 02, 03

### Wave 5
- [x] [Final verification](05-final-verification.md) — after 04

## Run log

Review base: 578c0d08ecda7909910ef4254a06d47fef5e0f55

### Groups
- 01 · 38ee7cc9 · diff read: five DecodedLine fields and command_lifecycle in DECODERS present; typecheck passes · concerns: none
- 02 · 0fd04bc9 · diff read: ControlCommand, TurnLine, TurnRead, TurnTracker, createTurnTracker present as planned; typecheck passes · concerns: the explicit turnOpener close in lifecycle mode has no test that fails without it (every measured result lists the opener in turnMessages)
- 03 · 420cf9cf · diff read: randomUuid dep, userMessage(message, uuid), controlMessage(id, value, lineId) present; typecheck passes · concerns: close handler leaves tracker uuids open (masked by hasClosed); interrupt tests on real timers leave a 5 s grace timer running after the test; worker used one python heredoc for a test edit
- 04 · 4987c3e4 · diff read: each listed section stale-and-fixed or already true; the grep finds no stale line outside plan folders · concerns: design.md § Working block line not written: no working-block code on this branch (it belongs to the unlanded plan-working-block); an own turn with uuids stays unmeasured
- 05 · none · gate: typecheck, lint, 291 tests, chat selftest pass; drive .drive/20261102-210036-e214 on Haiku/Low over the real CLI: 1 own turn shows working PASS, 2 message during own turn waits then runs PASS (2nd attempt), 3 Ctrl+C recovers PASS, 4 second Ctrl+C VOID (Claude answered the first interrupt in under 1 s; covered by interrupt_SecondWhileWorking_KillsTheProcess) · concerns: the second-Ctrl+C kill path is unchecked live
### Contract changes
### Rulings
- stringItems(value) helper shared by init capabilities and result user_message_uuids — one filter rule — inline it back if unwanted · group 01 · group 01
- a lifecycle turn end with turnOpener null returns null and still closes every turnMessages uuid — the rule and the folded-uuid row need it — a folded message would wait for its completed frame if wrong · group 02 · group 02
- interrupt turn-open test row: the errorResult carries user_message_uuid/user_message_uuids uuid-1, as a real interrupted turn's result does, since a result naming no opener cannot close uuid-1 in lifecycle mode — only the test changes if wrong · group 03 · group 03
- the grace callback nulls graceTimer before its working check — the callback cannot run while idle anyway — none · group 03 · group 03
- dropped the followups.md item 'Probe messages that get no result' — its probes are recorded in claude-stream.md and the tracker is the guard — restore from git if wrong · group 04 · group 04
- skipped the Working block header line the task asked for — no code counts from turnStarted yet — plan-working-block adds it · group 04 · group 04
- review 1 triage on the user's standing word to take every recommendation: #1 fix now (clear the grace on the interrupted turn's result), #4 and #5 fix now, #2 leave it (fallback clear-all is the plan's decision and chat never has two messages in flight), #3 follow-up (interruptAnswered could keep a started uuid open) — lead
### Review rounds
- 1 · 089c6ae0 · NEEDS FIXES (1 Important: grace timer survives the interrupted turn's result; 4 Minor)
- 2 (re-review, correctness on 867cbd59) · 867cbd59 · NEEDS FIXES → both Minor determined and applied by the lead: design.md Interrupt bullet says Ctrl+C ends the running turn; test row pins the idle clear of the grace (a repeat on the grace lifetime, stacked on round 1 #1; closed by test only, no behaviour change)
### Test gate
- stream-decoder, turn-tracker, claude-code-harness, claude-controls tests (the files 01–03 changed) and chat-sessions.test.ts (chat main reads the emitted activity); npm run typecheck, npm run lint; npm run selftest -- --plugin chat · 291/291 tests pass, typecheck and lint clean, selftest all passed
