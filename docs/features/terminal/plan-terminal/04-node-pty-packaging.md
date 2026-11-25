# 04 — node-pty adapter and packaging

Status: not started
Type: Task
Rung: deep · rests on low-confidence packaging claims: node-pty's runtime files, spawn-helper's executable bit, asar unpacking and Windows prebuilds are unverified
Wave: 3 · Depends on: 01, 02, 05
Plan: [plan.md](plan.md)

Files:     create `src/session-host/node-pty/node-pty-spawn.ts` · modify `src/session-host/session-host.ts` ·
           modify `vite.session-host.config.mts` · modify `forge.config.mts` · modify `scripts/check-layers.mts` ·
           test `src/session-host/node-pty/node-pty-spawn.test.ts` (create)
Consumes:  `node-pty` 1.1.0 in `package.json` `dependencies` ← 01 · `PtySpawn`, `Pty`, `PtyOptions`, `PtyExit` in
           `src/contracts/pty.ts` ← 02 · `SessionHostDeps.ptySpawn` in `src/session-host/host-server.ts` ← 02 ·
           `scripts/check-layers.mts` with the `src/renderer/xterm` entry in place ← 05 (05 edits the file first; this
           task adds its own entry to that state)
Produces:
- `src/session-host/node-pty/node-pty-spawn.ts` — the only file in the repo that imports `node-pty`:
  ```ts
  import type * as NodePty from 'node-pty';
  // A PtySpawn over the module `load` returns. `load` runs on the first spawn, not at import.
  export function createNodePtySpawn(load: () => typeof NodePty): PtySpawn;
  // createNodePtySpawn(() => require('node-pty') as typeof NodePty)
  export const nodePtySpawn: PtySpawn;
  ```

Decisions:
- **Lazy load.** The adapter loads node-pty on its first spawn, not at host start. node-pty loads its native
  `pty.node` when it is required (`lib/unixTerminal.js` calls `utils_1.loadNativeModule('pty')` at module top, read
  from unpkg for 1.1.0). A static import would put that load in the host's own start, so a missing prebuild or a
  blocked `.node` file would stop every hosted agent session, not only the terminals. With the lazy load, a failed
  load throws from the `PtySpawn`, and task 02's table refuses that `termSpawn` with the thrown message, which the
  drawer shows.
  - `createNodePtySpawn(load)` calls `load()` once, on the first spawn, and keeps the module it returns.
  - When `load()` throws, that spawn throws `node-pty did not load: <message>`. The next spawn calls `load()` again,
    since Node does not cache a failed `require`.
  - `nodePtySpawn` passes `() => require('node-pty') as typeof NodePty`. The host bundle is CommonJS
    (`vite.session-host.config.mts` `formats: ['cjs']`), and `main.ts:726` already uses the CommonJS `__dirname`.
    With `node-pty` external, the bundle keeps this `require("node-pty")` as it is. Unchecked: that vitest 5.0.5 gives
    a test module a `require`. The boundary test settles it: when it fails with `require is not defined`, use
    `createRequire(import.meta.url)` from `node:module` in the test only, and report it in the Proof section.
  - The type-only import brings in no code; `import type` is still an import of `node-pty`, so the layer entry
    (below) allows it.
- **Adapter.** A spawn calls node-pty's `spawn(file, [...args], { name: 'xterm-256color', cwd, env, cols, rows })`
  and wraps the returned `IPty`:
  - `pid` reads the `IPty`'s `pid`.
  - `onData(listener)` and `onExit(listener)` subscribe through the `IPty`'s `onData` and `onExit` events.
    `onExit` maps node-pty's `{ exitCode, signal?: number }` to `PtyExit` with `signal: signal ? signal : null`, and
    passes `exitCode` as it is.
  - Why that mapping: node-pty 1.1.0's `src/unix/pty.cc` (read from unpkg) starts its exit event as
    `int exit_code = 0, signal_code = 0;`, sets `exit_code = WEXITSTATUS(...)` when `WIFEXITED`, and sets
    `signal_code = WTERMSIG(...)` when `WIFSIGNALED`. So on macOS and Linux a normal exit reports `signal` 0, and a
    signal exit reports `exitCode` 0 with the signal number. Windows leaves `signal` undefined. `signal ?? null` would
    pass the 0 on as a signal. Task 02's table turns a non-null signal into `code: null`.
  - `write`, `resize` and `kill()` call the same-named `IPty` methods; `kill` passes no signal. node-pty 1.1.0's
    `UnixTerminal.prototype.kill` runs `process.kill(this.pid, signal || 'SIGHUP')` in a try with an empty catch
    (`lib/unixTerminal.js`, read from unpkg), so macOS and Linux get SIGHUP, and a kill of a gone pid throws nothing.
    Windows takes no signal. The SIGKILL after `HOST_END_GRACE_MS` is task 02's, through the children record, not
    this adapter's.
  - node-pty sets `TERM` from `name`; the host's env already holds `TERM=xterm-256color` (task 02), and `name` keeps
    the two the same.
