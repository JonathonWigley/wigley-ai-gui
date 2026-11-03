# 10 — Agents log and workflow countdown skip replayed events

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Read first: `docs/features/session-host/design.md` § Re-attach (the replayed events bullet).

Files:     modify `src/plugins/agents/main/start.ts` · test `src/plugins/agents/main/start.test.ts` ·
           modify `src/plugins/workflow/main/start.ts` · test `src/plugins/workflow/main/start.test.ts`
           (the countdown starts in `withCountdown`, which `apply` in `start.ts` calls; the plan-ready stage,
           `src/plugins/workflow/stages/plan-ready/main.ts`, only names `autoCommand` and does not change)
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

Workflow, how the flag reaches the countdown:

- `apply(sessionId, signal)` in `start.ts` gains a third parameter `replayed: boolean`, default `false`. When it is
  true, `apply` puts the folded flow as it is and skips `withCountdown`. Every other step of `apply` runs as today:
  the `planWatch.check` on `turnEnded`, the `planWatch.follow` calls, `putFlow` (so `countdown.sync` still runs and a
  countdown already running stays in step with the flow).
- Only the `chat.agentEvent` listener passes a third argument: the payload's `replayed` field. The
  other callers of `apply` — the plan watch's `signal`, the actions' `signal`, and the `sessions.hostSessionChanged`
  listener — keep two arguments, so they stay live.
- A replayed `fileWritten` or `turnEnded` makes the plan watch read `plan.md` later, and the `planChanged` it sends
  comes through `apply` with no replay flag. When the flow had no plan progress yet (a feature turn that ended while
  the app was closed), that live `planChanged` enters `planReady` and starts a countdown. This is the user's choice:
  only the fold of a replayed event starts no countdown; a plan read it triggers is live, and the user can cancel
  that countdown as usual. The plan watch does not change.

GIVEN a `chat.agentEvent` with `replayed: true` for a real host id WHEN the agents part hears it THEN no line is
appended to `logs/<hostSessionId>.jsonl` AND the row's roster folds the event AND `rosterChanged` is sent when the
roster changed.
GIVEN a `chat.agentEvent` with `replayed: false` WHEN the agents part hears it THEN the log appends it as today.
GIVEN replayed events whose fold moves a session's flow into `planReady` (the stage whose entry starts Clear &
make's countdown) WHEN workflow folds them THEN the flow ends on that stage AND no countdown starts. The same events
with `replayed: false` start the countdown as today.

Tests:
- Agents (`src/plugins/agents/main/start.test.ts`): the helper becomes
  `agentEvent(event: AgentEvent, hostSessionId = 'h1', replayed = false)` and puts `replayed` in the payload. Every
  existing caller keeps its arguments, so every existing event is emitted with `replayed: false`.
- Turn `previewEvents_NoLogWritten` into an `it.each` named `agentLog_UnloggedEvents_NoLogWritten`, with two rows:
  `{ given: 'the chat preview host', hostSessionId: CHAT_PREVIEW_HOST_ID, replayed: false }` and
  `{ given: 'a replayed event', hostSessionId: 'h1', replayed: true }`. Each row emits `spawned` through
  `agents.agentEvent(spawned, hostSessionId, replayed)`, then `await settled()`. Each row asserts
  `expect(await agents.data.list('logs')).toEqual([])` (`Files.list` lists a missing folder as `[]`). Each row also
  asserts `agents.invoke('rosters')` equals `{ s1: roster([runningA]) }`, and the replayed row asserts
  `agents.sent` equals `[{ sessionId: 's1', roster: roster([runningA]) }]`.
- `logs each event under its host session id`: unchanged; through the helper's default its events carry
  `replayed: false`, and its assertions stay.
- Workflow (`src/plugins/workflow/main/start.test.ts`): its `agentEvent` helper gains the same third parameter
  `replayed = false`, and `runFeatureTurn(workflow, replayed = false)` passes it to each of its `agentEvent` calls.
  New test `replayedFeatureTurn_ReachesPlanReady_StartsNoCountdown`: `startWorkflowPart({ ...SETTINGS,
  autoClearAndMake: true })`, `await runFeatureTurn(workflow, true)`. `workflow.lastFlow()` matches
  `{ stage: 'planReady', planDir: PLAN_DIR, countdownEndsAt: null }`; after `workflow.time.advance(10_000)` and
  `await settled()`, `workflow.chatCalls` equals `[]`. `runFeatureTurn` awaits between its events, so the plan watch
  has read the plan (while the turn was busy, so no entry) before `turnEnded` folds: the entry is the replayed
  `turnEnded`'s own fold. The existing `featureTurnWritingAPlan_ReachesPlanReady_…` test keeps today's assertions and
  is the `replayed: false` case.

Done when: `npm run typecheck` passes; the test gate runs `src/plugins/agents/main/start.test.ts` and
`src/plugins/workflow/main/start.test.ts`.
Commit:    one commit for the group: "agents and workflow: replayed chat events log nothing and start no countdown".

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
