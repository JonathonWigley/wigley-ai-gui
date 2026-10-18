# wigley-ai-gui

**Contents**

- **Running and testing** — Node version, the self-test the agent may run any time, and the visible run that is the user's.
- **Vim engine** — how `@replit/codemirror-vim` matches binds, and what that asks of a vimrc and an ex command.
- **Dev quirks** — the startup reload and the dev-only mock agent.

An Electron proof app (Forge 8, Vite, TypeScript) for a vim-first GUI over the wigley harness: CodeMirror 6 with vim,
app-owned Cmd keys, a global summon shortcut, and an ACP client driving an agent process over stdio.

## Running and testing

- Node is pinned in `.nvmrc`. A shell that started on another version runs commands as
  `source ~/.nvm/nvm.sh && nvm use && npm run …`.
- `npm run selftest` is the agent's loop, and the user allows the agent to run it any time. It renders the window
  offscreen as an accessory app, so it never takes the user's foreground; it drives keys with `sendInputEvent`, checks
  the page's log lines, and exits non-zero on a failure. A key behaviour the agent adds or fixes gets a step in
  `STEPS` (`src/selftest.ts`).
- A visible `npm start` takes the user's foreground and keyboard, so that run is the user's: the agent gives the user
  the steps to try. The global shortcut needs it — macOS keys reach a global shortcut only from the real keyboard.

## Vim engine

- The engine runs a complete bind at once instead of waiting for a longer one, so a bind whose first key is already
  bound never fires. A leader key is unmapped before the binds that use it (`unmap <Space>`).
- A bind to an ex command ends in `<CR>`; without it the keys only type the command into the `:` prompt.
- An ex command finds its editor from the `cm` vim passes it. `EditorView.hasFocus` reads false whenever the window
  lacks OS focus — offscreen, or behind another app.

## Dev quirks

- Under `electron-forge start` the page loads twice at startup, the second load triggered by the dev server. Code
  that acts on page load runs on every load, as the self-test does.
- The mock agent runs on Electron's own Node through `ELECTRON_RUN_AS_NODE`. The packaged app's `RunAsNode` fuse is
  off, so the ACP round trip works only in dev until the real harness executable replaces the mock.
