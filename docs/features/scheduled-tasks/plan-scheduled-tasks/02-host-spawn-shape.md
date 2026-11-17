# 02 — Host spawn shape: env overlay, unset names, stdin lines

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/session-host.ts` · modify `src/session-host/process-table.ts` ·
           modify `src/session-host/host-server.ts` · modify `src/session-host/session-host.ts` ·
           modify `src/session-host/session-host-test-doubles.ts` · modify `src/main/claude-code/claude-launch.ts` ·
           modify `src/main/claude-code/claude-code-harness.ts` · modify `src/shared/fake-session-host.ts` ·
           test `src/session-host/process-table.test.ts` · test `src/session-host/host-server.test.ts` ·
           test `src/main/session-host/session-host-client.test.ts` · test `src/shared/fake-session-host.test.ts` ·
           test `src/main/claude-code/claude-code-harness.test.ts`

Consumes:  nothing from another task. Tree members: `NESTED_SESSION_ENV`, `SESSION_ROW_ENV`
           (`src/shared/session-env.ts`); `claudeEnv`, `claudeLaunch`, `defaultConfigFolder`
           (`src/main/claude-code/claude-launch.ts`); `createProcessTable`, `ProcessTableDeps`
           (`src/session-host/process-table.ts`); `startSessionHost`, `SessionHostDeps` (`src/session-host/host-server.ts`).

Produces:
- In `src/contracts/session-host.ts`, `HostedSpawn` exactly as plan.md § Shared names and shapes gives it:
  ```ts
  export interface HostedSpawn {
    id: string;
    command: string;
    args: readonly string[];
    cwd: string;
    // With `inheritEnv` true: laid over the host's own environment, after the host drops `ELECTRON_RUN_AS_NODE` and
    // every name in `unsetEnv` from it; a name in both `unsetEnv` and `env` takes `env`'s value. With `inheritEnv`
    // false: the child's whole environment.
    env: Readonly<Record<string, string>>;
    // True for a spawn the host starts later (a prepared run), whose child takes the host's environment under `env`.
    // False for a live start, whose child environment is exactly `env`.
    inheritEnv: boolean;
    // Names the harness says the child must not inherit from the host's environment. Read only when `inheritEnv`.
    unsetEnv: readonly string[];
    // Lines written to stdin right after the spawn, in order, each logged as `in` like a `write`.
    stdin: readonly string[];
    idleRule: IdleRule;
    droppedOutKeys: readonly KeyPath[];
  }
  ```
  Keep the existing comment on `droppedOutKeys`.
- In `src/session-host/process-table.ts`: `ProcessTableDeps` gains `env: NodeJS.ProcessEnv` (the host's own
  environment).
- In `src/session-host/host-server.ts`: `SessionHostDeps` gains `env: NodeJS.ProcessEnv`. `startSessionHost` hands it
  to the process table.
- In `src/session-host/session-host.ts`: `startSessionHost` gets `env: process.env`.
- In `src/main/claude-code/claude-launch.ts`:
  - `export function claudeUnsetEnv(profileDir: string | null, homeDir: string, paths: Paths): string[]` — the names
    `claudeEnv` removes.
  - `ClaudeLaunch` gains `unsetEnv: string[]`. `claudeLaunch` fills it from `claudeUnsetEnv`.

Decisions:
- **The child env (process table).** When `request.inheritEnv` is true, `spawn` builds the child's environment in
  this order: a copy of `deps.env`; delete `ELECTRON_RUN_AS_NODE`; delete every name in `request.unsetEnv`; then set
  every pair of `request.env`. Values in `deps.env` that are `undefined` stay out of the result. When
  `request.inheritEnv` is false, the child's environment is a copy of `request.env` and nothing else, as today. It
  passes the result as `options.env` to `deps.spawn`. Settled design: the host merges the overlay over its own env and
  drops its own `ELECTRON_RUN_AS_NODE`. Reason for the flag: the host outlives the app that started it, so its own
  environment can hold names (a shell's proxy or `ANTHROPIC_*` variables, launchd's names after a login start) that
  the current app's environment lacks. A live start must not get them.
- **Validation.** `unsetEnv` and `stdin` are checked like `droppedOutKeys` (`requireDroppedOutKeys`): each must be an
  array of strings, else the spawn is refused with `process <id> has no well-formed unset names` or
  `process <id> has no well-formed stdin lines`, and no other process is touched. `env` must be an object whose values
  are all strings, else `process <id> has no well-formed env`. `inheritEnv` must be a boolean, else
  `process <id> has no well-formed inheritEnv`. A bad field must fail at the request, not later.
- **Stdin lines.** After the table holds the new process and `spawned` was called, the table writes each `stdin` line
  in order through the same path `write` uses: append as `in` to the pipe log, read the idle rule's busy values on
  stdin, then write the line with its newline. So a first `user` line marks the process busy, as a live `write`
  does. The table writes no line when the child has no pid (it never ran; its `error` follows and closes it).
- **One rule for the unset names (Claude adapter).** `claudeUnsetEnv` returns `NESTED_SESSION_ENV`, the two app launch
  names (`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, `SESSION_ROW_ENV`), and `CLAUDE_CONFIG_DIR` when `profileDir` is not
  null and resolves to `defaultConfigFolder`. `claudeEnv` deletes exactly the names `claudeUnsetEnv` returns, so the
  two cannot drift. `claudeEnv`'s behaviour does not change: `spawnCli` keeps using it. This is the adapter's one unset
  rule (plan.md § Shared names, Claude adapter names): task 08's `claudeSpawn` passes `launch.unsetEnv` and keeps no
  list of its own.
