# Plugin framework — settled design

**Contents**

- **Plans** — the three plans and what each lands.
- **Core and plugins** — what the core owns, what a plugin is, and how plugins talk.
- **Shell and areas** — the permanent areas and who fills them.
- **Sessions (plan A2)** — tabs as agent sessions, the relay, tab lifecycle.
- **Keymap (plan A2)** — the user's new keys, from the keymap rounds.
- **Keys plugin (plan B)** — the `keys` plugin, all page but a main part that registers its layouts: which-key, help on `Space ?`, the scope stack, titled scopes, the key hints that replaced the bar.
- **Foundation sweeps (Wave 1)** — stopping a plugin, who undoes each registration, typed dependency keys, scoped logs, tool contributions in live sessions, derived layer rules.

The decisions the user settled in the 2026-10-18 interview rounds, kept so plans A2 and B are written from them once
the plan before has landed. Each plan reads this file and the code as it then stands; a decision here stands unless
the user changes it.

## Plans

- **A1 — core**: plugin contracts and host, manifests, shell areas, per-plugin Bridge channel, page and main plugin
  APIs, and the forms feature moved into `src/plugins/forms/` with its behaviour and keys unchanged. Plan folder
  `plan-a1-core/`.
- **A2 — sessions**: the `sessions` plugin, session tabs, the event bus, plugin dependencies used for real, and the
  keymap changes.
- **B — keys**: the `keys` plugin: which-key, help on `<leader>?`, the slimmer bottom bar (replaced later by key hints in place, `docs/features/key-hints/design.md`).

Each lands green on its own, the self-test passing, and is reviewed on its own.

## Core and plugins

- Nothing in the app is anything other than a plugin: the core provides events, UI areas and tooling, and every
  feature is built on the same plugin API, so every plugin has the same reach as the app itself (user's words).
- Plugins are built-in folders under `src/plugins/<id>/`, compiled in, through the API a runtime loader from a user
  folder would use later. No runtime loader yet.
- A plugin may have a main part and a page part, each started with its own process's API.
- A typed manifest declares commands (label, group, process), scopes, settings and dependencies, and, for a
  plugin from outside the repo, its own default keys (the built-ins' sit in `src/plugins/keymap.ts`); each
  part's start function returns the handlers. A missing handler is a type error.
- Plugins never import a third-party library's adapter: the core hands them services (editor, markdown,
  notifications, log, clock, home folder). Built-in main parts use Node directly.
- A plugin's two parts talk over one generic per-plugin Bridge channel (invoke and listen, by plugin id), typed in
  the plugin's `contract.ts`.
- A manifest names the plugins it depends on; they start first, and a plugin's start function may return an
  exported API its dependents receive, typed from the dependency's `contract.ts`.
- Plugins may publish their own events for other plugins to listen to. One event bus per process; the core forwards
  the core events both sides need; a plugin's cross-process messages use its own channel. The bus lands in A2,
  where sessions publish the first events.
- Every built-in plugin starts at launch unless the core setting `plugins.disabled` names it; the list arrived with
  the chat bar's optional views (`docs/features/chat-bar/design.md` § Optional plugins).
- Key scopes are plugin-declared and qualified (`forms.review`); plugin settings live in the manifest under the
  plugin's id (which-key's delay is a setting, 200 ms default); fonts and theme stay core settings.
- Core: plugin host, shell and areas, commands, key engine (sequences, chords, leader), settings, themes, the
  Bridge's plugin channel, services (editor, markdown, notifications and Dock badge, log, clock). The unwired ACP
  adapter and mock agent wait for a harness plugin. The self-test is a core driver running a plugin's script.

## Shell and areas

