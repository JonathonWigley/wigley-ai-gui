# 02 — Builds contract and config

Status: not started
Type: Task
Rung: hard · adds the contract fields, the `saveLog` seam, the downloads slot and the channel calls that 03–08 consume
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/builds/contract.ts`
- modify `src/plugins/builds/contract.test-support.ts`
- modify `src/plugins/builds/builds-model.ts`
- test `src/plugins/builds/builds-model.test.ts`
- modify `src/plugins/builds/main/backend-config.ts`
- test `src/plugins/builds/main/backend-config.test.ts`
- modify `src/plugins/builds/main/tracked-backend.ts`
- test `src/plugins/builds/main/tracked-backend.test.ts`
- modify `src/plugins/builds/main/fixture-backend.ts`
- modify `src/plugins/builds/main/selftest-script.ts`
- modify `src/plugins/builds/main/start.ts`
- test `src/plugins/builds/main/start.test.ts`
- test `src/plugins/builds/main/build-messages.test.ts`
- test `src/plugins/builds/main/queueing.test.ts`
- modify `src/plugins/builds/page/demo-sample.ts`
- test `src/plugins/builds/page/start.test.ts`
- test `src/plugins/builds/page/builds-view-model.test.ts`
- test `src/plugins/builds/page/session-parts-model.test.ts`
- modify `src/plugins/builds-teamcity/main/teamcity-parse.ts`
- modify `src/plugins/builds-teamcity/main/teamcity-backend.ts`
- test `src/plugins/builds-teamcity/main/teamcity-parse.test.ts`
- test `src/plugins/builds-teamcity/main/teamcity-backend.test.ts`
- modify `src/plugins/builds-local/main/local-backend.ts`
- test `src/plugins/builds-local/main/local-backend.test.ts`

Consumes:  nothing

Produces, in `src/plugins/builds/contract.ts`, each in exactly this shape (plan.md § File Structure):
- `BuildJob` gains `webUrl: string | null; startedAt: number | null; finishedAt: number | null; dependsOn: string[];`
  with the comments `// the job's own page in the backend`, `// epoch ms`, `// epoch ms`,
  `// ids of the jobs in the same build this job directly waits on`.
- `export interface BackendCapabilities { cancel: boolean; choosesBranch: boolean; saveLog: boolean; }`
- On `BuildBackend`:
  `saveLog?(game: GameEntry, buildId: string, jobId: string | null, path: string): Promise<void>;` with the comment
  `// Present only when capabilities.saveLog is true. Saves the job's whole log to the full path \`path\`; \`jobId\` null saves the build's own log.`
- `export interface BuildDownloadEntry { label: string; path: string; }`
- `export interface BuildKindEntry { label: string; target: unknown; downloads: BuildDownloadEntry[]; }`
- `export interface BuildFile { label: string; path: string; entry: number; }`
- `GameView` gains `files: Record<string, BuildFile[]>; // build id → its files that exist`
- `export interface BuildDownload` exactly as plan.md gives it.
- `export const buildsDownloadsSlot: KeyedSlotKey<BuildDownload, 'main', 'builds'> = { id: 'builds.downloads', process: 'main', kind: 'keyed' };`
- On `BuildsChannel.invoke`:
  `saveLog(arg: { backend: string; game: string; build: string; job: string | null }): Promise<{ ok: true } | { problem: string }>;`
  `download(arg: { backend: string; game: string; build: string; file: number }): Promise<{ ok: true } | { problem: string }>; // file: a BuildFile.entry`
- In `src/plugins/builds/builds-model.ts`: `GameState` gains `files: Record<string, BuildFile[]>;`.
- In `src/plugins/builds/contract.test-support.ts`: `FixtureBackend` gains
  `readonly savedLogs: { gameId: string; buildId: string; jobId: string | null; path: string }[];` and
  `failSaveLogs(error: Error | null): void;`.

Decisions:
- **Comments.** `BuildDownloadEntry` is a kind's template: comment it `// path: a full path, \`~\` expanded; \`{version}\` and \`{number}\` are filled per build`.
  `BuildFile` gets the comment `// a filled path that exists on disk; entry: its index in the kind's \`downloads\``. The `BuildDownload` and slot comments copy plan.md's.
  The `BuildsChannel` comment above the interface gains: `saveLog` and `download` start a save into the Downloads
  folder and answer once it is in `builds.downloads`; a refusal answers `{ problem }` and starts nothing.
- **`~` in a download path** is expanded by `parseBackends`, through the same `expandTilde` it takes for `clone`
  (start.ts passes `services.paths.expandTilde(text, services.homeDir)`). Task 05 only fills `{version}` and
  `{number}`.
- **Parsing a kind's `downloads`** (`parseKinds` in `backend-config.ts`). `downloads` is optional; absent or null
  parses as `[]`. Each failing check drops the game and gives its problem, as every other bad game field does, so it
  shows on the backend's heading. `parseKinds` returns the problem text instead of the bare kind id, and `parseGame`
  passes that text through. The texts, verbatim:
  - a kind that is not an object with a string `label` and a `target` key: `game <id>: kind <kind> needs a label and a target` (unchanged)
  - `downloads` present and not a list: `game <id>: kind <kind>: downloads is not a list`
  - an element that is not an object with a non-empty string `label` and a non-empty string `path`:
    `game <id>: kind <kind>: download <n> needs a label and a path`, `<n>` 1-based
  - Other keys of an element are left out. The template text is kept as written apart from `~`.
