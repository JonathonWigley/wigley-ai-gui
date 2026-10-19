# wigley-ai-gui

**Contents**

- **Architecture** — build every change for extensibility with `wigley:codebase-design`; the core and its plugins, the
  layers, the forms relay, and where a new plugin, key, setting, theme, round source or third-party tool goes, and
  the layer check.
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

The app is a **core** and its **plugins**, as in Neovim or VS Code. The core supplies the shell's areas, the
command and key engine, settings, themes, the Bridge and services; every feature is a plugin, built-ins included, and
reaches the app only through the plugin API, so a new tool has the same reach as anything already built.

```
src/contracts/   interfaces and records crossing a seam, the plugin API among them; imports nothing
src/config/      core keymap (leader, remaps, app chords) and settings, and the built-in themes  → read only by main
src/shared/      implementation both processes use (CommandRegistry, the plugin host, manifest merging, theme variables)
src/main/        core main process; main.ts is its composition root
  plugins/       the main-side plugin API: per-plugin channel routing and services
  themes/        theme loader: parses and chooses the built-in or user theme
  alerts/        native notification, Dock bounce or taskbar flash, and the badge, behind Alerts
  acp/           ACP adapter behind AgentClient             → the only client-side @agentclientprotocol/sdk import
src/preload/     the Bridge, exposed as window.wigley
src/renderer/    core page; renderer.ts is its composition root
  shell/         the window's areas: activity bar, side bar, main, panel, status bar, overlay layer
  plugins/       the page-side plugin API
  markdown-it/   markdown adapter                           → the only markdown-it import
  codemirror-vim/ editor adapter behind EditorHost          → the only codemirror / @replit import
src/plugins/     every plugin, one folder each; main.ts and page.ts list the built-in parts each root starts
  forms/         manifest.ts, contract.ts, main/ (round logic, saved rounds, MCP adapter, relay), page/ (the view)
src/mock-agent/  a separate executable the ACP adapter spawns in dev
```

Each Claude Code or Codex session runs the marketplace's `relay.py` (`plugins/wigley/scripts/forms/` in
wigley-ai-marketplace, whose README states the tool contract, the saved-round file format
the `retro` skill reads, and the relay's side of the channel). A change to either contract
lands in both repos together.

- **A plugin** is a folder in `src/plugins/<id>/`: `manifest.ts` declares its commands (each with a label, a group
  and the process it runs in), key scopes, default keys, settings and the plugins it depends on; `main/` and
  `page/` each export a part, the manifest with a start function that receives that process's plugin API and
  returns the handlers for the manifest's commands that run in that process, plus the `exports` its dependents read
  (and, in main, a `dispose`). The compiler checks every command that runs in a process has a handler there and
  every key names a declared command. A built-in plugin joins the lists in `src/plugins/main.ts` and
  `src/plugins/page.ts`. A main part starts once; a page part starts on every page load.
- **A plugin talks** to its other process over its own channel (`api.channel`), typed by its `contract.ts`, and to
  another plugin through the exported API of a plugin its manifest depends on. A plugin imports only
  `src/contracts`, `src/shared` and its own folder.
- **A key** is a default bind in its plugin's manifest naming that plugin's command; the core qualifies both, so
  `nextItem` in plugin `forms` runs as `forms.nextItem`, and its scope `review` is `forms.review`. Keys never call
  code directly, so rebinding never touches a handler. `src/config/keymap.ts` holds only the core's keys and is where
  the user's overrides land. Each process checks at startup that every key it owns names a registered command, and
  the page also rejects a key bound twice in one scope.
- **A theme** is a JSON file of a `palette` and semantic `tokens` (a token names a palette entry or gives a hex).
  Built-in themes live in `src/config/themes/`; the user's own live in the `themes` folder of Electron's per-user
  data folder and override a built-in of the same name. Views read tokens as CSS variables and never name a
  colour. A broken theme falls back to Catppuccin Mocha and shows its error.
- **A round source** — MCP today, the wigley harness next — is an adapter that calls `FormsService`; it never
  reaches the round store, the deadline or the window directly.
- **An ambient service** — the clock, ids, the home folder — reaches a plugin through `api.services`, filled in by
  the composition root.
- **A setting** is a core setting in `src/contracts/settings.ts` and `src/config/settings.ts`, or a plugin's own in
  its manifest's `settings`. Main owns the config and serves it to the page over the Bridge, so a user config file
  later lands in `main.ts` alone.
- **A third-party tool** gets a contract in `src/contracts/` and an adapter folder of its own; the core hands
  plugins the shared ones (editor, markdown) as services. Swapping it is a new adapter folder against the same
  contract, and one changed line in the composition root.
- `npm run lint` runs `scripts/check-layers.mts`, which fails on an import crossing a boundary its `LAYERS` table does
  not allow. A new layer, adapter or plugin folder gets a `LAYERS` entry, and the composition root's entry lists it.

## Running and testing

- Node is pinned in `.nvmrc`. A shell that started on another version runs commands as
  `source ~/.nvm/nvm.sh && nvm use && npm run …`.
- `npm test` runs the Vitest suite: every module whose correctness follows from inputs and outputs — round
  logic, saved rounds, answer state, markdown, theme loading, the keymap — is tested there, without Electron.
- `npm run selftest` is the agent's loop, and the user allows the agent to run it any time. It renders the window
  offscreen as an accessory app, so it never takes the user's foreground; the core's driver (`src/main/selftest.ts`) runs
  the script a plugin hands it — the forms plugin's opens a fixture round through `FormsService` — drives keys with
  `sendInputEvent`, checks the lines each step adds to the page's log and the result the script checks, and exits
  non-zero on a failure. A key behaviour the agent adds or fixes gets a step in its plugin's self-test script
  (`src/plugins/forms/main/selftest-script.ts` for forms).
- A visible `npm start` takes the user's foreground and keyboard, so that run is the user's: the agent gives the user
  the steps to try. The global shortcut needs it — macOS keys reach a global shortcut only from the real keyboard.

## Dev quirks

- Under `electron-forge start` the page loads twice at startup, the second load triggered by the dev server. Code
  that acts on page load runs on every load, as the self-test does.
- Nothing in the app calls the ACP adapter or the mock agent; both still build for the harness work.
