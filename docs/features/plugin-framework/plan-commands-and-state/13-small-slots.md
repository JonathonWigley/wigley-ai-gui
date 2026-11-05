# 13 — Agents, usage, workflow and unity-pool as slots

Status: done
Type: Batch
Wave: 11 · Depends on: 11
Plan: [plan.md](plan.md)

Paths are relative to `src/plugins/`. This task touches no chat file, because task 12 runs in the same wave.

**Files:**

- Agents, modify: `agents/contract.ts`, `agents/manifest.ts`, `agents/main/start.ts`, `agents/main/preview.ts`, `agents/page/start.ts`, `agent-lines/page/start.ts`, `agent-skills/page/start.ts`, `agent-strip/page/start.ts`, `agent-strip/page/agent-strip.ts`.
- Agents, delete: `agents/page/rosters.ts`, `agents/page/rosters.test.ts`.
- Usage, modify: `usage/contract.ts`, `usage/main/start.ts`, `usage/page/start.ts`.
- Workflow, modify: `workflow/contract.ts`, `workflow/main/flow-store.ts`, `workflow/main/start.ts`, `workflow/page/start.ts`.
- Unity-pool, modify: `unity-pool/contract.ts`, `unity-pool/main/start.ts`, `unity-pool/page/start.ts`.
- Test: `agents/main/start.test.ts`, `agents/main/preview.test.ts`, `agents/page/start.test.ts`, `agent-lines/page/start.test.ts`, `agent-skills/page/start.test.ts`, `agent-strip/page/start.test.ts`, `usage/main/start.test.ts`, `usage/page/start.test.ts`, `workflow/main/flow-store.test.ts`, `workflow/main/start.test.ts`, `workflow/page/start.test.ts`, `unity-pool/main/start.test.ts`, `unity-pool/page/start.test.ts`.

**Consumes:**

- `KeyedSlotKey`, `SlotKey`, `KeyedSlotWriter`, `SlotWriter`, `KeyedSlotReader`, `SlotReader`, `api.state.publish`, `api.state.read`, `reads` on `PluginManifest` ← 05.
- `harness.state`, the part harness's `SlotStore` ← 05. A test writes a slot through `harness.state.publish`.
- `core.pageReady` ← 06.
- `sessions.rows`, `sessions.selection`, `sessions.active` ← 11.
- The holder's push gate in `src/main/main.ts` ← 05. A write during a quit keeps its value and pushes nothing, so the stops here need no code of their own.
- From the store ← 05: it keeps the caller's reference, so `SlotWriter.get()` returns the object last set and usage's identity check holds. `all()` on a main writer keeps `Map` order, so `flow-store`'s `all()` keeps `open` order.

**Produces:**

```ts
// agents/contract.ts. Keyed by the row's sessionId.
export const agentsRostersSlot: KeyedSlotKey<Roster, 'main', 'agents'> =
  { id: 'agents.rosters', process: 'main', kind: 'keyed' };
export const EMPTY_ROSTER: Roster = { agents: [], tasks: [], skills: [] };

// usage/contract.ts. As plan.md gives it.
export const usageSnapshotSlot: SlotKey<UsageSnapshot, 'main', 'usage'> =
  { id: 'usage.snapshot', process: 'main', kind: 'value' };

// workflow/contract.ts. Keyed by the row's sessionId.
export const workflowFlowsSlot: KeyedSlotKey<SessionFlow, 'main', 'workflow'> =
  { id: 'workflow.flows', process: 'main', kind: 'keyed' };

// unity-pool/contract.ts.
export const unityPoolSnapshotSlot: SlotKey<PoolSnapshot, 'main', 'unity-pool'> =
  { id: 'unity-pool.snapshot', process: 'main', kind: 'value' };
```

`createFlowStore` deps gain `flows: KeyedSlotWriter<SessionFlow>`. `createAgentsPreview`'s `send` dep becomes `rosters: KeyedSlotWriter<Roster>`, and its `rosters()` member goes.

These go from the contracts:

- `AgentsChannel.invoke.rosters`, `AgentsChannel.messages.rosterChanged`, `AgentsPageExports`, `agentsPageKey`.
- `UsageChannel`, which then holds nothing. Usage's API types use `ChannelShape`, as `auto-compact/main/start.ts` does.
- `WorkflowChannel.invoke.flows`, `WorkflowChannel.messages.flows`.
- `UnityPoolChannel.invoke.snapshot`, `UnityPoolChannel.messages.changed`.