- **Live starts keep their child env** (plan.md § Decisions). `startClaudeProcess` passes the whole launch env as
  `env` (through `definedEnv`, as now), `inheritEnv: false`, `unsetEnv: launch.unsetEnv`, and `stdin: []`. So its
  child's environment is exactly the launch env, as today, whatever the host's own environment holds. The live start
  still writes its opening lines through `HostedProcess.write`, as now. Task 08 moves the spec into `claudeSpawn`;
  this task does not.
- **Every spawn literal** in the files above gains `inheritEnv: false`, `unsetEnv: []` and `stdin: []` (the fake
  harness tests, the client test's `spawnRequest`, the test doubles' `spawnRequest`, the fake host test's literal).
  The client and the protocol
  carry the request as JSON, so the client needs no code change. There is no protocol bump in this task: task 07 bumps
  once for the whole change.
- **Fake host.** `createFakeSessionHost`'s `spawn` appends each `request.stdin` line to the record's `log` as `in` and to
  `writes`, in order, before it returns, as the real host treats them as writes. With `stdin: []` nothing changes for
  existing callers.
- Test names follow the files' existing `subject_Condition_Result` form (match the surrounding code).

GIVEN a host whose own env holds `KEEP=a`, `DROP=b`, `ELECTRON_RUN_AS_NODE=1`, `BOTH=host`
WHEN the table spawns a request with `inheritEnv: true`, `unsetEnv: ['DROP', 'BOTH']` and
`env: { BOTH: 'spawn', NEW: 'c' }`
THEN the child env is exactly `{ KEEP: 'a', BOTH: 'spawn', NEW: 'c' }`

GIVEN the same host env
WHEN the table spawns a request with `inheritEnv: false`, `unsetEnv: ['DROP']` and `env: { NEW: 'c' }`
THEN the child env is exactly `{ NEW: 'c' }`

GIVEN a request with `stdin` `['{"type":"user"}', 'x']`
WHEN the table spawns it
THEN the pipe log holds the two lines as `in` with seq 1 and 2, the child's stdin received both with newlines, and
the process reads busy

GIVEN a request whose `stdin` is not an array of strings
WHEN the table spawns it
THEN its subscriber gets `closed` with `process <id> has no well-formed stdin lines`, and no log file stays

GIVEN a Claude launch with a profile folder equal to `<home>/.claude`
WHEN `claudeLaunch` runs
THEN `unsetEnv` holds every `NESTED_SESSION_ENV` name, `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, `WIGLEY_SESSION_ROW` and
`CLAUDE_CONFIG_DIR`, and `env` holds none of them except the row id and idle compact value the launch sets

Tests:
- `process-table.test.ts`, new `spawn_ChildEnv_HostEnvLessUnsetNamesUnderTheOverlay` — a table over the case in the
  first GIVEN/WHEN/THEN, with rows: no unset names and an empty overlay (host env less `ELECTRON_RUN_AS_NODE`); an
  overlay that sets `ELECTRON_RUN_AS_NODE` (kept, since the overlay wins); a host env value `undefined` (left out);
  `inheritEnv: false` (the second GIVEN/WHEN/THEN: exactly `env`, no host name). The fake `spawn` in the test deps
  records `options.env`. Break: a live start that inherits the host's names.
- `process-table.test.ts`, new `spawn_StdinLines_LoggedAsInThenWrittenInOrder` — the second GIVEN/WHEN/THEN; asserts
  the log records, the child's stdin text, and that a keep window armed at spawn is cancelled (busy). A row with a
  child that never ran (`fakeChild(false)`) writes nothing to stdin.
- `process-table.test.ts`, `spawn_Throws_ClosesWithTheMessageAndKeepsNoEntry` — add rows for a bad `unsetEnv`, a bad
  `stdin`, a bad `env` and a bad `inheritEnv`, each with its message above.
- `claude-code-harness.test.ts`, `start_SpawnsThroughTheHost` — the expected request gains `inheritEnv: false`,
  `unsetEnv` (the full list for that request) and `stdin: []`.
- `claude-code-harness.test.ts`, new `claudeLaunch_UnsetEnv_NamesWhatClaudeEnvRemoves` — rows: profile null (no
  `CLAUDE_CONFIG_DIR`); profile at the default folder (`CLAUDE_CONFIG_DIR` included); profile elsewhere (not
  included). Each row also asserts that `claudeEnv` over an env holding every listed name holds none of them.
- `fake-session-host.test.ts`, `spawn_WriteThenOutput_LogsBothDirectionsAndEchoesOnlyOut` — add a request with one
  stdin line; it is the first `in` line and `writes[0]`.
- `host-server.test.ts`: the test deps pass `env: {}`. One new case,
  `spawn_HostEnv_ReachesTheProcessTable`: deps `env: { A: '1', ELECTRON_RUN_AS_NODE: '1' }` and a `spawn` message with
  `inheritEnv: true` and an empty overlay; the recorded `options.env` holds `A` and not `ELECTRON_RUN_AS_NODE`. Break:
  `startSessionHost` not handing `deps.env` to the table.

Done when: `npm run lint` and `npm run typecheck` pass; `npm test` passes for the five test files above. No live
check here: a spawn through a real host with a real env is checked in task 21 (Final verification).

Commit:    one commit for the group: "Session host spawns take an env overlay, unset names and stdin lines".

## Proof

Commit 08b4e3534 · proof: diff read: Produces present; wave 1 typecheck and lint pass after 8b8a40c12 · concerns: test lines hand-wrapped (oxfmt fixed)
