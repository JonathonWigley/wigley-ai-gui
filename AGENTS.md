# wigley-ai-gui

**Contents**

- **Architecture** — build every change for extensibility with `wigley:codebase-design`; the layers, the forms relay, and
  where a new key, setting, theme, round source, feature or third-party tool goes, and the layer check.
- **Running and testing** — Node version, the self-test the agent may run any time, and the visible run that is the user's.
- **Dev quirks** — the startup reload and the unwired ACP adapter and mock agent.

An Electron app (Forge 8, Vite, TypeScript) growing into a vim-first GUI over the wigley harness: CodeMirror 6 with
vim, app-owned Cmd keys and a global summon shortcut. Its one live job: it is the only client of the `wigley-forms`
tools, receiving agents' review rounds and showing them in its forms view for the user to answer. An ACP client, built
but not yet wired, is for driving an agent process over stdio.

## Architecture

The user builds on this app indefinitely and expects to swap any third-party tool, change how a feature works, or add
one, as a local edit. So every change is designed with `wigley:codebase-design`, loaded before writing code: deep
modules behind small interfaces in `src/contracts/`, each third-party library behind one adapter, and wiring only in a
composition root.

```
src/contracts/   interfaces and records crossing a seam; imports nothing
src/config/      default keymap and settings, and the built-in themes, as data  → read only by main
src/shared/      implementation both processes use (CommandRegistry, the theme-variable names)
src/main/        main process; main.ts is its composition root
  forms/         round logic behind FormsService: validation, re-send, deadline, saved rounds
  mcp/           MCP adapter feeding FormsService           → the only @modelcontextprotocol import
  relay/         the local channel the marketplace's relay.py connects to
  themes/        theme loader: parses and chooses the built-in or user theme
  alerts/        native notification, Dock bounce or taskbar flash, and the badge, behind Alerts
  window-presenter.ts  RoundPresenter over IPC: opens each round in the window
  acp/           ACP adapter behind AgentClient             → the only client-side @agentclientprotocol/sdk import
src/preload/     the Bridge, exposed as window.wigley
src/renderer/    renderer features; renderer.ts is its composition root
  forms/         the forms view; form-state.ts holds the answers as a pure module
  markdown-it/   markdown adapter                           → the only markdown-it import
  codemirror-vim/ editor adapter behind EditorHost          → the only codemirror / @replit import
src/mock-agent/  a separate executable the ACP adapter spawns in dev
```

Each Claude Code or Codex session runs the marketplace's `relay.py` (`plugins/wigley/scripts/forms/` in
wigley-ai-marketplace, whose README states the tool contract, the saved-round file format
the `retro` skill reads, and the relay's side of the channel). A change to either contract
lands in both repos together.

- **A key** is a line in `src/config/keymap.ts` naming a command id. Keys never call code directly: a feature
  registers the command, and the keymap binds keys to it, so rebinding never touches a feature and a feature never
  knows its keys. A page key also names the view scope it fires in. Each process checks at startup that every
  command its keymap names is registered, and that no key is bound twice in one scope.
- **A theme** is a JSON file of a `palette` and semantic `tokens` (a token names a palette entry or gives a hex).
  Built-in themes live in `src/config/themes/`; the user's own live in the `themes` folder of Electron's per-user
  data folder and override a built-in of the same name. Views read tokens as CSS variables and never name a
  colour. A broken theme falls back to Catppuccin Mocha and shows its error.
- **A round source** — MCP today, the wigley harness next — is an adapter that calls `FormsService`; it never
  reaches the round store, the deadline or the window directly.
- **An ambient service** — the clock, ids, the home folder — is passed in from the composition root.
- **A setting** goes in `src/contracts/settings.ts` (its type) and `src/config/settings.ts` (its default). Main owns
  the config and serves it to the renderer over the Bridge, so a user config file later lands in `main.ts` alone.
- **A feature** is a module that registers commands and receives what it uses as parameters; the composition root
  wires it.
- **A third-party tool** gets a contract in `src/contracts/` and an adapter folder of its own. Swapping it is a new
  adapter folder against the same contract, and one changed line in the composition root.
- `npm run lint` runs `scripts/check-layers.mts`, which fails on an import crossing a boundary its `LAYERS` table does
  not allow. A new layer or adapter folder gets a `LAYERS` entry, and the composition root's entry lists it.

## Running and testing

- Node is pinned in `.nvmrc`. A shell that started on another version runs commands as
  `source ~/.nvm/nvm.sh && nvm use && npm run …`.
- `npm test` runs the Vitest suite: every module whose correctness follows from inputs and outputs — round
  logic, saved rounds, answer state, markdown, theme loading, the keymap — is tested there, without Electron.
- `npm run selftest` is the agent's loop, and the user allows the agent to run it any time. It renders the window
  offscreen as an accessory app, so it never takes the user's foreground; it opens a fixture round through
  `FormsService`, drives keys with `sendInputEvent`, checks the lines each step adds to the page's log and the answers
  the round returns, and exits non-zero on a failure. A key behaviour the agent adds or fixes gets a step in `STEPS`
  (`src/main/selftest.ts`).
- A visible `npm start` takes the user's foreground and keyboard, so that run is the user's: the agent gives the user
  the steps to try. The global shortcut needs it — macOS keys reach a global shortcut only from the real keyboard.

## Dev quirks

- Under `electron-forge start` the page loads twice at startup, the second load triggered by the dev server. Code
  that acts on page load runs on every load, as the self-test does.
- Nothing in the app calls the ACP adapter or the mock agent; both still build for the harness work.
