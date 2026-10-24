# 05 — Index source registry in main

Status: in progress
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/contract.ts` · `src/plugins/docs/main/index-sources.ts` · `src/plugins/docs/main/start.ts`
           test `src/plugins/docs/main/index-sources.test.ts` · `src/plugins/docs/main/start.test.ts`
Consumes:  `IndexEntry` (schema 2) ← 03
Produces:  in `src/plugins/docs/contract.ts`:
           `export interface IndexSource { id: string; title: string; load(): Promise<IndexLoad>; rebuild?(): Promise<IndexLoad> }`
           `export interface SourceRead extends IndexLoad { title: string; canRebuild: boolean }`
           `export interface DocsMainExports { addSource(source: IndexSource): Disposable }`
           `DocsChannel.invoke.loadIndex(sourceId: string): Promise<SourceRead>`
           `DocsChannel.invoke.rebuildIndex(sourceId: string): Promise<SourceRead>`
           (`machineIndex`, `rebuild` and `sessionIndex` removed)
           in `src/plugins/docs/main/index-sources.ts`:
           `export interface IndexSourceRegistry { add(source: IndexSource): Disposable; load(id: string): Promise<SourceRead>; rebuild(id: string): Promise<SourceRead>; loadedEntries(): readonly IndexEntry[] }`
           `export function createIndexSourceRegistry(): IndexSourceRegistry`
           `export function createMachineSource(deps: IndexSourcesDeps): IndexSource`
           `export function createSessionSource(deps: IndexSourcesDeps, sessionId: string, spec: SessionSourceSpec): IndexSource`
           the docs main part's `exports: DocsMainExports`
Decisions: sources register by id; `addSource` throws on a taken id (round 1; round 2 notice) · one source per live
           session, `retainSessions` and `sessionKey` removed (round 1, Session sources) · `SourceRead` carries the
           title and whether a rebuild exists, so the page needs no second call (decided while planning) · titles
           `machine index` and `session index` keep the self-test's session lines (plan.md, pinned strings)

## Behaviour

- **Registry**:
  - `add` throws `Docs index source <id> is already registered` on a taken id. Its Disposable removes the source
    and its entries; a second `dispose` does nothing.
  - `load(id)` runs the source's `load` and returns its result with `title` and `canRebuild` (`rebuild` present).
  - `rebuild(id)` runs `rebuild`, or `load` for a source with none.
  - An unknown id rejects with `No docs index source <id>`.
  - Each result with a document replaces that source's kept entries. A result with none, or a throw, clears them;
    the throw still rejects.
  - `loadedEntries()` joins the kept entries of every registered source, in registration order.
  - A source disposed while its load runs keeps no entries from that load.
- **Machine source** (`id: 'machine'`, `title: 'machine index'`): `load` is today's `machineIndex` read, `rebuild`
  today's queued build then read, both unchanged in behaviour and messages.
- **Session source** (`id: 'session:<sessionId>'`, `title: 'session index'`): `load` is today's `sessionIndex(spec)`
  run, the Codex `context` route, the fallback and the 'no folder known' message unchanged; no `rebuild`.
- **Main start**:
  - The registry is created synchronously in `start` and returned through `exports: { addSource: registry.add }`,
    so a dependent plugin can add a source during its own start. The machine source and each session source are
    registered synchronously as wrappers `{ id, title, load: async () => (await inner).load(), rebuild: … }` around
    the source `createMachineSource` / `createSessionSource` builds once `startDocs` settles; the machine source's
    queued-build state lives in its one inner instance, and `canRebuild` is fixed at registration (machine: yes,
    session: no).
  - `sessions.connected` registers the session's source under the event's `id`, and `sessions.ended` disposes it.
  - `createDocFiles` reads `entries: () => registry.loadedEntries()`.
  - The `loadIndex` and `rebuildIndex` handlers replace the three old ones.
  - `dispose` also disposes every session source.

GIVEN a registered source WHEN `add` is called again with its id THEN it throws the message above
GIVEN a source with no `rebuild` WHEN `rebuild(id)` runs THEN its `load` runs and `canRebuild` is false
GIVEN two sources each loaded WHEN one is disposed THEN `loadedEntries` holds only the other's entries
GIVEN a source whose load is running WHEN it is disposed and the load then resolves THEN `loadedEntries` holds none
of its entries
GIVEN an unknown id WHEN `load` runs THEN it rejects `No docs index source session:x`
GIVEN docs main started WHEN a session connects and then ends THEN `loadIndex('session:<id>')` serves its index while
it lives and rejects after it ends

Tests:     `index-sources.test.ts`: the existing machine and session tests rewritten against `createMachineSource` and
           `createSessionSource` with their assertions unchanged; `add_TakenId_Throws`,
           `rebuild_NoRebuild_RunsLoad`, `dispose_DropsEntries`, `dispose_DuringLoad_KeepsNoEntries`,
           `load_UnknownId_Rejects`, `load_NoDocument_ClearsEntries`; the two `retainSessions_*` tests removed; the
           existing assertions on `loadedEntries()` (near lines 82, 110, 371–387) go through
           `createIndexSourceRegistry()` with the source added ·
           `start.test.ts`, with a fake api built after `startChatPart` in `src/plugins/chat/main/start.test.ts`:
           `sessionSource_RegisteredWhileConnected`, `exports_AddSource_ServedOverChannel`

GIVEN docs main started WHEN a plugin adds a source `x` through `exports.addSource` THEN the `loadIndex` handler
called with `x` returns its load with `title` set and `canRebuild: false`
Done when: `npm run typecheck`, `npm run lint` and the tests above pass. The page still calls the old methods
           until 06 lands, so `npm run typecheck` fails in `src/plugins/docs/page/docs-view.ts` only; that is
           expected inside the wave-3/4 series, and 06 makes it green.
Commit:    one commit for the group

## Proof
