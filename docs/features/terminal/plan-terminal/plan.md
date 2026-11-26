# Terminal — plan

Feature: Terminal in the app · Implements: none · Ticket: none
Target: main · Written: 2026-11-25

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — one shell per session in a drawer; agents type a command for the user to run.
- **Architecture** — the systems touched.
- **Preconditions** — repository facts the plan rests on, with the commands that checked them.
- **Docs written ahead** — the design docs and the rule line already written.
- **Mandatory Reads** — the agent files every task reads.
- **Design Overview** — flow, decisions, out of scope.
- **File Structure** — every shared name, signature and type, and the files each area owns.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

The user runs short commands an agent cannot run for them, such as `gcloud auth login`, without leaving the app. Each
session gets its own shell, started on first use, drawn in a drawer at the bottom of the session's frame. An agent
calls the app command `terminal.type` to type a command line into its own session's shell. The user presses Enter.
The agent reads the shell's recent output from the `terminal.output` slot.

## Architecture

- **Session host** (`src/session-host/`): a new terminal table runs each shell in a pty, outside the process table's
  idle rules. Protocol 4 becomes 5.
- **Session host client** (`src/main/session-host/`): implements the new `TerminalHost` contract over the same link.
- **Pty seam**: `src/contracts/pty.ts`, adapter `src/session-host/node-pty/` over node-pty 1.1.0. The packaged app
  carries node-pty through a Forge hook.
- **Emulator seam**: `src/contracts/terminal-emulator.ts`, adapter `src/renderer/xterm/` over @xterm/xterm 6.0.0 and
  @xterm/addon-fit 0.11.0, handed to plugins as page `services.terminals`.
- **Composition root** (`src/main/main.ts`, `src/renderer/renderer.ts`): main `services.terminals` is the host client
  in a live run and a fake shell host in a self-test or drive run.
- **Platform record** (`src/contracts/platform.ts`, `src/shared/platform.ts`): a `shell` program list.
- **Sessions plugin**: a new page export `addDrawer`, a drawer row in each session's frame, Alt+j/k into and out of
  the drawer.
- **Terminal plugin** (new, `src/plugins/terminal/`): main part owns the shells, the output slot and `terminal.type`;
  page part owns the drawers and the emulators; layouts, keys, demo step, self-test, session note, `auri:terminal`
  skill.

## Preconditions

Each was checked in the plan worktree at `a5fd6bcb` (`origin/main` at the same commit).

| Claim | Command | Result |
|---|---|---|
| The host protocol is 4 | `grep -n 'SESSION_HOST_PROTOCOL =' src/contracts/session-host-protocol.ts` | `11:… = 4;` |
| `<Leader>bt` and `<C-\`>` are unbound | `grep -c 'Leader>bt' src/plugins/keymap.ts`; `grep -c 'C-\`' src/plugins/keymap.ts` | `0`, `0` |
| node-pty and xterm are not installed | `grep -c '"node-pty"\|"@xterm' package.json` | `0` |
| No `terminal` plugin exists | `ls src/plugins/terminal` | no such folder |
| The agent tool count is 35 | `grep -n 'TOOL_COUNT =' scripts/readme-coverage.test.mts` | `22:const TOOL_COUNT = 35;` |
| The follow-up is open | `grep -n 'Terminal in the app' docs/features/followups.md` | line 405 |
| Forge's Vite plugin ships only `.vite` | read `node_modules/@electron-forge/plugin-vite/dist/VitePlugin.js:259-265` | `ignore = file => !file.startsWith('/.vite')` |
| node-pty 1.1.0 builds on N-API | `npm view node-pty@1.1.0 dependencies scripts.install --json` | `node-addon-api ^7.1.0`; install `node scripts/prebuild.js \|\| node-gyp rebuild` |