- The shell owns the layout: activity bar, side bar, main area, bottom panel, status bar, overlay layer, each hidden
  while nothing fills it (VS Code's areas).
- The app is heading to be a chat frontend for the wigley harness, so the whole forms view, its question rail
  included, fits inside the main area.

## Sessions (plan A2)

- Tabs are an agent-session structure, not part of forms: each agent session is a tab whose window shows the chat
  until the agent triggers a form; the session's tab then shows the form instead, so a form is self-contained in
  its session (user's words).
- A `sessions` plugin owns the session list, the tab strip in the main area, and a session-view place other plugins
  fill: forms fills it while a round is open, chat later.
- The sessions plugin owns the relay: each relay connection is a session, and plugins contribute MCP tools to it
  (forms contributes `ask_round` and `collect_last_round`; the primer's tools are the named second set). The tool
  list `relay.py` answers when the app is closed lives in wigley-ai-marketplace; A2 leaves that repo alone.
- A session gets a tab when it first sends a round; the tab stays, showing the session idle between rounds, until
  the session disconnects or the user closes it.
- A tab is labelled by its project folder, numbered when two sessions share one (`wigley-ai-gui 2`); while a round is open the tab reads `<label> · <round heading> <answered>/<total>`.
- Cmd+W, `Space ;` and `<Leader>;` (in a box) close the session tab, opening the cancel-round confirmation first when a round is open.

## Keymap (plan A2)

Compared against the user's Neovim, tmux/Ghostty and IdeaVim configs:

- Option+o / Option+i switch session tabs (next / previous); `gt` / `gT` are not bound. Option chords match the physical key
  (Electron's `Input.code`, present in Electron 44.9.0), since macOS turns Option+o into `ø`.
- Ctrl+h / Ctrl+l move to the previous / next question, on the page and inside a box (inside a box this takes
  Ctrl+h from backspace); `<Leader>n` / `<Leader>p` go.
- Ctrl+n / Ctrl+p move to the next / previous box, on the page and inside a box; `<Leader>j` / `<Leader>k` go
  (Ctrl+j / Ctrl+k until the forms scroll keys moved them, `docs/keymap.md`).
- There is no jump to question N; a bare digit on the page still picks a choice (changed by ui-design plan C).
- `<A-n>` / `<A-p>` jump to the next / previous unanswered question, on the page and inside a box (changed by
  ui-design plan C).
- `<leader>a<digit>` picks a choice and `<leader>ac` clears it inside a box; on the page raw digits pick and raw `c`
  `f` `u` `s` clear and act (changed by ui-design plan C). `<Leader>1`–`9` and
  `<Leader>c` inside a box go (A2 interview). Plan folder `plan-a2-sessions/` holds the rest of A2's settled design.
- `<C-j>` / `<C-k>` scroll the form and its review a line and `<C-S-j>` / `<C-S-k>` half a page, as in docs, chat
  and the gallery.
- Folding goes: the fold keys (`za`, `zM`, `zR`) and the collapsible context and "Why recommended" sections are
  removed; both are always shown.

## Keys plugin (plan B)

Landed as one page-only `keys` plugin (depends on no plugin) holding which-key and the help overlay; it has since gained a
main part that only registers its layouts (`src/plugins/keys/main/start.ts`). Key
hints in place later replaced the plugin's bottom key list: the plugin now also exports `anchor`, which draws a command's
keys into an element a view names, and the plugin's `showHints` setting (`"keys": { "showHints": false }` in
`settings.json`) turns the hints off. The title bar's Keys button, which opens help, is the plugin's too
(`docs/features/key-hints/design.md`).

- Which-key opens `whichKeyDelayMs` (200 ms) after a prefix key (the leader), as a panel docked full width just above
  the status bar, listing what can follow in columns; it redraws at once on a deeper prefix and closes when the
  sequence ends or on Esc. `whichKeyTimeoutMs` (default `null`,
  wait for the next key or Esc) ends a sequence the panel has shown that long. Commands draw in the theme's green and
  prefixes in its mauve, from theme tokens (the user's IdeaVim which-key colours).
- It also opens inside a box in vim normal mode: `@replit/codemirror-vim` 6.4.0 keeps the typed keys in
  `getCM(view).state.vim.inputState.keyBuffer` and fires `vim-keypress` per key and `vim-command-done` when the
  pending input clears; the editor adapter reports them through `EditorHost.onPendingKeys` and `cancelPendingKeys`,
  and a test fails if an upgrade drops that state. The remaining keys come from the app's own keymap, not vim's.
  A count-prefixed sequence (`3 Space`) gets no panel.
- `Space ?` (`<Leader>?` in a box) opens the full help overlay; bare `?` is freed. Help lays the `help` scope
  (`keys.help`, Esc closes) over the page's scope with `api.keys.pushScope`, and closes itself when the scope under it
  changes (the `PushedScope`'s `onBaseChanged`), so a prompt such as Cmd+W's cancel shows at once.
- Key scope is a stack in the page core: `setScope` sets a plugin's base scope, `pushScope` lays a scope over it until
  the handle's `pop`, so a modal view never fights the plugin under it. Each scope in a manifest carries a title, which
  help shows over its keys. Esc while a sequence waits cancels it and runs nothing.
- A key sequence never outlives the place it was typed: focus entering a box or the window losing focus drops a
  pending page sequence, and a box losing focus discards vim's unfinished command (keys, count, operator, register) by
  sending it `<Nop>`, which vim matches to nothing, rather than Esc, which would run the box's mapped Esc. The
  offscreen self-test fires no DOM focus or blur events, so those two paths are proved only in a visible run.
- The bottom bar split first: forms and the primer kept the mode and save state (the shared `.ui-status-line`; round
  progress stayed on the session tab) and the keys plugin's own row listed the keys that don't start with the
  leader. Key hints in place removed the key list and the mode item; the save state moved to each form's rail header.

## Foundation sweeps (Wave 1)

Settled in the 2026-11-03 interview for Wave 1 of `docs/features/intent-alignment/master-plan.md`. Plan folder
`plan-foundation-sweeps/`.

- **One owner for each registration.** The plugin API records every registration it hands out, and the host
  disposes them when the plugin stops. A plugin's own `dispose` covers only what the API cannot see. Making each
  plugin collect its own handles was rejected: the maps found dozens of handles dropped, and any new plugin could drop
  another.
- **Per-dependent exports.** A provider's `exports(consumer)` files each registration a dependent makes under that
  dependent, so the host undoes `keys.anchor`, `sessions.addRowPart` and the rest when the dependent stops. Before
  this, most callers threw those handles away.
- **Per-plugin service views.** Timers, file watches, running processes, editors and alert counts are held per
  plugin, so a stop clears them with no plugin code. `ProcessRunner.run` takes an abort signal for this.
- **Late registrations.** A registration made after its plugin stopped (a `then` that resolves late) is disposed at
  once rather than leaked.
- **Stop now, reload later.** `stop(id)` lands in Wave 1, and quit uses it for main parts in reverse start order,
  so disposal has a real caller before Wave 4's reload. Reload and the live enable switch stay in Wave 4. A stop at
  quit leaves what must outlast it: chat's stop detaches the processes the session host keeps
  (`docs/features/session-host/design.md`), and main sends the page no plugin message from the first quit task on, so
  rows those stops end stay in the page's saved panes and recency.
- **Typed keys per process.** `dependsOn` splits into `main` and `page` lists, so an edge only the page uses (workflow
  on docs) no longer orders or blocks the main part. A list still names a plugin whose events the process only
  hears, since start order is how a listener exists before the first emit.
- **Scoped logs on both sides.** Most hand-typed log sources were on main, so both processes get the scoped log.
  Sessions' relay lines log as `[sessions]`. A `child` sub-source was rejected, since only sessions had one.
- **Tool lists change live.** A contribution and its disposal reach every live session with
  `notifications/tools/list_changed`, which Claude Code honours (code.claude.com/docs/en/mcp, Dynamic tool updates).
  The relay in wigley-ai-marketplace advertises `listChanged` when it answers `initialize` for an absent app, since its
  replayed handshake drops the app's own answer.
