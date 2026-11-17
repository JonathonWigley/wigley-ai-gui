# Lane P: platform — plan

Feature: intent-alignment (Lane P of `../master-plan.md`) · Implements: none · Ticket: none
Target: main · Written: 2026-11-09 · Revised: 2026-11-16 (audio picker joins 02 and 03; one detached start)

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Land the four Lane P items of `../master-plan.md`, so platform knowledge sits behind adapters and the
Platform record, with no `process.platform` checks in features:

1. **Per-platform chord matching** — chords match the typed character, with the physical key for macOS Option
   chords and non-Latin layouts; AltGr typing is not a chord; chords may hold any printable character, F1–F12 and
   the navigation keys.
2. **Per-source alert descriptions** — each alert source says what it counts, so the Windows taskbar text names
   each source's own noun.
3. **Round store through Files** — the saved-form store and sessions' endpoint files go through `Files`; the
   atomic write retries a held rename on Windows.
4. **Per-platform program lookup and spawning** — `ProcessRunner` gains `spawn` (a handle) and `resolveProgram`
   (per-OS candidates, one core Python setting), and its `startDetached` takes an optional log and extra environment;
   every start finds `.cmd`/`.bat` shims and PATHEXT names; the Claude adapter and the session host client stop
   importing `node:child_process`; `claude` is looked up on PATH with the installer's
   spot as fallback.

## Architecture

Systems touched:

- **Platform record** (`src/contracts/platform.ts`, `src/shared/platform.ts`): gains `keys` (task 01) and per-OS
  program candidates (task 04).
