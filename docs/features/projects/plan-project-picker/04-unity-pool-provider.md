# 04 — unity-pool: pool provider

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

unity-pool main registers itself as chat's pool provider: clone folders from the watch's snapshot, origin branch
names read with git in each clone, and the claim run through the CLI under the new session's ids. The process runner
gains `setEnv` so the claim can carry those ids.

Files:
- modify `src/contracts/processes.ts` — `ProcessRunOptions.setEnv`
- modify `src/main/processes/node-processes.ts` — applies `setEnv` after `unsetEnv` · test `src/main/processes/node-processes.test.ts`
- modify `src/shared/fake-processes.ts` — `FakeRun.setEnv`
- modify `src/plugins/unity-pool/main/pool-cli.ts` — the claim run · test `src/plugins/unity-pool/main/pool-cli.test.ts`
- create `src/plugins/unity-pool/main/pool-provider.ts` · test `src/plugins/unity-pool/main/pool-provider.test.ts`
- modify `src/plugins/unity-pool/main/start.ts` — registration · test `src/plugins/unity-pool/main/start.test.ts`
- modify `src/plugins/unity-pool/manifest.ts` — the doc comment above `unityPoolManifest` only

Consumes (all from 02, `src/plugins/chat/contract.ts`):
- `PoolProvider`, `PoolClaimRequest`, `PoolClaimResult`
- `ChatMainExports.addPoolProvider(provider: PoolProvider): Disposable`

Produces:
- `src/contracts/processes.ts`, `ProcessRunOptions`: `setEnv?: Readonly<Record<string, string>>;`
- `src/plugins/unity-pool/main/pool-cli.ts`:
  ```ts
  export type ClaimAnswer =
    | { ok: true; path: string }
    | { ok: false; error: string; message: string };
  export function claimCommandArgs(scriptPath: string, pool: string, branch: string): string[];
  export function readClaimAnswer(result: ProcessResult): ClaimAnswer;
  export async function runPoolClaim(
    deps: { processes: ProcessRunner; files: Pick<Files, 'stat'>; paths: Pick<Paths, 'expandTilde'>;
            homeDir: string; scriptPath: string; pythonCommand: string },
    request: PoolClaimRequest,
    signal: AbortSignal,
  ): Promise<ClaimAnswer>;
  ```
- `src/plugins/unity-pool/main/pool-provider.ts`:
  ```ts
  export interface OriginBranch { name: string; committedAt: number }   // committedAt: Unix seconds
  export function parseOriginBranches(stdout: string): OriginBranch[];
  export function mergeOriginBranches(perClone: readonly (readonly OriginBranch[])[]): string[];
  export interface PoolProviderDeps {
    processes: ProcessRunner;
    snapshot(): PoolSnapshot;                                // the watch's current snapshot
    readPool(pool: string): Promise<PoolState | null>;      // the pool's state file read now
    runClaim(request: PoolClaimRequest, signal: AbortSignal): Promise<ClaimAnswer>;
    rescan(): void;
    log: PluginLog;
  }
  export interface UnityPoolProvider extends PoolProvider {
    snapshotChanged(snapshot: PoolSnapshot): void;           // the watch's change callback
    dispose(): void;                                         // aborts every claim still running
  }
  export function createPoolProvider(deps: PoolProviderDeps): UnityPoolProvider;
  ```

## Decisions

- **Branches go through the process runner, not the `Git` service.** `Git` (`src/contracts/git.ts`) is the app's
  per-clone git state, with an adapter and fakes app-wide; its `fetch` runs `git fetch --quiet` with no remote and
  recurses into submodules, so using it would mean two contract changes (a new listing method and a second fetch)
  for one plugin's need. The provider already holds the runner for the CLI, so one `FakeProcesses` scripts every run
  in its tests, and the plan's File Structure lists no git file.
- **The branch listing carries the commit date.** `git -C <clone> for-each-ref --sort=-committerdate
  --format=%(committerdate:unix) %(refname:short) refs/remotes/origin`: each clone fetched at its own time, so a
  merge by position alone cannot order a branch one clone has newer. `mergeOriginBranches` keeps each name's newest
  date across clones and sorts by it, newest first, ties by name (`localeCompare`), so the order is the same whatever
  order the clones answer in.
