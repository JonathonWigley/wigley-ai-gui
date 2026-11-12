# 07 — Backlog assistant and tools

Status: not started
Type: Task
Rung: hard · adds the assistant registration, its store adapter and two MCP tools that 08's page and the assistant session consume
Wave: 4 · Depends on: 02, 06
Plan: [plan.md](plan.md)

Backlog main registers one global assistant with `scoped-agents`, keeps its session record in plugin data, sends it
the staleness sweep on request, and gives it two tools: one reads what the user sees in Backlog, one sets a repo's
unstarted chunks through the chunk store.

Files:
- create `src/plugins/backlog/main/assistant.ts` · test `src/plugins/backlog/main/assistant.test.ts`
- create `src/plugins/backlog/main/backlog-tools.ts` · test `src/plugins/backlog/main/backlog-tools.test.ts`
- modify `src/plugins/backlog/contract.ts`
- modify `src/plugins/backlog/manifest.ts`
- modify `src/plugins/backlog/main/start.ts` · test `src/plugins/backlog/main/start.test.ts`

Consumes:
- `ScopedAgentRecord`, `ScopedAgentStore`, `ScopedAgentSpec` (with 02's added `owner: string`), `ScopedAgent`,
  `ScopedAgentsMainExports`, `scopedAgentsMainKey` in `src/plugins/scoped-agents/contract.ts` ← 02
- `ChunkStore` (`chunks`, `replaceUnstarted`), `ChunkPlan` in `src/plugins/backlog/main/chunk-store.ts` ← 06
- `BacklogChunk` in `src/plugins/backlog/contract.ts` ← 06
- `StalenessReader.entries()` in `src/plugins/backlog/main/staleness.ts`, `BacklogStaleness`, `RowKey` ← 05
- `BacklogRow`, `backlogRows` in `src/plugins/backlog/main/rows.ts` ← 05
- `sessionsMainKey`, `contributeTools`, `ToolDefinition`, `ToolSession`, `AgentSession`, `textResult`, `errorResult`
  in `src/plugins/sessions/contract.ts` — in the tree
- `backlogPlaceSlot` in `src/plugins/backlog/contract.ts`, `api.state.read` — in the tree

Produces:
- `src/plugins/backlog/contract.ts`:
  - `BacklogChannel.invoke` gains `sweep(repo: string): Promise<string>` (the assistant's sessionId)
  - `BacklogPlace` gains, each optional until 08 makes it required: `repo?: string | null; marked?: RowKey[];
    isReadyOnly?: boolean; isChunkedHidden?: boolean; isStaleFirst?: boolean; isDoneShown?: boolean;
    isAssistantShown?: boolean`
- `src/plugins/backlog/main/assistant.ts`:
  - `export const ASSISTANT_ID = 'assistant';`
  - `export const ASSISTANT_SCOPE = 'global';`
  - `export const ASSISTANT_TITLE = 'Backlog assistant';`
  - `export const ASSISTANT_INSTRUCTIONS: string` (text below)
  - `export function createAssistantStore(data: Pick<Files, 'read' | 'write'>, log: PluginLog): ScopedAgentStore`
  - `export function sweepMessage(repo: string, files: readonly string[], rows: readonly BacklogRow[], staleness: Readonly<Record<RowKey, BacklogStaleness>>): string`
- `src/plugins/backlog/main/backlog-tools.ts`:
  - `export const READ_BACKLOG_STATE_TOOL: ToolDefinition`
  - `export const SET_BACKLOG_CHUNKS_TOOL: ToolDefinition`
  - `export interface AssistantPlace { selectedKey: RowKey | null; repo: string | null; filter: string; marked: RowKey[]; isReadyOnly: boolean; isChunkedHidden: boolean; isStaleFirst: boolean; isDoneShown: boolean }`
  - `export function assistantPlace(place: BacklogPlace | undefined): AssistantPlace | null`
  - `export interface BacklogToolsDeps { scopeOf(session: AgentSession): Promise<string | null>; rows(): Promise<BacklogRow[]>; staleness(): Record<RowKey, BacklogStaleness>; chunks: Pick<ChunkStore, 'chunks' | 'replaceUnstarted'>; place(): AssistantPlace | null }`
  - `export function backlogStateText(state: { rows: readonly BacklogRow[]; staleness: Readonly<Record<RowKey, BacklogStaleness>>; chunks: readonly BacklogChunk[]; place: AssistantPlace | null }): string`
  - `export function startBacklogTools(deps: BacklogToolsDeps): (session: AgentSession) => ToolSession`

Decisions:
- **Registration** (interview: one global assistant, a scoped agent with scope `global`, run from the home folder,
  default profile, ids in backlog's plugin data; design review: a third use is one registration). In `start`:
  `api.dependency(scopedAgentsMainKey).addScopedAgent({ owner: backlogManifest.id, agentId: ASSISTANT_ID, folder: () => services.homeDir, instructions: () => Promise.resolve(ASSISTANT_INSTRUCTIONS), title: () => Promise.resolve(ASSISTANT_TITLE), store: createAssistantStore(api.data, services.log) })`.
  The service picks the default profile (02). The registration is filed with backlog's registrations through 02's
  `consumer.track`, so backlog needs no `dispose` for it. The manifest's `dependsOn.main` becomes
  `['docs', 'chat', 'sessions', 'scoped-agents']` (plan.md boundary rules). `dependsOn.page` is 08's.
- **Store adapter** (plan.md: `ScopedAgentStore` is a real seam; Backlog's plugin data adapter). File `assistant.json` in
  plugin data: `{ "<scope>": ScopedAgentRecord }`, in practice only `global`.
  - `read(scope)`: the scope's record, else null. A missing file reads as `{}`; an unreadable one, or a record that is
    not `{ sessionId: string, hostSessionId: string }`, logs `assistant.json unreadable; the assistant starts fresh`
    and reads as `{}`.
  - `write(scope, record)`: reads the file, sets the scope (or deletes it for null), writes it back. Calls run one
    after another, each after the one before settles.
  - `entries()`: one `{ scope, record }` per key, in key order.
  - `superseded()`: resolves null — a fresh launch replaces only a record whose session chat no longer holds.
  - `checkAsk()`: resolves — the assistant may launch at any time.
- **Instructions** (interview: the assistant's tools and landing per each repo's rules). `ASSISTANT_INSTRUCTIONS`,
  verbatim:

  ```text
  You are the Backlog assistant in wigley-ai-gui. In Backlog mode the user reviews the follow-ups of every repo on this machine, sees which ones are stale, groups them into chunks that one session each works, and starts those sessions. Every edit to a follow-up file goes through you.

  The user writes to you from the Backlog page, which you cannot see. Call read_backlog_state before you act on the cursor item, the marked rows or the filters: it gives every row with its staleness and chunk, the cursor item's full text, the marked rows, the filters and the chunks.

  Edit a follow-up file directly, in the shape it already has (wigley-ai-marketplace's skills/review/triage.md § The project's follow-ups). To group follow-ups into chunks, call set_backlog_chunks with a repo and its chunks. It replaces that repo's unstarted chunks, so pass every chunk the repo keeps. A chunk that has started cannot change.

  Land each change to a repo per that repo's own rules: its AGENTS.md and the user's git rules. Then report each change by repo and title.
  ```
- **Sweep** (interview: `W` sends the staleness sweep for the filtered repo to the assistant as a message). Handler
  `sweep(repo)`: the last load's homes (a load first when there is none) whose `repo` equals `repo`; none → reject
  `No Backlog repo <repo>`. Else `assistant.ask(ASSISTANT_SCOPE, sweepMessage(repo, files, rows, staleness.entries()))`,
  where `files` is every `followupFiles[].path` of those homes in load order and `rows` is `backlogRows(read)`
  filtered to `repo`. Resolves the ask's sessionId; the page refreshes its pane with it (08). `sweepMessage`, verbatim,
  with `<…>` filled:

  ```text
  Sweep <repo>'s follow-ups for staleness.

  Files:
  - <path>

  Items Backlog reads as stale or moved:
  - <title>: <level>; <commitsSince> commits since it was written; gone: <gonePaths joined by ", ", or none>

  Fix the file: remove each item whose work has landed, rewrite each item the code has moved past, and keep the rest. Check every item against the code, not only the ones listed. Land the change per <repo>'s own rules. Then report each change: the item's title, whether you removed, rewrote or kept it, and why.
  ```

  One `- <path>` line per file. The listed items are the repo's open rows (`done` false) whose staleness entry has level
  `stale` or `moved`, in row order. With none, the line under the `Items …` heading is
  `None: check every item against the code anyway.`
- **Tools** (interview: `read_backlog_state` and `set_backlog_chunks`; both refuse any session but the assistant).
  `start` calls `api.dependency(sessionsMainKey).contributeTools([READ_BACKLOG_STATE_TOOL, SET_BACKLOG_CHUNKS_TOOL], startBacklogTools(deps))`,
  as `src/plugins/practice/main/start.ts` does, with `scopeOf: (session) => assistant.scopeOf(session)`,
  `rows: async () => backlogRows(await backlog.load())`, `staleness: () => staleness.entries()`, `chunks: store`, and
  `place: () => assistantPlace(api.state.read(backlogPlaceSlot).get())`. The reader of the slot is made once in
  `start`. `startBacklogTools` follows `startPracticeTools` in `src/plugins/practice/main/practice-tools.ts`: a
  `switch` on the tool name, an unknown name rejects `no backlog tool "<name>"`, and `end` does nothing.
  - Each tool first awaits `deps.scopeOf(session)`; null gives `errorResult('read_backlog_state answers only the Backlog assistant session.')`
    or `errorResult('set_backlog_chunks answers only the Backlog assistant session.')`.
  - `READ_BACKLOG_STATE_TOOL`: name `read_backlog_state`; description, verbatim: `Read what the user sees in Backlog:
    every follow-up row across the repos with its staleness and chunk, the cursor item's full text, the marked rows,
    the filters and the chunks. Only the Backlog assistant session may call it.`; `inputSchema`
    `{ type: 'object', properties: {}, additionalProperties: false }`. It returns `textResult(backlogStateText(…))`.
  - `SET_BACKLOG_CHUNKS_TOOL`: name `set_backlog_chunks`; description, verbatim: `Replace one repo's unstarted chunks in
    Backlog. Each chunk is a name and the titles of that repo's follow-ups that one session works. Started chunks stay.
    Pass every chunk the repo keeps; an empty list removes the repo's unstarted chunks. Only the Backlog assistant
    session may call it.`; `inputSchema`:
    `{ type: 'object', properties: { repo: { type: 'string', description: "The repo, as Backlog's repo column shows it." }, chunks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', description: "The chunk's name." }, titles: { type: 'array', items: { type: 'string' }, description: "The follow-ups' titles, exactly as the file has them." } }, required: ['name', 'titles'], additionalProperties: false }, description: "Every unstarted chunk the repo keeps." } }, required: ['repo', 'chunks'], additionalProperties: false }`.
    Checks, in order: `repo` not a string, or no row has it → `errorResult('Refused: no follow-ups in <repo>.')`
    (`<repo>` as `JSON.stringify` gives a non-string); `chunks` not an array of objects with a string `name` and a
    `titles` array of strings → `errorResult('Refused: chunks must be a list of { name, titles }.')`. Then
    `chunks.replaceUnstarted(repo, plans, new Set(titles of the repo's rows))`; a rejection gives
    `errorResult(`Refused: ${errorText(error)}`)`. Success gives
    `textResult('Set <n> unstarted chunks for <repo>: <name> (<title count>), <name> (<title count>).')`, or
    `textResult('Set no unstarted chunks for <repo>.')` when `plans` is empty.
- **The page's place** (plan.md: `BacklogPlace` becomes the new shape and main reads it). The contract's `BacklogPlace`
  is the old page's until 08, so this task adds the new fields as optional members, and the old page compiles as it is.
  `assistantPlace(place)` returns null for `undefined` (the page never opened Backlog), else each field with its
  default for a missing one: `repo` null, `marked` `[]`, every `is…` flag false; `selectedKey` and `filter` as they are.
  08 makes the fields required, drops the old ones, and drops the defaults in `assistantPlace` that the compiler or the
  lint then flags. `isAssistantShown` is the page's alone; the tool does not read it.
- **`backlogStateText`** (interview: rows, staleness, cursor item, marked rows, chunks), verbatim shape with `<…>`
  filled; a `|` inside a table cell is written `\|`:

  ```text
  # Backlog

  ## View

  - Cursor: <repo> / <title>
  - Marked: <repo> / <title>; <repo> / <title>
  - Repo filter: <repo>
  - Text filter: "<filter>"
  - Ready only: <yes|no> · Chunked hidden: <yes|no> · Stale first: <yes|no> · Done shown: <yes|no>

  ## Cursor item

  ### <title>

  Repo: <repo> · File: <path>:<line> · Tags: <tags joined by ", ", or none>
  Staleness: <level>; written <writtenAt, or unknown>; <commitsSince> commits since; gone: <gonePaths joined by ", ", or none>; named: <namedPaths joined by ", ", or none>

  <oneLine>

  <body>

  ## Chunks

  - <name> (<repo>), <started: session <sessionId>|not started><, headless when headless>: <title>; <title>

  ## Rows

  ### <repo>

  | Title | Ready | Staleness | Chunk |
  |---|---|---|---|
  | <title> | <yes|no> | <level> (<commitsSince> since, <gonePaths count> gone) | <chunk name, or —> |
  ```

  Rules: with no place, the `## View` section is the one line `The Backlog page has not been opened.` and there is no
  `## Cursor item` section. `Cursor: none` when `selectedKey` is null or no row has it, and then no `## Cursor item`
  section. `Marked: none` for an empty list, and a marked key no row has is left out. `Repo filter: all repos` for
  null; `Text filter: none` for `''`. `## Chunks` holds the line `None.` when there are no chunks. Rows are the open
  rows, plus the done rows when `isDoneShown` is true, grouped under one `### <repo>` per repo in row order. `Ready` is
  `yes` when the row's tags hold `agent-ready`. A row with no staleness entry yet shows `not read yet` in its
  Staleness cell. A row's Chunk cell is the name of the chunk whose repo and titles hold it.
- **Self-test**: no key behaviour changes in this task (the `W` key and the assistant pane are 08's), so no self-test
  group is added here. Fixture: no change.

GIVEN a session `scopeOf` does not know WHEN it calls either tool THEN it gets the refusal text and nothing is read or
written.

GIVEN the assistant session WHEN it calls `set_backlog_chunks` with `{ repo: 'r', chunks: [{ name: 'One', titles: ['A', 'B'] }] }`
THEN the store's unstarted chunks of `r` are exactly `One` with A and B, and the result text is
`Set 1 unstarted chunks for r: One (2).`

GIVEN a cursor on row `r\nA` and two marked rows WHEN the assistant calls `read_backlog_state` THEN the text names
`Cursor: r / A`, both marked rows, and A's full body under `## Cursor item`.

GIVEN repo `r` with one stale row WHEN the page invokes `sweep('r')` THEN the assistant's `ask` gets `global` and the
sweep text listing that row, and the invoke resolves the ask's sessionId.

Tests:
- `assistant.test.ts` (memory files as plugin data):
  - `store_WriteReadEntries_RoundTrips` — write `global`, read it back, `entries()` lists it; write null deletes it.
  - `store_FileUnreadable_LoggedAndEmpty`.
  - `store_SupersededAndCheckAsk_NullAndResolves`.
  - `sweepMessage_StaleAndMovedRows_ListedInRowOrder` — exact text for two files and one `stale`, one `moved`, one
    `fresh` and one done `stale` row (the last two not listed).
  - `sweepMessage_NoStaleRows_NoneLine`.
- `backlog-tools.test.ts`:
  - `tools_SessionNotTheAssistant_Refused` — `it.each` over both tool names, asserting the exact refusal.
  - `readBacklogState_PlaceAndRows_ExactText` — one full expected text for two repos, a cursor, one marked row, one
    chunk and one row with no staleness entry.
  - `readBacklogState_NoPlace_PageNotOpenedLine`.
  - `backlogStateText_CellWithPipe_Escaped`.
  - `setBacklogChunks_Cases` — rows: repo with no rows; `chunks` not a list; a store rejection (its text after
    `Refused: `); success with one plan; success with an empty list.
  - `assistantPlace_MissingFields_Defaults` — undefined → null; an old-shape place → defaults.
- `start.test.ts`, added to `describe('backlog main part')`: `start_RegistersTheAssistant` (a fake `scoped-agents`
  export records the spec: owner `backlog`, agentId `assistant`, folder the home folder); `sweep_KnownRepo_AsksTheAssistant`;
  `sweep_UnknownRepo_Rejects`; `start_ContributesBothTools` (a fake `sessions` export records the two tool names).

Done when: `npm run typecheck` passes; `npm test -- src/plugins/backlog` passes; `npm run lint` passes. The live
assistant chat, its tool calls and the sweep are `10-final-verification.md`'s.

Commit: one commit for the group.

## Proof
