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
- [ ] [Packages](01-packages.md)
- [ ] [Host terminal table and protocol 5](02-host-terminal-table.md)
- [ ] [Sessions drawer slot](07-sessions-drawer.md)

### Wave 2
- [ ] [Client terminals](03-client-terminals.md) — after 02
- [ ] [xterm adapter and layer rules](05-xterm-adapter.md) — after 01

### Wave 3
- [ ] [node-pty adapter and packaging](04-node-pty-packaging.md) — after 01, 02, 05
- [ ] [Services wiring](06-services-wiring.md) — after 02, 03, 05

### Wave 4
- [ ] [Terminal plugin main](08-terminal-main.md) — after 06

### Wave 5
- [ ] [Terminal plugin page](09-terminal-page.md) — after 06, 07, 08

### Wave 6
- [ ] [Demo, self-test, skill and docs](10-demo-selftest-docs.md) — after 08, 09

### Wave 7
- [ ] [Doc re-read](11-doc-re-read.md) — after 10
- [ ] [Final verification](12-final-verification.md)

## Run log

Review base: 23cbed36e5c4423e609f17f04a9b027a96ead67f

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