- **Names**: `parseOriginBranches` strips the `origin/` prefix once (`origin/feature/x` → `feature/x`) and drops
  `origin/HEAD` and the bare `origin` (git's short name for `refs/remotes/origin/HEAD`). A line that is blank or has
  no date before its first space is skipped.
- **Refresh**: `branches(pool, true)` first runs `git -C <lowest-numbered clone> fetch --no-recurse-submodules origin`
  (timeout 60 000 ms), then lists. A fetch that exits non-zero, times out or rejects is logged
  (`fetch in <clone path> failed: <last stderr line or error>`) and the listing goes on with the refs the clones have.
  A refresh while that pool's fetch is still running joins it rather than starting a second fetch (git would refuse
  it on the ref lock).
- **A clone whose listing fails** (non-zero exit, timeout 10 000 ms, rejection) is logged
  (`branches of <clone path> not read: …`) and left out; the others still answer. An unknown pool, or one with no
  clones, answers `[]` with no run. `branches` never rejects.
- **`folders(pool)`** is `snapshot().pools` → that pool's `clones.map(clone => clone.path)`, in the snapshot's order
  (the contract keeps `clones` sorted by number); `[]` for an unknown pool.
- **The claim's environment**: `unsetEnv` is `SESSION_IDENTITY_ENV` less `CLAUDE_CODE_SESSION_ID` and
  `WIGLEY_SESSION_ROW` (`SESSION_ROW_ENV`), and `setEnv` is `{ CLAUDE_CODE_SESSION_ID: hostSessionId,
  WIGLEY_SESSION_ROW: rowId }`. The two names are left off `unsetEnv` as well as set, so the run does not lean on the
  set-after-unset order alone; the adapter still documents and tests that order. No `timeoutMs`: `--wait` queues with
  no time limit, and chat's `signal` is the only stop.
- **The claim's answer**: the CLI's JSON on the last non-empty stdout line, as `readActionResult` reads it.
  `{"ok": true, "path": …}` → `{ ok: true, path }`; `ok: true` with no string `path` →
  `{ ok: false, error: 'cli-failed', message: 'unity-pool claim answered no path' }`; `ok: false` → its `error` and
  `message`; no JSON → `cli-failed` with the last stderr line, else `unity-pool exited <code>`. A missing script →
  `no-cli` (`unity-pool not found at <script>`), running nothing. A rejection while `signal` is aborted →
  `{ ok: false, error: 'cancelled', message: 'claim cancelled' }`; any other rejection → `cli-failed` with its text.
- **`diverged`**: the CLI's JSON carries no `path` on a failure (README § Commands), and the watch's snapshot may lag
  the CLI's write, so the provider reads the state file afresh (`readPool`) and takes the clone whose
  `claim.session === hostSessionId`: found → `{ ok: true, path: clone.path, note: message }`; none, or `readPool`
  answers null or rejects (logged) → `{ ok: false, error: 'diverged', message }`.
- **`queued`** fires at most once per claim, from `snapshotChanged`, the first time a snapshot holds a ticket in the
  claim's pool with `session === hostSessionId`. A claim that has settled no longer listens.
- **After each claim** settles, the provider calls `rescan()` (as the panel's `run` handler does, so the badge shows
  the claim even if the OS watcher misses the write) and logs `claim <pool> <branch>: ok <path>` or
  `claim <pool> <branch>: <error>: <message>`.
- **`dispose`** aborts every running claim through the provider's own `AbortController`; each claim runs on
  `AbortSignal.any([signal, own])`, so it settles `cancelled` and its CLI is killed when the part stops.
- **Registration** (`start.ts`): the provider is created before the watch, its `snapshot` dep reading
  `watch.snapshot()` through a closure; the watch's `changed` callback sets the slot and then calls
  `provider.snapshotChanged(snapshot)`. `readPool(pool)` reads `<stateRoot>/<pool>/state.json` (the tool's
  `state_path`) with `readIfPresent` and `readStateFile`, answering the pool on `kind: 'pool'` and null otherwise.
  `runClaim` reads `api.settings()` on each call, as the `run` handler does, and calls `runPoolClaim` with
  `resolveScriptPath`. One `chat = api.dependency(chatMainKey)` serves the registration and the self-test.
  `dispose` disposes the registration, then the provider, then the watch.

## Behaviour

