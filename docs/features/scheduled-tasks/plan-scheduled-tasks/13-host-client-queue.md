# 13 — Host client queue members and `sessionHostLaunch`

Status: done
Type: Task
Wave: 3 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/session-host.ts` · modify `src/main/session-host/session-host-client.ts` ·
           modify `src/main/session-host/host-link.ts` · modify `src/shared/fake-session-host.ts` ·
           test `src/main/session-host/session-host-client.test.ts` · test `src/shared/fake-session-host.test.ts` ·
           test `src/plugins/claude-code/main/claude-code-harness.test.ts`

Consumes:  `PendingSpawn`, `HostedRun` ← 07 · `SetPendingMessage`, `ListRunsMessage`, `ListRunsReply`,
           `ForgetRunsMessage`, `RunStartedEvent`, `SESSION_HOST_PROTOCOL = 4` ← 07. Tree members: `Disposable`
           (`src/contracts/disposable.ts`), `HOST_REPLY_LIMIT_MS`, `HostLinkDeps`, `openHostLink`
           (`src/main/session-host/host-link.ts`), `SessionHostClientDeps` and the client's `adopt` step
           (`src/main/session-host/session-host-client.ts`), `OtherHosts.drainOlder` (`src/main/session-host/other-hosts.ts`).
           The host's `importOlder` at each `listRuns` ← 07 (plan.md § Shared names, the protocol-change paragraph).

Produces:
- In `src/contracts/session-host.ts`, the five `SessionHost` members exactly as plan.md § Shared names and shapes gives
  them, with their comments:
  ```ts
  setPending(entries: readonly PendingSpawn[]): void;
  listRuns(): Promise<HostedRun[]>;
  forgetRuns(ids: readonly string[]): void;
  onRunStarted(listener: (run: HostedRun) => void): Disposable;
  onConnected(listener: () => void): Disposable;
  ```
- In `src/main/session-host/session-host-client.ts`, exactly as plan.md gives it:
  ```ts
  export function sessionHostLaunch(deps: Pick<SessionHostClientDeps, 'execPath' | 'hostScript' | 'folder' | 'channel'>):
    { command: string; args: string[]; env: Record<string, string> };
  ```
  It returns `command: deps.execPath`, `args: [deps.hostScript, deps.folder, deps.channel]`,
  `env: { ELECTRON_RUN_AS_NODE: '1' }`.
- In `src/main/session-host/host-link.ts`: `HostLinkDeps` gains `runStarted(run: HostedRun): void`.
- In `src/shared/fake-session-host.ts`, `FakeSessionHost` gains:
  ```ts
  // Every list `setPending` was given, in call order.
  readonly pendingLists: readonly (readonly PendingSpawn[])[];
  // Every id `forgetRuns` was given, in call order.
  readonly forgotten: readonly string[];
  // Adds `run` to what `listRuns` resolves, then tells every `onRunStarted` listener.
  startRun(run: HostedRun): void;
  // Tells every `onConnected` listener, as a reconnect to a new host does.
  connectAgain(): void;
  ```

Decisions:
- **One launch rule.** `startHost` spawns from `sessionHostLaunch(deps)`, with
  `env: { ...deps.env, ...launch.env }` and the options it has now (`detached`, `stdio: 'ignore'`, `windowsHide`). So
  the app's start and task 18's login start run the same command. `sessionHostLaunch` is pure.
- **The queue the client keeps.** The client holds `pending: readonly PendingSpawn[] | null`, null until the first
  `setPending`. `setPending` stores the list (a copy), sends `{ type: 'setPending', entries }` when connected, and
  otherwise calls `startConnecting()`. `adopt` sends `setKeepIdle` and runs the waiting calls as now, then awaits
  `otherHosts.drainOlder()` (it never rejects). After it settles, and only while `current` is still that link, it
  sends `setPending` when `pending` is not null, then, on every connect after the first, calls each `onConnected`
  listener. The client counts connects in a `connects` counter that `adopt` raises at its top, before the drain wait:
  "after the first" means `connects` is above 1. So a first link that drops during the drain wait still counts, and
  the next link's listeners run. Reason: an older host drops its queue at the drain, so waiting for the drain keeps two hosts from holding
  the queue at once, and a `listRuns` an `onConnected` listener sends then finds the older host's records imported
  (07). So a new host (after a host death, an update or a login start) takes the queue over, and an app that never
  called `setPending` (the dev app, a plugin that is off) sends nothing and so empties no queue. Settled design: the
  app re-sends the queue on every connect.
- **The kept list drops fired entries.** Each `runStarted` push and each `forgetRuns` call removes from `pending`
  every entry whose `spawn.id` it names, before the listeners run. Reason: the host drops a re-sent entry only while
  its runs record holds the id. After `forgetRuns` and before the scheduler's next `setPending`, a reconnect would
  send the old list, and the new host would fire the forgotten run again.
- **`listRuns`.** Through `whenConnected`. A null link rejects with `the session host did not start: <reason>`, as
  `list` does. Else `link.request` a `listRuns` with `HOST_REPLY_LIMIT_MS`; a reply that is not `listRuns` rejects with
  `the session host did not answer its run list`. It asks only the current host: an older protocol's host's run records reach it through the current
  host's `importOlder` (07), which runs before each `listRuns` reply.
- **`forgetRuns`.** An empty list sends nothing. Else `sendWhenConnected({ type: 'forgetRuns', ids: [...ids] })`.
- **`onRunStarted`.** The client keeps a set of listeners. `openHost` passes a `runStarted` to `openHostLink` that calls
  each listener in turn with the run. `dispose` removes the listener. `onConnected` keeps its own set the same way. In `host-link.ts`, `received` sends a
  `runStarted` message to `deps.runStarted` and returns, beside the `line`, `closed` and `spawned` pushes.
- **Fake host.** `setPending` appends a copy to `pendingLists`. `listRuns` resolves every started run whose id is not
  in `forgotten`, oldest first, and rejects with the `failList` error while one is set (it "rejects as `list` does").
  `forgetRuns` appends the ids to `forgotten`. `onRunStarted` returns a `Disposable`. `startRun` does not add a
  process record: a test that needs the run's process attachable also calls `addRunning`. `onConnected` returns a
  `Disposable`; `connectAgain` calls each live listener.
- **Other `SessionHost` literals.** `childHost` in `claude-code-harness.test.ts` returns a `SessionHost` literal: it
  gains the five members as stubs (`setPending` and `forgetRuns` do nothing, `listRuns` resolves `[]`, `onRunStarted`
  and `onConnected` return a `Disposable` that does nothing). `deliversDuringAttach` spreads `host` and needs no change.
- The client still imports only `src/contracts`, `src/shared`, `src/shared/local-channel` and `node:` (plan.md
  § Boundary rules).
- Test names follow the files' existing `subject_Condition_Result` form.

GIVEN a client that called `setPending([a])` before any host answered
WHEN the host answers
THEN the host gets `setKeepIdle`, then `setPending` with `[a]`, in that order

GIVEN a connected client whose host dies, and a new host answers on the next call
WHEN the client connects to the new host
THEN the new host gets the last `setPending` list again

GIVEN a client that never called `setPending`
WHEN it connects
THEN the host gets no `setPending`

GIVEN a connected client with an `onConnected` listener whose host dies
WHEN the client connects to a new host and an older host is drained
THEN the listener runs once, after the drain was sent and the `setPending` list went to the new host; the first
connect called it never

GIVEN a client that set `[a, b]`, then heard `runStarted` for `a` and called `forgetRuns([a])`
WHEN it reconnects to a new host
THEN the new host gets `setPending` with `[b]`

GIVEN a host that pushes `runStarted` with a run
WHEN two listeners are registered and one was disposed
THEN only the other gets the run

Tests:
- `session-host-client.test.ts`:
  - new `sessionHostLaunch_BuildsTheHostCommand` — asserts the whole return value for the deps the test builds.
  - `create_NoHost_SpawnsTheHostDetachedThenConnects` — the spawn call's env is `{ KEPT: 'yes',
    ELECTRON_RUN_AS_NODE: '1' }` and its command and args equal `sessionHostLaunch`'s.
  - new `setPending_Connect_Cases` — a table: set before the connect (sent after `setKeepIdle`); set while connected
    (sent at once); never set (nothing sent); a reconnect after the host exits (sent again, the last list only); set
    `[a, b]`, `forgetRuns([a])`, reconnect (sends `[b]`); set `[a, b]`, a `runStarted` push for `b`, reconnect (sends
    `[a]`). Break: a forgotten run fired twice by a re-sent list.
  - new `listRuns_Cases` — rows: the host replies (resolves the runs); no host started (rejects with the start
    reason); the host stays silent past the limit (rejects with `the session host did not answer its run list`). The
    scripted host in the test answers `listRuns` with a `runs` list the script sets.
  - new `forgetRuns_Cases` — rows: ids sent as one message; an empty list sends nothing.
  - new `onRunStarted_Push_ReachesEachLiveListener` — the last GIVEN/WHEN/THEN.
  - new `onConnected_Reconnect_FiresAfterTheDrainAndThePendingList` — the GIVEN/WHEN/THEN above; a disposed listener
    is not called; a row where the first link drops during its drain wait: the next link's connect calls the
    listener. Break: connects counted only after a drain settled.
- `fake-session-host.test.ts`:
  - new `queue_StartRunAndForget_ListRunsAndListenersAgree` — `startRun` twice, `forgetRuns` one id: `listRuns`
    resolves the other; a listener disposed before the second `startRun` got only the first; `pendingLists` holds
    every `setPending` list in order; `connectAgain` reaches a live `onConnected` listener and not a disposed one.
  - `failList_Error_ListRejectsUntilCleared` — `listRuns` rejects with the same error until cleared.
- `claude-code-harness.test.ts`: `childHost` gains the stubs (no new test).

Done when: `npm run lint` and `npm run typecheck` pass; `npm test` passes for the three test files above. A real
client that hands its queue to a new host, and a `runStarted` that reaches the app, are checked in task 21 (Final
verification).

Commit:    one commit for the group: "Session host client sends the pending queue on each connect, lists and forgets
runs, and hears run starts".

## Proof

Commit 9ecbd6a1d · proof: diff read: Produces present; wave 3 typecheck and lint pass after 29482b015 · concerns: links to older or newer hosts also feed runStarted; never-set row proves by waiting, not a sync point
