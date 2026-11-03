# 05 — Tool contributions reach live sessions

Status: in progress
Type: Batch
Wave: 4 · Depends on: 01, 04
Plan: [plan.md](plan.md)

Four items share one aggregate spec: sessions' registrations return handles, a contribution reaches live sessions,
the MCP server serves the live list, and sessions gives each dependent its own view of its exports.

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts` ·
           modify `src/plugins/sessions/main/mcp/mcp-server.ts` · modify `src/plugins/sessions/main/start.ts` ·
           modify `src/plugins/sessions/page/start.ts` · modify `src/plugins/sessions/page/session-tabs-view.ts` ·
           modify `src/contracts/agent-forms.ts` · modify `src/shared/agent-forms/channel-presenter.ts` ·
           modify `src/plugins/docs/page/start.ts` · modify `src/plugins/workflow/page/flow-tab.ts` ·
           create `src/plugins/sessions/main/consumer-view.ts` · create `src/plugins/sessions/page/consumer-view.ts` ·
           test `src/plugins/sessions/main/session-list.test.ts` · test `src/plugins/sessions/main/mcp/mcp-server.test.ts` ·
           test `src/plugins/sessions/main/start.test.ts` · test `src/plugins/sessions/page/consumer-view.test.ts` (new) ·
           test `src/plugins/sessions/page/session-tabs-view.test.ts` ·
           test `src/shared/agent-forms/channel-presenter.test.ts` · test fakes in
           `src/plugins/forms/page/forms-view.test.ts`, `src/plugins/primer/page/primer-view.test.ts`,
           `src/plugins/workflow/page/flow-tab.test.ts`, `src/plugins/workflow/page/preview.test.ts`
Consumes:  `Disposable`, `Registrations` in `src/contracts/disposable.ts` ← 01 ·
           `createRegistrations(): Registrations & Disposable` in `src/shared/registrations.ts` ← 01 ·
           `MainStart.exports?(consumer: Registrations): unknown` and `PageStart.exports?(consumer: Registrations): unknown`
           in `src/contracts/plugin.ts` ← 01 · sessions' `exports: () => ({ … })` form in both starts ← 01
Produces:  in `src/plugins/sessions/contract.ts`:
           `contributeTools(tools: ToolDefinition[], start: (session: AgentSession) => ToolSession): Disposable;`
           `addCloseGuard(mayClose: (sessionId: string) => boolean): Disposable;`
           `export interface SessionTabHandle extends Disposable { setStatus(status: string): void; select(): void; takeOver(): { release(): void }; isVisible(): boolean; }`
           in `src/contracts/agent-forms.ts`: `AgentFormSessions.addCloseGuard(mayClose: (sessionId: string) => boolean): Disposable;`
           in `src/plugins/sessions/main/session-list.ts`: `SessionList.onToolsChanged(listener: () => void): Disposable;`
           in `src/plugins/sessions/main/mcp/mcp-server.ts`:
           `export interface LiveTools { tools(): ToolDefinition[]; onToolsChanged(listener: () => void): Disposable; }`
           `export function serveMcp(streams: { input: Readable; output: Writable }, session: ToolSession, tools: LiveTools): { close(): Promise<void> }`
           in `src/plugins/sessions/main/consumer-view.ts`:
           `export function sessionsMainView(exports: SessionsMainExports, consumer: Registrations): SessionsMainExports`
           in `src/plugins/sessions/page/consumer-view.ts`:
           `export function sessionsPageView(exports: SessionsPageExports, consumer: Registrations): SessionsPageExports`
Decisions: every handle is a plain `Disposable`; `SessionTabHandle.remove()` becomes `dispose()` (plan.md Decisions,
           decided by the agent) · a disposed tool contribution frees its tool names and ends its tool sessions in
           every live session; one unknown-tool check stays, in `routeCall` (plan.md Decisions) · each provider gives
           every dependent its own view of its exports and files each registration under that dependent (round 3);
           a setter with no handle (`setActivity`) tracks a `Disposable` that clears the dependent's own value
           (plan.md § Plugin sweep pattern item 2) · stopping sessions leaves `endpoint.json` and `tools.json` in
           place (plan.md Decisions) · Claude Code refetches `tools/list` on `notifications/tools/list_changed`
           (plan.md Preconditions) · the decisions in Approach below (this task document)

## What changes

`src/plugins/sessions/main/session-list.ts`, `createSessionList`:

- `contributeTools` now: checks name clashes, adds the names to `toolNames`, pushes the contribution, returns void.
  It never touches an existing `SessionEntry`. After: the same checks, then it starts the contribution's tool session
  in every live entry (connected and owned), adds its tool names to each entry's `toolRoutes`, calls every
  `onToolsChanged` listener once, and returns a `Disposable`.
- The returned `dispose`: removes the contribution from `contributions`, removes its names from `toolNames`, ends
  its tool session in every live entry and removes its names from each entry's `toolRoutes`, then calls every
  `onToolsChanged` listener once. A second `dispose` does nothing.
- `SessionEntry.toolSessions` is now `ToolSession[]`. After: it is `Map<Contribution, ToolSession>`, keyed by the
  contribution object, so a disposal ends one contribution's tool session. A `Map` iterates in insertion order, which
  equals contribution order, so `end(entry)` still ends every tool session of the entry in contribution order.
- `addCloseGuard` now pushes the guard and returns void. After: it returns a `Disposable` that removes that one
  registration. The same function added twice is two registrations; each handle removes only its own.
- `routeCall` now rejects an unknown name with `No plugin contributed the tool "<name>"`. After: it rejects with
  `new Error(`Unknown tool: ${name}. Valid tools are ${names.join(', ')}.`)`, where `names` are the keys of the
  entry's `toolRoutes` in insertion order. This is the text `serveMcp` sends today, copied from
  `mcp-server.ts` `callTool`.
- New `onToolsChanged(listener)`: adds a listener and returns a `Disposable` that removes it.
- `tools()` is unchanged: every live contribution's tools in contribution order.

`src/plugins/sessions/main/mcp/mcp-server.ts`, `serveMcp`:

- Now: takes `tools: ToolDefinition[]`, a snapshot. It advertises `{ capabilities: { tools: {} } }`. `tools/list`
  returns the snapshot. `callTool` returns an error result for a name outside the snapshot and never calls the
  session.
- After: takes `tools: LiveTools`. It advertises `{ capabilities: { tools: { listChanged: true } } }`. `tools/list`
  reads `tools.tools()` on each request, with the same `inputSchema.type: 'object'` step. `callTool` has no name
  check: every call goes to `session.call`, and `routeCall` rejects an unknown name. `serveMcp` subscribes with
  `tools.onToolsChanged` and, on each change, sends `notifications/tools/list_changed` through
  `Server.sendToolListChanged()` once the connection resolves. `close()` disposes the subscription before it closes
  the server.
- SDK fact, read in `node_modules/@modelcontextprotocol/server` version `2.3.1`: `declare class Server` has
  `sendToolListChanged(): Promise<void>`, and `assertNotificationCapability` throws for
  `notifications/tools/list_changed` when the server capabilities hold no `tools`.

`src/plugins/sessions/main/start.ts`, `sessionsMainPart.start`:

- `openRelay`'s `serve` now calls `serveMcp(streams, session, list.tools())`. After: `serveMcp(streams, session, list)`
  (`SessionList` fits `LiveTools`).
- `exports.contributeTools` now calls `list.contributeTools` and then `writeEndpointFiles(endpointDir,
  opened.endpoint, list.tools())` when `opened !== null`. After: it returns `list.contributeTools(...)`'s handle and
  still writes both files after each contribution added. The write runs inside `exports.contributeTools`, after
  `list.contributeTools` returned, so after the `onToolsChanged` listeners ran. A write that throws is logged through
  `api.services.log` and does not undo the contribution: the handle is returned and the contribution stays live. A
  disposal writes no file (Approach, item 1).
- `exports.addCloseGuard` returns the list's handle.
- The part's `exports` member (task 01 made it `() => …`) becomes `(consumer) => sessionsMainView(exports, consumer)`.
  Sessions' own calls (the title tool, the drive actions, the self-test script) keep the internal `exports` object,
  which no consumer tracks.
- `dispose` is unchanged: it closes the layouts, the drive actions and the relay. It deletes no file.
- Fix the comments that say a contribution reaches only later sessions (contract `SessionsMainExports.contributeTools`,
  the comment above `sessionsMainPart`, the comment above `openRelay`).

`src/plugins/sessions/main/consumer-view.ts` (new), `sessionsMainView`: returns `exports` with five members wrapped.
`contributeTools` and `addCloseGuard` return `consumer.track(<the handle>)`. `connect` and `open` return the session
as they do now and track a `Disposable` whose `dispose` calls that session's `end()`. Every other member is
`exports`' own. A call that throws tracks nothing.

`src/plugins/sessions/page/consumer-view.ts` (new), `sessionsPageView`: returns `exports` with four members wrapped.
`addTab`, `addRowPart` and `addBarPart` return `consumer.track(<the handle>)`. `setActivity` passes through and
records the pair: the view keeps the set of `(sessionId, sourceId)` pairs this consumer last set to a non-null
activity, and a null set removes its pair. The view tracks one `Disposable`, at creation, that calls
`exports.setActivity(sessionId, sourceId, null)` for each pair still in that set. Every other member is `exports`'
own.

`src/plugins/sessions/page/start.ts`: the part's `exports` member (task 01 made it `() => …`) becomes
`(consumer) => sessionsPageView(exports, consumer)`. Sessions' own `exports.activate` and `exports.closeSession`
calls stay on the internal object.

`src/plugins/sessions/page/session-tabs-view.ts`, `add`: the returned handle's `remove()` becomes `dispose()`. Its
body now first releases the takeover this handle gave out, if that takeover is still held (the handle remembers the
`release` of its latest `takeOver()` and calls it, once), then removes the tab as `remove()` does today. A `release()`
the dependent calls later does nothing, as it does today after the tab is gone.

`SessionTabHandle.remove()` callers (non-test, measured at plan time, re-verify with
`grep -rn "\.remove()" src/plugins/docs/page/start.ts src/plugins/workflow/page/flow-tab.ts`): `docs/page/start.ts`
line ~449 `held.tab?.remove()`, `workflow/page/flow-tab.ts` lines ~83 and ~100 `handle.remove()`. Each becomes
`.dispose()`. Test fakes that build a handle with `remove:` (measured at plan time): `forms/page/forms-view.test.ts`
~105, `primer/page/primer-view.test.ts` ~166, `workflow/page/flow-tab.test.ts` ~39, `workflow/page/preview.test.ts`
~60. Each becomes `dispose:`. `src/shared/page/session-form-tabs.ts` `FormTabHandle` has no `remove` and needs no
change.

`src/contracts/agent-forms.ts`: `AgentFormSessions.addCloseGuard` returns `Disposable` (import from `./disposable`).
`src/shared/agent-forms/channel-presenter.ts` keeps calling `sessions.addCloseGuard(...)` once and ignores the handle:
the forms and primer views of sessions track it. The fake in `channel-presenter.test.ts` line ~78
(`addCloseGuard: (mayClose) => guards.push(mayClose)`) returns a `Disposable` that removes the guard from `guards`.

## Behaviours

GIVEN a session connected (or opened) before a contribution WHEN the contribution is added THEN its start runs once
with that session, and a call to its tool on that session reaches its tool session
GIVEN a contribution and two live sessions WHEN its handle is disposed THEN its tool session ends once in each
session, a call to its tool rejects with the unknown-tool text, `tools()` no longer lists it, and a new contribution
may use its tool names
GIVEN a disposed contribution WHEN its handle is disposed again THEN nothing ends and no listener is called
GIVEN two live sessions WHEN a contribution's start throws for the second THEN the tool session it started in the
first ends, its names are free, `tools()` is unchanged, no `onToolsChanged` listener is called, and
`contributeTools` rethrows
GIVEN a close guard that refuses WHEN its handle is disposed THEN the guard no longer keeps a row
GIVEN the same guard function added twice WHEN one handle is disposed THEN the other registration still keeps the row
GIVEN a call to a name no contribution holds WHEN it reaches `routeCall` THEN it rejects with
`Unknown tool: <name>. Valid tools are <names joined by ", ">.`
GIVEN a served connection WHEN the client calls a name no contribution holds THEN the client gets an error result
whose text is `Error: Unknown tool: <name>. Valid tools are <names joined by ", ">.`
GIVEN a tab handle that took over its session WHEN the handle is disposed THEN the takeover is released: the tab
selected before the takeover is selected again, and the tab is gone
GIVEN a served connection WHEN the client initializes THEN the answer's capabilities are
`{ tools: { listChanged: true } }`
GIVEN a served connection WHEN the live list changes THEN the client gets `notifications/tools/list_changed`, and its
next `tools/list` returns the new list
GIVEN a served connection WHEN it closes THEN it no longer listens to the live list
GIVEN a dependent's view of sessions main WHEN the dependent's registrations dispose THEN its tools leave every live
session, its close guards are gone, and the sessions it connected or opened end
GIVEN a dependent's view of sessions page WHEN the dependent's registrations dispose THEN its tabs and parts are
disposed and each activity it still holds is set to null

## Tests

In `src/plugins/sessions/main/session-list.test.ts` (`describe('createSessionList')`; its helpers `setUp`, `tool`,
`fakeContribution`, `info` exist):
- `it('rejects a call to a tool no contribution holds')` (exists): change the assertion from `.rejects.toThrow(/"zz"/)`
  to `.rejects.toThrow('Unknown tool: zz. Valid tools are a.')`.
- new `it('starts a contribution added after a session connected, and routes its calls')`: connect, then
  `contributeTools([tool('a')], contribution.start)`; `contribution.started` equals `[session]`, and
  `connected.call('a', …)` resolves to `RESULT` with one recorded call named `a`.
- new `it('ends a disposed contribution in every live session and frees its names')`: two connected sessions, one
  contribution of `tool('a')`; after `handle.dispose()`, `contribution.ends()` is `2`, `connected.call('a', …)`
  rejects with `'Unknown tool: a. Valid tools are .'`, `list.tools()` is `[]`, and
  `list.contributeTools([tool('a')], fakeContribution().start)` does not throw. A second `handle.dispose()` leaves
  `ends()` at `2`.
- new `it('undoes a live contribution whose start throws for one session, and rethrows')`: two connected sessions and
  a start that throws `'no tools for the second'` on its second call; `contributeTools` throws that text; the first
  tool session's `ends()` is `1`; `list.tools()` is `[]`; an `onToolsChanged` listener recorded no call.
- new `it.each` `'calls onToolsChanged once for $change'`, rows `{ change: 'an added contribution', calls: 1 }`,
  `{ change: 'a disposed contribution', calls: 2 }` (added then disposed), `{ change: 'a second dispose', calls: 2 }`,
  `{ change: 'a listener disposed before the add', calls: 0 }`: the listener's call count equals `calls`.
- `it('keeps a row a close guard refuses, …')` (exists, line ~552): add a step: dispose the refusing guard's handle,
  then `closeSession(id)` returns `true`.
- new `it('keeps a row while one registration of the same guard remains')`: add one refusing guard function twice;
  dispose the first handle; `closeSession(id)` still returns `false`; dispose the second handle; `closeSession(id)`
  returns `true`.

In `src/plugins/sessions/main/mcp/mcp-server.test.ts` (`describe('serveMcp')`): the `connect` helper passes a fake
`LiveTools` that holds a mutable tool array and its listeners, and exposes `change(next)` and a live listener count.
- `it('lists the tools it was given')` becomes `it('lists the tools the live list holds')`, same assertion
  (`toEqual(TOOLS)`).
- new `it('advertises tools.listChanged when the client initializes')`: the `initialize` reply's
  `result.capabilities` equals `{ tools: { listChanged: true } }`.
- new `it('notifies the client when the live list changes and lists the new tools')`: after `initialized`,
  `change([TOOLS[1]])`; the output carries a line `{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}`
  (parsed, `method` equals `'notifications/tools/list_changed'`), and the next `tools/list` returns
  `[TOOLS[1]]`.
- new `it('stops listening to the live list once closed')`: after `close()`, the fake's live listener count is `0`.
- `it('answers an unknown tool with a tool error naming the valid tools')` becomes
  `it('hands a call for any tool name to the session')`: a call named `ask` reaches the session; `calls[0].name` is
  `'ask'`. The unknown-tool text now belongs to `session-list.test.ts`.
- new `it('answers a call the session rejects as unknown with the error text')`: the session fake rejects
  `new Error('Unknown tool: x. Valid tools are .')`; a `tools/call` for `x` returns an error result
  (`isError` true) whose text content is `Error: Unknown tool: x. Valid tools are .`.

In `src/plugins/sessions/main/start.test.ts` (`describe('sessions main part')`): `startSessionsPart` returns the
started part (task 01 changed how it reads `exports`).
- new `it('disposes what a dependent registered through its view when its registrations dispose')`: two
  `createRegistrations()` stores, `dependent` and `bystander`, each with its own view (`started.exports(store)`).
  In this order: the bystander view connects host id `host-1`; the dependent view contributes one tool named `ask`
  whose fake start counts `end` calls, opens an owned session with host id `host-owned`, and connects host id
  `host-dep`. After `dependent.dispose()`: the fake's `end` count is `3` (one tool session per live session); a call
  to `ask` on `host-1` rejects with `'Unknown tool: ask. Valid tools are set_session_title.'`;
  `titles(<host-owned app id>)` and `titles(<host-dep app id>)` are `null` (both sessions ended); `titles(<host-1 app
  id>)` is not `null`. The close-guard wrap is the same one-line `consumer.track` and has no row here: the list test
  above owns the guard's handle.
- new `it('keeps a contribution live when the endpoint files cannot be written')`: start the part so the endpoint
  files cannot be written (the test makes the endpoint folder's path a regular file, or fails the write the way the
  file's existing write-failure test does if it has one); `contributeTools` returns a handle without throwing, a call
  to `ask` on a connected session still reaches the tool session, and the log the test passes to the part records
  one line for the failed write.

In `src/plugins/sessions/page/session-tabs-view.test.ts` (`describe('session tabs view')`; build the view as that
file's existing tests do):
- new `it('releases a live takeover when the tab handle is disposed')`: add two tabs `a` then `b` to one session,
  select `a`, call `takeOver()` on `b`'s handle (`b` is selected); `b`'s handle `dispose()`; `a` is selected and `b` is
  gone. A later `release()` on the takeover changes nothing.

In `src/plugins/sessions/page/consumer-view.test.ts` (new, `describe('sessionsPageView')`), over a fake
`SessionsPageExports` that records calls and returns a counting handle from `addTab`, `addRowPart` and `addBarPart`:
- `it('disposes the tabs and parts a consumer added when its registrations dispose')`: one tab, one row part, one bar
  part; after `consumer.dispose()`, each fake handle's dispose count is `1`.
- `it('clears each activity the consumer still holds when its registrations dispose')`: `setActivity('s1', 'src',
  NEEDS_YOU_ACTIVITY)`, `setActivity('s2', 'src', NEEDS_YOU_ACTIVITY)`, `setActivity('s2', 'src', null)`; after
  `consumer.dispose()`, the fake's recorded calls end with exactly one more call, `['s1', 'src', null]`.

Done when: compiles (`npm run typecheck`); the test gate runs the tests above; `npm run lint` passes
Commit:    one commit for the group

## Approach

1. `tools.json` is rewritten from `list.tools()` after each contribution added, as now. A disposal writes no file.
   Reason: quit stops every dependent before sessions (plan.md `stopAll`, reverse start order), so a rewrite on each
   disposal would leave `tools.json` with only `set_session_title` after quit, and the relay serves that file while
   the app is away. Every disposal in this plan comes from a stop, and a reload (Wave 4) adds the tools again.
2. A live contribution whose start throws for one entry undoes itself everywhere and rethrows, as a start at connect
   does today (`startToolSessions`).
3. `serveMcp` drops a `sendToolListChanged()` that rejects: the connection is closing.
4. The unknown-tool rejection is a plain `Error`. `callTool` returns it as `Error: Unknown tool: …`, through the
   existing thrown-error branch. The `serveMcp` test above pins that text at the client.
5. A contribution added while `serveMcp` is mid-`tools/list`, or before the connection resolves, is safe: `tools/list`
   reads the live list on each request, and the notice goes out once the connection resolves.

## Proof

