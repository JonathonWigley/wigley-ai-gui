# 05 — `ready()` replaces `core.pageReady`

Status: done
Type: Parallel
Wave: 3 · Depends on: 01, 02, 04
Plan: [plan.md](plan.md)

Files:
- modify, core: `src/renderer/renderer.ts` · `src/main/main.ts` · `src/contracts/core-state.ts` · `src/shared/plugin-part-harness.test-support.ts` (`HostedStart` gains `ready?(): void`, and the `reals` wrapper in `partLifecycle` passes `ready: () => started.ready?.()` through, so `PartHarness.ready()` reaches each real part's `ready`, not only the part under test's)
- modify, the page parts that hear `core.pageReady` (measured at plan time, re-verify with `grep -rln pageReady src/plugins --include='*.ts' | grep -v test`): `src/plugins/<id>/page/start.ts` for agent-lines, agent-skills, agent-strip, chat, docs, notes, sessions, unity-pool, usage and workflow; and `src/plugins/chat/page/chat-view.ts`
- test, the tests that emit or capture it (measured at plan time, re-verify with `grep -rln pageReady src --include='*.ts' | grep test`): `src/plugins/agent-lines/page/start.test.ts` · `agent-skills/page/start.test.ts` · `agent-strip/page/start.test.ts` · `chat/page/start.test.ts` · `chat/page/chat-view.test.ts` · `docs/page/start.test.ts` · `forms/page/start.test.ts` · `primer/page/start.test.ts` · `sessions/page/start.test.ts` · `unity-pool/page/start.test.ts` · `usage/page/start.test.ts` · `workflow/page/start.test.ts` (each under `src/plugins/`) · `src/plugins/workflow-heavy-page.test.ts` · `src/shared/state/slot-store.test-d.ts`

Consumes:
- `PageStart<M>.ready?(): void` and `MainStart<M>.ready?(): void` in `src/contracts/plugin.ts` ← 02.
- `PluginHost<Started>.ready(): void` in `src/shared/plugin-host.ts`: calls `ready()` on every started part, in start order; the composition root calls it once, after the start ← 02.
- A part whose `ready()` throws: the host logs it and still calls the later parts' `ready()` ← 02. **plan.md does not say this.** Today each `core.pageReady` listener runs inside `pluginEvents`' wrapper (`src/shared/event-bus.ts`), which logs `<qualifiedEvent> listener failed: <error>` under the plugin id and runs the other listeners. If the landed host rethrows instead, a throw would fail the page's start. Report that as a contract difference before you edit the parts.
- The renderer claims the Bridge (`window.wigley.claim()`) ← 01. This task moves no Bridge line; re-measure the line numbers below after 01 lands.
- Wave 3's after-state ← Wave 3 (re-verify). Wave 3 task 08 adds a `pruneKeys` call inside the `core.pageReady` listeners of chat, sessions and docs, before their `followRows` `added` runs, and its contract text says "a reader with `added` calls `followRows` inside a `core.pageReady` listener". Wave 3 tasks 03, 04, 05, 06, 07 and 08 rewrite chat, agent-strip, docs, notes, sessions, unity-pool and workflow `start.ts`, and `chat-view.ts`. Re-measure every listener in the landed files. Apply the rule below to each one you find, whatever its body holds.

Produces:
- In `src/renderer/renderer.ts`: `const pageHost = startPlugins(pageParts, 'page', …)`. The host the page discards today (measured at line 353) is kept in `pageHost`. Task 08 uses it.
- `PartHarness<Started>.ready(): void` in `src/shared/plugin-part-harness.test-support.ts`. It calls the harness host's `ready()`: the real parts' `ready` and the part under test's, in start order. `restart()` does not call it, as a page load waits for its root.
- `ChatTabs.ready(): void` in `src/plugins/chat/page/chat-view.ts`, which runs what `deps.onPageReady`'s listener runs today. `ChatViewDeps.onPageReady` goes.
- Removed: `CoreEvents` and its comment from `src/contracts/core-state.ts`; the emit `bus.emit(qualify('core', 'pageReady'), null)` from `src/renderer/renderer.ts`.

Decisions:

