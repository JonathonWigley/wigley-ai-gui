# 10 — Agents log and workflow countdown skip replayed events

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Read first: `docs/features/session-host/design.md` § Re-attach (the replayed events bullet).

Files:     modify `src/plugins/agents/main/start.ts` · test `src/plugins/agents/main/start.test.ts` ·
           modify `src/plugins/workflow/main/start.ts` and the workflow file that starts Clear & make's countdown
           (find it with `grep -rn "countdown" src/plugins/workflow`) · test their existing test files
Consumes:  `ChatAgentEvent.replayed: boolean` in `src/plugins/chat/contract.ts` ← 01
Produces:  no new name. The `chat.agentEvent` listener in `agentsMainPart.start` appends to `logs/<hostSessionId>.jsonl`
           only when `replayed` is false and the host id is not `CHAT_PREVIEW_HOST_ID`.
Decisions:
- The check sits in the listener in `start.ts`, beside the preview check. `agent-log.ts` does not change: it stays a
  plain appender and knows nothing of chat's events.
- A replayed event still folds into the roster, by the same path as a live event. The replay rebuilds the roster of a
  re-attached process, so its running subagents and tasks show again after a relaunch.
- Only the log skips a replayed event. The log already holds the events the app saw before it quit. The events that
  fired while the app was closed are lost from the log. That is accepted: the design asks only that no event is
  appended twice.
- Update the part's doc comment ("logs each in plugin data (all but the chat layout preview's sample events)") to name
  replayed events too.

The other `chat.agentEvent` listeners (checked with `grep -rn "chat.agentEvent" src`):

| Listener | Decision | Why |
|---|---|---|
| `src/plugins/usage/main/start.ts` | fold, no change | It keeps the newest main-agent `usage` per row. The replay fires usage oldest first, so the row ends on the current usage. |
| `src/plugins/workflow/main/start.ts` | fold; a replayed event starts no Clear & make countdown | `foldFlow` sets state from each signal (`turnRunning`, `runningSubagents`, `planDir`, stage). The replay ends on the current flow, which the app must learn after a relaunch. `turnEndedListeners` serve only the self-test hook `onMainTurnEnded`. |
| `src/plugins/agent-lines`, `src/plugins/agent-strip` | not a listener | Page plugins. They read the agents plugin's rosters, not `chat.agentEvent`. |
| chat's own turn-finished alert | task 09 | Chat does not alert on replayed activity. |

GIVEN a `chat.agentEvent` with `replayed: true` for a real host id WHEN the agents part hears it THEN no line is
appended to `logs/<hostSessionId>.jsonl` AND the row's roster folds the event AND `rosterChanged` is sent when the
roster changed.
GIVEN a `chat.agentEvent` with `replayed: false` WHEN the agents part hears it THEN the log appends it as today.
GIVEN replayed events that move a session's flow into the stage whose entry starts Clear & make's countdown WHEN
workflow folds them THEN the flow ends on that stage AND no countdown starts. The same events with `replayed: false`
start the countdown as today.

Tests:
- Turn `previewEvents_NoLogWritten` into an `it.each` named `agentLog_UnloggedEvents_NoLogWritten`, with two rows:
  `{ given: 'the chat preview host', hostSessionId: CHAT_PREVIEW_HOST_ID, replayed: false }` and
  `{ given: 'a replayed event', hostSessionId: 'h1', replayed: true }`. Each row emits an `agentSpawned` event. Each
  row asserts that the data folder holds no file under `logs/`. The replayed row also asserts one `rosterChanged`
  message for its row, holding the spawned agent.
- `logs each event under its host session id`: its emitted events get `replayed: false`, and its assertions stay.
- Add a row to the workflow test that pins the countdown start (find it in the workflow tests): the same entry
  events with `replayed: true` start no countdown; with `replayed: false` they start one.
- Every other `chat.agentEvent` literal in `start.test.ts` (the helper near line 158) gets `replayed: false`, so the
  type check passes.

Done when: `npm run typecheck` passes; the test gate runs `src/plugins/agents/main/start.test.ts`.
Commit:    one commit for the group: "agents and workflow: replayed chat events log nothing and start no countdown".

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