**Decisions:**

Every page reader subscribes and catches up in one synchronous block inside a `core.pageReady` listener. A notice before that is in `all()` or `get()` already. So no read flag, read window or race rule stays: `setWhileReading`, `changedSinceRead`, `hasSnapshot`, and usage's `snapshot === null` test on a reply all go.

Agents:

- Main keeps `rosters`, its row id → host id → roster map. A clear leaves the old process ending under the same row, and the slot holds only the merged row roster, so this map is the fold's input and no second copy.
- After a fold, main writes `rowRoster(hosts)` for the row. When `hosts` is empty it deletes the key. Today it sends three empty lists. A reader treats `undefined` as `EMPTY_ROSTER`.
- `dropRoster` deletes the key.
- The preview writes its row's roster through the writer and deletes the key on close, in place of `send('rosterChanged', …)`.
- The notice order at a row's end stays as today: the rows notice, so `forget`, then the roster delete, so a `setRoster` with `EMPTY_ROSTER`.
- `createPageRosters` goes, and so do `agents.roster` and `agents.onRosterChanged`. A reader uses `rosters.get(id) ?? EMPTY_ROSTER` and `rosters.on`. The page's `forget` goes, as main deletes the key. The agents page part keeps only `openPreview`.

Edges:

| Plugin, process | Edge today | After | Why |
|---|---|---|---|
| agents main | `dependsOn` `chat` | `reads.main: ['chat']` | It hears `chat.agentEvent` and imports only contract values. No `api.dependency(chatMainKey)`. The stop cascade changes on purpose: see Stop order. |
| agents main | `dependsOn` `sessions` | stays | The preview calls its exports. |
| agents page | `reads` `sessions`, from 11 | removed | `forget` went. |
| agent-lines, agent-skills, agent-strip page | `dependsOn` `agents` | stays | `dependsOn` keeps the config check: a plugin those views depend on cannot be disabled while they run (`AGENTS.md` § A disabled plugin). With `reads` the user could disable `agents` and get empty views with no config problem. The export goes, the edge does not. |
| agent-lines, agent-skills, agent-strip, unity-pool main | `dependsOn` `chat`, `sessions` | stays | `api.dependency` hands them to the self-test script: a real call, not a hearing. |
| auto-compact main | `dependsOn` `chat` | stays | `addSendGate`, `addIdleCompactThreshold`. |
| usage main | `dependsOn` `chat`, `sessions` | stays | `chat.profiles()`, and `sessions.activate` for the self-test. |
| workflow main | `dependsOn` `chat`, `sessions` | stays | `send`, `clear`, `launch`, `label`. |
| docs main | `dependsOn` `sessions` | stays | `api.dependency` at `docs/main/start.ts:347` for the self-test. |
| forms, primer main | `dependsOn` `chat`, `sessions` | stays | `createChatFormWake`, close guard, mark, tools. |
| usage-tab-line page | `dependsOn` `usage`, `sessions` | stays | `sessionLinePart`, `addBarPart`. |

Task 11 moves the page edges that sessions' events caused. That table is in [11](11-sessions-slots.md).

Start order: `dependencyOrder` unions both `dependsOn` lists and takes the first ready manifest in list order. `builtInManifests` lists `chat` before `agents`, so the order stays `keys, sessions, chat, forms, primer, auto-compact, agents, agent-lines, agent-strip, agent-skills, docs, gallery, settings, backlog, notes, usage, usage-tab-line, workflow, unity-pool, visual` with and without these moves (computed at plan time on the 20 plugins then listed, re-verify with the `window` plugin of task 03 in the list). Agents' `chat.agentEvent` listener keeps its place too, after auto-compact's. Self-test scripts run in part start order, so their order stays. Agents has no script of its own.

To verify, print `dependencyOrder(builtInManifests)` on the task's base commit and on its result, and compare. A difference stops the task and goes in the report.

Stop order changes on purpose. `stopOrder` in `src/shared/plugin-host.ts` walks `dependsOn` alone, so after this move a stop of `chat` in main no longer stops `agents`. No main part depends on `agents`, so no other part moves. This is accepted: no production code calls `stop(pluginId)` on a host (measured at plan time, re-verify with `grep -rn '\.stop(' src/main src/renderer`), and the live restart is Wave 4. `stopAll` reverses start order, so it does not change.

