# 05 — Sessions offline tools

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts` ·
           modify `src/plugins/sessions/main/start.ts` · modify `src/plugins/sessions/main/relay/endpoint.ts` ·
           create `src/plugins/sessions/main/offline-calls.ts` ·
           test `src/plugins/sessions/main/offline-calls.test.ts` · test `src/plugins/sessions/main/session-list.test.ts` ·
           test `src/plugins/sessions/main/relay/endpoint.test.ts` · test `src/plugins/sessions/main/start.test.ts`

Consumes:  the offline file shapes in plan.md § Shared names and shapes › Offline files (the env var
           `WIGLEY_FORMS_OFFLINE`, `<endpoint dir>/offline.json`, the calls file line shape) ← 04, pinned in plan.md
           `ToolResult`, `ToolCallContext`, `ToolCallGuard`, `ContributeToolsOptions.mainAgentOnly` in
           `src/plugins/sessions/contract.ts` (tree)
           `appEndpointDir(paths, homeDir, instanceId)` in `src/shared/app-endpoint-dir.ts` (tree)
           `createEndpointWriter(files, paths, dir, log)` and its `EndpointWriter` in
           `src/plugins/sessions/main/relay/endpoint.ts` (tree; this task grows `write`)
           `Files.deleteFile`, `Files.rename`, `isMissingFile` in `src/contracts/files.ts` (tree)

Produces:  in `src/plugins/sessions/contract.ts`, as plan.md gives them word for word:
           `export interface OfflineAnswer { readonly result: ToolResult; readonly replay: boolean; }`
           `ContributeToolsOptions.offline?: Readonly<Record<string, OfflineAnswer>>`
           `SessionsMainExports.offlineEnv(): Readonly<Record<string, string>>`
           `SessionsMainExports.replayCalls(hostSessionId: string): Promise<number>`
           `GuardedToolCall.replayed: boolean` (`readonly`), with its comment as plan.md gives it
           in `src/plugins/sessions/main/offline-calls.ts`:
           `export const OFFLINE_ENV = 'WIGLEY_FORMS_OFFLINE';`
           `export const OFFLINE_CALLS_FOLDER = 'offline-calls';`
           `export interface OfflineCall { tool: string; arguments: unknown; toolUseId: string | null; at: number; replay: boolean; }`
           `export function replayOfflineCalls(deps: { files: Files; paths: Paths; folder: string; route(call: OfflineCall): Promise<unknown>; log: PluginLog }, hostSessionId: string): Promise<number>`
           in `src/plugins/sessions/main/session-list.ts`, on `SessionList`:
           `offlineTable(): Record<string, OfflineAnswer>`
           `replayCall(hostSessionId: string, call: OfflineCall): Promise<ToolResult>`
           in `src/plugins/sessions/main/relay/endpoint.ts`:
           `EndpointWriter.write(endpoint: RelayEndpoint, tools: ToolDefinition[], offline: Readonly<Record<string, OfflineAnswer>>): void`

## Decisions

- **The offline table.** `session-list.ts` keeps each contribution's `offline` record on its `Contribution`.
  `offlineTable()` merges the records of the live contributions, in contribution order, into one record by tool name.
  A disposed contribution's entries leave the table with its tools. A tool left out of every record is not in the
  table. Reason: plan.md § Decided by the agent, "Offline answers per tool name".
- **A bad offline name throws.** `contributeTools` throws `Offline answer names the tool "<name>", which the
  contribution does not list` when `options.offline` holds a key that is not a tool name of the same contribution.
  It throws before it starts any tool session or records any name, as the duplicate-name checks do now. Reason: a
  typo in a key would silently make a tool answer "did not run".
- **`offline.json` rides on every endpoint write.** `EndpointWriter.write` writes `offline.json` beside
  `tools.json`, as `{ "tools": <table> }`, in the same queued job, through `files.write` (atomic). Order:
  `endpoint.json`, `tools.json`, `offline.json`. A failed write is logged as today's are. `start.ts` changes its
  call to `endpointWriter.write(opened.endpoint, list.tools(), list.offlineTable())`, so each `contributeTools`
  passes the table. A disposal and a stop still leave the files, and a stop still awaits `endpointWriter.flushed()`.
  The self-test still writes no file.
- **`offlineEnv()`** returns `{ WIGLEY_FORMS_OFFLINE: <endpoint dir>/offline-calls }`, the path built with
  `api.services.paths.join(endpointDir, OFFLINE_CALLS_FOLDER)`. `start.ts` passes `appEndpointDir(...)` inline to
  `createEndpointWriter` now: hoist it into a `const endpointDir` that both `createEndpointWriter` and `offlineEnv`
  read. It returns `{}` when the part opened no relay (the
  self-test, `opened === null`). A drive run returns its own home's folder. It creates no folder: the relay creates
  the folder when it writes the first line (task 04).
- **`replayCalls(hostSessionId)`** calls `replayOfflineCalls` with `files` and `paths` from `api.services`, `folder` =
  the calls folder, `route` = `(call) => list.replayCall(hostSessionId, call)` and `api.services.log`. It runs in the self-test too, where it
  finds no file and resolves to 0.
- **`replayOfflineCalls` is the deep module.** It holds the file name, the line format, the order and the delete:
  - The file is `<folder>/<hostSessionId>.jsonl`. A `hostSessionId` that is empty, `.`, `..`, or holds `/` or `\`
    rejects with `Not a host session id: <id>` and reads nothing.
  - It reads, renames and deletes through `Files`. It first claims the file: `files.deleteFile` on
    `<id>.jsonl.replaying` (an earlier run's leftover; nothing there is no error), then `files.rename` of
    `<id>.jsonl` to `<id>.jsonl.replaying` (`rename` refuses an existing target, so the delete comes first). A
    rename rejection that `isMissingFile` matches resolves to 0 and routes nothing. Any other rename or read
    error rejects. Reason: the relay may still append while the app replays (an
    attached run's call answered offline during a hold). It opens the file by name for each line (task 04), so a
    line it writes after the rename goes to a new `<id>.jsonl` and is not deleted unread. That new file waits for the
    next `replayCalls` of the same id; task 17 calls it at adoption only, so such a line is not replayed in this run
    of the app (accepted: it needs a call answered offline after the app opened). A `.replaying` file that a crash
    left stays until the next replay of that id replaces it, and is never read.
  - It reads the claimed file once, then handles each non-empty line in file order. A line that does not parse as
    JSON, or is not an object with a string `tool`, a boolean `replay`, a number `at` and a `toolUseId` that is a
    string or null, is logged as `offline call line <n> of <id> not read: <reason>` and skipped. A missing
    `arguments` reads as `{}`.
  - A line with `replay: false` is skipped with no log.
  - Each replayable call is routed with `await route(call)` before the next one starts, so step and checklist
    reports apply in the order the run made them. A route that rejects is logged as
    `offline call <tool> of <id> not replayed: <error>`, and the next line still routes.
  - After the last line it calls `files.deleteFile` on the claimed file. A failed delete is logged, and the call
    still resolves.
  - It resolves to the number of calls it routed, rejected routes included.
  - It imports no `node:` module, as `relay/endpoint.ts` imports none: `Files.deleteFile` deletes for good, so a
    calls file does not reach the Trash. On Node a late relay append after the claim opens a new `<id>.jsonl`,
    because the adapter moves a file by hard link. Sessions' `PLUGIN_EXTRAS` main entry keeps its
    `packages: ['node:']`; this task neither needs nor edits it.
- **`replayCall` goes through the normal call path.** `SessionList.replayCall(hostSessionId, call)` finds the owned
  entry whose `info.sessionId` is `hostSessionId` (else a connected one). It calls the existing `routeCall` with
  `call.tool`, `call.arguments`, a context of `{ toolUseId: call.toolUseId, signal: <a new AbortController's
  signal> }`, and a new private `replayed` flag set to true; every live call passes false. `routeCall` puts the flag
  on the `GuardedToolCall` as `replayed`. So every tool-call guard sees the call, `mainAgentOnly` included, and knows
  it is a replay. It rejects with `No session holds host <id>` when no entry holds the id. The caller drops the
  result.
- **Why `replayed`.** Chat's caller guard (task 14) names a call's agent from the `toolStarted` notes it holds. A
  live call whose note has not come yet waits up to `CALLER_WAIT_MS` and then runs. A replayed call's note never
  comes: a resting row reads only its saved history, which holds only the main agent's calls (Claude's transcript
  reader skips sidechain lines). So for a replayed call the guard reads the notes without waiting, and a call that no
  note names as the main agent's is skipped (task 14). Without the flag, a subagent's `set_session_title` or
  `set_workflow_step` from a run that finished while the app was closed would apply as the main agent's, after a
  2 s wait each.
- **`consumer-view.ts` needs no edit.** `sessionsMainView` spreads `exports`, so the two new members pass through.
  The task checks this and leaves the file unchanged.
- **`mcp/mcp-server.ts` needs no edit.** The app side gets replayed calls through `replayCall`, not over MCP.
- **Ordering is the caller's.** `replayCalls` does not wait for any transcript replay. Task 17 calls it after
  `chat.adopt` resolves, and `adopt` resolves only after chat noted the run's callers (task 14; plan.md § Flow).
- **Existing `GuardedToolCall` literals** in tests (`tool-callers.test.ts`, the sessions tests) gain
  `replayed: false`; the compiler names each one.

GIVEN a contribution with `offline: { ask: { result: textResult('x'), replay: false } }` WHEN the live part writes the
endpoint files THEN `offline.json` holds `{ "tools": { "ask": { "result": { "content": [{ "type": "text", "text": "x" }] },
"replay": false } } }`

GIVEN a contribution whose `offline` names a tool it does not list WHEN `contributeTools` runs THEN it throws, and no
tool of it is listed or routed

GIVEN a calls file with a replay line, a non-replay line, a bad line and a second replay line WHEN `replayCalls` runs
THEN both replay calls reach the tool session in file order, the bad line is logged, the file is gone, and it
resolves to 2

GIVEN a replay call from a subagent's `toolUseId` and a guard that skips it WHEN `replayCall` routes it THEN the
handler does not run

GIVEN `replayCall` and a live call of the same tool WHEN each reaches a guard THEN the guard sees `replayed: true`
for the first and `replayed: false` for the second

GIVEN a calls file WHEN the relay appends a line while `replayCalls` routes the earlier ones THEN the new line is in a
new `<id>.jsonl` after the call, and the claimed file is gone

GIVEN the self-test WHEN a plugin calls `offlineEnv()` THEN it returns `{}`

## Tests

- `src/plugins/sessions/main/offline-calls.test.ts` (new; memory files and `posixPaths`, as `endpoint.test.ts` does; run `npm run lint` to see whether the test needs a
  layer entry, since `start.test.ts` in the folder imports `posixPaths` with none):
  - `routes each replayable line in order and deletes the file` — `it.each` rows over file contents:
    `{ case, lines, routed: string[] /* tool names */, count, logs }`. Rows: replay and non-replay lines mixed
    (only replay ones routed, in order); a line that is not JSON (logged, skipped, later lines routed); a line
    missing `replay` (logged, skipped); an empty trailing line (ignored); a line with no `arguments` (routed with
    `{}`). Every row asserts `<id>.jsonl` and `<id>.jsonl.replaying` are both gone after the call.
  - `resolves to 0 and routes nothing when the session has no calls file`.
  - `a line appended during the replay survives in a new calls file` — the `route` fake appends one line with
    `files.append(<folder>/<id>.jsonl, …)` when it is called the first time; after the call that file holds that line only, and
    the claimed file is gone. Break: a read-then-delete of one path that drops the late line.
  - `logs a route that rejects and still routes the next line` — the count includes the rejected call.
  - `rejects a host session id that is not one path segment, reading nothing` — rows `''`, `'.'`, `'..'`, `'a/b'`,
    `'a\\b'`; a file placed at `<folder>/../x.jsonl` stays.
- `src/plugins/sessions/main/session-list.test.ts` (add):
  - `offlineTable lists each live contribution's offline answers by tool name` — two contributions, one with two
    entries and one with none; then one disposes and its entries leave.
  - add a row to the existing duplicate-name throw cases (`throws on a tool name two contributions share` and its
    sibling) or a new `it`: an `offline` key the contribution does not list throws, and `tools()` and a call of the
    contribution's tool show it was not added.
  - `replayCall routes through every guard with the line's toolUseId` — a guard records the `GuardedToolCall`
    (asserts `toolUseId`, `mainAgentOnly: true` for a main-agent-only tool, and `replayed: true`); a live call of the
    same tool records `replayed: false`; a `skip` verdict leaves the handler uncalled; an unknown host id rejects
    `No session holds host`.