The user approved installing `node-pty` 1.1.0, `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 for this run
(forms answer, 2026-11-25). No other package may be installed.

The user runs the install. `~/.claude/settings.json` denies package-manager installs to every agent, and a deny
overrides a forms answer. Before wave 1, the `wigley:make` lead runs `npm ls node-pty @xterm/xterm @xterm/addon-fit`
in its tree. When that does not list all three at the pinned versions, the lead asks the user, in a forms round, to
run `npm install --save-exact node-pty@1.1.0 @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0` in that tree, and starts
wave 1 once `npm ls` lists them. Task 01 then checks and commits the result.

## Docs written ahead

Committed with this plan folder; each carries a planned mark that task 11 drops.

- `docs/features/terminal/design.md` — the whole design.
- `docs/features/session-host/design.md` § The host › Terminals — the terminal table, replay, lifetime, drain and
  messages.
- `wigley-agents/AGENTS.md` § Communication forms (in the `ai` repo, branch `terminal-type-rule`, commit `7d88413b9`) —
  a sign-in command goes into the session's terminal first.

README, CHANGELOG and the app `AGENTS.md` change with the code (task 10): the README coverage test ties each to a
built plugin id and skill.

## Mandatory Reads

- `AGENTS.md` (the app repo root), through its last line. It holds the plugin layout, contracts and adapters, layouts,
  commands, keys, demo steps, self-test, platform adapters, README and changelog rules.
- `~/wigley-agents/AGENTS.md`, `~/wigley-agents/WigleyRepos.md`.
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in the app repo (`ls CLAUDE*.md .claude/rules` finds none).

## Design Overview

### Flow (after the change)

```
 agent ──run_command terminal.type "gcloud auth login"──▶ terminal main
                                                            │ no shell? spawn (80×24, projectDir or home)
                                                            │ write text, no Enter
                                                            │ channel message typed{sessionId,text}
                                                            ▼
 sessions page ◀─addDrawer / open({focus:false})──── terminal page ── setActivity(row, 'terminal', NEEDS_YOU)
   │ drawer row under the session's tabs                   │ screen = services.terminals.create(...)
   │                                                       │ invoke open → {buffer, seq, state} → screen.write
   ▼                                                       │
 user presses Enter in the drawer ──screen.onInput──▶ invoke write ──▶ terminal main ──TerminalProcess.write──▶
   session host client ──termWrite──▶ session host terminal table ──Pty.write──▶ shell
 shell output ──Pty.onData──▶ table ring (256 KB) ──termData──▶ client ──TerminalEvents.data──▶ terminal main
   ├─ main buffer (256 KB) + seq ──channel message data──▶ terminal page ──screen.write
   └─ last 200 lines, escape codes stripped ──keyed slot terminal.output[sessionId] (debounced 250 ms)
 agent ──read_state terminal.output <sessionId>──▶ the lines