GIVEN processes run with `setEnv` naming a variable also in `unsetEnv` WHEN the program starts THEN it sees the
`setEnv` value; every other `unsetEnv` name is absent, and every other variable passes through.
GIVEN a pool `p` with clones 1 at `/c/1` and 2 at `/c/2` WHEN chat asks `folders('p')` THEN `['/c/1', '/c/2']`.
GIVEN clone 1 lists `main` at 200 and `old` at 100, clone 2 lists `old` at 300 WHEN `branches('p', false)` THEN
`['old', 'main']`, and no fetch ran.
GIVEN the same WHEN `branches('p', true)` THEN `git -C /c/1 fetch --no-recurse-submodules origin` runs before either
listing.
GIVEN a claim whose CLI answers `{"ok": true, "path": "/c/2", …}` THEN `{ ok: true, path: '/c/2', note: null }`.
GIVEN a claim whose CLI answers `diverged` and the state file shows clone 2 claimed by the host session id THEN
`{ ok: true, path: '/c/2', note: <the CLI's message> }`.
GIVEN a claim running WHEN a snapshot holds a ticket in its pool for its host session id THEN `queued` runs once,
however many snapshots follow.
GIVEN a claim running WHEN chat aborts the signal THEN the CLI is killed and the claim answers `cancelled`.
GIVEN unity-pool main started WHEN the part stops THEN its `addPoolProvider` registration is disposed.

## Tests

Names follow the files' `subject_Case_Result` style. Every git and python run is scripted on `FakeProcesses`.

`src/main/processes/node-processes.test.ts`:
- `run_SetEnv_SetsAfterUnset` — `it.each`, real child process like `run_UnsetEnv_DropsOnlyThoseNames`, with the
  test's own names (`SET_ENV_TEST_A`, `SET_ENV_TEST_B`, `SET_ENV_TEST_KEPT`), `A`, `B` and `KEPT` set to `'1'` in
  `process.env` first and removed in `finally`. The child prints `[A ?? null, B ?? null, KEPT ?? null]`.

  | unsetEnv | setEnv | child sees |
  |---|---|---|
  | `['SET_ENV_TEST_A', 'SET_ENV_TEST_B']` | `{ SET_ENV_TEST_A: '2' }` | `['2', null, '1']` |
  | undefined | `{ SET_ENV_TEST_A: '3' }` | `['3', '1', '1']` |

  Breaks: `setEnv` applied before the unset (row 1 sees null); `setEnv` ignored when `unsetEnv` is undefined because
  `envWithout` returns undefined (row 2 sees `'1'`).

`src/plugins/unity-pool/main/pool-cli.test.ts`:
- `claimCommandArgs_ClaimWaitsAndAnswersJson` — `claimCommandArgs('/s/unity-pool', 'p', 'feature/x')` equals
  `['-X', 'utf8', '/s/unity-pool', 'claim', '--branch', 'feature/x', '--pool', 'p', '--wait', '--json']`. Break: a
  dropped `--wait` fails at once with `queued-timeout`; a dropped `--pool` claims in the app's cwd's pool.
- `readClaimAnswer: $name` — `it.each`, one row per rule:

  | name | stdout / stderr / code | expected |
  |---|---|---|
  | ok with path | `'{"ok": true, "pool": "p", "clone": 2, "path": "/c/2", "switched": true}\n'` / `''` / 0 | `{ ok: true, path: '/c/2' }` |
  | ok without path | `'{"ok": true, "pool": "p", "clone": 2}\n'` / `''` / 0 | `{ ok: false, error: 'cli-failed', message: 'unity-pool claim answered no path' }` |
  | diverged | `'{"ok": false, "error": "diverged", "message": "main in /c/2 has diverged"}\n'` / `''` / 1 | `{ ok: false, error: 'diverged', message: 'main in /c/2 has diverged' }` |
  | progress line before the JSON | `'fetching\n{"ok": true, "path": "/c/3"}\n\n'` / `''` / 0 | `{ ok: true, path: '/c/3' }` |
  | stack trace | `''` / `'Traceback …\nValueError: x\n'` / 1 | `{ ok: false, error: 'cli-failed', message: 'ValueError: x' }` |
  | nothing written | `''` / `''` / 2 | `{ ok: false, error: 'cli-failed', message: 'unity-pool exited 2' }` |

