# 08 — Agents main: rosters, log, channel

Status: done
Type: Task
Wave: 3 · Depends on: 02, 05, 07
Plan: [plan.md](plan.md)

Files:     create `src/plugins/agents/main/start.ts` · create `src/plugins/agents/main/agent-log.ts` ·
           test `src/plugins/agents/main/agent-log.test.ts` · modify `src/plugins/main.ts` · modify `scripts/check-layers.mts`
Consumes:  `AgentEvent` in `src/contracts/agent.ts`, and `Files.append(path: string, text: string): Promise<void>` with
           its `createMemoryFiles` implementation ← 02
           `ChatAgentEvent`, `ChatMainEvents.agentEvent` in `src/plugins/chat/contract.ts` ← 05
           `agentsManifest`, `RunningAgent`, `AgentsChannel`, `foldAgentEvent` ← 07
           `SessionsMainEvents.ended` / `closed` (already in the tree)
Produces:  in `src/plugins/agents/main/start.ts`:
           `export const agentsMainPart: MainPart<typeof agentsManifest>`
           in `src/plugins/agents/main/agent-log.ts`:
           `export interface AgentLog { append(hostSessionId: string, event: AgentEvent): Promise<void>; }`
           `export function createAgentLog(deps: { files: Pick<Files, 'append'>; log: Log }): AgentLog;`
Decisions:
- **Hearing events.** `api.events.on('chat.agentEvent', ({ sessionId, hostSessionId, event }) => …)` does two things
  in this order:
  - `agentLog.append(hostSessionId, event)`. The returned promise is not awaited, and it never rejects.
  - It folds `event` into `rosters.get(sessionId) ?? NONE`, where `NONE` is a module constant
    `readonly RunningAgent[]` `[]`. When the result is the same reference, nothing else happens. Otherwise an empty
    result deletes the map entry and a non-empty one is stored, then
    `api.channel.send('rosterChanged', { sessionId, running: [...result] })` is sent.
  - Per 05, chat forwards a `sessionEnded` even after the row closed. It folds to `NONE` with no entry and no send.
    An event for a row that is gone is still logged.
- **`rosters()`** answers `Object.fromEntries` of the map, each list copied. Only sessions with a running subagent
  appear.
- **Dropping a session.** The roster is dropped on both `sessions.closed` and `sessions.ended`. For a chat-owned row,
  the user's close emits `closed` at once and `ended` only after chat's process end resolves (`chat-sessions.ts`
  `closed`). Every other row that leaves emits `ended`. Each handler deletes the session's entry when there is one,
  and only then sends `rosterChanged` with `running: []`, so a page whose row still draws clears it. With no entry it
  sends nothing. The first of the two to arrive does the work, and the second finds no entry.
- **Log path and line.** The log is written to `logs/<hostSessionId>.jsonl` through `api.data` (the scoped plugin
  data `Files`). Each line is `JSON.stringify(event) + '\n'`: the `AgentEvent` exactly as received, one per line, with
  no envelope, no sessionId and no added time (`at` is already in it). The host session id names the file, so a
  resumed session appends to the same log (`agent-tower/design.md` § The agents plugin). Logs are never pruned.
- **Order and failures** (`agent-log.ts`):
  - A `Map<string, Promise<void>>` holds one tail per log path. `append` chains
    `tail.then(() => files.append(path, line))`, catches a failure, and stores the caught promise as the new tail,
    which `append` also returns. So appends to one file start in call order, each after the previous one settles,
    and different files do not wait on each other.
  - A failure logs `[agents] event not logged to logs/<hostSessionId>.jsonl: <error>` (through `errorText`), and the
    next append still runs.
  - Tails are not pruned: one settled promise per host session is held for the app's life.
- **Part shape.** Follow `keysMainPart`. The api type is
  `MainApi<typeof agentsManifest, AgentsChannel, Record<never, never>, QualifiedEvents<'chat', ChatMainEvents> &
  QualifiedEvents<'sessions', SessionsMainEvents>>`, as chat's `ChatApi` builds its heard events. The part returns
  `commands: {}` and no `dispose` (`api.events.on` returns nothing to undo; 09 adds the layouts' dispose).
  `api.dependency` is not called here: chat is heard on the bus and sessions through its events. 09 adds the layout
  registration and the preview, and 10 adds the self-test hand-off.
- **Registration.**
  - Add `agentsMainPart` to `mainParts` in `src/plugins/main.ts`, after `chatMainPart`.
  - `LAYERS` gains `'src/plugins/agents/main': { layers: ['src/contracts', 'src/shared', 'src/plugins/agents',
    'src/plugins/agents/contract.ts', 'src/plugins/chat/contract.ts', 'src/plugins/sessions/contract.ts'],
    packages: [] }`.
  - Add `'src/plugins/agents'` and `'src/plugins/agents/main'` to the `src/plugins/main.ts` entry.
- No test of `start.ts`: no main part in the tree has a fake `MainApi`. The fold rules are `roster.test.ts`'s (07),
  the log's are below, and the wiring is proved by 10's self-test and 12's drive run.

GIVEN two events for one host session WHEN both are appended THEN the file holds two JSON lines in call order.
GIVEN an append that is still pending WHEN a second append is called THEN the second `files.append` starts only after
the first settles.
GIVEN a first append that rejects WHEN a second follows THEN the failure is logged and the second line is written.

Tests:     `agent-log.test.ts`:
           - `append_TwoEvents_WritesOneJsonLineEach`: over `createMemoryFiles()`, appending a `userMessage` (`at`
             1) and an `agentSpawned` leaves `logs/h1.jsonl` reading exactly
             `JSON.stringify(e1) + '\n' + JSON.stringify(e2) + '\n'`. Catches a missing newline or an envelope.
           - `append_SecondBeforeFirstSettles_StartsInCallOrder`: a hand-made `files` double whose `append` records
             each call and returns a promise the test resolves by hand. After two `append` calls, before the first
             resolves, the double holds one call; after it resolves (and the microtasks flush), it holds two in order.
             Catches appends fired without the chain, which lose order on disk.
           - `append_FirstFails_LogsAndWritesSecond`: the double rejects the first call with `Error('disk full')`.
             The log records `[agents] event not logged to logs/h1.jsonl: disk full`, the second call is made, and
             both returned promises resolve. Catches a rejected tail that stops every later line.
Done when: compiles; `npm test` runs `agent-log.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof

Commit 4bd3bbc · proof: diff read: agentsMainPart and AgentLog/createAgentLog present, main part registered after chat, layer entries added; typecheck clean; worker ran agent-log.test.ts (3 pass) and lint · concerns: task doc's 'no main part has a fake MainApi' is stale (usage and chat main start tests have one); a ~25-line start test would pin no-send-on-no-change, closed-then-ended sending once and rosters() copying — not written, Tests list governs; part order after chat but before keys relies on the host's dependency-ordered start, first proved live in 10/12