```

### Decisions

- **Ownership.** Terminal main is the only subscriber of each shell. It keeps its own 256 KB buffer of the shell's
  output and a sequence number, so a page reload or a drawer opened late gets the screen from main. The page drops a
  `data` message whose `seq` is at or below the `seq` its `open` returned for the same shell id; a message of another
  shell id makes the page open again.
- **Shell start.** A shell starts on the first `open` from the page or the first `terminal.type`. A shell that
  `terminal.type` starts gets 80 columns and 24 rows; the page resizes it on open.
- **Shell end.** Terminal main kills a session's shell on the sessions main `closed` event. The `ended` event (the agent
  process ended) leaves the shell running. At main start, terminal main lists the host's shells; it adopts each whose
  id is a session with a row and kills the rest.
- **Restart after exit.** An exited shell's drawer shows its exit line. Enter in that drawer, or the header's restart
  control (shown only after an exit), invokes `restart`, which spawns a new shell for the session at the screen's size.
- **Environment.** The host spawns each shell with its own environment, less `ELECTRON_RUN_AS_NODE`, plus
  `TERM=xterm-256color` and `COLORTERM=truecolor`.
- **Shell program.** The platform record's `programs.shell` list, resolved with the existing
  `ProcessesService.resolveProgram`. macOS and Linux: `$SHELL` with `-l`, else `/bin/zsh` with `-l`. Windows: `pwsh`
  then `powershell.exe`, each with `-NoLogo`. No setting overrides it.
- **`terminal.type`.** Runs in main. Its argument is a string. It throws `terminal.type takes one line: the text holds
  a line break` on text holding `\n` or `\r`, and throws `terminal.type needs a calling session` when the call has no
  `callerSessionId`. It is not risky.
- **"Needs you".** The page sets `NEEDS_YOU_ACTIVITY` on the row with source id `terminal` on `typed`, and clears it
  when the user's input to that screen holds `\r`, or the drawer closes.
- **Output slot.** Main-owned keyed slot `terminal.output`, keyed by app session id; the value is a string: the last
  200 lines of output, escape sequences stripped, joined with `\n`. Writes are debounced 250 ms. A session's key is
  deleted when its shell is killed for a closed row.
- **Drawer.** One per session, drawn by sessions in a grid row of `.session-area` between the tab bodies and the
  popup bar, outside the popup layer. One height for every drawer, in sessions' uiState key `drawer-height`, dragged through
  `createSplitDivider` on the handle the layout part draws (task 07). A drawer starts closed after an app restart or a page reload.
- **Focus.** Sessions wraps the outer panes' `focus.move`: `down` from a session whose drawer is open and not focused
  focuses the drawer; `up` from inside the drawer focuses the session's selected tab. Every other move passes through.
- **Keys.** `<Leader>bt` and `<C-\`>` in scope `any` run `terminal.toggle`. `<Esc>` in scope `terminal.terminal` runs
  `terminal.back`, which returns focus to the session's selected tab and leaves the drawer open. The screen's element
  stops propagation of every bubble-phase keydown that is not Esc, as `textBoxInput` does, so Enter, Tab, Space and
  letters reach the shell, and bound chords still fire in the capture phase.
- **Palette.** The screen's colours come from core theme tokens: background `--wg-transcript-background`, foreground
  `--wg-fg`, cursor `--wg-accent`, selection `--wg-accent-tint`, font `--wg-font-mono` at `--wg-text-13`. The ANSI
  colours stay xterm's defaults. The page reads the tokens when it creates a screen and again on the theme change the
  page already hears (task 09 names the source it reads).
- **Drain.** `drain` ends every shell at once. A shell survives an app restart, not an update that changes the host
  protocol.
- **Packaging.** `vite.session-host.config.mts` marks `node-pty` external. A Forge `packageAfterCopy` hook copies
  `node_modules/node-pty` (its `package.json`, `lib/`, and the `prebuilds/` or `build/Release/` folder for the target
  platform and arch) into the build path's `node_modules/node-pty`. `packagerConfig.asar.unpack` takes
  `**/node_modules/node-pty/**`, so the `.node` file and `spawn-helper` stay real files.

### Out of scope

- A terminal anywhere but a session's drawer; several shells per session; tabs inside the drawer.
- Full-screen programs (vim, less with Esc): the shell never receives Esc.
- Shell integration escape codes, command-exit wakes, and a setting for the shell program.
- Restoring a drawer's open state or a row's "needs you" mark across an app restart.
- A custom ANSI palette.
- Linux packaging: node-pty 1.1.0 ships prebuilds for darwin and win32 only, so a Linux install builds it with
  node-gyp; no task checks a Linux package.

## File Structure

### Shared contracts (exact; every task uses these words)

`src/contracts/pty.ts` (create, task 02) — the host-side seam over node-pty:

```ts
export interface PtyOptions { cwd: string; env: Record<string, string>; cols: number; rows: number }
export interface PtyExit { exitCode: number; signal: number | null }
export interface Pty {
  readonly pid: number;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (exit: PtyExit) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export type PtySpawn = (file: string, args: readonly string[], options: PtyOptions) => Pty;
```

`src/contracts/terminals.ts` (create, task 02) — the app-side seam main plugins use:

```ts
export interface TerminalSpawn {
  id: string;                 // the app session id
  command: string;            // the resolved shell program
  args: readonly string[];
  cwd: string;
  cols: number;
  rows: number;
}
export interface TerminalExit { code: number | null; signal: number | null; error: string | null }
export interface TerminalEvents {
  data(chunk: string): void;
  closed(exit: TerminalExit): void;
}
export interface TerminalProcess {
  readonly id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  detach(): void;
}
// `running` is false while the shell is ending; an exited shell leaves the host's list at once.
export interface TerminalInfo { id: string; startedAt: number; running: boolean }
export interface TerminalAttach { process: TerminalProcess; replay: string }
// UTF-16 code units of output a shell's replay keeps; cut with `keepTail` (`src/shared/keep-tail.ts`).
export const TERMINAL_REPLAY_LIMIT = 256 * 1024;
export interface TerminalHost {
  spawn(request: TerminalSpawn, events: TerminalEvents): TerminalProcess;
  attach(id: string, events: TerminalEvents): Promise<TerminalAttach | null>;
  list(): Promise<TerminalInfo[]>;
}
```

Protocol 5 messages (`src/contracts/session-host-protocol.ts`, task 02; the client in task 03 sends and reads them):

| Message | Direction | Shape |
|---|---|---|
| `termSpawn` | app → host | `{ type, request: TerminalSpawn }`; subscribes the sending connection |
| `termWrite` | app → host | `{ type, id, data }` |
| `termResize` | app → host | `{ type, id, cols, rows }` |
| `termKill` | app → host | `{ type, id }` |
| `termAttach` | app → host, replied | reply `{ replay: string, running: boolean } \| null`, through the reply mechanism `subscribe` uses; subscribes the connection |
| `termDetach` | app → host | `{ type, id }` |
| `termList` | app → host, replied | reply `{ terminals: TerminalInfo[] }`, through the reply mechanism `list` uses |
| `termData` | host → subscribed app | `{ type, id, data }` |
| `termClosed` | host → subscribed app | `{ type, id, exit: TerminalExit }` |

`src/contracts/terminal-emulator.ts` (create, task 05) — the page seam over xterm:

```ts
import type { Disposable } from './disposable';
export interface TerminalPalette { background: string; foreground: string; cursor: string; selection: string }
export interface TerminalScreenOptions { fontFamily: string; fontSize: number; palette: TerminalPalette }
export interface TerminalSize { cols: number; rows: number }
export interface TerminalScreen extends Disposable {
  readonly element: HTMLElement;
  write(data: string): void;
  onInput(listener: (data: string) => void): Disposable;
  onResize(listener: (size: TerminalSize) => void): Disposable;
  size(): TerminalSize;
  fit(): void;
  focus(): void;
  setPalette(palette: TerminalPalette, fontFamily: string, fontSize: number): void;
  reset(): void;
}
export interface TerminalEmulator { create(options: TerminalScreenOptions): TerminalScreen }
```

Services (`src/contracts/plugin.ts`, task 06): `MainServices.terminals: TerminalHost` and
`PageServices.terminals: TerminalEmulator`.

Platform (task 06): `PlatformPrograms.shell: readonly ProgramCandidate[]`, so `ProgramName` gains `'shell'`.

Sessions page exports (`src/plugins/sessions/contract.ts`, task 07):

```ts
// `shown` runs each time the drawer becomes visible: opened in a visible frame, or its frame shown.
// `focus` runs when sessions moves focus into the drawer (Alt+j, or `open({ focus: true })`).
export interface SessionDrawerView { id: string; element: HTMLElement; shown(): void; focus(): void }
export interface SessionDrawerHandle extends Disposable {
  open(options: { focus: boolean }): void;
  close(): void;
  isOpen(): boolean;
  // When the drawer holds focus, hands the keys to the focused pane's selected tab, as Alt+k from the drawer
  // does; otherwise does nothing. The drawer stays open.
  returnFocus(): void;
}
// in SessionsPageExports: throws when the session already has a drawer, as addPopup throws on a duplicate id.
addDrawer(sessionId: string, drawer: SessionDrawerView): SessionDrawerHandle;
```