- `runPoolClaim_RunsUnderTheSessionIdsWithNoTimeout` — script present at `/h/x` (`scriptPath: '~/x'`), request
  `{ pool: 'p', branch: 'main', hostSessionId: 'host-1', rowId: 'row-1' }`. The one `FakeRun` has `timeoutMs`
  undefined, `setEnv` `{ CLAUDE_CODE_SESSION_ID: 'host-1', WIGLEY_SESSION_ROW: 'row-1' }`, `unsetEnv` containing
  `'CLAUDECODE'` and containing neither `'CLAUDE_CODE_SESSION_ID'` nor `'WIGLEY_SESSION_ROW'`; answer
  `{ ok: true, path: '/c/1' }`. Breaks: the ids dropped or swapped (the pool records the wrong holder); a timeout
  copied from `runPoolCommand` (a queued claim killed after 30 s).
- `runPoolClaim_Aborted_Cancelled` — the run scripted as a pending promise; abort the controller; answer
  `{ ok: false, error: 'cancelled', message: 'claim cancelled' }`. Break: the abort reported as `cli-failed` (chat
  shows an error for a row the user closed).
- `runPoolClaim_ScriptMissing_RunsNothing` — `no-cli`, `runs` empty.
- `runPoolClaim_RunRejects_CliFailed` — the run rejects `spawn failed` with the signal not aborted →
  `{ ok: false, error: 'cli-failed', message: 'spawn failed' }`.

`src/plugins/unity-pool/main/pool-provider.test.ts`:
- `parseOriginBranches: $name` — `it.each`:

  | name | stdout | expected |
  |---|---|---|
  | strips the remote once | `'300 origin/feature/x\n200 origin/main\n'` | `[{ name: 'feature/x', committedAt: 300 }, { name: 'main', committedAt: 200 }]` |
  | drops HEAD and bare origin | `'500 origin/HEAD\n500 origin\n400 origin/main\n'` | `[{ name: 'main', committedAt: 400 }]` |
  | CRLF and blank lines | `'100 origin/a\r\n\r\n90 origin/b\r\n'` | `[{ name: 'a', committedAt: 100 }, { name: 'b', committedAt: 90 }]` |
  | empty | `''` | `[]` |

- `mergeOriginBranches: $name` — `it.each`:

  | name | perClone | expected |
  |---|---|---|
  | one clone keeps its order | `[[main@300, b@200, a@100]]` | `['main', 'b', 'a']` |
  | newer in another clone moves ahead | `[[main@200, old@100], [old@300]]` | `['old', 'main']` |
  | same name once, newest date | `[[a@100, b@50], [a@40, b@60]]` | `['a', 'b']` |
  | tie by name | `[[z@100], [y@100]]` | `['y', 'z']` |
  | no clones | `[]` | `[]` |

  (`name@n` is `{ name, committedAt: n }`.) Breaks: first-seen wins instead of newest; duplicates kept.
- `folders: $name` — `it.each` over a snapshot with pools `p` (clones 1 `/c/1`, 2 `/c/2`) and `q` (clone 1 `/q/1`):
  `'p'` → `['/c/1', '/c/2']`; `'q'` → `['/q/1']`; `'r'` → `[]`.
- `branches_NoRefresh_ListsEveryCloneAndMerges` — pool `p` as above; for-each-ref scripted per clone (clone 1
  `'200 origin/main\n100 origin/old\n'`, clone 2 `'300 origin/old\n'`); answer `['old', 'main']`; the runs are the two
  listings and no `fetch`.
- `branches_Refresh_FetchesInTheLowestCloneFirst` — same, `refresh` true; `runs[0]` is
  `git -C /c/1 fetch --no-recurse-submodules origin`, then the two listings. Break: fetching in every clone, or in
  the last one, or listing before the fetch lands.
- `branches_FetchFails_StillLists` — fetch scripted `{ code: 1, stderr: 'fatal: unable to access' }`; answer as
  without refresh; `log` holds `fetch in /c/1 failed: fatal: unable to access`.
- `branches_OneCloneFails_ListsTheOthers` — clone 2's listing rejects; answer is clone 1's names; one log line naming
  `/c/2`.
- `branches_RefreshWhileFetching_RunsOneFetch` — fetch scripted as a pending promise; two `branches('p', true)` calls;
  settle it; both answer the merged list and `runs` holds one `fetch`.