- **Page key engine** (`src/renderer/key-sequences.ts`, `page-keys.ts`, `renderer.ts`) and the chord notation
  readers (`src/shared/chord-notation.ts`, `key-notation.ts`, `key-hints.ts`, `keymap-checks.ts`, the drive's
  `page-driver.ts`, settings' `leader-menu-view.ts`).
- **Alerts** (`src/contracts/alerts.ts`, `src/main/alerts/`, `src/shared/plugin-service-views.ts`, the agent-form
  channel presenter and its three callers: forms, primer, audio picker).
- **Files adapter** (`src/main/files/node-files.ts`) and the **agent-form store** (`src/shared/agent-forms/`), the
  main starts of the three agent-form types (forms, primer, audio picker), sessions' relay endpoint files.
- **Processes** (`src/contracts/processes.ts`, `src/main/processes/`, `src/shared/fake-processes.ts`), docs' index
  runner, unity-pool's CLI, the core settings, the Claude adapter (`src/main/claude-code/`), the session host client
  and `src/main/main.ts`.

### Cross-lane gate (settled with the user, `../master-plan.md` § Intent, "Side lanes")

Tasks 04 and 05 (Per-platform program lookup and spawning) start only after Lane H's **AgentHarnessRegistry**,
**Permission behind the harness** and **Harness settings with the harness** have landed on `origin/main`: they share
`src/main/claude-code/`, `src/main/main.ts`, `src/config/settings.ts` and the Platform record's `programs`. Before
dispatching Wave 4, `wigley:make` runs the gate check in Preconditions. When it fails, the run stops after Wave 3 with
Waves 1–3 landed and reports the waiting gate; a later `wigley:make` session resumes at Wave 4. Tasks 01–03 run beside
any other lane.

At Wave 4 start, `wigley:make` re-reads where Lane H moved each thing tasks 04 and 05 name — the `claude.command`
setting (into the Claude harness plugin's manifest), the harness construction (out of `main.ts` into the harness
plugin, which then receives `api.services.processes`), the `permissionTool` dep — and applies each task's decision to
its landed home. The decisions in 04 and 05 are written against today's names, with each Lane H move marked.

## Preconditions

Each verified at plan time (2026-11-09, on that day's `main`); `wigley:make` re-runs them before the first dispatch,
and the gate check again before Wave 4. A `\|` in a command is the table's escape for `|`.

| Claim | Command | Expected |
|---|---|---|
| Chords hold only letters, digits, `;`, `'`, Enter, Tab | `grep -n "^const CHORD_NOTATION" src/shared/chord-notation.ts` | `/^<(C-)?(A-)?(S-)?(D-)?([a-z0-9;']\|Enter\|Tab)>$/` |
| The Platform record has no `keys` block | `grep -c "keys" src/contracts/platform.ts` | `0` |
| The Windows overlay text is hard-coded | `grep -n "open agent form" src/main/alerts/windows-alerts.ts` | two lines |
| `Alerts.setOpenCount` takes `(source, count)` | `grep -n "setOpenCount" src/contracts/alerts.ts` | `setOpenCount(source: string, count: number): void;` |
| The form store uses sync `node:fs` | `grep -n "from 'node:fs'" src/shared/agent-forms/form-store.ts` | one line |
| The endpoint files write with sync `node:fs` | `grep -n -E "mkdirSync\|writeFileSync\|renameSync" src/plugins/sessions/main/relay/endpoint.ts` | at least three lines |
| Forms' and primer's folders are inline | `grep -n -E "'wigley-forms', 'rounds'\|'wigley-primer', 'primers'" src/plugins/forms/main/start.ts src/plugins/primer/main/start.ts` | one line each |
| The audio picker is a third agent-form type with an inline folder, a prune and its own alert source (checked 2026-11-16) | `grep -n -E "'wigley-audio-picker'\|store.prune\|source: 'audio-picker'" src/plugins/audio-picker/main/start.ts` | three lines |
| `startDetached` exists with a required `logPath` and no `setEnv` (d49a34e6d; checked 2026-11-16) | `grep -n -E "logPath: string\|setEnv" src/contracts/processes.ts` | `logPath: string;` and the `run` option's `setEnv?` only |
| The session host starts through Node's `spawn` dep | `grep -n "spawn: SessionHostSpawn" src/main/session-host/session-host-client.ts` | one line |
| Docs runs a literal `python3` | `grep -n "processes.run('python3'" src/plugins/docs/main/index-sources.ts` | one line |
| Unity-pool has its own `pythonCommand` setting | `grep -n "pythonCommand: 'python3'" src/plugins/unity-pool/manifest.ts` | one line |
| `main.ts` imports Node's `spawn` | `grep -n "import { spawn } from 'node:child_process'" src/main/main.ts` | one line (gone once Lane H's registry moves the harness construction; then grep `src/plugins/` for the harness plugin's import) |
| The user has no `keymap.json` (so no `<C-S-1>`-style bind the new notation refuses) | `ls ~/.config/wigley-ai-gui/keymap.json` | no such file; if one appears, `grep -c -E 'S-[0-9;'"'"']'` on it is `0` |
| The user's `settings.json` holds no `pythonCommand` (this Mac; the Windows machine is the user's wrap-up step, 07) | `grep -c pythonCommand ~/.config/wigley-ai-gui/settings.json` | `0` |
| **Gate (Wave 4)**: Lane H's three items landed | `git fetch origin && git show origin/main:docs/features/intent-alignment/master-plan.md \| grep -c -E '\[x\] (AgentHarnessRegistry\|Permission behind the harness\|Harness settings with the harness)'` | `3` (plan time: `0`) |

## Docs written ahead

None, by decision: the four items land weeks apart (two wait on Lane H), and other lanes' sessions read `AGENTS.md`
and `docs/keymap.md` from `main` meanwhile, so a doc written ahead would tell them about chords or a `spawn` that do
not exist yet. Each task updates the doc lines its own change makes untrue, in its own commit, by the paths its Files
line names; task 06 re-reads every one of them against the landed code.

Each item's own commit also ticks its box in `../master-plan.md` § Lane P and removes its entry from
`docs/features/followups.md` § Platform and packaging (the master plan's rule): tasks 01, 02 and 03 each for their
item, and task 05 for Per-platform program lookup and spawning, which tasks 04 and 05 land together (04 touches
neither file). Task 05 also adds the follow-up its known Windows limit leaves (05 § Docs).

## Mandatory Reads

- `AGENTS.md` (the wigley-ai-gui folder's), through its last line: § Intent, § Architecture (the source tree; A key; An ambient
  service; A setting; A third-party tool; the layer check), § Running and testing, § Dev quirks (login-shell PATH).
- `docs/keymap.md` — task 01 (the chord rules and the `Cmd+,` note).
- `wigley:codebase-design`, `wigley:writing-code`, `wigley:writing-tests` (TypeScript: `typescript-vitest.md`).
- No `CLAUDE*.md`, nested `AGENTS*.md` or `.claude/rules/` exist in the wigley-ai-gui folder (checked with `find` at plan time).

## Design Overview

### After-state flows

```
Chords (01)
  keydown ─► page-keys: AltGr down && platform.keys.altGraphTypes ? typing : chord press
          ─► ChordPress { key, code, ctrl, alt, shift, meta, altGraph }
          ─► key-sequences matcher(platform.keys):
               Option chord on a platform with optionMatchesByCode ─► match by code
               typed key is a Latin letter, digit or known symbol  ─► match by key
               otherwise (non-Latin layout)                         ─► match by code
  keymap.json "<C-/>" "<F5>" "<A-Up>" "<C-lt>" ─► chord-notation.parseChord (one reader)
          ─► key-notation / key-hints / keymap-checks / page-driver / leader-menu-view

Alerts (02)
  forms / primer / audio-picker presenter ─► alerts.setOpenCount(source, count, { singular, plural })
          ─► trackedAlerts (zeroes a stopped plugin's sources)
          ─► open-counts: { total, parts[] in first-count order }
          ─► mac: badge = total · windows: overlay text = parts joined ", " · linux: none

Round store (03)
  form-service ─► AgentFormStore: reads sync from the in-memory index
                                 saveBody → Promise (a failed save shows as unsaved)
                                 other writes → one ordered queue, failures logged
          ─► Files.write (atomic; rename retried on EPERM/EBUSY) · Files.watch refreshes the index
  sessions contributeTools (sync) ─► endpoint writer queue ─► Files.write endpoint.json / tools.json

Programs (04, 05)
  docs index / unity-pool ─► processes.resolveProgram('python')
          ─► core setting programs.python, else platform.programs.python candidates in order
          ─► program-lookup: PATH × PATHEXT search over Files ─► { command, args } | null
  Claude adapter ─► processes.spawn(command, args, options) ─► ProcessHandle (stdin, stdout, stderr, exit, kill)
  session host client ─► processes.startDetached(execPath, …, { setEnv: { ELECTRON_RUN_AS_NODE } })  (no log)
  app-update installer ─► processes.startDetached(command, args, { cwd, logPath })  (unchanged call)
  session processes (claude per session) ─► the session host process's own adapters, unchanged (Out of scope)
  node adapter (run, spawn, startDetached): .cmd/.bat ─► cmd.exe /d /s /c "<quoted>" (one pure quoting function)
  claude.command empty ─► resolveProgram('claude'): `claude` on PATH, else ~/.local/bin/claude
                          (Windows: `claude.exe` only, so no shim reaches the session host)
```

### Decisions (interview, 2026-11-09; the user took every recommendation)

- **Spawn handle**: a new `ProcessRunner.spawn(command, args, options)` returning a handle; `run` unchanged for
  every other caller.
- **Session host start too**: the session host client starts the host through `ProcessRunner` (revised 2026-11-16:
  through `startDetached`, below), so no main-process code outside `src/main/processes/` spawns a program. The
  session host process's own adapters (`src/session-host/`) stay as they are.
- **Python**: one core setting `programs.python`, empty by default; when set it wins, else the OS's candidate order
  from the Platform record (Windows `py -3` → `python` → `python3`; macOS and Linux `python3` → `python`).
  Unity-pool's `pythonCommand` setting is removed; docs and unity-pool both ask `resolveProgram('python')`.
- **Default claude command**: empty means look up — `claude` on PATH at each launch, then the installer's own spot
  (`~/.local/bin/claude`; `claude.exe` there on Windows). A set command still wins.
- **Round store**: reads stay sync from an in-memory index that `Files.watch` refreshes (the stable app, the dev app
  and the marketplace retro skill share the folder); `saveBody` returns a promise; every other write runs in order
  behind it and logs a failure.
- **Alerts**: `setOpenCount(source, count, noun)` with `noun: { singular, plural }`.
- **Chord notation**: any printable character inside the brackets (`<C-/>`, `<C-,>`, `<C-?>`), vim's names for the
  clashing ones (`<C-lt>`, `<C-Bslash>`, `<C-Bar>`, `<C-Space>`), `F1`–`F12` alone or with modifiers, and `Up`,
  `Down`, `Left`, `Right`, `Home`, `End`, `PageUp`, `PageDown`, `BS`, `Del` with a modifier. A symbol is written by
  the character it types: `<C-?>`, never `<C-S-/>`.
- **Chord matching**: the typed character; the physical key for Option chords where the Platform record says so
  (macOS) and whenever the typed character is not a Latin letter, digit or known symbol.
- **AltGr**: a press with AltGr down is typing, never a chord, where the Platform record says so (Windows, Linux);
  other Ctrl+Alt binds keep working.

Decisions (round of 2026-11-16, after the refresh against `main` at 83305ac31; the user took both recommendations):

- **Audio picker joins 02 and 03**: the audio picker is a third agent-form type. It gets its own alert noun
  (`open audio picker` / `open audio pickers`), a `SAVED_PICKERS_FOLDER` constant holding today's path, the load
  gate (`afterLoad`) in place of `prune()`, and a stop that returns `store.flushed()`, as forms and the primer do.
- **One detached start**: `spawn` always has its pipes; `startDetached` (in the tree since d49a34e6d, used by
  app-update) is the only way to start a program that outlives the app. Its options gain `setEnv` and an optional
  `logPath`, it gets the Windows PATHEXT lookup and shim handling (04), and the session host starts through it with
  no log (05). `abortableProcesses` kills every spawned handle with no detached exception.

Decided by the agent (shown as Decided notices):

- `.cmd`/`.bat` start through `cmd.exe /d /s /c` inside the node adapter, with the quoting in one pure function;
  PATHEXT and shim handling apply to every `run`, `spawn` and `startDetached` of a bare name, git's included.
- Program lookup is a pure module over `Files`, an env record and the OS's path rules.
- The rename retry on `EPERM`/`EBUSY` lives in `Files.write` and `writeBytes` (node adapter), for every caller.
- A failed `markReturned` retries through the adapter, logs, and the index still holds the form returned.
- Endpoint files write through `Files` behind one ordered writer; `contributeTools` stays sync.
- Each form type names its saved-forms folder as a constant in its own contract.
- The Windows overlay text joins each source's phrase with `, ` in the order sources first set a non-zero count.
- Key code reads `platform.keys` flags, never `os === …`.
- No docs written ahead (see Docs written ahead).
- One task per wave: every item ticks `../master-plan.md` and edits `followups.md` in its own commit, and 02/03,
  04/05 share files.
- Drafting decisions, each written in its task: navigation keys need Ctrl, Alt or Cmd (Shift alone selects text);
  "printable" is printable ASCII; digits follow the symbol rule (no `S-`); `Files` gains `deleteFile` rather than
  trashing pruned forms; the composition root calls `store.load()` where it called `prune()`; one ordered queue per
  store; forms' and primer's `dispose` return `store.flushed()` (the plugin host awaits `dispose`,
  `src/shared/plugin-host.ts:247`); POSIX `run`/`spawn` leave the PATH search to Node, Windows searches
  PATH × PATHEXT; `AgentHarness.start` stays sync behind a pending pipe while the command lookup resolves.
- Cold-read decisions, each written in its task: the text-box and Fabric guards treat an AltGr press as typing
  (one `isChordPress` predicate); Windows `claude` candidates name `claude.exe`, so an npm shim never reaches the
  session host; a throwing `stat` is a miss; the node adapter's Windows branch is tested on every OS through an
  injected `start`; a failed write keeps its form through a rescan.
- Design review: the shapes above follow the Platform record and adapter seams already in the tree; `resolveProgram`
  takes a program name from the record rather than candidates from each caller, so the per-OS order and the
  override live in one place (locality).

### Out of scope

- Moving `Cmd+,` and other menu accelerators onto page chords.
- A chat source for the icon badge (none exists; Lane H's chat pass may add one).
- The session host process's own `node:child_process` adapters (`src/session-host/`) and `src/main/login-shell-env.ts`.
- Real Windows runs: AltGr on a physical keyboard, `cmd.exe` shims, `py -3`, a held-file rename — the user's checks,
  listed in the wrap-up.
- The completion popup's Ctrl+N and Ctrl+P (`popupActionOf`) keep matching on `code`.
- A `claude.cmd` shim for session processes on Windows (task 05 files it as a follow-up).
- Lane H's shape for `PlatformPrograms.claude`: at Wave 4, `wigley:make` re-reads what Lane H did with the
  record's `programs` along with the setting (Cross-lane gate).

## File Structure

Shared by more than one task (the only cross-part names; each task document pins its own):

- `src/contracts/platform.ts` — task 01 adds, task 04 builds on:

  ```ts
  export interface PlatformKeys {
    // An Option (Alt) chord matches the physical key, since Option changes the typed character.
    readonly optionMatchesByCode: boolean;
    // A press with AltGr down types a character and is never a chord.
    readonly altGraphTypes: boolean;
  }
  // Platform gains: readonly keys: PlatformKeys;
  ```

  Values (`src/shared/platform.ts`): macOS `{ optionMatchesByCode: true, altGraphTypes: false }`, Windows
  `{ false, true }`, Linux `{ false, true }`.

- `src/contracts/platform.ts` — task 04 replaces `PlatformPrograms`:

  ```ts
  // One way to start a program: the command and the arguments that lead every run (`py` with `-3`).
  export interface ProgramCandidate {
    readonly command: string;
    readonly args: readonly string[];
  }
  // Each program's candidates, tried in order.
  export interface PlatformPrograms {
    readonly python: readonly ProgramCandidate[];
    readonly claude: readonly ProgramCandidate[];
  }
  export type ProgramName = keyof PlatformPrograms;
  ```

- `src/contracts/processes.ts` — task 04 adds `ProcessRunner.spawn(…)`, `ProcessHandle`, `ProcessSpawnOptions` (no
  `detached` member) and `resolveProgram(name: ProgramName): Promise<ProgramCandidate | null>`, and widens
  `DetachedStartOptions` to `{ cwd?: string; logPath?: string; setEnv?: Readonly<Record<string, string>> }`; task 05
  consumes them (`spawn` for the Claude adapter, `startDetached` for the session host client).
- `SAVED_ROUNDS_FOLDER`, `SAVED_PRIMERS_FOLDER`, `SAVED_PICKERS_FOLDER` — task 03, one per form type's contract.
- `src/contracts/files.ts` — task 03 adds `deleteFile(path: string): Promise<void>` (the store's prune; no other
  task uses it).
- `docs/features/intent-alignment/master-plan.md` and `docs/features/followups.md` — tasks 01, 02, 03 and 05 (each
  its own box and entry).
- `AGENTS.md` — tasks 01, 03, 04, 05 (each its own lines).

New files:

- `src/shared/program-lookup.ts` (+ test) — task 04: the pure PATH × PATHEXT search and the `cmd.exe` quoting, so
  both are tested as string functions on any OS.

Boundary rules: contracts import nothing; the node adapters (`src/main/processes/`, `src/main/files/`) are the only
`node:child_process` and `node:fs` importers among the files this plan touches; plugins reach processes and files only
through `api.services`; the page reads the Platform record from the served config.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Per-platform chord matching](01-chord-matching.md)

### Wave 2
- [x] [Per-source alert descriptions](02-alert-descriptions.md) — after 01 (shared master plan and follow-ups)

### Wave 3
- [x] [Round store through Files](03-round-store-files.md) — after 02

### Wave 4 — gate: Lane H's AgentHarnessRegistry, Permission behind the harness, Harness settings with the harness
- [x] [Program lookup and spawn behind ProcessRunner](04-program-lookup-spawn.md) — after 03 and the gate

### Wave 5
- [x] [Claude adapter and session host start through ProcessRunner](05-claude-spawn-handles.md) — after 04

### Wave 6
- [x] [Doc re-read](06-doc-re-read.md) — after 05

### Wave 7
- [ ] [Final verification](07-final-verification.md) — after 06

## Run log

Review base: e6c894d93

### Groups
- 01 · hard · 07bec5457 · diff read against Produces (all present, no contract changes); typecheck and lint pass after an oxfmt pass on three files · concerns: done-when grep 'keys:' finds only the parameter, the records are positional (optionMatchesByCode finds all three); capture test row Ctrl+[ swapped for Dead since <C-[> is now a chord; check-layers lets src/renderer/fabric import src/shared/page for isChordPress; settings design.md:34 reworded off the comma reason
- 02 · hard · 36a249aa7 · Diff read: AlertNoun and setOpenCount(source, count, noun) in contracts/alerts.ts; describeOpenCounts and OpenCounts {total, parts} in open-counts.ts; windows-alerts uses describeOpenCounts with no inline 'open agent form' string; alertNoun passed in forms, primer and audio-picker start.ts. typecheck and lint pass. · concerns: Part order rests on Map insertion order (a source enters on its first count above 0 and keeps its place); tests follow the task doc's table [count, noun] over its prose [count, singular]; primer and audio-picker noun literals wrapped for oxfmt.
- 03 · hard · fbfd81e40 · Diff read: Files.deleteFile in contract, node, memory and scoped adapters; Node write retries EPERM/EBUSY renames; createFolderFormStore over Files with load/flushed and an indexed, watched folder, prune queued after the first scan; saveBody and draft return promises; afterLoad wraps the folder-backed services; SAVED_ROUNDS_FOLDER, SAVED_PRIMERS_FOLDER, SAVED_PICKERS_FOLDER constants; createEndpointWriter in relay/endpoint.ts. typecheck and lint pass; the worker ran 17 touched test files (425 tests) green. · concerns: Out-of-list edits: audio-reads.test.ts listener fake, and check-layers.mts sublayers for forms/primer start tests (shared/paths, own contract, node: dropped). The done-when grep 'store.prune' still hits backlog's unrelated chunk-store prune. Rescan test reordered because the spec's order could not fail. Forms and primer start tests flush() after a drive open. Selftest and drive scripts may need a wait after an open, since open now waits for load; not run.
- 04 · hard · 978572251 · Diff read: ProgramCandidate/PlatformPrograms per OS, resolveProgram on node/limitRuns/abortable/Fake runners, program-lookup.ts exports (envVariable, findProgram, findCandidate, shimLaunch, programNotFoundMessage), NodeProcessesDeps with injected start, startDetached optional logPath and setEnv, programs.python core setting, docs and unity-pool through resolveProgram; Lane H's spawn kept per ruling. typecheck passes; lint passes after a check-layers sublayer fix (same rung). · concerns: Windows spawn line-break failure reports shimLaunch's raw message (no Could not run prefix) to match the landed spawn's startError shape; found Windows paths keep PATHEXT case; a sync throw from start inside run keeps its cached path; a setEnv PATH beside a copied Path key takes the first; new hostNodeProcesses test-support helper used by process-git and judge tests; claudeCommand falls back to the last claude candidate until 05
- 05 · hard · 8138eba0b · Diff read: command(): Promise<ProgramCandidate|null> in start.ts via resolveProgram('claude'); createPendingPipe in pending-pipe.ts; session host via processes.startDetached with setEnv ELECTRON_RUN_AS_NODE; main.ts drops node:child_process; Done-when greps print nothing. typecheck and lint pass. · concerns: harness tests adjusted by reading alone (settle() awaits); start_ThenDetach_ReportsNoSessionId row removed, its claim moved to start_DetachBeforeCommandResolves_SpawnsNothing; one-shots split into async claudeProgram + sync spawnCli with CliEvents so a cancel before spawn spawns nothing
- 06 · standard · ddba3fbdf · Diff read: keymap.md and the PageBind comment name the Option-chord and non-ASCII physical-key exceptions; every other listed line checked true against the code. typecheck and lint pass. · concerns: none
### Contract changes
### Rulings
- the matcher compares the press's chordTokenFor token with the bind's token rather than five fields — one token per chord, so equal — and named-key checks ask chordToken, keeping one list of chord keys · group 01
- Wave 4 gate failed at 2026-11-17 (Lane H count 0 on origin/main): run stops after Wave 3; tasks 04–07 stay open.
- 07 run early for tasks 01–03 (review round 1 finding 4: the only live checks would otherwise wait on the Lane H gate): self-test checks 1–3 passed (selftest forms/primer/audio-picker/settings; <C-/> ran keys.toggleHelp, <A-o>/<C-S-j>/<D-Enter>/Tab steps passed); drive run 20261117-121528-3cdf (opus-low): 5 PASS (<C-?>, <F5>, <A-Up> ran keys.toggleHelp from keymap.json), 9 PASS (restart prefilled the re-sent round from the saved file), 10 PASS (endpoint.json parses; tools.json lists every contributed tool), extra <A-o> in a forms notes box ran sessions.nextTab with no ø. 07 stays open for 4, 7, 8, 11, 12 after the gate.
- Wave 4 gate passed 2026-11-17 (count 3 on origin/main 8d829c42c); waves 4-7 run in worktree ai-lane-p-platform from 8d829c42c, and their review range is 8d829c42c..HEAD (01-03 were reviewed in rounds 1-2) · lead
- Lane H landed ProcessRunner.spawn first (594eb7589: SpawnOptions with events, SpawnedProcess, SpawnExit.startError {message, notFound}; tracked by abortableProcesses, forwarded by limitRuns, FakeSpawn in fake-processes); 04 keeps that contract and drops its ProcessHandle, ProcessExit, ProcessSpawnOptions and FakeProcessHandle, adding only the Windows lookup and shim, resolveProgram and the startDetached widening; 05 consumes the landed spawn — one spawn contract, not two; cost if wrong: 04/05 tests named in the task docs map onto the landed shape · lead
- Lane H homes: the harness is src/plugins/claude-code/main/ (claude-code-harness.ts, start.ts), the claude command is the claude-code plugin's own command setting (default '' already, with claudeCommand(setting, programs) falling back to programs.claude), permissionTool left the deps, core settings are coreDefaultSettings() with no claude member; 04 keeps claude-code start.ts compiling over the new candidate PlatformPrograms by falling back to the claude candidate list's installer spot (today's behaviour), and 05 replaces it with resolveProgram · lead
- 04 contract change: the Windows spawn line-break start error is shimLaunch's message as it is, matching the landed spawn's startError.message (run and startDetached keep the Could not run prefix) · group 04 · group 04
- 05 contract change: one-shots split into claudeProgram (async, throws the not-found text) and a sync spawnCli(program, …) with CliEvents; harness-internal, no consumer outside · group 05 · group 05
### Review rounds
- Round 1 (pinned 123ba61c8): NEEDS FIXES — 4 Important, 11 Minor; 1 dropped (coverage misread). Lead-applied 510b0c9ef (stale followup). Picks per repo rule: #5 AltGr two predicates Leave it (plan Decision 12; 07 live check covers); #4 live checks for 01–03 run at this run's live session. Fix range 9d99ebbf1, 7f05de6cb — tier: Medium (new production seam withShownWaits, self-test flow, load/prune order, endpoint path join) → re-review, correctness lane.
- Round 2 re-review (fix range 510b0c9ef..7f05de6cb): all 9 fixes closed; 3 Minor. #1 self-test hang on a refused ask and #2 withShownWaits untested -> fixed in 269a8956a; #3 Node deleteFile under a file on Windows (unchecked theory) -> Leave it, Windows run of node-files.test.ts goes to the wrap-up. Fix range tier: Low (self-test script and a test-only-used helper; selftest --plugin forms passed) -> no re-review.
### Test gate
- Tier High (plan's rating: async store, chord matching across platforms). Picks: vitest over every folder the range touches and their dependents (src/shared, src/renderer, src/main/{alerts,files,drive,plugins}, src/plugins/{forms,primer,audio-picker,sessions,settings}): 292 files. 1 caused failure, plugin-manifests 'box-only bind' used <F5>, now a chord -> fixed 8ab20b180, rerun green. 1 pre-existing failure: plan-copies readPlanCopy_PlanAndLinkedTaskDocuments (fails at review base e6c894d93 too). selftest --plugin forms --plugin primer --plugin audio-picker --plugin settings: all passed. Skipped: whole selftest and whole suite (not asked).