Terminal plugin (`src/plugins/terminal/contract.ts`, task 08; task 09 consumes):

```ts
export interface TerminalOpened {
  shell: string;              // this shell's id: new for each spawn or adoption by main
  buffer: string;             // main's last 256 KB of the shell's output
  seq: number;                // the seq of the last chunk in `buffer`; 0 when empty
  folder: string;             // the shell's cwd
  exit: TerminalExit | null;  // null while the shell runs
}
export interface TerminalChannel extends ChannelShape {
  invoke: {
    open(sessionId: string, cols: number, rows: number): Promise<TerminalOpened>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    restart(sessionId: string, cols: number, rows: number): Promise<TerminalOpened>;
  };
  messages: {
    data: { sessionId: string; shell: string; chunk: string; seq: number };
    exited: { sessionId: string; shell: string; exit: TerminalExit };
    typed: { sessionId: string; shell: string; text: string };
  };
}
export const terminalOutputSlot: KeyedSlotKey<string, 'main', 'terminal'>;  // id 'terminal.output'
```

Manifest (task 08): id `terminal`; commands `terminal.type` (main, arg `'string'`), `terminal.toggle` (page),
`terminal.back` (page); scope `terminal` (qualified `terminal.terminal`); `dependsOn.main` holds `chat` and
`sessions`; `dependsOn.page` holds `sessions`.

### Files by area

- **Host** (tasks 02, 04): modify `session-host-protocol.ts`, `host-server.ts`, `host-children.ts`,
  `session-host.ts`, `session-host-test-doubles.ts`, and one comment in `os-processes.ts`; create `terminal-table.ts`.
  `process-table.ts` stays untouched: shells never enter it. A kill ends a shell with `{ code: null, signal: 1 }`
  (SIGHUP), or `{ code: null, signal: 9 }` once the table escalates to SIGKILL after `HOST_END_GRACE_MS`.
- **Replay rule** (task 02): create `src/shared/keep-tail.ts`, `keepTail(text, limit)`: the last `limit` UTF-16 code
  units, less a leading low surrogate. The host table (02), the fake terminal host (06) and terminal main (08) all
  cut with it, at `TERMINAL_REPLAY_LIMIT`.
- **Client** (task 03): modify `session-host-client.ts`, `host-link.ts`.
- **Packaging** (task 04): modify `vite.session-host.config.mts`, `forge.config.mts`; create
  `src/session-host/node-pty/node-pty-spawn.ts`. It is the only file that imports `node-pty`.
- **Layer rules**: `scripts/check-layers.mts` gains the `src/renderer/xterm` entry (packages `@xterm/xterm`,
  `@xterm/addon-fit`) and `src/renderer/renderer.ts`'s layers gain `src/renderer/xterm` (task 05); it gains the
  `src/session-host/node-pty` entry (packages `node:`, `node-pty`) and `src/session-host`'s layers gain it (task 04,
  which creates the file). Each task commits its rule with the file it covers, so lint passes at every commit.
  `src/plugins/*` imports no package.
- **Emulator** (task 05): create `src/renderer/xterm/xterm-emulator.ts`. It links xterm's stylesheet through a `?url`
  import, as `renderer.ts` links layout CSS. It also creates `src/renderer/xterm/key-rule.ts` (`passesToPage`, the
  one Esc key rule) with `key-rule.test.ts`.
- **Wiring** (task 06): modify `contracts/plugin.ts`, `contracts/platform.ts`, `shared/platform.ts`, `main/main.ts`,
  `renderer/renderer.ts`, `renderer/plugins/page-api.ts`, `shared/plugin-part-harness.test-support.ts`; create
  `shared/fake-terminal-host.ts`, `shared/fake-terminal-emulator.ts`.
- **Sessions** (task 07): the drawer row, height, focus wrapper and the layout part `drawer`.
- **Terminal plugin** (tasks 08–10): `src/plugins/terminal/` with `manifest.ts`, `contract.ts`, `main/`, `page/`,
  `layouts/`; registered in `src/plugins/manifests.ts`, `main.ts`, `page.ts`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 02 → 03 → 06 → 08 → 09 → 10 → 11