- **Compile fallout.** Every literal of a changed type gets the new fields with no behaviour yet:
  - a `BuildJob`: `webUrl: null, startedAt: null, finishedAt: null, dependsOn: []`. Sites in the tree:
    `buildJobOf` in `teamcity-parse.ts` (each of its three `return`s), `movingBuild` in `fixture-backend.ts`,
    `demo-sample.ts`, `buildJob` in `contract.test-support.ts`, and the job literals of the test files listed above.
  - a `BackendCapabilities`: `saveLog: false`. Sites: `teamcity-backend.ts` (line 403), `local-backend.ts` (line
    452), `fixture-backend.ts` (line 28), `demo-sample.ts`, `createFixtureBackend`'s default, and the test files'
    capability literals and assertions.
  - a `BuildKindEntry`: `downloads: []`. Sites: `selftest-script.ts` (line 18), `demo-sample.ts`, `gameEntry` in
    `contract.test-support.ts`, and the kind literals of the test files listed above.
  - a `GameView` or `GameState`: `files: {}`. `backendStates()` in `start.ts` passes `files: {}` for each game;
    task 05 fills it.
  - Fix every other site the compiler names the same way, and add it to this task's Proof.
- **The model** (`gameView` in `builds-model.ts`) copies `state.files` into the `GameView` unchanged.
- **`trackCalls`** (`tracked-backend.ts`) passes `saveLog` through tracked, the way it passes `cancel`: present only
  when the backend has it, and a call after `dispose` rejects `the backend was replaced; try again`. Update its
  comment to name `saveLog`.
- **The fixture backend** (`createFixtureBackend`): the default capabilities become
  `{ cancel: true, choosesBranch: true, saveLog: false }`. `saveLog` is present only when the given capabilities
  have `saveLog: true`; it pushes `{ gameId, buildId, jobId, path }` to `savedLogs`, then rejects with the error
  `failSaveLogs` set, else resolves. It writes no file.
- `selfTestBackend` (`fixture-backend.ts`) keeps `saveLog: false` here; task 08 owns the self-test.

GIVEN a kind with `downloads: [{ "label": "Android zip", "path": "~/d/{version}.zip" }]` and home `/Users/u` WHEN
`parseBackends` runs THEN the kind's `downloads` is `[{ label: 'Android zip', path: '/Users/u/d/{version}.zip' }]`.
GIVEN a kind with no `downloads` WHEN `parseBackends` runs THEN its `downloads` is `[]`.
GIVEN a kind whose `downloads` is `"x"` WHEN `parseBackends` runs THEN the game is dropped and the backend's
`problems` holds `game g1: kind dev: downloads is not a list`.
GIVEN a backend with `saveLog` WHEN `trackCalls` wraps it and `saveLog` runs THEN the call reaches the backend and
`drained()` waits for it.

Tests:
- `backend-config.test.ts`, rows added to the `parseBackends` problem table (line 53): `downloads: 'x'` →
  `game g1: kind dev: downloads is not a list`; `downloads: [{ label: 'Zip' }]` →
  `game g1: kind dev: download 1 needs a label and a path`; `downloads: [{ label: '', path: '/p' }]` → the same text;
  `downloads: ['x']` → the same text; `downloads: [null]` → the same text; `downloads: [{ label: 'Zip', path: '' }]` →
  the same text; `downloads: [{ label: 'A', path: '/a' }, { label: 'B' }]` → `… download 2 needs a label and a path`
  (pins the 1-based count).
  Use the ids the table's builders give (`validGame`); the ids above assume `g1` and `dev`, so match the builder.
- `backend-config.test.ts`, `'expands ~ in clone and fills the optional fields'` (line 259): add a kind with
  `downloads: [{ label: 'Android zip', path: '~/d/{version}.zip', extra: 1 }]`, and assert the parsed kind's
  `downloads` is `[{ label: 'Android zip', path: '<home>/d/{version}.zip' }]` (`extra` left out), that a kind
  with no `downloads` has `[]`, and that a kind with `downloads: null` has `[]`.
- `tracked-backend.test.ts`, rows added to the `trackCalls` table (line 6) for `saveLog`: a call before `dispose`
  reaches the backend and `drained()` waits for it; a call after `dispose` rejects
  `the backend was replaced; try again`; and a backend without `saveLog` gives a tracked backend without `saveLog`.
- `builds-model.test.ts`, `'publishes each backend in order, with its set runs newest first'` (line 469): give one
  game state `files: { 'b-1': [{ label: 'Zip', path: '/z/a.zip', entry: 0 }] }` and assert the game view's `files`
  equals it.
- Every other test changes only for the compile.

Done when: compiles (`npm run typecheck`); the test gate runs `backend-config.test.ts`, `tracked-backend.test.ts`,
`builds-model.test.ts`, and every test file listed in Files.
Commit:    one commit for the group

## Proof