**The core.**
- `renderer.ts`: the emit (measured at line 441) becomes `pageHost.ready();`, in the same place: after the held push is applied, and before `document.body.dataset.ready = 'true'`. The comment above `dataset.ready` stays.
- `main.ts`: call `mainHost.ready();` once, directly after `mainCatalog.set({ ...(mainCatalog.get() ?? EMPTY_RUNTIME_CATALOG), started: true });` (measured at lines 982-985), so a main `ready()` reads the catalog as started. No main part returns `ready` in this plan; the call is there for plan.md's contract.
- `CoreEvents` goes. It holds only `pageReady`, and no core event is planned. Every `QualifiedEvents<'core', CoreEvents>` goes with it (the ten parts' `Heard`, the reader in `sessions/page/start.test.ts`, `hearingPageApi` in `slot-store.test-d.ts`). A `PageApi` whose `Heard` was only that drops the argument; one whose `Ev` is `Record<never, never>` drops that argument too, so `PageApi<typeof agentLinesManifest, ChannelShape>`. Docs and sessions keep their `Ev` (`DocsPageEvents`, `SessionsPageEvents`).
- In `slot-store.test-d.ts`, delete the `hearingPageApi` declaration and its `core.pageReady` line. Nothing else there reads it.

**The order.** At page load the parts' `ready()` run in start order. This is the order the listeners ran in. Checked: `createEventBus` runs listeners in subscription order, and every one of the ten parts subscribes synchronously inside its own `start`, chat through `mountChatView`, which `start` calls. No part subscribes later. So subscription order was start order. A part with two listeners (Wave 3 may add one) calls their bodies in the order it subscribed them, inside its one `ready()`.

**The move, once for every part.** For each `api.events.on('core.pageReady', () => { BODY })` in a part's `start`:
1. Delete the listener.
2. Return `ready() { BODY }` from `start`, beside `commands`. The body does not change, and it runs in the same closure.
3. A part with two or more listeners puts each body in `ready()` in its old order.
4. A part that returns nothing but `commands` today adds `ready` to that object.

The ten parts, measured at plan time (re-verify):

| Part | Listener today | Its body |
|---|---|---|
| `agent-lines` | line 62 | `rosters.on(…)`, then `setRoster` for each roster held |
| `agent-skills` | line 56 | `rosters.on(…)`, then `rosterUpdated` for each roster held |
| `agent-strip` | line 67 | `rosters.on(…)`, then `rosterUpdated` for each roster held |
| `chat` | line 204, `onPageReady` dep into `chat-view.ts` line 450 | see Chat below |
| `docs` | line 470 | `followRows(rows, { added, removed, hostChanged })` |
| `notes` | line 67 | `followRows(rows, { added, hostChanged })` with its two log lines |
| `sessions` | line 241 | `apply(currentState())` |
| `unity-pool` | line 357 | `poolSnapshot.on(…)`, then `redraw()` |
| `usage` | line 236 | `usage.on(…)`, then `redraw()` |
| `workflow` | lines 169-185 | `followRows(…)`, `flows.on(…)`, then `drawFlow` for each flow held |

**Chat.** `chat-view.ts` holds the body, in `deps.onPageReady(() => { … })`. That body runs past the `slots.session.on` call to the end of the listener; move all of it. `mountChatView` returns `ready()` on `ChatTabs`, running that body. `chat/page/start.ts` deletes the `onPageReady` dep and returns `ready: () => view.ready()`. A second `ready()` call on `ChatTabs` is not guarded, as a second emit was not.

**Comments that name the event.** Reword each so it names `ready`. Measured at plan time: `sessions/page/start.ts` line 176 (`The first state is read on \`core.pageReady\`` → `The first state is read at \`ready\``), `unity-pool/page/start.ts` line 84 (`Redraws all at \`core.pageReady\`` → `Redraws all at \`ready\``), `usage/page/start.ts` line 67 (`at \`core.pageReady\`` → `at \`ready\``), `chat-view.ts` lines 173-175 (`` `onPageReady` hears that every page part has started: the view reads… `` → `` `ready`, which the host calls once every page part has started, reads the sessions already held and follows the slots from then ``). Re-grep after Wave 3.

**Log lines.** No log line or self-test `expect` names `pageReady` (measured: `grep -rn pageReady src/plugins/*/main/selftest-script.ts src/main` prints nothing). The only line that named it is the bus wrapper's `core.pageReady listener failed: <error>`, under the plugin id. Its replacement is the host's line for a `ready()` that throws, which task 02 owns. Name the landed line in the report.

**Docs this task leaves.** `AGENTS.md` (line 407 names `core.pageReady` and `CoreEvents`) is task 11's. The follow-up `Parts that follow at core.pageReady follow nothing after a part restart` in `docs/features/followups.md` (line 28) is closed by task 02's live `ready()` and this move; task 11 removes it.

**Tests: the move, once for every test.** Each `harness.emit('core.pageReady', null)` becomes `harness.ready()`. `engine.emit('core.pageReady', null)` in `workflow-heavy-page.test.ts` becomes `engine.ready()`. In `forms/page/start.test.ts` and `primer/page/start.test.ts` the part under test hears nothing, and the call stays as `harness.ready()` so each test keeps its page-load shape. In `chat-view.test.ts`, the captured `pageReady` listener goes: the helper's `ready` calls `view.ready()`. The reader part in `sessions/page/start.test.ts` (`pageReady_SessionsAppliesBeforeAReaderAdded`) returns `ready()` with its `followRows` body, in place of its listener. A test name that names the event renames: a leading `pageReady_` becomes `ready_`; unity-pool's rows `written before core.pageReady` and `written after core.pageReady` become `written before ready` and `written after ready`. No assertion value changes.

GIVEN a page load WHEN the held push is applied THEN each page part's `ready()` runs once, in start order, before `document.body.dataset.ready` is `'true'`.
GIVEN a roster written before the page is ready WHEN `ready()` runs THEN agent-lines, agent-skills and agent-strip draw it, and agent-lines draws the next one too.
GIVEN sessions and a reader part that depends on it WHEN the harness calls `ready()` THEN sessions applies its first state before the reader's `followRows` `added` runs, so the reader sees `s1` drawn.
GIVEN the main parts started WHEN the catalog reads `started: true` THEN `mainHost.ready()` runs once.

Tests (each row is an existing test, moved as above; no new test, since the order rule is the host's and task 02's test owns it):
- `sessions/page/start.test.ts`: `ready_SessionsAppliesBeforeAReaderAdded` asserts `drawnWhenAdded` has length 1 and `drawnWhenAdded[0]` contains `'s1'`. It catches a harness `ready()` that skips the real parts, or calls them after the part under test. `ready_AppliesOnceFromTheStore` asserts `sessions.active` reads `'s1'` and one `activated label s1` log line.
- `agent-lines/page/start.test.ts` `ready_RosterWrittenBefore_DrawsItAndHearsTheNext`, `agent-skills` and `agent-strip` `ready_RosterWrittenBefore_DrawsIt`, `usage` `ready_DrawsTheZeroLine`, `workflow` `ready_DrawsEachFlowTheSlotHolds`, unity-pool's `written before ready` / `written after ready` rows: unchanged assertions. Together they catch a body left in a listener nothing emits.
- `chat-view.test.ts`: every test that called the helper's `ready` keeps its assertions; it catches `ChatTabs.ready` missing part of the old body.

Done when: `grep -rn 'pageReady\|CoreEvents' src` prints nothing; `grep -n 'pageHost.ready()' src/renderer/renderer.ts` and `grep -n 'mainHost.ready()' src/main/main.ts` each print one line; compiles; `npm run typecheck` passes the type tests; the test gate runs every test file above. The filtered self-test runs `npm run selftest -- --plugin sessions --plugin chat --plugin docs --plugin workflow-heavy`. The live check (a page load and a page reload draw every row, roster and flow) is in [13](13-final-verification.md).
Commit: one commit for the group.

## Proof

Commit 3a42a35f · proof: diff read; typecheck 0, lint 0; pageReady|CoreEvents grep empty in src; worker ran the task's 30 test files 486 pass plus slot-store, harness, plugin-host · concerns: a throwing ready now logs under plugin-host, not the plugin's id; the part harness host has no log so a throwing ready is silent in tests; workflow-heavy-page test's variable is heavy, not engine
