# 05 — Subagent lines in the decoder

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

This task closes the follow-up in `docs/features/followups.md` (§ "Background subagent misattributed and dropped
early"). Remove that entry in the same commit. The follow-up says:

> two faults a real session showed on 2026-11-03, a haiku background subagent under an Opus main told to run
> `sleep 90`. (1) The subagent's replies show in the main transcript as the main agent's: the decoder's text entries
> read no `parent_tool_use_id` (`decodeTextBlock`, `src/main/claude-code/stream-decoder.ts`). Only a background
> subagent was seen doing this; check a foreground one. (2) A subagent waiting on its own background shell lost its
> strip box about 80 s before it really ended, then replied and handed back with no box. The box follows
> `agentFinished`, which for a launched subagent comes from `task_notification` (`finishByNotification`).

Read first: `AGENTS.md` § Architecture, the bullets "An agent harness" and "An agent event", and the src tree entries
for `claude-code/`, `agents/`, `agent-strip/` and `chat/`. Docs written ahead: `docs/features/agent-chat/design.md`
(Chat entry), `docs/features/chat-bar/design.md` § The agent strip (Lifetime), and
`docs/features/agent-chat/claude-stream.md` lines 960–1070 (the end event, the hand-back turn, the subagent's own
lines, a revive).

## Item 1 — Subagent text and thinking carry their agent, and the transcript leaves them out

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/stream-decoder.ts` ·
           modify `src/main/claude-code/transcripts.ts` · modify `src/shared/fake-agent-harness.ts` ·
           modify `src/plugins/chat/main/preview/preview-session.ts` · modify `src/plugins/chat/page/entry-list.ts` ·
           modify `src/plugins/chat/page/working-turn.ts` ·
           test `src/main/claude-code/stream-decoder.test.ts` · test `src/plugins/chat/page/entry-list.test.ts` ·
           test `src/plugins/chat/page/working-turn.test.ts` ·
           modify every other test builder of an `assistant` or `thinking` entry that the typecheck names (today:
           `chat-kit.test.ts`, `chat-sessions.test.ts`, `entry-stamp.test.ts`, `fake-agent-harness.test.ts`,
           `session-fold.test.ts`, `transcripts.test.ts`, the chat layout tests)
Consumes:  `agentOf(event: Json): string` in `stream-decoder.ts` (the tree holds it: `parent_tool_use_id`, else
           `MAIN_AGENT_ID`) · `MAIN_AGENT_ID` in `src/contracts/agent.ts`
Produces:  in `src/contracts/agent.ts`, the `ChatEntry` members `kind: 'assistant'` and `kind: 'thinking'` each gain
           `agentId: string`, with the comment the `tool` member's `agentId` has (the agent that wrote the text:
           `MAIN_AGENT_ID` for the session's own agent, else the subagent's id the agent events use)

Decisions:
- The field sits in the `ChatEntry` union beside `id`, as on the `tool` member. `EntryDraft` derives from `ChatEntry`,
  so the decoder's `TextEntry` gets the field with no type change.
- The decoder sets `agentId` at the three places that build a text entry:
  - the `content_block_start` draft in `decodeStreamEvent`: `agentId` is the stream key, `stream ?? MAIN_AGENT_ID`
    (the stream key is the line's `parent_tool_use_id`);
  - `unstreamedEntry`: `agentOf(event)`; `decodeTextBlock` passes the `event` it already has;
  - `decodeTextBlock` on a streamed entry: the entry keeps the `agentId` its `content_block_start` gave.
- A foreground subagent needs no other path. `claude-stream.md` § The subagent's own lines: a subagent prints no
  `stream_event` lines, and every one of its `assistant` lines carries `parent_tool_use_id`. Its text goes through
  `unstreamedEntry`, as a background subagent's does. Its first `user` line (its prompt as text) joins the turn's
  events entry today, and stays there.
- A synthetic `assistant` line still makes a notice, not a text entry. No change.
- `transcripts.ts` `addAssistantEntries` sets `agentId: MAIN_AGENT_ID` on both kinds. A history transcript skips every
  sidechain line, so every text entry it makes is the main agent's.
- The fake harness and chat main's preview sample set `agentId: MAIN_AGENT_ID` on every `assistant` and `thinking`
  entry: neither models a subagent's text. A test builder sets `MAIN_AGENT_ID` unless its case models a subagent.
- `src/plugins/chat/layouts/layout.d.ts` does not change. `AssistantInput` and `ThinkingInput` get no `agentId`: a
  subagent's text entry never reaches a layout.
- The transcript rule lives in `isInTranscript` in `entry-list.ts`. `put` and `rebuild` both read it through
  `transcriptEntries`, and the rows and cursor stops come from that list (`listRows`, `cursorStops`). After the change,
  `isInTranscript` returns false for an `assistant` or `thinking` entry whose `agentId` is not `MAIN_AGENT_ID`,
  whatever `activityInTranscript` is. Its other rule stays: a step gets a slot only while activity shows in the
  transcript. `transcriptEntries` filters in both layouts: today it returns `entries` unfiltered when
  `activityInTranscript` is true.
- A subagent's tool entry keeps its slot when activity shows in the transcript. No change.
- The dock follows the same rule. `isDockStep` in `working-turn.ts` skips a subagent's tool call today. After the
  change it skips every step whose `agentId` is not `MAIN_AGENT_ID`: a subagent's thinking also leaves the dock's
  steps and `resultStepCount`. A `raw` step has no `agentId` and stays a step. Update the comment on `workingInput`
  ("Steps leave out subagents' tool calls") to say subagents' steps.
- `turnState` does not change: a subagent's text never streams, so it never reads as `writing`.

GIVEN a subagent `assistant` line (`parent_tool_use_id` `toolu_01FqZQTLkePVaZcsvgWG3jqK`) with a text block
WHEN the decoder decodes it THEN the `assistant` entry carries `agentId: 'toolu_01FqZQTLkePVaZcsvgWG3jqK'`

GIVEN a main streamed text block WHEN `content_block_start` and then the `assistant` line arrive THEN both sends of
the entry carry `agentId: 'main'`

GIVEN a session's entries hold a subagent's `assistant` and `thinking` entry WHEN the list builds, in the default
layout and with activity in the transcript THEN neither entry has a slot and neither is a cursor stop

Tests:
- New table test `decode_TextAndThinking_CarryTheirAgent ($case)` in `stream-decoder.test.ts`, beside
  `decode_ToolUse_AddsToolEntryWithSummaryAndAgent`. It catches a text entry that names the wrong agent. Each row
  decodes its lines and matches every send of the text entry (each `putEntry` call for its id, not only the last)
  with `toMatchObject({ kind, agentId })`. The `messageStart` and `textStart` helpers gain an optional parent id
  (default null) that they pass to `streamLine`, so the subagent row builds its stream lines with `'b1'`:

  | case | lines | kind | agentId |
  |---|---|---|---|
  | main streamed text | `messageStart('m1')`, `textStart(0)`, `textDelta(0, 'Hi')`, `blockStop(0)`, then the confirming `assistant` line for `m1` with text `Hi` | `assistant` | `main` |
  | main unstreamed text | an `assistant` line with a text block and no `parent_tool_use_id` | `assistant` | `main` |
  | subagent text | `subagentReply(MEASURED_AGENT_CALL, 'm2', 'claude-haiku-5-5', {})` | `assistant` | `toolu_01FqZQTLkePVaZcsvgWG3jqK` |
  | subagent thinking | an `assistant` line with one thinking block and `parent_tool_use_id: MEASURED_AGENT_CALL` | `thinking` | `toolu_01FqZQTLkePVaZcsvgWG3jqK` |
  | subagent streamed text | `messageStart('m3', 'b1')`, `textStart(0, 'b1')`, then the confirming `assistant` line for `m3` with `parent_tool_use_id: 'b1'` | `assistant` | `b1` |

- `entry-list.test.ts`, the `activity hidden` table (`it.each` with `slots`, `kinds`, `stops`): add two rows. Each
  puts `everyKind` and then a subagent `assistant` entry `sa1` and a subagent `thinking` entry `sk1` (`agentId`
  `'b1'`), then rebuilds. The rows catch a subagent's text that draws or takes a stop:
  - `subagent text and thinking, default layout, rebuilt`: `slots`, `kinds` and `stops` equal the row
    `default layout, rebuilt`; `focused` `'n1'`.
  - `subagent text and thinking, activity in the transcript, rebuilt`: `slots`, `kinds` and `stops` equal the row
    `activity in the transcript, rebuilt`; `focused` `'n1'`.
  The file's `assistant`, `thinking` and `assistantText` builders gain `agentId: MAIN_AGENT_ID`, and take an optional
  agent id for these rows.
- `working-turn.test.ts`, the `workingInput bounds` table: add the row
  `given: "a subagent's thinking between two main tools"`,
  `list: entries('user:u@100', 'tool:a@110', 'thinking~:s@115', 'tool:b@120')`,
  `expected: { startedAt: 100, steps: ['a', 'b'], now: 900 }`. It catches a subagent's thinking in the dock. The
  spec builder's `~` sets `SUBAGENT_ID` on a `tool`, `assistant` or `thinking` entry; its comment says so.

## Item 2 — A background subagent's end waits for its tasks, and a late line lists it again

Files:     modify `src/main/claude-code/stream-decoder.ts` · modify `src/contracts/agent.ts` (comments only) ·
           test `src/main/claude-code/stream-decoder.test.ts`
Consumes:  `finishAgent`, `finishByNotification`, `startTask`, `finishTask`, `reportSpawn`, `respawnAgent`,
           `pairRevive`, `decodeAssistant`, `decodeUser`, `decodeResult` in `stream-decoder.ts` (the tree holds them)
Produces:  no new export. The decoder's `agentEvents` change as the GIVEN/WHEN/THEN lines below state.

Decisions:
- **A held end.** An end event of a launched subagent (in `launchedAgents`) ends it at once only when no started task
  names it as owner. When a started task names it, the decoder keeps the end and its outcome, and leaves the
  subagent in `launchedAgents`. A started task's owner is the `agentId` its `taskStarted` carried. `startedTasks`
  becomes a `Map` from `task_id` to that owner.
- **The release.** `finishTask` sends `taskFinished` first. Then, when the task's owner has a held end and no other
  started task names that owner, the decoder calls `finishAgent` with the held outcome. The order on that line is
  `taskFinished`, then `agentFinished`. The held outcome is the end event's, not the task's.
- The hold applies to a launched subagent only. A pending (foreground) subagent ends at its `tool_result` or its
  notification as today, and its tasks outlive it as today.
- The hold applies to every end event of a launched subagent: a `completed` or `stopped` `task_notification`, and the
  hand-back result below. An interrupt stops the subagent's tasks too, and their notifications release the hold.
- The first held end wins: a later end event for an agent that already has a held end does nothing. The
  notification is the harness's own status for the subagent, and a hand-back result always says `done`.
- Accepted risk: an owned task that never sends its notification keeps the box until the process ends. The decoder
  does not read `background_tasks_changed` as a release.
- While a subagent's end is held, it is still running to the decoder. A revive of it (`respawnAgent`, or `pairRevive`
  at a reply) sends no new `agentSpawned`, as for any running subagent, but it drops the held end: the revived work
  ends by the rules under "The revived agent's next end". `reportChangedWindows` still reads it. Its pending foreground calls stay pending until the
  release fails them, as `finishAgent` does today.
- `finishAgent` also drops the ending agent's held end.
- **A kept spawn.** `reportSpawn` keeps each agent's spawn record: `parentAgentId` and the `source` JSON it read. The
  record is never deleted. A later `agentSpawned` for the same agent reads the record, so it carries the same
  `agentType`, `description`, `name`, `model` and `effort` as the first Agent call. `respawnAgent` replaces only the
  record's `parentAgentId`, so a revive by `SendMessage` names its reviver as the parent and keeps the first call's
  name, model and effort.
- `subagentFacts` stays past the end: `finishAgent` no longer deletes it. Update the comments on `subagentFacts` and
  `finishAgent` ("its kept facts go") to match.
- **A revivable agent.** `finishAgent` marks the ending agent revivable when it was launched and its outcome is
  `done`. A failed or stopped subagent is not revivable: an interrupt stops every subagent, so a line after a stop is
  output still in flight, not new work. A cascade end (a nested call failed under its ending parent) is failed, so it
  is not revivable.
- `respawnAgent` clears the revivable mark when it lists the agent again.
- **A late line.** An `assistant` or `user` line whose agent is a revivable subagent that is not in `launchedAgents`
  lists it again. The line's agent
  is `parent_tool_use_id`; when that is absent, `agent_id` read through `subagentTasks`. The decoder clears the mark,
  adds the agent to `launchedAgents`, and sends, in this order: `agentSpawned` from the kept spawn record,
  `agentLaunched`, and `agentReplied` from the kept `subagentFacts` (with `spendOf`) when facts are kept. The line's
  own events follow. In `decodeAssistant` this runs right after `pairRevive`; in `decodeUser` it runs first.
- A `tool_progress` line does not revive: its `parent_tool_use_id` names the pending call, not a subagent.
- A line from a subagent that ended as a foreground call does not revive it. The existing row
  `subagent end fails its open tool call` has a late `tool_result` from such a subagent, and it stays unchanged.
- **The revived agent's next end** is the first of these:
  1. its next `task_notification`. `finishByNotification` finds it in `launchedAgents`, as for any launched subagent.
  2. a `result` whose `origin` has `kind` `'peer'` and `handback: true`, and whose `origin.senderTaskId` (else
     `origin.from`) maps through `subagentTasks` to a launched subagent. That subagent ends with outcome `done`,
     through the held-end rule. `decodeResult` runs this check after `failPendingAgents` and before the windows and
     `turnEnded`. The rule applies to every launched subagent; for a subagent its notification already ended, it
     finds nothing in `launchedAgents` and sends nothing.
  3. the process end. The roster empties on `sessionEnded` (`src/plugins/agents/roster.ts`), so the decoder adds no
     end.
  Evidence: `claude-stream.md` lines 992–1000 say a notification is not always the subagent's last word, and the
  2026-11-03 subagent replied and handed back after its shell ended. Lines 1001–1004 show the hand-back turn's
  `result` with `origin` `{"kind":"peer","from":"a5d2bf79d0e109653","senderTaskId":"a5d2…","handback":true,…}`: the
  one line that names the subagent at its hand-back. No second `task_notification` after a late hand-back was
  captured, so the decoder does not wait for one alone. Lines 1061–1062: a restart prints a `stopped` notification
  with no `tool_use_id`. A new process knows no such task, so it sends nothing, as today.
- The roster does not change. `foldAgentEvent` adds an `agentSpawned` for any id it does not list
  (`roster.ts` lines 17–40), and it keeps no record of a removed id. The row `SpawnIntoEmpty` covers that case, so
  `roster.test.ts` gets no row. A listed-again agent starts with no tools, `isBackground` set by its `agentLaunched`.
- Chat main's `trackBackground` (`chat-sessions.ts`) adds the id again on the new `agentSpawned`. The session stays
  busy while the revived agent runs. No change.
- `src/contracts/agent.ts` comments: the `agentSpawned` comment gains "An agent that finished may be spawned again
  under the same id: it runs again until its next `agentFinished`." The `agentLaunched` comment gains "Its
  `agentFinished` comes only after every task it owns has its `taskFinished`." The `taskStarted` comment ("A task
  outlives its turn and its agent") stays true for a foreground subagent; add "a background subagent's end waits for
  it".
- Live check: task 10 (Final verification) runs the background subagent that waits on its own shell. This task writes
  no live step.

GIVEN a launched subagent `a1` that owns a running task `bpdumb7hy` WHEN its `task_notification` (`completed`) arrives
THEN no `agentFinished` goes out; WHEN the task's notification arrives THEN `taskFinished` for `bpdumb7hy` and then
`agentFinished` for `a1` with outcome `done` go out

GIVEN a launched subagent `b1` that ended `done` WHEN an `assistant` line with `parent_tool_use_id` `b1` arrives THEN
`agentSpawned` (the first spawn's fields), `agentLaunched` and `agentReplied` for `b1` go out before the line's own
events; WHEN a hand-back `result` names `b1`'s task id THEN `agentFinished` for `b1` with outcome `done` goes out
before `turnEnded`

Tests (rows in the `decode_AgentEvents_$case` table in `stream-decoder.test.ts`, which owns the agent-event order;
add a helper `handbackResult(taskId)` for a `result` line with `origin`
`{ kind: 'peer', from: taskId, senderTaskId: taskId, handback: true }`):

| case | lines | expected | catches |
|---|---|---|---|
| `task outlives its subagent` → rename `launched subagent's end waits for its task` | as today | `spawned('a1')`, `launched('a1')`, `taskBegan('bpdumb7hy', 'a1')`, `taskEnded('bpdumb7hy', 'done')`, `finished('a1', 'done')` | the end sent before the task ends |
| `launched subagent's end waits for its last task` (new) | `agentCall('a1')`, `launchReceipt('a1')`, `taskStarted('a8e9e7aad968da282', 'a1', 'local_agent')`, two owned `taskStarted` (`bpdumb7hy`, `bq2`), `taskNotification('a1', 'completed', 'a8e9e7aad968da282')`, the `bpdumb7hy` notification, the `bq2` notification | `spawned`, `launched`, two `taskBegan`, `taskEnded('bpdumb7hy', 'done')`, `taskEnded('bq2', 'done')`, `finished('a1', 'done')` | a release at the first task's end |
| `held end keeps the notification's outcome` (new) | as the first row, with the subagent's notification `stopped`, then `handbackResult` for its task id, then the task's `completed` | … `taskEnded('bpdumb7hy', 'done')`, `finished('a1', 'failed')` | the task's outcome used for the agent |
| `foreground subagent's end does not wait for its task` (new) | `agentCall('a1', { run_in_background: false })`, `taskStarted('a8e9e7aad968da282', 'a1', 'local_agent')`, an owned `taskStarted('bpdumb7hy', …)`, `toolResultLine('a1')` | `spawned('a1')`, `taskBegan('bpdumb7hy', 'a1')`, `finished('a1', 'done')` | the hold applied to a foreground call |
| `revive in the Agent call's process` | as today, then `taskNotification('tb2', 'completed', 'bpdumb7hy')` | as today with `finished('a1', 'done')` moved after a new `taskEnded('bpdumb7hy', 'done')` | the revived agent's end sent while its task runs |
| `late line lists an ended subagent again` (new) | `agentCall('b1', { name: 'notes-reader', model: 'haiku' })`, `launchReceipt('b1')`, `subagentReply('b1', 'm1', 'claude-haiku-5-5', usage)`, `taskNotification('b1', 'completed')`, `toolUseLine('t1', 'Read', { file_path: 'notes.txt' }, 'b1')` | `spawned('b1')` with name `notes-reader` and model `haiku`, `launched('b1')`, `replied(…)`, `finished('b1', 'done')`, the same `spawned('b1')` again, `launched('b1')`, the kept `replied(…)`, `started('b1', 't1', 'Read', 'notes.txt')` | a late line with no box, or a re-list rebuilt from defaults |
| `revive then a line lists once` (new) | `agentCall('b1')`, `launchReceipt('b1')`, `taskNotification('b1', 'completed')`, a `SendMessage` revive of `b1` (as the `revive in the Agent call's process` row builds it), then `toolUseLine('t1', 'Read', {}, 'b1')` | `spawned('b1')`, `launched('b1')`, `finished('b1', 'done')`, one `spawned('b1')`/`launched('b1')` pair, `started('b1', 't1', 'Read', '')` | a revived subagent listed twice |
| `revive of a held subagent drops its held end` (new) | the first row's lines up to the subagent's `completed` notification, then a `SendMessage` revive of `a1`, then the task's notification | … `taskEnded('bpdumb7hy', 'done')` and no `finished('a1', …)` | the old held end firing while revived work runs |
| `late tool result lists an ended subagent again` (new) | `agentCall('b1')`, `launchReceipt('b1')`, `taskNotification('b1', 'completed')`, `toolResultLine('t9', { parent: 'b1' })` | `spawned('b1')`, `launched('b1')`, `finished('b1', 'done')`, `spawned('b1')`, `launched('b1')` | a `user` line left out of the revive |
| `hand-back result ends a listed-again subagent` (new) | the row above's lines, then `handbackResult('a4e45e22d2e0fef8f')` (pair the task id with `taskStarted('a4e45e22d2e0fef8f', 'b1', 'local_agent')` after the receipt) | … `spawned('b1')`, `launched('b1')`, `finished('b1', 'done')`, `TURN_ENDED` | a revived box that never leaves |
| `late line after a stopped end lists nothing` (new) | `agentCall('b1')`, `launchReceipt('b1')`, `taskNotification('b1', 'stopped')`, `toolUseLine('t1', 'Read', {}, 'b1')` | `spawned('b1')`, `launched('b1')`, `finished('b1', 'failed')`, `started('b1', 't1', 'Read', '')` | a box brought back by output in flight after an interrupt |
| `hand-back result of an ended subagent ends nothing` (new) | `agentCall('b1')`, `launchReceipt('b1')`, `taskStarted('a4e45e22d2e0fef8f', 'b1', 'local_agent')`, `taskNotification('b1', 'completed')`, `handbackResult('a4e45e22d2e0fef8f')` | `spawned('b1')`, `launched('b1')`, `finished('b1', 'done')`, `TURN_ENDED` | a second `agentFinished` for one end |

The row `subagent end fails its open tool call` stays as it is: a foreground subagent's late `tool_result` revives
nothing. Write each new row's `expected` in full from the helpers; the `…` above stands for the prefix the row's lines
already give.

## Both items

Done when: `npm run typecheck` passes; the test gate runs `stream-decoder.test.ts`, `entry-list.test.ts`,
`working-turn.test.ts`, `roster.test.ts` and every test file whose builder changed.
Commit:    one commit for the group, with the follow-up's removal from `docs/features/followups.md`.

## Proof

Commit 9c23d58b · proof: diff read: agentId on assistant/thinking entries; transcript skips subagent text; held ends, hand-back end, relisting in stream-decoder; follow-up removed; decoder/chat/agents tests pass; typecheck clean for its files · concerns: activity-runs.test.ts also needed agentId (not in Files); a subagent stream_event text block could show the dock as writing (decoder-only case); oxfmt not run
