# wigley-ai-gui

**Contents**

- **Architecture** — build every change for extensibility with `wigley:codebase-design`; the layers, where a new
  key, setting, feature or third-party tool goes, and the layer check.
- **Running and testing** — Node version, the self-test the agent may run any time, and the visible run that is the user's.
- **Dev quirks** — the startup reload and the dev-only mock agent.

An Electron app (Forge 8, Vite, TypeScript) growing into a vim-first GUI over the wigley harness: CodeMirror 6 with
vim, app-owned Cmd keys, a global summon shortcut, and an ACP client driving an agent process over stdio.

## Architecture

The user builds on this app indefinitely and expects to swap any third-party tool, change how a feature works, or add
one, as a local edit. So every change is designed with `wigley:codebase-design`, loaded before writing code: deep
modules behind small interfaces in `src/contracts/`, each third-party library behind one adapter, and wiring only in a
composition root.

```
src/contracts/   interfaces and records crossing a seam; imports nothing
src/config/      default keymap and settings, as data      → read only by main.ts
src/shared/      implementation both processes use (CommandRegistry)
src/main/        main process; main.ts is its composition root
  acp/           ACP adapter behind AgentClient            → the only client-side @agentclientprotocol/sdk import
src/preload/     the Bridge, exposed as window.wigley
src/renderer/    renderer features; renderer.ts is its composition root
  codemirror-vim/ editor adapter behind EditorHost         → the only codemirror / @replit import
src/mock-agent/  a separate executable the ACP adapter spawns in dev
```

- **A key** is a line in `src/config/keymap.ts` naming a command id. Keys never call code directly: a feature
  registers the command, and the keymap binds keys to it, so rebinding never touches a feature and a feature never
  knows its keys. Each process checks at startup that every command its keymap names is registered.
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
- `npm run selftest` is the agent's loop, and the user allows the agent to run it any time. It renders the window
  offscreen as an accessory app, so it never takes the user's foreground; it drives keys with `sendInputEvent`, checks
  the lines each step adds to the page's log, and exits non-zero on a failure. A key behaviour the agent adds or fixes
  gets a step in `STEPS` (`src/main/selftest.ts`).
- A visible `npm start` takes the user's foreground and keyboard, so that run is the user's: the agent gives the user
  the steps to try. The global shortcut needs it — macOS keys reach a global shortcut only from the real keyboard.

## Dev quirks

- Under `electron-forge start` the page loads twice at startup, the second load triggered by the dev server. Code
  that acts on page load runs on every load, as the self-test does.
- The mock agent runs on Electron's own Node through `ELECTRON_RUN_AS_NODE`. The packaged app's `RunAsNode` fuse is
  off, so the ACP round trip works only in dev until the real harness executable replaces the mock.