- `claim: $name` — `it.each`; `runClaim` is a double answering the row's answer; `snapshot` shows clone 1 `/c/1`
  claimed by session `host-1` (stale) in every row; request `{ pool: 'p', branch: 'main', hostSessionId: 'host-1',
  rowId: 'row-1' }`:

  | name | runClaim answers | readPool answers | expected |
  |---|---|---|---|
  | ok | `{ ok: true, path: '/c/2' }` | — | `{ ok: true, path: '/c/2', note: null }` |
  | diverged, held in the fresh state | `{ ok: false, error: 'diverged', message: 'm' }` | clone 2 `/c/2` claimed by `host-1` | `{ ok: true, path: '/c/2', note: 'm' }` |
  | diverged, held by another session | same | clone 2 claimed by `host-9` | `{ ok: false, error: 'diverged', message: 'm' }` |
  | diverged, no state file | same | null | `{ ok: false, error: 'diverged', message: 'm' }` |
  | dirty | `{ ok: false, error: 'dirty', message: 'd' }` | — | `{ ok: false, error: 'dirty', message: 'd' }` |
  | cancelled | `{ ok: false, error: 'cancelled', message: 'claim cancelled' }` | — | same |

  Each row also asserts `rescan` ran once. Breaks: the diverged path taken from the stale snapshot (`/c/1`); a
  diverged claim reported as a failure though the pool kept the clone; a missed rescan.
- `claim_QueueTicket_FiresQueuedOnceWhileRunning` — `runClaim` pending; `snapshotChanged` with a ticket for `host-9`
  in `p`, then one for `host-1` in pool `q`: `queued` not called; then a ticket for `host-1` in `p` twice: called
  once; settle the claim, send the same snapshot: still once. Breaks: firing per snapshot; matching on another
  pool's ticket; a settled claim still listening.
- `claim_SignalAndDispose_AbortTheRun` — `it.each` over `'chat aborts'` and `'provider disposed'`: the `runClaim`
  double's signal reads `aborted` true after the action. Break: chat's signal not passed through, so closing the row
  leaves the CLI waiting.

`src/plugins/unity-pool/main/start.test.ts` (the fake chat dependency now answers `addPoolProvider`, recording the
provider and returning a `Disposable` that counts its `dispose`):
- `start_RegistersThePoolProvider_StopDisposesIt` — one registration at start; `dispose` count 1 after `stop()`.
- `poolProvider_Folders_ReadTheWatchSnapshot` — write the self-test fixture's state file as
  `start_WritesTheWatchSnapshot_AndAChangeWritesTheNewOne` does and rescan through `run`; `folders(SELFTEST_POOL)`
  equals `['/x/1', '/x/2']`. Proves the wiring once.
- `poolProvider_Claim_EmptyScriptPath_LooksUpPlatformDefault` — rows `windows` / `macos` as
  `run_EmptyScriptPath_LooksUpPlatformDefault`; `claim(…)` on the registered provider stats the platform default
  and answers `no-cli`. Proves `runClaim` reads the settings and platform.

## Doc comments to update

- `src/contracts/processes.ts`: `ProcessRunOptions` gains `setEnv` with the comment "Names set for this run, after
  `unsetEnv` is applied, so a name in both is set; every other variable passes through". `ProcessRunner.run`'s
  comment "in the app's environment without the names in `unsetEnv`" becomes "… without the names in `unsetEnv`,
  then with `setEnv`'s names set".
- `src/main/processes/node-processes.ts`: the header "in the app's environment less `unsetEnv`" adds "plus
  `setEnv`"; `envWithout` is renamed `runEnv(unsetEnv, setEnv)`, its comment: undefined only when both are.
- `src/shared/fake-processes.ts`: `FakeRun` gains `setEnv: Readonly<Record<string, string>> | undefined`, and `run`
  records it.
- `src/plugins/unity-pool/main/pool-cli.ts`: `runPoolCommand`'s comment stays (the user's runs); `runPoolClaim`'s
  says it runs under the session's two ids with no timeout, stopped only by `signal`.
- `src/plugins/unity-pool/main/start.ts`: the part comment adds that it registers as chat's pool provider, which
  claims under a session's ids, and reads every pool again after each claim.
- `src/plugins/unity-pool/manifest.ts`: "and `chat` for its self-test's launch" becomes "and `chat` for the pool
  provider it registers and its self-test's launch".

Done when: `npm run typecheck` and `npm run lint` pass, and vitest passes on `src/main/processes/node-processes.test.ts`,
`src/plugins/unity-pool/main/pool-cli.test.ts`, `src/plugins/unity-pool/main/pool-provider.test.ts` and
`src/plugins/unity-pool/main/start.test.ts`.

Commit: one commit for the group — "unity-pool registers as chat's pool provider: clone folders, origin branches
newest first, and the claim run under the session's ids (ProcessRunOptions.setEnv)".

## Proof