- **session-host.ts** passes `ptySpawn: nodePtySpawn` to `startSessionHost`, in place of the refusing `PtySpawn`
  task 02 put there.
- **Vite.** `vite.session-host.config.mts` gains `build.rollupOptions.external: ['node-pty']`. Use `rollupOptions`,
  not `rolldownOptions`: Forge's Vite plugin 8.0.1 sets its own Node built-ins under `build.rollupOptions.external`
  (`node_modules/@electron-forge/plugin-vite/dist/config/vite.main.config.js`), and `mergeConfig` joins the two
  arrays only under the same key. So the built `session-host.js` keeps `require("node-pty")`, and Node resolves it at
  run time: from the repo's `node_modules` under `npm start`, from the packaged app's `node_modules` (next bullet)
  packaged.
- **Packaging.** Forge's Vite plugin ships only `/.vite` (`VitePlugin.js` ignore filter, plan.md § Preconditions), so
  `forge.config.mts` copies node-pty in by hand:
  - A `packageAfterCopy(forgeConfig, buildPath, electronVersion, platform, arch)` hook (the signature in
    `@electron-forge/shared-types` 8.0.1) copies from `<repo>/node_modules/node-pty` into
    `<buildPath>/node_modules/node-pty`: `package.json`, `lib/`, and `prebuilds/<platform>-<arch>/` when it exists,
    else `build/Release/`. It throws `node-pty has no native build for <platform>-<arch>` when neither exists, so a
    package never ships without the pty. Copy with `cpSync(…, { recursive: true })`, which keeps each file's mode.
  - It copies no `binding.gyp`. Forge's rebuild step runs right after this hook, and `@electron/rebuild` 4.2.1
    rebuilds only a module folder holding `binding.gyp` (`node_modules/@electron/rebuild/lib/rebuild.js:98`), so it
    leaves the copy as it is.
  - `packagerConfig.asar` becomes `{ unpack: '**/node_modules/node-pty/**' }`, so `pty.node`, `spawn-helper` and the
    Windows `conpty` files stay real files under `app.asar.unpacked`. node-pty 1.1.0's `lib/unixTerminal.js` rewrites
    the helper's path itself: `helperPath.replace('app.asar', 'app.asar.unpacked')` (read from unpkg).
  - node-pty 1.1.0's published package holds prebuilds for `darwin-arm64`, `darwin-x64`, `win32-arm64` and
    `win32-x64` only (read from unpkg's file list), each `darwin-*` with `pty.node` and `spawn-helper`. Linux has no
    prebuild: there the install builds `build/Release/` through node-gyp.
  - The hook writes into `buildPath` after the packager's copy, and @electron/packager 20.3.0 prunes inside that copy
    (`dist/copy-filter.js`), so no prune step touches the hook's files. node-pty stays in `dependencies` (task 01)
    because the packaged host loads it at run time.
- **Layer rule.** `npm run lint` runs `node scripts/check-layers.mts`. The `'src/session-host'` entry (now
  `scripts/check-layers.mts:590`) allows only `node:` packages, so this task's import of `node-pty` fails lint
  without a rule of its own. `layerOf` (now :797) gives a file its longest layer key, and an import into another
  layer passes only when `rule.layers` holds that layer (now :849). So:
  - Add a `CORE_LAYERS` entry right after the `'src/session-host'` entry, with the comment
    `// The node-pty adapter: the only file that imports node-pty.`:
    `'src/session-host/node-pty': { layers: ['src/contracts'], packages: ['node:', 'node-pty'] }`.
  - Add `'src/session-host/node-pty'` to the `'src/session-host'` entry's `layers`, so `session-host.ts` may import
    the adapter.
  - Task 05 edits the same file first (wave 2). Add these lines to the file as 05 left it.
- **First step: confirm the files.** Before writing the hook, read the installed `node_modules/node-pty/package.json`
  and `lib/utils.js` (`loadNativeModule`: it tries `build/Release`, `build/Debug`, then `prebuilds/<platform>-<arch>`,
  each from `..` then `.`) and list `node_modules/node-pty/prebuilds/`. When the installed files differ from the
  list above, copy what the loader reads and report the difference in the Proof section.
- **First step: the helper's mode.** Run `test -x node_modules/node-pty/prebuilds/darwin-<arch>/spawn-helper`. When
  it fails, stop and report it to the lead: every macOS spawn then fails with `posix_spawnp failed`, and a `chmod` of
  installed files is not in this plan. The hook's `cpSync` keeps the mode it finds, so the package would fail too.

Pinned values: external `node-pty` · unpack glob `**/node_modules/node-pty/**` · pty name `xterm-256color` · errors
`node-pty has no native build for <platform>-<arch>`, `node-pty did not load: <message>`.

GIVEN the adapter WHEN it spawns `/bin/echo hi` THEN its data holds `hi` and its exit code is 0
GIVEN a node-pty that fails to load WHEN the adapter spawns THEN the spawn throws `node-pty did not load: <message>`
and the import of the adapter throws nothing
GIVEN node-pty's exit event WHEN its `signal` is 0 or undefined THEN the `PtyExit` has `signal: null`
GIVEN `npm run package` WHEN it finishes THEN `app.asar.unpacked/node_modules/node-pty` holds `pty.node` and an
executable `spawn-helper`

Tests:
- create `src/session-host/node-pty/node-pty-spawn.test.ts`, `describe('nodePtySpawn')`, a boundary test over the
  real node-pty, `it.skipIf(process.platform === 'win32')`:
  - `it('runs a program in a pty and reports its output and exit')` — `nodePtySpawn('/bin/echo', ['hi'], { cwd:
    tmpdir(), env: { PATH: '/bin:/usr/bin' }, cols: 80, rows: 24 })` → the joined data contains `hi`; `onExit` gives
    `{ exitCode: 0, signal: null }` once (wait with `vi.waitFor`); `pid` is a positive integer.
- in the same file, over `createNodePtySpawn` with a fake module (a `spawn` that returns a fake `IPty` whose `onExit`
  listener the test calls), on every platform:
  - `it('load_Throws_SpawnThrowsTheReasonAndLoadsAgainNextTime')` — `load` throws `Error('no prebuild')` →
    `createNodePtySpawn` itself calls nothing; the spawn throws `node-pty did not load: no prebuild`; a second spawn
    calls `load` a second time.
  - `it.each` `'exit_Signal_MapsToPtyExit: $name'` — rows: `{ exitCode: 3, signal: 0 }` → `{ exitCode: 3, signal: null }`;
    `{ exitCode: 0, signal: 9 }` → `{ exitCode: 0, signal: 9 }`; `{ exitCode: 4 }` (Windows) →
    `{ exitCode: 4, signal: null }`.
- The packaging claims have no unit test; Done when checks them in the package.

Done when:
1. `npm run typecheck` passes, `node scripts/check-layers.mts` passes, and the tests above exist for the test gate.
2. `npm run package` succeeds (the repo's script, `electron-forge package`; it runs the macOS `codesign` in
   `postPackage`).
3. `.vite/build/session-host.js` holds `require("node-pty")` and none of node-pty's own source.
4. In `out/wigley-ai-gui-darwin-<arch>/wigley-ai-gui.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty`,
   `prebuilds/darwin-<arch>/pty.node` exists and `prebuilds/darwin-<arch>/spawn-helper` is executable
   (`test -x` exits 0).
5. With a one-line script in the session scratchpad,
   `const p = require('<app>/Contents/Resources/app.asar/node_modules/node-pty').spawn('/bin/echo', ['hi'], {}); p.onData(d => process.stdout.write(d));`,
   `ELECTRON_RUN_AS_NODE=1 "<app>/Contents/MacOS/wigley-ai-gui" <script>` prints `hi`. The `app.asar` path is the route
   the packaged host's `require` takes; when it fails, run the same script on the `app.asar.unpacked` path and record
   both results in the Proof section.
6. `codesign --verify --deep --strict "<app>"` exits 0.

Commit: one commit — "node-pty adapter behind the pty contract, wired into the session host, kept external in its
Vite build, and copied and unpacked into the packaged app".

## Proof
