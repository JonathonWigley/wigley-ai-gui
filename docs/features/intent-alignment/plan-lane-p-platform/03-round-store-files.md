# 03 — Round store through Files

Status: not started
Type: Task
Wave: 3 · Depends on: 02 (shared `channel-presenter.ts` and its test, forms' and primer's `main/start.ts`,
`master-plan.md`, `followups.md`)
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/files.ts` (`write`'s comment, the new `deleteFile`)
- modify `src/main/files/node-files.ts` · test `src/main/files/node-files.test.ts`
- modify `src/shared/memory-files.ts` · test `src/shared/files-contract.test-support.ts` (shared cases both adapters run)
- modify `src/shared/scoped-files.ts` (`deleteFile` through `inside`)
- modify `src/shared/plugin-part-harness.test-support.ts` (`countingWatches` forwards `deleteFile`)
- modify `src/contracts/agent-forms.ts` (`AgentFormListener.draft`, `AgentFormInvoke.draft`)
- modify `src/shared/agent-forms/form-store.ts` · test `src/shared/agent-forms/form-store.test.ts`
- modify `src/shared/agent-forms/memory-form-store.ts` · test `src/shared/agent-forms/memory-form-store.test.ts`
- modify `src/shared/agent-forms/form-service.ts` · test `src/shared/agent-forms/form-service.test.ts`
- modify `src/shared/agent-forms/channel-presenter.ts` (the `draft` handler) · test
  `src/shared/agent-forms/channel-presenter.test.ts`
- modify `src/shared/agent-forms/scripted-presenter.ts` (`draft` returns the listener's promise)
- modify `src/plugins/forms/contract.ts` · `src/plugins/forms/main/start.ts` · test `src/plugins/forms/main/start.test.ts`
  · test `src/plugins/forms/main/round-type.test.ts`
- modify `src/plugins/primer/contract.ts` · `src/plugins/primer/main/start.ts` · test
  `src/plugins/primer/main/start.test.ts`
- modify `src/plugins/sessions/main/relay/endpoint.ts` · test `src/plugins/sessions/main/relay/endpoint.test.ts`
- modify `src/plugins/sessions/main/start.ts` · test `src/plugins/sessions/main/start.test.ts`
- modify `AGENTS.md` (§ Architecture, the `files/` line) · `docs/features/intent-alignment/master-plan.md` ·
  `docs/features/followups.md`

Consumes: none from 02's Produces. 02 adds the `alertNoun` dep to the same `createAgentFormChannelPresenter` calls in
forms' and primer's `start.ts`; keep it.

Produces:
- `src/contracts/files.ts`, `Files` gains:
  ```ts
  // Deletes the file at `path` for good; nothing there is no error. Rejects for a
  // folder, keeping it.
  deleteFile(path: string): Promise<void>;
  ```
  `write`'s comment gains: `The Node adapter tries a rename that fails with EPERM or EBUSY (a file another process
  holds open, as on Windows) again, up to 4 more times, 10, 20, 40 and 80 ms apart, then rejects with the last
  error.` `writeBytes` says the same through "through the same temp file".
  The name is `deleteFile`, not `remove`: `MemoryFiles` already has a sync test-only `remove(path): void` that also
  removes folders, and its signature cannot extend a `Promise<void>` member of the same name.
- `src/shared/agent-forms/form-store.ts`, `AgentFormStore` becomes (unchanged members not repeated: `create`,
  `createAutoAnswered`, `finish`, `markReturned`, `newestFor`, `newestUnreturnedFinished`, `newestOwned`,
  `recentArgs` keep their signatures and stay sync):
  ```ts
  // Reads the folder into the index and starts watching it. Never rejects: a
  // failure is logged. A second call returns the first call's promise.
  load(): Promise<void>;
  // A finished form keeps the body it finished with: a late draft is dropped and
  // the promise resolves. Rejects with an Error naming the form and the disk's
  // reason when the write fails.
  saveBody(record: SavedAgentForm, body: unknown): Promise<void>;
  // Settles once every disk step queued before the call has settled.
  flushed(): Promise<void>;
  ```
  `prune(): void` leaves the interface (Decision 9). `createFolderFormStore(deps: { files: Files; dir: string;
  clock: Clock; randomHex: RandomHex; paths: Paths; log: PluginLog }): AgentFormStore` — one new dep `files`. The
  file imports no `node:fs` and no `node:path`.
- `src/shared/agent-forms/form-service.ts`:
  ```ts
  // `service` whose sessions' `open` and `collect` run once `loaded` settles;
  // `end` and `detach` run at once.
  export function afterLoad<Payload>(
    loaded: Promise<void>,
    service: AgentFormService<Payload>,
  ): AgentFormService<Payload>;
  ```
- `src/contracts/agent-forms.ts`: `AgentFormListener<Body>.draft(body: Body): Promise<void>` (comment: rejects with an
  Error naming the reason when the draft could not be saved; a form no longer open ignores the draft and resolves);
  `AgentFormInvoke<Form, Body>.draft(formId: string, body: Body): Promise<void>`.
- `src/plugins/forms/contract.ts`, beside `FormBody` (the saved round body):
  ```ts
  // The saved-round folder under the home, which the marketplace's retro reads.
  export const SAVED_ROUNDS_FOLDER = '.agents/wigley-forms/rounds';
  ```
- `src/plugins/primer/contract.ts`, beside `PRIMER_ERROR_NAME`:
  ```ts
  // The saved-primer folder under the home.
  export const SAVED_PRIMERS_FOLDER = '.agents/wigley-primer/primers';
  ```
- `src/plugins/sessions/main/relay/endpoint.ts`:
  ```ts
  export interface EndpointWriter {
    // Queues one write of both files with this endpoint and tool list; returns at once.
    write(endpoint: RelayEndpoint, tools: ToolDefinition[]): void;
    // Settles once every write queued before the call has settled.
    flushed(): Promise<void>;
  }
  export function createEndpointWriter(files: Files, dir: string, log: PluginLog): EndpointWriter;
  ```
  `writeEndpointFiles` goes (its only callers are `sessions/main/start.ts:272` and `endpoint.test.ts`).
  `endedDriveRunLaunch` is unchanged; the file keeps `node:path` for it and for `path.join`, and imports no `node:fs`.

Callers of each changed contract (checked with grep at plan time; each list is complete):

| Contract | Callers and implementers |
|---|---|
| `Files` gains `deleteFile` | full implementers: `src/main/files/node-files.ts`, `src/shared/memory-files.ts`, `src/shared/scoped-files.ts` (`scopedFiles`), `src/shared/plugin-part-harness.test-support.ts` (`countingWatches`). Every other `Files` literal spreads a base (`...memory`, `...files`) or is a `Pick`/`as Files` cast, and needs no edit. Caller: `form-store.ts` prune |
| `createFolderFormStore` | `src/plugins/forms/main/start.ts:75`, `src/plugins/primer/main/start.ts:83`, `form-store.test.ts:34`, `form-service.test.ts:156`, `round-type.test.ts:189` |
| `AgentFormStore.saveBody`, `load`, `flushed`, `prune` | implementers `form-store.ts`, `memory-form-store.ts`; `saveBody` caller `form-service.ts:476`; `prune` callers `forms/main/start.ts:82`, `primer/main/start.ts:90`, `form-store.test.ts:374,398`, `memory-form-store.test.ts:139` |
| `AgentFormListener.draft` | implementer `form-service.ts` `formListener`; callers `channel-presenter.ts:86`, `scripted-presenter.ts:39`; test fakes `channel-presenter.test.ts:100,330,377,397` |
| `AgentFormInvoke.draft` | handler `channel-presenter.ts:80`; page invokes `src/plugins/forms/page/start.ts:206`, `src/plugins/primer/page/start.ts:221` (they already use the returned promise; no edit) |
| `writeEndpointFiles` | `src/plugins/sessions/main/start.ts:272`, `endpoint.test.ts` |

Decisions:

1. **Rename retry** (plan.md Decided, "The rename retry on `EPERM`/`EBUSY` lives in `Files.write` and `writeBytes`
   (node adapter), for every caller"). In `writeAtomically`, only the `rename(temp, file)` step retries. The delays
   are one constant `RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80]`: try the rename; on `EPERM` or `EBUSY` wait the next
   delay and try again; after the 4th delay try once more (5 tries in all); then throw the last error. Any other code
   throws at once. The wait is `setTimeout` from `node:timers/promises` (a plain await), so the test mocks that
   module. The existing `catch` still removes the temp file on the final failure. `renameWithoutReplacing` (`Files.rename`)
   gets no retry.
2. **`deleteFile`**: the Node adapter runs `rm(path, { force: true })` (no `recursive`, so a folder rejects). The
   memory adapter deletes the file and reports its path to the watches over it, as `remove` does; a missing path
   resolves; a folder rejects with `code: 'ERR_FS_EISDIR'`, as Node's `rm` does. `scopedFiles` forwards
   `files.deleteFile(inside(path))`.
3. **The index** (plan.md Decisions, "Round store"). The folder store keeps a `Map<id, SavedAgentForm>`. Every read
   (`newestFor`, `newestUnreturnedFinished`, `newestOwned`, `recentArgs`) answers from it through `formQueries`,
   sync, and reads no disk. Every write call (`create`, `createAutoAnswered`, `saveBody`, `finish`, `markReturned`)
   changes the record and stamps `updated` at once (as `writeRecord` does today), puts that record object in the
   index under its id, and queues the disk write. The index holds a record whose write failed: the reads find it for
   the rest of the run.
4. **One ordered queue** (plan.md Decisions, "Round store": "every other write runs in order behind it"). Every disk
   step of a store runs in one queue, in call order, one at a time: the writes, the load scan, the prune, each
   watch-reported re-read and each rescan. Use `createSerialQueue` from `src/shared/serial-queue.ts` (as
   `src/plugins/notes/main/draft-store.ts` does): a rejection reaches only its own caller, so the next step still runs.
   `flushed()` is its `settled()`. A write's text is
   `JSON.stringify(record)` taken when the write is queued, written with `files.write(paths.join(dir, `${id}.json`),
   text)`.
5. **Failures**. `saveBody`'s promise settles with its own write: it rejects with
   `Error('could not save form <id>: <reason>', { cause })` (today's text). `create`, `createAutoAnswered`,
   `finish` and `markReturned` log that same text and throw nothing. A failed `markReturned` gets the adapter's
   rename retry (Decision 1) and no retry of its own; the index keeps `returned: true`, so this run never hands the
   form back again (plan.md Decided, "A failed `markReturned` retries through the adapter, logs, and the index still
   holds the form returned").
6. **The draft path shows a rejection**. `formListener.draft` returns `session.store.saveBody(...)`; a form already
   ended or closed returns `Promise.resolve()`. `open.latestBody` is set before the save, as today, so a failed
   save still reaches the reply. The channel presenter's `draft` handler returns `entry.listener.draft(body)` (an
   unknown `formId` returns `undefined`), so the page's `invoke('draft', …)` rejects with the reason and the page
   shows the draft unsaved, as today. `ScriptedFormPresenter.draft` returns the listener's promise.
7. **Watch** (plan.md: "`Files.watch` refreshes the index; macOS `onMissed` → rescan"). `load` first calls
   `files.watch(dir, onChange, { recursive: false, onMissed, onError })`, then queues the scan. A watch that throws
   at start logs `form folder not watched: <reason>` and the scan still runs (test: a `form-store.test.ts` row with a
   `files.watch` that throws finds a pre-written form after `load()`; and a row beside `keeps a form whose write is
   still queued when a rescan misses its file`: a form whose create write failed is still found after a rescan); `onError` logs
   `form folder watch failed: <reason>`. The watch is made through the plugin's `services.files`, so the plugin's
   stop disposes it (`trackedFiles`); the store has no `dispose`.
   - `onChange(name)`: a name that ends in `.json` and does not start with `.` queues a re-read of that one file.
   - `onMissed()`: queues one rescan; while a rescan is queued and not yet started, another `onMissed` queues none.
8. **Merge rule** (scan, rescan and re-read alike). A file read is `readIfPresent(files, path)` then
   `savedFormFrom(JSON.parse(text))`. For each id:
   - a readable file whose `updated` is greater than the index entry's, or with no index entry, replaces the entry
     with the record read;
   - a readable file whose `updated` is equal or less keeps the index entry (the store's own write, or an echo of an
     older one);
   - a missing, corrupt or non-object file drops the index entry, unless a write of that id is still queued or the
     id's last write failed. The store counts its queued writes per id, and keeps the set of ids whose last write
     failed (an id leaves it when a later write of it succeeds), so Decision 3 holds through a rescan;
   - a read that rejects for any other reason (`EBUSY`, `EPERM`, `EACCES`: another process holds the file) keeps the
     index entry, logs `could not read <name>: <reason>`, and the step goes on to the next name.
   A scan or rescan lists the folder (`files.list(dir)`), reads every name that ends in `.json` and does not start
   with `.`, merges each, and drops every index entry whose file the list lacks (same queued-write exception).
9. **Load and prune** (the brief: name how the store loads and what `prune` becomes). The store does not load
   itself. Each composition root calls `const loaded = store.load();` where it called `store.prune()`, and wraps
   its service with `afterLoad(loaded, …)`, so no tool call reads the index before the folder is read. `load`
   resolves after the scan step. It then queues one prune step: for each listed name that ends in `.json` or in
   `.tmp` (a legacy `<id>.json.tmp` and a `Files` temp `.<id>.json.<8 hex>.tmp` alike), `files.modified` before
   `clock.now() - RETENTION_SECONDS * 1000` → `files.deleteFile`, and the id leaves the index; a failure logs
   `could not prune <name>: <reason>` (today's text). `prune()` leaves `AgentFormStore`, and
   `memory-form-store.ts` drops its no-op `prune`. `RETENTION_SECONDS` stays 90 days.
10. **`afterLoad`**. `open(args, toolUseId, signal)` and `collect(wait, signal)` return
    `loaded.then(() => inner.open(...))` and `loaded.then(() => inner.collect(...))`; calls made before the load
    settles run in call order once it settles; `end()` and the service's `detach()` call through at once. A call
    made after `detach` still waits forever, because the inner session's `answerUnlessDetached` answers nothing.
    The preview services keep their memory stores and no `afterLoad`.
11. **Composition roots**. Forms (`createForms`): `createFolderFormStore({ files: services.files, dir:
    services.paths.join(services.homeDir, SAVED_ROUNDS_FOLDER), clock, randomHex, paths, log })`; `loaded =
    store.load()`; `forms: withKnownLayouts(afterLoad(loaded, agentsService), layoutNames)`; `savedArgs` still reads
    `store.recentArgs`. `createForms` also returns `flushed: () => store.flushed()`, and forms' `dispose` returns
    `Promise.all([layouts.dispose(), flushed()])` settled to `void`. The primer: the same store with
    `SAVED_PRIMERS_FOLDER`; `const primer = afterLoad(loaded, createAgentFormService({...}))`; its `dispose`
    returns `store.flushed()`. Both files drop `import path from 'node:path'`. Each memory store gets
    `load: () => Promise.resolve()`, `flushed: () => Promise.resolve()` and `saveBody` returning
    `Promise.resolve()`.
12. **Folder constants** (plan.md Decided, "Each form type names its saved-forms folder as a constant in its own
    contract"). The values are today's paths, so the stable app, the dev app and retro keep one folder.
13. **Saved-file format is unchanged**. File name `<id>.json`, text `JSON.stringify(record)` with `openRecord`'s
    field order, the same fields and `updated` stamping (`form-store.ts` lines 21 and 32–53 name retro as the
    reader). Only the temp file's name changes, to `Files`' `.<id>.json.<8 hex>.tmp`, which retro never reads.
14. **Endpoint files** (plan.md Decided, "Endpoint files write through `Files` behind one ordered writer;
    `contributeTools` stays sync"). `createEndpointWriter` queues each `write` (the same `createSerialQueue`, Decision 4);
    a step writes `endpoint.json` then `tools.json` through `files.write(path.join(dir, …),
    `${JSON.stringify(value, null, 2)}\n`)` (today's text; `tools.json` holds `{ tools }`); `files.write` makes the
    folder. A failed step logs `endpoint files not written: <reason>` (today's text) and the next write still runs.
    Sessions' `start` makes one writer, `createEndpointWriter(api.services.files, endpointDir, api.services.log)`,
    before `exports`; `contributeTools` calls `endpointWriter.write(opened.endpoint, list.tools())` when `opened` is
    not null, with the tool list taken at the call. Its `try`/`catch` narrows to `list.tools()`: a throw there logs
    `endpoint files not written: <reason>` and writes nothing, as today. `contributeTools` now returns before the
    files are on disk; a relay that reads the previous run's `endpoint.json` in that window is accepted, since
    relays read the file on connect and the queued write starts in the same tick chain. Sessions' `dispose` awaits
    `endpointWriter.flushed()` after `opened?.relay.close()`, inside the existing `finally`. The self-test still
    writes nothing (`opened` is null).
15. **Doc line** (`AGENTS.md` § Architecture, the `files/` line at line 211). It lists `Files`' members, so it
    becomes incomplete. It reads after the change: `files/         file reads (whole as text or bytes, or the first
    bytes), modified times, atomic writes (a rename EPERM or EBUSY holds is tried again), append, rename, trash, file
    deletes, folder lists and watching, behind Files; …` with the rest of the line unchanged. No other `AGENTS.md`
    line is made untrue: line 134 ("the saved-form folder and memory stores"), line 889 ("the saved-form files") and
    lines 898–905 (`endpoint.json`, `tools.json`) stay true.

GIVEN a rename that fails with `EPERM` twice WHEN `Files.write` runs THEN the file holds the new text, no temp file is
left, and the waits were 10 and 20 ms.
GIVEN another app writes `<id>.json` into the folder after load WHEN the watch reports it THEN `newestFor` finds it.
GIVEN the store wrote a record with `updated` 1001 WHEN the folder reports a copy of it with `updated` 1000 THEN the
index keeps 1001.
GIVEN a held first write WHEN `create` and then `finish` run THEN the second write starts only after the first settles,
and the file ends with the finish's body.
GIVEN the disk refuses the write WHEN the page saves a draft THEN `invoke('draft', …)` rejects naming the form, and the
reply after the deadline carries the draft.
GIVEN `markReturned`'s write fails WHEN `newestUnreturnedFinished` runs THEN it finds no form, and the log names the
form.
GIVEN the load has not settled WHEN a tool call opens a form THEN no form shows until it settles.
GIVEN a saved form and a temp file last changed before the retention window WHEN the store loads THEN both are
deleted and the form leaves the index, and newer files stay.

Tests (rows go into the test that owns each rule; `wigley:make` owns when they run):
- `src/main/files/node-files.test.ts`: add `renameStandIn` beside `linkStandIn` in the `node:fs/promises` mock
  (`rename` runs `renameStandIn.current ?? fs.rename`), and mock `node:timers/promises` so `setTimeout(ms)` pushes
  `ms` into a `delays` list and resolves at once; reset both in `beforeEach`. New `it.each`
  `'$method with a rename failing $code $times times $result'` (break: no retry, a retry on any code, an off-by-one
  in the try count, the temp file left after the last failure). The stand-in fails the first `times` calls with
  `code`, then calls the real `rename`:
  | method | code | times | result | `delays` |
  |---|---|---|---|---|
  | `write` | `EPERM` | 2 | file holds `'new'`, folder lists only the file | `[10, 20]` |
  | `writeBytes` | `EBUSY` | 1 | file holds bytes `[1, 2]` | `[10]` |
  | `write` | `EPERM` | 5 | rejects with code `EPERM`; file keeps `'old'`; no temp file | `[10, 20, 40, 80]` |
  | `write` | `EACCES` | 1 | rejects with code `EACCES`; file keeps `'old'` | `[]` |
  Each row starts with the file holding `'old'` (bytes for `writeBytes` rows read back with `readBytes`).
- `src/shared/files-contract.test-support.ts` (both adapters): `deleteFile_File_DeletesItAndKeepsItsFolder` — after
  `write(at('s/a.md'))`, `deleteFile(at('s/a.md'))`: `stat(at('s/a.md'))` is null and `list(at('s'))` is `[]`;
  `deleteFile_Missing_Resolves` — `deleteFile(at('none.md'))` resolves; `deleteFile_Folder_RejectsAndKeepsIt` —
  after `makeFolder(at('top/e'))`, `deleteFile(at('top/e'))` rejects and `list(at('top'))` is
  `[{ path: 'e', kind: 'folder' }]` (break: a recursive delete, a missing-path rejection).
- `src/shared/agent-forms/form-store.test.ts` moves onto `createMemoryFiles({ now: () => nowMs })` with
  `formsDir = '/forms'`; `storeIn` passes `files`; `formFiles()` lists through `files.list`; each test that reads
  the disk first awaits `store.flushed()`; files another app wrote are written with the raw memory `files` (or
  `files.write`) before `await store.load()`. Existing tests keep their names and assertions, except:
  - `'logs and throws nothing when the folder cannot be written'`: `files` is the memory files with
    `write: () => Promise.reject(new Error('EACCES'))`; after `await store.flushed()` the log names `record.id` and
    `autoAnswered.id`, and `store.newestFor('fp')?.id` is `record.id` (the index holds it; was `toBeNull()`).
  - `"throws a draft's failed write with the disk's reason"`: `await expect(store.saveBody(record,
    withNote('half'))).rejects.toThrow(record.id)`.
  - `'prunes only files last written before the retention window'` and `'prunes a temp file a crash left, by the
    same age rule'`: the files are written with `nowMs` set to the stale or the fresh time (memory `modified`
    stamps the clock), then `nowMs = 2_000_000_000_000`, `await store.load()`, `await store.flushed()`. The temp
    test writes `stale.json.tmp`, `fresh.json.tmp`, `.stale.json.0000abcd.tmp` and `.fresh.json.0000abcd.tmp`, and
    expects only the two fresh ones to stay. The first test also expects `store.newestFor('old')` to be null.
  - `'skips a corrupt file …'`, `'never reads a leftover temp file as a form'`, `'loads a file holding a field …'`,
    `'loads a file the Python forms server wrote'`: the files go in before `await store.load()`.
  New tests:
  - `'finds a form another app writes after load'` — after `load`, `files.write('/forms/9-0000000a.json', <a saved
    form with fingerprint 'other'>)`, `await store.flushed()`: `newestFor('other')?.id` is `'9-0000000a'` (break: the
    watch not opened, or its change not merged).
  - `'drops a form another app deletes'` — a created form, `await store.flushed()`, `files.remove(path)`, `await
    store.flushed()`: `newestFor('fp')` is null.
  - `it.each` `'keeps the newer of its own record and a reported copy: $case'` (break: any reported copy replaces
    the entry). Rows: a reported copy with `updated` 1 second older → the index keeps the store's body; equal
    `updated` → keeps the store's object (`toBe(record)`); 1 second newer → the index takes the copy's body.
  - `'keeps a form whose write is still queued when a rescan misses its file'` — `files` wraps `watch` to capture
    `onMissed` and holds the first `write` on a deferred promise; `create`, call `onMissed()`, release the write,
    `await store.flushed()`: `newestFor('fp')?.id` is the record's id (break: the rescan drops queued ids).
  - `'rescans the folder when the watch may have missed changes'` — `files` wraps `watch` to capture `onMissed` and
    pass an `onChange` that drops every report; a file written after `load`, then `onMissed()`, `await
    store.flushed()`: `newestFor` finds it (break: `onMissed` ignored).
  - `'writes in call order behind a held write'` — the first `write` held on a deferred promise; `create` then
    `finish(record, 'submitted', withNote('done'))`; the second `write` call count is 0 until the first is
    released; after `await store.flushed()` the file's `body` is `{ note: 'done' }` (break: writes run in parallel).
  - `'logs a failed markReturned and still holds the form returned'` — a finished form, then `write` rejects,
    `markReturned`, `await store.flushed()`: `newestUnreturnedFinished(MINE, NONE)` is null and the log names the id.
- `src/shared/agent-forms/memory-form-store.test.ts`: delete `prune_KeepsEveryForm`; others stay.
- `src/shared/agent-forms/form-service.test.ts`: the store is `createFolderFormStore` over `createMemoryFiles({ now:
  () => nowMs })` with `formsDir = '/forms'` (no `mkdtempSync`/`rmSync`). `savedFile(formId)` and `savedFiles()`
  become async: each awaits `store.flushed()`, then reads through `files.read` / `files.list`; their 40 call sites
  `await` them. `"throws a draft's failed write to the caller and keeps the draft for the reply"`: the spy is
  `mockRejectedValue(new Error('could not save form r: EACCES'))` and the assertion is `await
  expect(presenter.draft(shown.formId, body('half'))).rejects.toThrow('could not save form r: EACCES')`; the reply
  still matches `{ outcome: 'draft', note: 'half' }`. New `describe('afterLoad')`:
  - `'opens no form until the load settles'` — `loaded` is a deferred promise; `afterLoad(loaded,
    newService()).startSession(...).open(NAMING_ARGS, null, live())`; after `await Promise.resolve()`,
    `presenter.shown` is `[]`; after resolving and awaiting, `presenter.shown` has length 1 (break: the gate
    missing, so a call at start misses the saved forms).
  - `'ends a session at once while the load is pending'` — `open(NAMING_ARGS, null, live())` made, then `end()`,
    both before the load settles; then resolve: the open rejects with `The session ended before this open_form
    ran.` (`requireLiveCaller`) and `presenter.shown` is `[]` (break: `end` deferred behind the load, so the form
    shows in an ended session).
- `src/plugins/forms/main/round-type.test.ts`: the store moves onto memory files as above; `savedFile` becomes async
  over `store.flushed()` and `files.read`; `expect(readdirSync(roundsDir)).toEqual([])` becomes
  `expect(await files.list(roundsDir)).toEqual([])`.
- `src/shared/agent-forms/channel-presenter.test.ts`: `fakeListener`'s and the inline listeners' `draft` return
  `Promise.resolve()`; `"throws a draft's failed save out of the handler, so the page's invoke rejects"` becomes a
  listener whose `draft` returns `Promise.reject(new Error(<today's message>))` and `await
  expect(saveDraft(...)).rejects.toThrow(<the same message>)` (break: the handler drops the promise);
  `'answers a draft for a form no longer open without passing it on'` awaits `saveDraft` and expects `undefined`.
- `src/plugins/forms/main/start.test.ts` and `src/plugins/primer/main/start.test.ts`, the `'a quit leaves each open
  … open on disk …'` tests: after `await harness.stop('quit')`, read the folder through `harness.files.list(dir)`
  and `harness.files.read(...)` in place of `readdirSync`/`readFileSync`; still expect `['open']` (break: the quit
  does not wait for the queued write). The folder path is `posixPaths.join(homeDir, SAVED_ROUNDS_FOLDER)` /
  `posixPaths.join(homeDir, SAVED_PRIMERS_FOLDER)`, since the harness serves `paths: posixPaths`
  (`plugin-part-harness.test-support.ts:1005`) and the part joins its folder with it.
- `src/plugins/sessions/main/relay/endpoint.test.ts`: `describe('createEndpointWriter')` over `createMemoryFiles()`
  replaces `describe('writeEndpointFiles')`: the two existing tests keep their assertions (both files in a folder
  it makes; a second write replaces both, and `files.list(dir)` is exactly `endpoint.json` and `tools.json`) after
  `await writer.flushed()`; new `'writes in call order behind a held write'` — the first `write` call held; two
  `writer.write` calls; after release and `flushed()`, `endpoint.json` holds the second endpoint; new `'logs a failed
  write and still runs the next'` — the first `files.write` rejects; the log holds one line containing
  `endpoint files not written`; the second write's files are there.
- `src/plugins/sessions/main/start.test.ts`: `startSessionsPart` gains a `files` option (default
  `createMemoryFiles()`) served as `services.files`. `'keeps a contribution live when the endpoint files cannot be
  written'` passes `files` whose `write` rejects, drops its `rmSync`/`writeFileSync` of the endpoint folder, and
  waits with `vi.waitFor` for the one `endpoint files not written` log line; the call still resolves to
  `ASK_RESULT`. `stop_ConnectedThroughRelay_EndsOnce` reads `endpoint.json` through `harness.files.read(...)` in
  place of `readFileSync`.

Done when: `npm run typecheck` and `npm run lint` (the layer check included) pass; the tests above pass in the test
gate; `grep -n -E "from 'node:fs'|mkdirSync|writeFileSync|renameSync" src/shared/agent-forms/form-store.ts
src/plugins/sessions/main/relay/endpoint.ts` finds nothing; `grep -n -E "'wigley-forms', 'rounds'|'wigley-primer',
'primers'" src/plugins/forms/main/start.ts src/plugins/primer/main/start.ts` finds nothing;
`grep -n "SAVED_ROUNDS_FOLDER\|SAVED_PRIMERS_FOLDER" src/plugins/forms/contract.ts src/plugins/primer/contract.ts`
finds one line each; `grep -n "prune" src/shared/agent-forms/form-store.ts` finds no `prune(): void` member; the
`AGENTS.md` `files/` line reads as Decision 15; in `docs/features/intent-alignment/master-plan.md` § Lane P the line
reads `- [x] Round store through Files [ready]`; the `**Round store through Files**` entry (five lines) is gone from
`docs/features/followups.md` § Platform and packaging; live checks: 07 — Final verification.

Commit: one commit for the task, holding the code, the tests, the `AGENTS.md` line, the master plan tick and the
follow-up removal.

## Proof