### Wave 1
- [x] [Packages](01-packages.md)
- [x] [Host terminal table and protocol 5](02-host-terminal-table.md)
- [x] [Sessions drawer slot](07-sessions-drawer.md)

### Wave 2
- [x] [Client terminals](03-client-terminals.md) — after 02
- [x] [xterm adapter and layer rules](05-xterm-adapter.md) — after 01

### Wave 3
- [x] [node-pty adapter and packaging](04-node-pty-packaging.md) — after 01, 02, 05
- [x] [Services wiring](06-services-wiring.md) — after 02, 03, 05

### Wave 4
- [x] [Terminal plugin main](08-terminal-main.md) — after 06

### Wave 5
- [x] [Terminal plugin page](09-terminal-page.md) — after 06, 07, 08

### Wave 6
- [x] [Demo, self-test, skill and docs](10-demo-selftest-docs.md) — after 08, 09

### Wave 7
- [x] [Doc re-read](11-doc-re-read.md) — after 10
- [ ] [Final verification](12-final-verification.md)

## Run log

Review base: 23cbed36e5c4423e609f17f04a9b027a96ead67f

### Groups
- 01 · main agent: a check and a commit, no code · eff7c2fa · npm ls lists the three at the pinned versions; package.json diff adds only the three dependencies entries, exact · concerns: npm replaced the worktree's node_modules symlink with a full install, so the app clone's own node_modules lacks the three packages until it is installed there
- 05 · hard · 373e8453 · diff read: every Produces present (contract, createXtermEmulator, passesToPage, both layer entries); typecheck clean in its files; layers lint clean · concerns: whether a subscription or options change before xterm opens takes effect is left to the live session (task 12)
- 07 · hard · 16bd1ef9 · diff read: SessionDrawerView, SessionDrawerHandle, addDrawer and the drawer layout part present as planned; typecheck clean in its files; oxfmt applied (main agent, tooling) · concerns: no CHANGELOG line (task 10 owns it); one-pane tree move rows assume pane-tree-view returns false for down/up/left, unchecked; layout.js drawer leaves its input unused
- 02 · deep · f4995ac3 · diff read: pty.ts, terminals.ts, keepTail, terminal table and protocol 5 messages present as planned; typecheck, oxlint, oxfmt and layers clean at e560a1d0 (host-link error fixed by 03) · concerns: shellEnvOf repeats two steps of process-table's private childEnvOf; AGENTS.md src map does not name the terminal table, pty.ts or terminals.ts yet
- 03 · deep · e560a1d0 · diff read: SessionHostClient with terminals: TerminalHost, HostLinkDeps terminalPushed and terminalAttachReceived present; typecheck, oxlint, oxfmt and layers clean · concerns: the planned row create_HostNeverAnswers attached the spawned id, which would replace its subscriber, so the test attaches another id; AGENTS.md session-host tree entry says only hosted processes
- 04 · deep → deep: the plan's helper-mode stop, settled by a main-agent ruling · 16718672 · diff read: createNodePtySpawn and nodePtySpawn, external node-pty, packageAfterCopy copy, asar unpack glob and both layer entries present; typecheck, oxlint, oxfmt, layers clean; the bundle, unpacked files and codesign checks wait for the live session · concerns: Windows conout worker path rewrites only node_modules.asar (outside this run); AGENTS.md src map says src/session-host imports only contracts and shared; install-app's npm ci now runs the repo postinstall
- 06 · hard · 02eb873f · diff read: MainServices.terminals, PageServices.terminals, PlatformPrograms.shell, trackedTerminals, fake terminal host and fake emulator present; typecheck, oxlint, layers, boundary, styles clean; oxfmt applied to two files (8d tooling commit) · concerns: AGENTS.md does not name services.terminals or the two fakes yet (task 10)
- 08 · deep · 59f1e38d · diff read: TerminalOpened, TerminalChannel, terminalOutputSlot match plan.md; manifest registered in manifests.ts and main.ts; wave 4 typecheck, layers, boundary, styles clean; oxfmt commit 759901e2 · concerns: no layouts/default until 09; page commands toggle/back/restart declared before 09's page part; demo self-test fails until 10 adds a demo step; README Settings row, CHANGELOG and AGENTS.md src map wait for 10; oxlint no-useless-spread warning at shells.ts killAll (the copy guards deletion while iterating, harmless)
- 09 · deep · 8da257e4 · diff read: terminalPagePart with toggle/back/restart, readTerminalLook, default drawerHeader layout, page.ts entry after visualPagePart, the three binds after <Leader>bh, keymap.md rows; wave 5 typecheck, oxlint, layers, boundary, styles clean; oxfmt commit 5acfe63b · concerns: <C-`> is a chord in scope any with no key-hint anchor, so the self-test's placement check fails until one is placed (main-agent ruling: task 10 adds it); layouts design.md owner list lacks terminal's drawerHeader (task 10/11); typed for a session with no row reaches addDrawer unchecked; the view's shown closure reads drawer before it is set, safe only because a drawer starts closed
- 10 · standard · 5ee04d7a · diff read: demo step terminal.drawer (sessions, 200) both halves, self-test script with the four drawer steps, auri:terminal SKILL.md, README/CHANGELOG/AGENTS.md/layouts design rows, follow-up removed; wave 6 typecheck, oxfmt, oxlint, layers, styles, boundary, changelog clean · concerns: self-test step 2 needs focus on the screen after the chord opens the drawer (open focus:true, checked live); toggle key hint lives in the drawer header, present only while the drawer is open; page start.ts top comment rewrapped unevenly
- 11 · standard · d6d5fb72 · diff read: planned notes gone from both design docs, stale lines fixed against the code; grep plan-terminal finds nothing in both docs and in ai wigley-agents/AGENTS.md (ai commit 36fefed32 on terminal-type-rule-done); oxfmt clean · concerns: Alt+j/k wording follows the code's focus moves, not the plan's 'between chat and drawer'
### Contract changes
- session-host-test-doubles: — → also exports terminalRequest(id): TerminalSpawn (/bin/zsh -l, /work, 80×24); fakePty().exit fires once, as node-pty's onExit does · why: tests and stopHost exiting every pty · consumers: none · group 02
- TerminalScreen and the other emulator contracts: one-line interfaces → one member per line · why: oxfmt printWidth 80; members word for word · consumers: 06, 09 · group 05
### Rulings
- onInput and onResize return xterm's IDisposable directly — it already has Disposable's shape — a wrapper would be needed if the contract grows · group 05
- row-order test checks which of the four row classes each frame child holds, not its first class, since sheet() puts ui-sheet first — group 07 · group 07
- spawn refusal order: draining, held id, shape, then a PtySpawn that throws; a termSpawn with no request throws into host-server's per-message catch — group 02 · group 02
- a throw from Pty.kill goes to diagnostics and still arms the SIGKILL, so one bad pty does not stop endAll or stopAll — group 02 · group 02
- the test defines its own terminalRequest, since importing the host's test doubles breaks the src/main/session-host layer rule — group 03 · group 03
- node-pty 1.1.0's published darwin spawn-helper files lack the execute bit, so the forge hook chmods the copied helper to 0o755 before signing, and a repo postinstall script (scripts/node-pty-helper-mode.mts, added to package.json) sets it in node_modules after every install; the main agent set it once in this run's node_modules — why: the plan's First step stop; makes the mode impossible to forget for the package and for npm start — cost if wrong: one more script on every install · main agent
- copy and chmod share scripts/node-pty-files.mts, split from the postinstall runner so forge's import runs no loop — group 04 · group 04
- fake host attach swaps in the new events and reads the replay inside the call, firing no event in it — group 06 · group 06
- spawn reply is the entry at spawn (buffer '', seq 0), so 09's page keeps data that arrives while open is pending · group 08
- after detachAll/killAll every waiting or later open, restart, type rejects 'the shell start for <id> was cancelled' · group 08
- a shell attached after stop is detached (restart/quit) or killed (end), not adopted · group 08
- type on a closed shell skips the write and still sends typed · group 08
- layouts.show built as show<Layout>, since readTerminalLayout returns the optional-part Layout, as agent-skills does · group 09
- page test runs on startDrawingPagePart so headers draw through the real default layout.js · group 09
- a rejected write or resize logs '<write|resize> failed in <label>: <error>', outside the pinned log list · group 09
- main agent: task 10 places the Ctrl+backtick key-hint anchor (a kit.keyHint for terminal.toggle in the default drawer header, or wherever AGENTS.md § Key hints puts a chord with no other home) · group 09
- toggle key-hint anchor: kit.keyHint(element, 'toggle', { label: 'close' }) at the end of the default drawerHeader (main-agent ruling carried out) · group 10
### Review rounds
- Review 1 (pinned 3eddc580): NEEDS FIXES — 0 Critical, 5 Important, 18 Minor, 1 pre-existing. Lead-applied 25c628c0 (prose, None). Fix cycle 1: 3a7f0126..d3e9bb5b — risk Medium (focus timing in the xterm adapter and the adoption stop path in terminal main are lifecycle changes; the rest is tests and a spawn guard) → correctness re-review.
- Re-review 1 (25c628c0..d3e9bb5b): NEEDS FIXES — 1 Important repeat (row closed during an adoption attach leaves its terminal.output key; stacked on R1#3), 3 Minor. Lead-applied 60356964 (design doc refusal line, no-control-regex comment; None). Repeat goes to the user; R1#18 duplicate already in triage.
- Triage (headless, recommendations taken): Fix now R1#2 reconnect on first use, #18 type rejects after typed, #10 shared env helper, #19 fake to shared/page, #14 node-pty-files test, #16 one test-name form, #24 refuse spawns while stopAll waits, plus re-review 1's repeat (output key on kill branches); Follow-up #15 Windows conout path. Fix cycle 2: 30cbc7f6..1fbdd5e8 (+ ba859f89 formatter, lead-applied) — risk Medium (new reattach path through the shared start, spawn refusal during stopAll) → correctness re-review 2.
- Re-review 2 (60356964..1fbdd5e8): NEEDS FIXES — 1 Important repeat (unreached host shells never killed by kill/killAll; stacked on R1#2), 4 Minor (repeat: output key left on a cancelled reattach; repeat: stopAll refusal per table only, stacked on R1#24; fake emulator snapshots dropped; design.md reattach line). Lead-applied the design.md line. Max cycles reached: remaining findings to the last fix pass (headless, recommendations taken): one settle-an-unreached-id routine for start/kill/killAll; output delete on cancelled reattach; host-level stopping flag across both tables until both report done; restore listener snapshots. Follow-up: R1#15 Windows conout path → followups.md.
- Last fix pass (8.1): 95b2c25c, 856b042d (+ ba859f89-style lead-applied spreads/formatter) — risk Medium (unreached-id routine for start/kill/killAll; host-level stopping state); no re-review per 8.1, covered by the test gate and the live session.
### Test gate
- Medium — new host terminal table, protocol 5, terminal main adoption/reattach and stopping state, page drawer; no High surface (no data migration) · picked 39 files: every test the range changed plus each changed source's own test (list in scratchpad test-picks.txt), typecheck incl. test-d · skipped: the full suite (Medium tier) · known: none · 2 failed, 1141 passed: fake-terminal-host kill test (an awaited list lets the queued close run; caused by this run at 02eb873f, failed at the pinned head too) and adopt_AttachResolvesAfterStop end row (asserts an output delete the stopped part's store drops; name printed undefined) → test-only fix through a subagent.
- Re-run after test-only fix 84be9e1e (Low: tests only) · picked the two failed files plus the terminal page test (shares the fakes) · 109 passed, 0 failed; typecheck and formatter clean.