- `src/plugins/sessions/main/relay/endpoint.test.ts` (change):
  - `writes the endpoint and the tool list into a folder it creates` also asserts `offline.json` equals
    `{ tools: offline }`.
  - `replaces the files of an earlier start and leaves no temp file`: its `files.list(dir)` row becomes
    `['endpoint.json', 'offline.json', 'tools.json']`.
  - Every `writer.write(...)` call in the file gains the `offline` argument (`{}` where the test is not about it).
    `writes in call order behind a held write` also asserts `offline.json` follows the later call.
- `src/plugins/sessions/main/start.test.ts` (add, through `startSessionsPart` with `runMode: 'live'`, `homeDir` from `relayHome()` and a `createMemoryFiles()`
  passed as `files`; the endpoint write is queued, so write and read the files through that `files`, reading
  `offline.json` after `vi.waitFor` or after `dispose`):
  - `offlineEnv names the calls folder in a live run and is empty in the self-test` — rows `live` →
    `{ WIGLEY_FORMS_OFFLINE: <home>/.agents/app/offline-calls }`, `selfTest` → `{}`.
  - `replayCalls routes a calls file to the owned session holding its host id` — open an owned session for
    `host-1`, contribute a fake tool, write `<home>/.agents/app/offline-calls/host-1.jsonl` into the memory files, expect the fake's call
    and a resolved 1, and the file gone.
  - `writes each contribution's offline answers to offline.json` — one contribution with an `offline` entry; read the
    file from the endpoint folder through the memory files.

## Done when

`npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. The relay's use of these files with a
real `claude -p` run defers to task 21 (Final verification).

## Commit

One commit for the group: "Sessions writes an offline answer table beside tools.json, names the offline calls folder
for host-fired runs, and replays a run's logged calls through the normal call path and its guards."

## Proof

Commit f12e30333 · proof: diff read: Produces present; wave 1 typecheck and lint pass after 8b8a40c12 · concerns: added replayed:false to chat test literals (outside Files, typecheck needs them); relay/endpoint.ts imports node:path, the task said none