To verify, walk `dependsOn.main` over `builtInManifests` as `stopOrder` does, because that function is private. Print each plugin's stop set on the base commit and on the result, and compare. The one expected difference is that `chat`'s set loses `agents`. Any other difference stops the task and goes in the report.

Usage:

- The closure keeps `held` only. `state.snapshot` goes. A local reads `{ snapshot: writer.get() ?? EMPTY_USAGE_STATE.snapshot, held }` for each fold.
- `usage-store.ts` does not change: its folds still take and return `UsageState`.
- `apply` sets `held`. When the fold's `snapshot` is a new object it writes and runs `resolveUsageWaits`.
- The part writes the slot at start when `get()` is undefined, before its first `apply`. Without this write, a run with no profile leaves the slot empty and the page draws nothing, where today's `snapshot` reply draws the zero line.
- `snapshot` for the drive and the self-test is `() => writer.get() ?? EMPTY_USAGE_STATE.snapshot`. `usage/main/selftest-script.ts` and `usage/main/drive-actions.ts` do not change: the shape `deps.snapshot()` returns is the same.
- The page's `snapshot` variable goes. `redraw` reads the slot and returns on `undefined`. `on` calls `redraw`. `core.pageReady` calls it once.

Workflow:

- `flows.json` stays the restart truth. The file is written from the store's `saved` map, and `store.open` restores from `saved`. Nothing restores from the slot, and `write()` reads no slot. `saved` is a superset with closed sessions' flows and save times, so it stays.
- `opened` keeps `hostSessionId` per open session and drops its `flow`. `get(id)` reads `flows.get(id) ?? null` for an id in `opened`, else null. `all()` reads the writer for each `opened` id, in `open` order.
- `hold` writes the slot. `drop` and `forgetFlows` delete the key. So a store change is one notice, and `sendFlows` goes with its six call sites in `workflow/main/start.ts` (measured at plan time, re-verify): the definition, `putFlow`, `sessionOpened`, `ended`, `ready.then` and the self-test's `forgetFlows`.
- At `createFlowStore`, delete every key the slot still holds. A slot outlives its owner's stop, and this owner's truth is the file, so a leftover from a stop must not stay as a stale flow. The session's reopen writes it again from `saved`.
- The whole-array push goes. A notice carries one flow, and only that flow redraws. `view.setFlow` already takes one flow.
- The page's `flows` map and `changedSinceRead` go. `flowOf` keeps its order: `preview.flowOf(id) ?? reader.get(id) ?? newFlow(…)`. The draw keeps `isPreview`'s skip and the `flow of <id> not drawn` catch.
- A notice with `undefined` draws nothing. A flow dropped by `store.drop` stays drawn until its row leaves, as today, since the push never carried a removal. The rows notice from 11 calls `view.forget`.
- `workflow/main/selftest-script.ts` reads no flows channel, so it does not change.

Unity-pool:

- `createPoolWatch` does not change. Its `changed` dep becomes `(snapshot) => writer.set(snapshot)` in `start.ts`. `pools` in the watch holds the parsed state files, so it stays: the files are the truth. `watch.snapshot()` stays for the first write.
- The part writes `watch.snapshot()` once at start.
- `originName` and `run` stay on the channel.
- The page's `pools` and `hasSnapshot` go. The draw reads `get()?.pools ?? []`, and `get() !== undefined` replaces `hasSnapshot`. `on` redraws. `core.pageReady` redraws once.

GIVEN a subagent start WHEN agents folds it THEN `agents.rosters` holds the row's merged roster and a reader's `on` runs with that id.
GIVEN a row's last item ended, or the row closed WHEN agents handles it THEN the key is gone and `rosters.get(id) ?? EMPTY_ROSTER` gives three empty lists.
GIVEN agents starts with `chat` in `reads` WHEN `chat.agentEvent` fires THEN the fold runs as before and `dependencyOrder(builtInManifests)` is unchanged.
GIVEN the moved edge WHEN each main stop set is compared with the base commit THEN only `chat`'s set differs, and it loses `agents`.
GIVEN a run with no profile WHEN usage's page reaches `core.pageReady` THEN it draws the zero line.
GIVEN a fold that changes only `held` WHEN it applies THEN no write happens and no reader runs.
GIVEN `flows.json` holds a flow and the slot is empty WHEN that session opens THEN the slot holds the file's flow, its running state cleared.
GIVEN the slot holds a leftover flow and the file holds a newer one WHEN the part starts and the session opens THEN the slot holds the file's flow.
GIVEN one flow changes among three WHEN the notice lands THEN `view.setFlow` runs once.
GIVEN a pool file changes WHEN the watch reads it THEN `unity-pool.snapshot` holds the new pools and the page redraws.
GIVEN any of these owners writes during a quit WHEN the write runs THEN the value stays in main and the page gets no push (the gate of task 05).

**Tests:**

- `agents/main/start.test.ts`:
  - The table at `:214` asserts the slot in place of `rosterChanged`. Its "all lists empty" rows assert a deleted key.
  - `:385`, `rosters copies each live list and merges the preview roster`, becomes `the slot holds the row's merged roster and the preview's`. Catches a clear's old process dropping the new one's agents.
  - Add a row: `agents starts with chat only in reads`, on a manifest check. Catches a return to a hard edge.
- `agents/main/preview.test.ts`: the fake `send` becomes a real store's writer. A toggle sets the key and a second toggle deletes it.
- `agents/page/start.test.ts`: `exports_ConsumerDisposed_HearsNoMoreChanges` goes with the exports. `agents/page/rosters.test.ts` goes with its file: the store owns its rules.
- `agent-lines/page/start.test.ts`, `agent-skills/page/start.test.ts`, `agent-strip/page/start.test.ts`: write rosters through the harness store. Add one row each: a roster present before `core.pageReady` draws at it. Catches a lost catch-up, which the removed read gave.
- `usage/main/start.test.ts`: `:108`'s fake `changed` sender goes and the assertions read the slot. Add rows: `start_WritesTheEmptySnapshot`; `heldOnlyChange_WritesNothing`, which catches a redraw per poll; `seed_ThenSnapshot_ReadsTheSeed`.
- `usage/page/start.test.ts`: `:94`, the reply after the stop, goes with what it guards. `:115` and `:154` write the slot. Add `pageReady_DrawsTheZeroLine`.
- `workflow/main/flow-store.test.ts`, add one table:
  - `open_RestoresFromTheFile`, with an empty slot.
  - A leftover slot key at creation is deleted.
  - `drop` deletes the slot key and the saved entry, and rewrites the file without that entry. This catches a stale flow that a reopen restores after `sessions.ended`.
  - `all` keeps `open` order.
  Catches a restart that reads the slot, or a stale flow outliving a stop.
- `workflow/main/start.test.ts`: `:179`'s `sent` array reads per-flow slot notices. `:434` and `:752` still assert `flows.json`. `:899`, `harness.invoke('flows')`, reads the slot after `ready`. Add `oneFlowChange_NotifiesOneKey`. Catches a return to the whole-array push.
- `workflow/page/start.test.ts`: add `oneFlowNotice_DrawsOneFlow` and `undefinedNotice_KeepsTheDrawnFlow`. The second catches a visible change on `store.drop`.
- `unity-pool/main/start.test.ts`, add a row: a start writes the watch's snapshot and a `changed` writes the new one.
- `unity-pool/page/start.test.ts`: the `invoke` fake drops `snapshot`. Pools come through the harness store.

The runtime checks collect in [Final verification](16-final-verification.md).

**Done when:**

- It compiles and the layer check passes.
- The test gate runs the tests above, filtered to agents, agent-lines, agent-skills, agent-strip, usage, workflow and unity-pool.
- `dependencyOrder(builtInManifests)` matches its base-commit output.
- The main stop sets match their base-commit output, except that `chat`'s set loses `agents`.
- `grep -rnE "rosterChanged|onRosterChanged|agentsPageKey|sendFlows|changedSinceRead|hasSnapshot|setWhileReading" src` prints nothing.
- Each self-test `expect` line that names one of these moved.
- A doc under `docs/features` that describes a removed member of today's code is fixed. A followup's history stays.

**Commit:** one commit for the group.

## Proof

Commit 61c255a4 · proof: Diff read; the four slots present; 62 files 1001 tests pass per the worker; the tree compile proof waits for task 12, which runs beside it. · concerns: A stop and restart of agents main leaves stale rosters for live rows until the next event, unreachable until the live restart of Wave 4; usage and unity-pool setLayouts can now draw before pageReady, which may change first log lines (task 16 watches); the pageReady catch-up redraws parts once more; view.forget may leave a flow readable until store.drop; the unity-pool main test reaches the write through a rescan, watcher path not traced.
