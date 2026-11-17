# 02 — Sessions hook route

Status: not started
Type: Task
Rung: deep · crosses the relay socket's lifecycle (a second line after the hello, a read timeout, a handler that rejects) and adds the seam 07 and 08 consume
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/relay/relay-server.ts` · create `src/plugins/sessions/main/relay/hook-routes.ts` · modify `src/plugins/sessions/main/session-list.ts` · modify `src/plugins/sessions/main/start.ts` · modify `src/plugins/sessions/main/consumer-view.ts` · test `src/plugins/sessions/main/relay/hook-routes.test.ts` · test `src/plugins/sessions/main/relay/relay-server.test.ts` · test `src/plugins/sessions/main/session-list.test.ts`
Consumes:  none (the tree holds `AgentSession`, `SessionInfo`, `RelayHello`, `jsonLine`, `readFirstLine`, `errorText`)
Produces:  in `wigley-ai-gui/src/plugins/sessions/contract.ts`:
           `export type HookHandler = (session: AgentSession, request: unknown) => Promise<Record<string, unknown>>;`
           `export type HookReply = { ok: true; reply: Record<string, unknown> } | { ok: false; error: string };`
           `RelayHello` gains `hook?: string | null;` (absent reads as null)
           on `SessionsMainExports`: `addHookHandler(name: string, handler: HookHandler): Disposable;`
           on `SessionsMainExports`: `project(sessionId: string): string | null;`
           in `wigley-ai-gui/src/plugins/sessions/main/relay/hook-routes.ts`:
           `export interface HookRoutes { add(name: string, handler: HookHandler): Disposable; answer(name: string, info: SessionInfo, request: unknown): Promise<HookReply>; }`
           `export function createHookRoutes(sessionOf: (info: SessionInfo) => AgentSession | null): HookRoutes`
           in `wigley-ai-gui/src/plugins/sessions/main/relay/relay-server.ts`:
           `RelayServerDeps` gains `hook(name: string, info: SessionInfo, request: unknown): Promise<HookReply>;`
           `RelayServerDeps` gains `hookTimeoutMs?: number;` (the default is `HOOK_REQUEST_TIMEOUT_MS`; a test passes 50)
           `export const HOOK_REQUEST_TIMEOUT_MS = 5_000;`
           in `wigley-ai-gui/src/plugins/sessions/main/session-list.ts`, on `SessionList`:
           `sessionOf(info: SessionInfo): AgentSession | null;`
Decisions:
- **Types.** The plan writes the handler as `(session, request: JsonSafe) => Promise<JsonSafe>`. `JsonSafe<T>` in `src/contracts/state.ts` is generic, so it cannot type a parsed line. The request is `unknown` (the handler parses it), and the reply is `Record<string, unknown>`, which `jsonLine` writes. The contract file imports only `src/contracts` and `src/shared/call-each` today; keep it so, and do not import `JsonObject`.
- **Wire (pinned).** A hook hello is a relay hello with a string `hook` field. After the hello line the client sends one JSON line, the request. The server writes one line, `jsonLine(reply)` of a `HookReply`, then calls `socket.end()`. The server writes no hello reply before it: the one line is the whole answer. A hello with a bad protocol or a mistyped field gets the refusal it gets today, `{ ok: false, error }`, which is also a valid `HookReply`.
- `mistypedHelloField` checks `hook` as optional string; `'hook'` joins `SESSIONS_HELLO_FIELDS`, so it never lands in `SessionInfo.host`.
- **Not held.** A hook hello does not wait on `deps.ready()` (the connect hold) and never calls `deps.connect`: a hook call opens no session and adds no row. The hold is for a relay that joins a row about to open; a hook has a short budget (07: 3 s in all).
- **Request read.** After the hello, read the next line with `readFirstLine` on the same socket. `readFirstLine` leaves the socket paused, so call `socket.resume()` after the second `readFirstLine` attaches its listener. Let `limit` be `deps.hookTimeoutMs ?? HOOK_REQUEST_TIMEOUT_MS`. Bound the read with `socket.setTimeout(limit)`; on `timeout`, reply `{ ok: false, error: 'no hook request line within <limit> ms' }` (with the default: `5000 ms`) and end. A line that is not JSON replies `{ ok: false, error: 'the hook request was not JSON' }`. Clear the socket timeout (`socket.setTimeout(0)`) once the line arrives.
- **Bound the handler.** After the line arrives, race `deps.hook(...)` against a timer of `limit` ms. When the timer wins, reply `{ ok: false, error: 'hook handler did not answer within <limit> ms' }` and end. Clear the timer when the handler settles first. Before every write to the socket, check `socket.destroyed` and skip the write when it is true: the client may have left (07 gives up after 3 s), and a late reply must not write to a closed socket. A handler that never settles then leaves no timer and no open socket behind.
- **Routes.** `createHookRoutes` keeps one handler per name. `add` throws `Error('hook handler <name> is already registered')` on a name another live registration holds; the returned `Disposable` frees the name, and a second `dispose` does nothing. `answer`:
  - no handler under `name` → `{ ok: false, error: 'no hook handler named <name>' }`
  - `sessionOf` returns null → `{ ok: false, error: 'no live session holds host id <id>' }` (`<id>` is `info.sessionId`, `none` for null)
  - handler rejects or throws → `{ ok: false, error: errorText(error) }`, and the route logs `hook <name> failed: <text>`
  - else → `{ ok: true, reply }`
  `answer` never rejects.
- **Identify the session as the relay does.** The hook hello carries `session_id`, `project_dir`, `harness`, `config_dir` and `row_id` (`WIGLEY_SESSION_ROW`, which an app-run Claude process and its hooks inherit); `sessionInfo(hello)` reads them as for a relay, `row_id` into `SessionInfo.rowId`. The route finds the live session in `connect`'s order (`session-list.ts` `connect`): `SessionList.sessionOf(info)` returns the owned entry `info.rowId` names while that entry has no host id, `info.sessionId` is null, or the two ids are equal; else the owned entry holding `info.sessionId`; else the first connected entry holding it (the `entriesHolding` filter); else null. A hook from a terminal Claude session finds the session its relay connected; one from an app-run session finds its owned row by row id, also before chat's `setHostSessionId` gives the row its host id and after a `/clear` or resume until chat moves it. The route does not create a session for an unknown id.
- **Exports.** `start.ts` builds the routes from `list.sessionOf`, passes `hook: (name, info, request) => routes.answer(name, info, request)` to `startRelayServer`, and adds `addHookHandler: (name, handler) => routes.add(name, handler)` to the exports. In self-test mode (no relay opened) `addHookHandler` still registers, so a self-test can call `routes` through a later drive action if it wants. `consumer-view.ts` files each `addHookHandler` registration with `consumer.track`, as it does `addToolCallGuard`.
- **`project(sessionId)`.** Returns the session entry's `project` (the name its row shows: namer, else origin repo, else folder), also for a connected session that has no row; null for a session not connected. 08 keys each session's room by it, since a terminal session has no row in `sessionsRowsSlot`. Write this comment on `project`: the value can change at a namer's `changed()` and when the origin lookup lands, so a caller reads it at each use. (`SessionRow.project` carries similar wording; `SessionsMainExports` has none yet.)
- Contract comments: write the `addHookHandler` and `project` comments in the style of the members around them (what it does, what it throws, the dispose rule).
- Every `SessionInfo` a test builds carries `rowId` (required since Lane H, `contract.ts` `SessionInfo`); a hook hello with no `row_id` reads as `rowId: null`, as `relay-server.test.ts`'s hello table already expects.
- The forms README hook bullet is 07's (same file as 03 in this wave). The `wigley-ai-gui/AGENTS.md` sentence on the hook route is 08's (04 edits that file in this wave).

GIVEN a handler registered under `chatroom.pre` and a connected session with host id `host-1` WHEN a client sends a hook hello `{ protocol: 1, session_id: 'host-1', hook: 'chatroom.pre', … }` and the line `{"tool":"edit"}` THEN the handler receives that session and `{ tool: 'edit' }`, the client reads one line `{"ok":true,"reply":{…}}`, and the socket closes
GIVEN a hook hello WHEN no request line arrives within 5,000 ms THEN the client reads `{"ok":false,"error":"no hook request line within 5000 ms"}` and the socket closes
GIVEN a hook hello WHEN the connect hold is up THEN the reply comes without waiting for it, and `connect` is never called

Tests:     `hook-routes.test.ts` › `answer_Outcomes` — one table, one row per outcome: handler found and resolves (`{ ok: true, reply }`, the handler got the session `sessionOf` returned and the request as sent); found by row id with a null host id; unknown name; null host id and no row id; unknown host id; handler rejects (`{ ok: false, error: <its message> }`); each row asserts the whole `HookReply`
           `hook-routes.test.ts` › `add_NameHeld_Throws` — a second `add` under a held name throws; after the first handle's `dispose`, `add` under that name succeeds
           `relay-server.test.ts` › `hookHello_RoutesOneRequest_RepliesAndCloses` — over the real channel, as the file's other tests: the fake `hook` dep receives name, `SessionInfo` and the parsed request; the client reads exactly one line, the dep's reply; the socket ends; `connect` is never called
           `relay-server.test.ts` › `hookHello_BadRequest_RepliesError` — a table: request line not JSON; no line within the timeout (the test passes `hookTimeoutMs: 50` and waits in real time, as the file's other tests do; no fake timers); each row asserts the exact error reply and that the socket ends
           `relay-server.test.ts` › `hookHello_HandlerNeverResolves_RepliesError` — `hookTimeoutMs: 50`, a fake `hook` dep whose promise never settles: the client reads `{"ok":false,"error":"hook handler did not answer within 50 ms"}` and the socket ends; a second row where the client destroys its socket first, then the dep resolves late: no write is attempted and no error is thrown
           `relay-server.test.ts` › `hookHello_WhileHeld_RepliesAtOnce` — beside `hello_WhileHeld_RepliesOnceReady`, with `ready` never resolving, a hook hello still gets its reply
           `session-list.test.ts` (existing file) › `sessionOf_ConnectOrder` — one table: a row id naming an owned entry with no host id → that entry; a row id naming an owned entry whose host id differs from a non-null `info.sessionId` → the host-id lookup instead; an owned entry over a connected one with the same host id; a row id naming a connected entry counts as none; unknown row id and host id → null
           `session-list.test.ts` › `project_ConnectedWithoutRow_ReturnsEntryProject` — a connected session with no row returns its folder-derived project; an unknown session id returns null
Done when: compiles; `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof
