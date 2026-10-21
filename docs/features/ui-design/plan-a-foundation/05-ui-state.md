# 05 — uiState service

Status: not started
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     create `src/contracts/ui-state.ts` · create `src/main/ui-state/ui-state-file.ts` ·
           test `src/main/ui-state/ui-state-file.test.ts` · create `src/renderer/ui-state.ts` ·
           test `src/renderer/ui-state.test.ts` · modify `src/contracts/bridge.ts` · modify `src/contracts/plugin.ts` ·
           modify `src/preload/preload.ts` · modify `src/main/main.ts` · modify `src/renderer/renderer.ts` ·
           modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts` ·
           modify `scripts/check-layers.mts`
Consumes:  `Files.read`, `Files.write`, `isMissingFile` ← tree (`src/contracts/files.ts`) ·
           `createMemoryFiles` ← tree (`src/shared/memory-files.ts`) · `errorText` ← tree (`src/shared/error-text.ts`) ·
           `PageApiDeps` and `createPageApi` as tasks 03 and 04 leave them ← 03, 04 · `selfTestHome`, `livePage`, `pageLog` ← tree (`src/main/main.ts`)
Produces:  `export interface UiState { get(key: string): unknown; set(key: string, value: unknown): void }` in `src/contracts/ui-state.ts`
           `BRIDGE_CHANNELS.uiStateRead = 'bridge:ui-state-read'`, `BRIDGE_CHANNELS.uiStateWrite = 'bridge:ui-state-write'`,
           `Bridge.uiState(): Promise<Record<string, unknown>>`, `Bridge.setUiState(key: string, value: unknown): void`
           in `src/contracts/bridge.ts`
           `PageServices.uiState: UiState` in `src/contracts/plugin.ts`
           `export interface UiStateFile { snapshot(): Record<string, unknown>; set(key: string, value: unknown): void; flush(): Promise<void> }`,
           `export function loadUiStateFile(deps: { files: Files; path: string; log: Log }): Promise<UiStateFile>`
           in `src/main/ui-state/ui-state-file.ts`
           `export function createPageUiState(snapshot: Record<string, unknown>, write: (key: string, value: unknown) => void): { scoped(prefix: string): UiState }`
           in `src/renderer/ui-state.ts`
Decisions: see the sections below; each carries its source.
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass with the tests below;
           `npm run selftest` passes (nothing reads or writes ui state yet; the run proves the page still starts
           with the snapshot read in place).
Commit:    one commit for the group

Task 04 consumes nothing from this task; plan B's Split primitive is the first consumer of `UiState`,
and the core shell's own keys (plan B's splits in the shell) use `scoped('core')`.

## Main: the ui-state file

- Path: `path.join(app.getPath('userData'), 'ui-state.json')`; under the self-test,
  `path.join(selfTestHome, 'ui-state.json')`, beside the self-test's `plugin-data` (plan.md, AGENTS.md
  § Plugin data: the self-test never touches the user's data folder).
- `main.ts` loads it lazily on the first `uiStateRead` request and keeps the promise: the page has
  registered `bridge.onLog` by then, so the corrupt-file line reaches the page's log (drafter: a line sent
  before the page listens is dropped). A page reload's request gets main's in-memory copy, which is the
  newest.
- `ipcMain.handle(BRIDGE_CHANNELS.uiStateRead, …)` resolves to `snapshot()`;
  `ipcMain.on(BRIDGE_CHANNELS.uiStateWrite, (_event, key: string, value: unknown) => …)` calls `set` once
  the file has loaded. On `will-quit`, a loaded file's `flush()` starts; Electron does not wait for it, so
  a change made in the last moment before quit may be lost (drafter: split widths only; a blocking quit
  path is not worth its cost here).
- Reading: a missing file starts empty with no log line. Text that is not JSON, or JSON that is not an
  object, starts empty and logs once through `log` (no toast: it is app state, not the user's config;
  lead):
  - `[ui-state] ui-state.json is not valid JSON, starting empty: <SyntaxError message>`
  - `[ui-state] ui-state.json is not a JSON object, starting empty`
  - any other read failure: `[ui-state] could not read ui-state.json, starting empty: <errorText>`
- `set(key, value)` updates the in-memory map at once (`value === undefined` deletes the key) and
  schedules a write 500 ms later unless one is already scheduled, so a burst of sets (a drag) is one
  write (lead: coalesce; drafter: 500 ms).
- A write sends the whole map as `JSON.stringify(map, null, 2) + '\n'` through `files.write` (atomic).
  Writes run one at a time: a timer firing while a write runs waits for it, then writes the latest map.
  A failed write logs `[ui-state] could not write ui-state.json: <errorText>`, and the next `set`
  schedules another.
- `flush()` cancels a scheduled write and writes now when anything changed since the last write;
  otherwise it resolves at once.
- `scripts/check-layers.mts`: add `'src/main/ui-state': { layers: ['src/contracts', 'src/shared'], packages: [] }`
  and list `'src/main/ui-state'` in `main.ts`'s layers.

## Page: the snapshot and the scoped service

- `renderer.ts` awaits `bridge.uiState()` after `bridge.onLog(log)` and the config read, and before
  `startPlugins`, so every plugin reads its state at start (lead).
- `createPageUiState(snapshot, write)` copies the snapshot into a map. `scoped(prefix)` returns a
  `UiState` whose `get(key)` reads `<prefix>.<key>` (`undefined` when absent) and whose `set(key, value)`
  updates the page copy at once (deleting on `undefined`) and calls `write('<prefix>.<key>', value)`.
  `renderer.ts` passes `(key, value) => bridge.setUiState(key, value)`.
- `PageApiDeps.services` becomes `Omit<PageServices, 'uiState'>` and the deps gain
  `uiState: { scoped(prefix: string): UiState }`; `createPageApi` hands each plugin
  `services: { ...deps.services, uiState: deps.uiState.scoped(manifest.id) }`, as `createMainApi` adds
  `selfTest` per plugin today (tree). The prefix `core` is the core shell's: plugin ids are lowercase
  letters, digits and `-`, and `core` already names the core in `CommandInfo.plugin` (tree), so no plugin
  takes it.
- Values are JSON values; a value IPC cannot clone throws from `bridge.setUiState` at the caller (fail
  loud, no guard).

## Tests

GIVEN `ui-state.json` holds `{"forms.rail":240}` WHEN the file loads THEN `snapshot()` is `{"forms.rail":240}`
GIVEN a file reading `{oops` WHEN it loads THEN the snapshot is `{}` and the log has one line starting `ui-state.json is not valid JSON, starting empty: `
GIVEN two sets 100 ms apart WHEN 499 ms pass after the first THEN nothing is written; WHEN 500 ms pass THEN one write holds both keys

Tests:     `ui-state-file.test.ts` (memory files at `/data/ui-state.json`, `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` as `claude-code-harness.test.ts` does):
           `starts empty with no file` — `{}`, no log line
           `reads the saved state` — the case above
           `starts empty on invalid JSON` / `starts empty on a JSON array` — the exact log lines above, source `ui-state`
           `writes once 500 ms after a burst of sets` — no write at 499 ms, then the file parses to both keys
           `deletes a key set to undefined` — the written file lacks it
           `flush writes a pending change now` — the file holds the change with no timer advanced
           `logs a failed write and retries on the next set` — a `files.write` stand-in that rejects once
           `ui-state.test.ts`: `scopes keys by prefix` — `scoped('forms').get('rail')` reads `forms.rail`; `scoped('chat').get('rail')` is `undefined`;
           `set updates the page copy at once and sends the qualified key` — `get` returns the new value before any reply; `write` got `('forms.rail', 300)`;
           `set undefined deletes the key` — `get` is `undefined`, `write` got `('forms.rail', undefined)`
           `page-api.test.ts`: `hands each plugin uiState scoped to its id` — plugin `forms` sets `rail`; the write names `forms.rail`

## Proof

