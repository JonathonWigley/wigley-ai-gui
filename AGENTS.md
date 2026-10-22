# wigley-ai-gui

**Contents**

- **Intent** — what every change is judged by: everything a plugin, everything hot reloads, macOS and Windows now,
  any agent harness or model later.
- **Architecture** — build every change for extensibility with `wigley:codebase-design`; the core and its plugins, the
  layers, the relay and agent sessions, and where a new plugin, shell area, mode, session tab, key, event, setting,
  user config file, theme, plugin data, layout, agent harness, session control, round source, MCP tool or
  third-party tool goes, and the layer check.
- **Running and testing** — Node version, the self-test and the drive run the agent may start any time, and the
  checks only a real keyboard proves.
- **Dev quirks** — the startup reload, a session's stale forms schema, and the login-shell PATH.

UI work — a view, its CSS, a theme, a primitive, a layout or a key — reads `DESIGN.md` first: it is the standard
every view follows, and it says where a new value or primitive goes. A new or moved key also reads `docs/keymap.md`,
the rule for which key an action takes.

An Electron app (Forge 8, Vite, TypeScript) growing into a vim-first GUI over the wigley harness: CodeMirror 6 with
vim, app-owned Cmd keys and a global summon shortcut. Its live jobs: it is the only client of the `wigley-forms`
tools, receiving agents' review rounds and showing each in its agent session's Form tab for the user to answer; and it
browses and edits every agent doc on the machine through the docs index (`docs_index.py`, `plugins/wigley/scripts/docs-index/`
in wigley-ai-marketplace, whose README states the index schema). It also starts Claude Code sessions itself and
chats with them in each session's Chat tab, a round from that session swapping in over the chat and back
(`docs/features/agent-chat/design.md`).

## Intent

The user builds on this app indefinitely, as a base to grow in any direction, and expects to swap any third-party
tool, change how a feature works, or add one, as a local edit. Every change is judged by how well it serves these
goals; a change that closes one off is redesigned, and an existing gap found while working is raised with the user:

- **Everything is a plugin, and everything is hookable.** The core supplies the shell, events, commands and keys,
  settings, themes and services, and nothing else. Every layout, view, event and behaviour, the core's own included,
  is something a plugin can hook into, extend or replace, and a built-in plugin has no more reach than one loaded
  from a user folder would. A closed list, switch or union that a new plugin would have to edit is an extension
  point waiting to become a registration.
- **Everything hot reloads.** A changed plugin, layout, theme, keymap or setting applies to the running app without
  a restart and without losing the user's work. So every registration a plugin makes can be undone, and state that
  must outlive a reload is kept where the reload does not reach it. Today settings, keymap, themes, and forms and
  chat layouts hot reload and plugins are compiled in with no runtime loader; new code is written so the rest can land
  without reworking it.
- **macOS and Windows, both working now.** A platform-specific need — key binds and their labels, paths, spawning
  processes, file watching, notifications, the relay's transport — is an adapter behind a contract, picked in the
  composition root, so adding one is a new adapter and features carry no `process.platform` checks.
- **Any agent harness and model, eventually.** Claude Code is the first adapter behind `AgentHarness`; Codex,
  wigley-harness and other models follow. Only the seams are built now, and no knowledge of one harness — its CLI,
  events, session controls, environment variables, model names — lives outside its adapter, so a new harness or
  model is a new adapter folder.

## Architecture

Every change is designed with `wigley:codebase-design`, loaded before writing code: deep
modules behind small interfaces in `src/contracts/`, each third-party library behind one adapter, and wiring only in a
composition root.

The app is a **core** and its **plugins**, as in Neovim or VS Code. The core supplies the shell's areas and
modes, the command and key engine, settings, themes, the Bridge and services; every feature is a plugin, built-ins included, and
reaches the app only through the plugin API, so a new tool has the same reach as anything already built.

```
src/contracts/   interfaces and records crossing a seam, the plugin API among them; imports nothing
src/config/      core commands and scopes, default settings, the core token registry and the built-in
                 themes  → read only by main
src/shared/      implementation both processes use (CommandRegistry, the plugin host, manifest merging, the event bus,
                 theme variables, `errorText`, the fake agent harness)
  layouts/       the layout registry plugins' main parts share (forms and chat layouts)
  page/          page-only DOM builders plugins share, the layout loader among them
                 → imported only by src/renderer and plugins' page/ parts
    ui/          the design primitives `DESIGN.md` lists, each a builder with its CSS beside it; `icon.ts` is the only
                 module naming the Codicons font
src/main/        core main process; main.ts is its composition root
  plugins/       the main-side plugin API: per-plugin channel routing and services
  config/        the ConfigStore: watches the user config folder, layers settings, keymap and themes over the
                 defaults, and tells its listeners each new config, which main.ts pushes to the page
  themes/        theme loader: parses a theme by the token registry and resolves `extends`
  ui-state/      the uiState file: app-written view state (`ui-state.json`) in Electron's user data folder
  alerts/        native notification, Dock bounce or taskbar flash, and the badge, behind Alerts
  claude-code/   Claude Code CLI adapter behind AgentHarness, which also lists and reads Claude's saved sessions
                 → the only place the app spawns `claude`
  files/         file reads (whole or the first bytes), modified times, atomic writes, rename, trash, folder lists
                 and watching, behind Files
  processes/     runs a program and returns its exit code and output, behind ProcessRunner
  data-protocol/ the `wigley-data:` scheme serving each plugin's data folder to the page
  drive/         the drive run: the page driver the self-test shares, the commands, their HTTP server, plugins'
                 drive actions and the video recorder, over a `DrivenWindow` → no electron import
src/preload/     the Bridge, exposed as window.wigley
src/renderer/    core page; renderer.ts is its composition root
  shell/         the shell registry, its areas and the default `ShellLayout`, and the modes
  plugins/       the page-side plugin API
  markdown-it/   markdown adapter behind MarkdownRenderer   → the only markdown-it import
  codemirror-vim/ editor (with prefix completion) and code-highlight adapters behind EditorHost and CodeHighlighter,
                 and the code colours
                 → the only codemirror, @codemirror, @lezer and @replit import
src/plugins/     every plugin, one folder each; manifests.ts lists every built-in manifest, keymap.ts holds
                 every built-in default key, main.ts and page.ts the parts each root starts
  sessions/      manifest.ts, contract.ts, main/ (the session list — rows, the selected session, tool routing — relay,
                 endpoint files, MCP adapter → the only @modelcontextprotocol import), page/ (Sessions mode: the
                 sidebar and each session's tabs)
  forms/         manifest.ts, contract.ts, main/ (round logic, saved rounds, its MCP tools, layouts, the preview
                 round), page/ (the Form tab), layouts/ (the Layout contract and the built-in `default` layout)
  docs/          manifest.ts, contract.ts, main/ (docs index runs, file changes inside the indexed folders only,
                 watching the open file), page/ (one docs view — tree, rendered doc, document editor — shown as
                 Docs mode over the machine's index and as each session's Docs tab over that session's; the
                 view hands back its tree and its doc: the tree goes in Docs mode's side bar, and in the start
                 pane of a split in each session's Docs tab)
  chat/          manifest.ts, contract.ts, main/ (owned sessions' agent processes and chat entries, the
                 permission_prompt MCP tool, recent folders, archived sessions, resume), page/ (the Chat tab,
                 the start prompt with its folder, profile and session steps), layouts/ (the chat Layout contract
                 and the built-in `default` chat layout)
  keys/          manifest.ts, contract.ts, page/ (which-key, the help overlay, the status bar's key list, and the
                 keys-for-command lookup it exports); no main part
  gallery/       manifest.ts, page/ (Gallery mode: every primitive in every state, a transparency switch, and a
                 swap of the shell to a test layout); no main part
```

Each Claude Code or Codex session runs the marketplace's `relay.py` (`plugins/wigley/scripts/forms/` in
wigley-ai-marketplace, whose README states the tool contract, the saved-round file format
the `retro` skill reads, and the relay's side of the channel). A change to either contract
lands in both repos together. Each relay connection is one agent session, owned by the `sessions` plugin; every
connected session has a row in the sessions sidebar until it disconnects or the user closes the row. A session the
app starts (`open`) is an owned session: its row exists from start, the relay connection whose hello carries its
host session id joins that row instead of adding one (a newer relay takes the join from an older one still
connected, as when the harness restarts its MCP connection), and the row ends when the agent process ends. A plugin's close
guard (`addCloseGuard`) refuses the user's close while the plugin still has something open there (forms: an open
round), since main, not the page, decides.

- **A plugin** is a folder in `src/plugins/<id>/`: `manifest.ts` declares its commands (each with a label, a group
  and the process it runs in), key scopes (each with the title help shows over its keys), settings
  and the plugins it depends on (a built-in plugin's default keys sit in `src/plugins/keymap.ts`); `main/`
  and `page/` each export a part, the manifest with a start function that receives that process's plugin API and
  returns the handlers for the manifest's commands that run in that process, plus the `exports` its dependents read
  (and, in main, a `dispose`). The compiler checks every command that runs in a process has a handler there and
  every key names a declared command running in the key's process (page and editor keys a page command; app,
  global and intercept keys a main one). A built-in plugin's manifest joins `src/plugins/manifests.ts`, which main
  builds the served keymap, labels and settings from, and its parts join `src/plugins/main.ts` and
  `src/plugins/page.ts`; a part whose manifest is missing from the list throws at startup. A main part starts once;
  a page part starts on every page load.
- **A plugin talks** to its other process over its own channel (`api.channel`), typed by its `contract.ts`, and to
  another plugin through the exported API of a plugin its manifest depends on, or through events. A plugin imports
  only `src/contracts`, `src/shared`, its own folder, and the `contract.ts` of a plugin its manifest depends on,
  which types that plugin's exports and events. A dependency with no part in a process (`keys` in main, a
  main-only plugin on the page) starts nowhere there, and its exports read as `undefined` in that process.
- **An event** is published with `api.events.emit` under the publishing plugin's id (`activeChanged` in plugin
  `sessions` is `sessions.activeChanged`) and heard with `api.events.on` by any plugin; its payload type lives in
  the publisher's `contract.ts`. Each process has its own bus, and nothing crosses processes on it: a plugin's own
  channel does that.
- **The shell** is a registry of areas — title bar, activity bar, side bar, main, panel, status bar, overlay — laid
  out by one `ShellLayout` module in `src/renderer/shell/`. A page plugin may replace the layout through the shell
  API (`shell.setLayout`); every contribution it makes returns a `Disposable`, and so does replacing the layout. The
  areas are the fixed set `AreaName` names, and a contribution carries an order and an alignment. Reworking the window's structure is
  editing the default layout or adding a plugin; track sizes are theme tokens.
- **A mode** fills the content sheet, and the core shows one at a time: a plugin registers its mode, with its icon,
  title and an optional side bar element, through the page plugin API, and binds the command that shows it
  (Sessions on `Space k s`, Docs on `Space k d`; pressed while its mode already shows, the same command toggles the
  side bar). The activity bar lists every mode, the side bar slot shows the shown mode's side bar, and the mode's
  handle sets the title bar's context. A hidden mode keeps its state,
  so leaving one never loses work in it, but it keeps no keys: each mode and each session tab is told when it becomes
  the visible one (`shown`), and its plugin sets its key scope there. A new full-window feature is a new mode, with no
  core edit.
- **A session tab** is added to a session by the plugin that fills it, through the `sessions` page export `addTab`:
  forms adds a Form tab where a session's round view is created, when the session has no Form tab, chat a Chat tab
  to each session it starts, and docs a Docs tab to each session when it connects. A tab that
  needs the user now takes over its session (`takeOver()`), and its release gives the session back to the tab shown
  before only if no tab was selected since, even back to the taking tab: forms takes over for a round and releases on submit or cancel. A session's tabs drop when its row leaves, closed by the user or ended, and
  `sessions.sessionRemoved` tells each plugin to forget the session; the user moves between tabs with `Option+o` /
  `Option+i` and between sessions with `Option+Shift+o` / `Option+Shift+i`.
- **A key** is a default bind in `src/plugins/keymap.ts`, the one file holding every built-in key (core and
  built-in plugins), naming its command and scope in full: `forms.nextItem` in scope `forms.review`. A bind is one
  vim-notation entry (`<Leader>ks`, `gg`, `<A-o>`) written once; the merge expands it into the page bind and the box
  bind it stands for, a leader bind into both and any other bind into the page bind, unless `where` (`page`,
  `box` or `both`) says otherwise, so the key engine reads page and editor binds as before. Keys never
  call code directly, so rebinding never touches a handler. Built-in manifests declare commands and scopes only; a
  manifest's optional `keys` is for a plugin from outside the repo. The keymap merges in layers — the default
  keymap, then each manifest's `keys` in dependency order, then the user's `keymap.json`, in the same entry format —
  where a later layer's bind replaces an earlier one with the same keys in the same scope and an `unbind` entry
  removes one; only a clash inside one layer is an error. Which key a bind takes follows `docs/keymap.md`, and its
  leader group is named in the file's `groups` for which-key (layered the same way, by prefix). Each process checks every keymap it installs, at startup and on
  each config change, for a key that names no registered
  command, and main and the page both reject a key bound twice in one scope. A page key may be a chord in vim notation (`<C-h>`, `<A-o>`,
  `<D-w>`), matched on the physical key, since macOS turns Option+o into `ø`; a chord bind fires inside a text box
  too, in every vim mode, ahead of the editor. A plugin's own text box may keep typed keys from the page keys while
  Tab, Enter, Escape and chords still reach its scope's binds (docs' `textBoxInput`). An editor key carries a scope as a page key does and runs only while
  that scope is in force, so two plugins' editors may bind one vim key in different scopes. It fires in normal mode,
  or in insert mode with `mode: 'insert'` (one key the host can type unbound, today only `<CR>`, as in the chat
  picker's filter). Vim keeps one mapping per key sequence and mode for every editor, so a sequence bound in any
  scope runs nothing in the others (the page logs `<keys> has no bind in <scope>`; an insert key types as it does
  unbound, Enter breaking the line), and startup fails on two binds in one mode with the same keys in overlapping
  scopes or on keys that begin another same-mode bind's longer keys in any scope. Esc while a sequence waits cancels
  it and runs nothing.
- **Debug and testing keys** sit under `Space z`, so everyday keys stay clear of them (forms' layout keys are
  `Space z l …`, chat's `Space z c …`, the gallery's `Space z g`, which shows Gallery mode, and its `Space z s`,
  which swaps the shell to a test layout and back).
- **A key scope** in force is the top of the page core's scope stack: `api.keys.setScope` sets a plugin's base
  scope (forms' view), and `api.keys.pushScope` lays a scope over it until its `pop` (help's `keys.help`), so a
  modal view never fights the plugin under it for the scope. The pushed scope's `onBaseChanged` hears the set scope
  change under it, so a modal view can close when the view beneath it moves on (help closes on it).
- **Key hints** belong to the `keys` plugin, which reads the merged keymap: which-key after a pending prefix, help on
  `Space ?` (`<Leader>?` in a box), and the status bar's keys that don't start with the leader. A plugin declares
  its labels and scope titles (its keys sit in the default keymap), and draws no key hints of its own: a view
  that shows a key beside its
  control (every forms or chat button whose command has a page bind) depends on `keys` and reads it from that plugin's `keysFor`
  export, again on each of its `onChanged`, so a rebind reaches the control, and draws no hint when the command is
  unbound. Every hint is drawn by the Kbd primitive through `formatChord` (`formatVimToken` for a text box's keys),
  which prints a chord for the platform the served config names. The core and the editor
  host report a pending prefix through `api.keys`; the editor host reads it from vim's pending input, behind
  `EditorHost`.
- **A theme** is a JSON file of a `palette`, `tokens`, a `reduced` block of overrides for reduced transparency, and
  a `colorScheme`; a user theme sets `extends` to a base theme and lists only the tokens it changes. Every token has
  a kind: colour, length, duration, number, shadow, filter or raw CSS. A core token is declared with its kind in the
  core token registry, and a theme with no `extends` sets every core token (the loader rejects one that misses any).
  A plugin token is declared with its kind and default in its manifest's `themeTokens` (qualified
  `<pluginId>.<token>`), so a theme written before the plugin still loads. A colour token may name another as
  `var(--wg-<name>)`, which the loader checks exists. Views read a token as
  `--wg-<name>` and never write a raw value (`DESIGN.md` § Tokens and themes). Built-in themes live in
  `src/config/themes/`; the user's own in the `themes` folder of the user config folder override a built-in of the
  same name. A broken theme keeps the last good one and shows its error.
- **An item kind** in a forms round — question, finding, notice — is a format module in a folder of its own,
  `src/plugins/forms/main/kinds/<kind>/<kind>-format.ts` and `src/plugins/forms/page/kinds/<kind>/<kind>-card.ts`,
  each listed in the typed `FORMATS` table of its process's `kinds/formats.ts`; the page module hands a layout the
  kind's card input, and the layout builds the card. A new kind starts as its name in
  the forms contract's `ItemKind` (and in `AnswerableKind`'s exclusion when it takes no answer), its item type, and
  its `ItemOf` entry in main's `kinds/item-format.ts`; from there the compiler flags each of the rest missing: that
  folder pair, its table entries, its array in the contract's `Round`, `FormBody` and `AnswersPayload`, `round.ts`'s
  fixed keys (`parseRound`, `readFormBody`, the answers payload) and the per-kind records: `FINGERPRINT_LISTS` in
  `round.ts`, `ROUND_ITEMS` in `page/form-state.ts`, and for an answerable kind `ANSWER_LISTS` in
  `forms-service.ts`, and `ANSWER_ARRAYS`, `PICK_ANSWERS` and `RECOMMENDED_PICKS` (what Enter accepts) in
  `form-state.ts`, then its card input and kit parts in the Layout contract (`layouts/layout.d.ts`) and its card in
  the `default` layout. The order lists are plain arrays the compiler cannot check: `formats.test.ts` fails when main's
  `ITEM_KINDS` or `ANSWERABLE_KINDS` misses a kind, and `RAIL_ORDER` in `form-state.ts` is added to by hand.
- **A finding origin** — `caused`, `pre_existing`, `design`, `nit` — is an entry in
  `src/plugins/forms/finding-origins.ts`: the card it draws as (Defect, Decision, Nit), the fields it requires and
  forbids, its choice bounds, and the actions it offers with the card's word for each. Main's parser (which rejects a
  choice opening with one of those words) and the page's card both read that table. A new origin starts as its name
  in the forms contract's `FindingOrigin` and its variant in the `Finding` union (and in `DefectFinding`'s origin when
  it takes severity); the compiler then flags its table entry, its chip text in `ORIGIN_CHIPS` in
  `page/kinds/finding/verdict.ts` and its meaning in `ORIGIN_MEANINGS` in `main/kinds/finding/finding-format.ts`,
  and a new card its `CARD_TEXT` in `finding-card.ts` and its `CARD_CHOICES` in `finding-format.ts`. The card list
  in `ASK_ROUND_DESCRIPTION` is built from the table by `findingCardsText()` in `main/kinds/finding/finding-text.ts`.
  The rest it cannot check: the `FINDING_ORIGINS` list in the contract, an `origin-*` token in forms'
  manifest `themeTokens` with its `.badge-origin` rule in `forms.css`, and retro's
  `ORIGIN_ACTION_LABELS` in the marketplace's `answers.py`, which otherwise labels the new origin's actions with the
  Defect words. Every card shows all its choices and its action row, the recommended ones tagged Recommended in the accent, and Accept (Enter)
  takes them whole: the user ruled out folding the alternatives away, since it biased answers toward the
  recommendation.
- **An agent harness** — Claude Code today, Codex and wigley-harness next — is an adapter behind `AgentHarness` in
  `src/contracts/agent.ts`, handed to plugins as a main service; the fake in `src/shared/` drives the tests and the
  self-test. The adapter alone reads its harness's output and turns it into chat entries, each carrying the raw
  events, so a chat layout can show any field and the chat never parses a harness's JSON. The Claude adapter's
  readings of the CLI (`docs/features/agent-chat/claude-stream.md`): it reports permission mode `manual` as
  `default`, no event reports effort, `total_cost_usd` is cumulative per process, and only a `control_request`
  interrupt keeps the process alive (SIGINT ends it). Listing a folder's saved sessions and reading one into chat
  entries are adapter calls too (`listSessions`, `history`), so Claude's transcript format stays in
  `src/main/claude-code/transcripts.ts`. That format is undocumented and was measured on the installed CLI, so a
  resume that lists nothing or draws raw entries starts with `transcripts.ts` and a fresh look at a transcript's line
  shapes.
- **A session control** — Claude's permission mode, effort and model — is declared by the harness adapter (id,
  label, choices, current value), and the Chat tab draws whatever its adapter declares. A control gets its key as a
  command in chat's manifest (raw `m`, `e`, `o` in the chat scope; `<Leader>cm`, `<Leader>ce`, `<Leader>co` in the
  composer box, where raw keys are vim's); `c` (`<Leader>cc` in the box) lists every control, so a new adapter's
  controls are reachable before they get a key.
- **A round source** — MCP today, the wigley harness next — is an adapter that calls `FormsService`; it never
  reaches the round store, the deadline or the window directly. It reads saved rounds only through a
  function the composition root injects, as the layout preview reads saved round args through `savedArgs`.
- **An MCP tool** is contributed to the `sessions` plugin by the plugin that runs it, with a handler per session;
  sessions writes every contributed tool into `tools.json` and routes each call by tool name, so its MCP adapter
  names no tool.
- **An ambient service** — the clock, ids, the home folder, files (with watching), processes, opening a link in the default browser, how the app was started (`runMode`: live, self-test or drive) — reaches a plugin
  through `api.services`, filled in by the composition root, so a test hands the plugin a fake.
- **A setting** is a core setting in `src/contracts/settings.ts` and `src/config/settings.ts`, or a plugin's own in
  its manifest's `settings`. The user overrides any of them in `settings.json` (plugin settings under the plugin id).
- **The user config folder** is `~/.config/wigley-ai-gui/` on both OSes: `settings.json`, `keymap.json` and
  `themes/`, each holding only what the user changes. Main's ConfigStore watches it and serves every new config to
  the page over the Bridge, so everything hot reloads: plugins read `settings()` and `keys.keymap()` with
  `onChanged` rather than keeping a copy, and a setting read only when something is created (window size, the claude
  command) applies to the next one. A broken file keeps the last good config and shows the problem in the status
  bar. App-written state, such as split widths, goes to the `uiState` service, never to the user's config.
- **A third-party tool** gets a contract in `src/contracts/` and an adapter folder of its own; the core hands
  plugins the shared ones (editor, markdown) as services. Swapping it is a new adapter folder against the same
  contract, and one changed line in the composition root.
- **Plugin data** — files a plugin keeps for the user, such as forms layouts — lives in the plugin's own folder,
  `plugins/<id>/` in Electron's per-user data folder (in the self-test and a drive run, `plugin-data/` in the temp home). Main reaches it through
  `api.data`, the files service scoped to that folder, which refuses a path outside it. The page loads a file from
  it by the URL `api.dataUrl(path, revision)` builds on the `wigley-data:` scheme, which the page's CSP allows for
  scripts and styles; `revision` sits in the URL's path, so a changed module and every relative import under it load
  fresh.
- **A layout** is a plugin's user-editable look: the shared registry (`src/shared/layouts/`) and loader
  (`src/shared/page/`) take the plugin's data folder, contract text, default layout and validator, and each plugin
  keeps its own contract and built-in `default`. Forms' layouts build round cards and chat's build chat entries, a
  chat entry's layout reading the entry's raw events for anything the entry does not name.
- **A chat layout** builds each entry kind's element from the entry and a `ChatKit`
  (`src/plugins/chat/layouts/layout.d.ts`): `markdown`, `json`, `expander` (a collapsible card), `collapsibleCard`,
  `card`, `statusDot` with `setDotStatus`, `sectionHeader`, and `permissionActions` (Allow once / Deny with their
  keys).
- **A forms layout** builds each item's cards, and may add a head above them. Its contract is
  `src/plugins/forms/layouts/layout.d.ts`: the card input for each kind, and the kit of ready-made parts (sections,
  choice list, answer controls, verdict, action row, and the plain parts `card`, `tag`, `kbd`, `button` — variant
  and `keys` — and `sectionHeader`), each of which keeps itself up to date. The built-in `default`
  layout is `layouts/default/layout.js`, plain JS that `// @ts-check` types against that contract, and it draws the
  forms look. The user's layouts are folders in forms' plugin data, `layouts/<name>/layout.js` and an optional
  `layout.css`, and the app writes `layouts/layout.d.ts` there at every start. Saving the active layout's code
  (`.js`, `.mjs`), style (`.css`), data (`.json`), image or font files redraws open rounds and keeps every answer;
  editor swap and lock files do not. `Space z l n` / `Space z l p` cycle the layouts, `Space z l c` copies the
  active one into a new folder, and `Space z l o` opens the preview round and selects its row; the round sends
  nothing and raises no notification or badge. A card that throws falls back to `default`, and a reload that fails
  keeps the last good layout.
- `npm run lint` runs `scripts/check-layers.mts`, which fails on an import crossing a boundary its `LAYERS` table does
  not allow. A new layer, adapter or plugin folder gets a `LAYERS` entry, and the composition root's entry lists it.
  Every plugin's `page/` layer and `src/shared/page` may import `src/shared/page/ui`.
- It also runs `scripts/check-styles.mts`, which fails on a raw colour, length, duration or font stack in CSS or an
  inline style under `src/`, and on `backdrop-filter` outside `src/shared/page/ui/materials.css`. It judges every file under
  `src/` and takes no argument.

## Running and testing

- Node is pinned in `.nvmrc`. A shell that started on another version runs commands as
  `source ~/.nvm/nvm.sh && nvm use && npm run …`.
- `npm test` runs the Vitest suite: every module whose correctness follows from inputs and outputs — round
  logic, saved rounds, answer state, markdown, theme loading, the keymap — is tested there, without Electron.
- `npm run selftest` is the agent's loop, and the user allows the agent to run it any time. It renders the window
  offscreen as an accessory app, so it never takes the user's foreground; the core's driver (`src/main/selftest.ts`) runs
  the script a plugin hands it — the forms plugin's opens fixture sessions through `sessions` and their rounds
  through `FormsService` — drives keys with
  `sendInputEvent`, checks the lines each step adds to the page's log and the result the script checks, and exits
  non-zero on a failure. A key behaviour the agent adds or fixes gets a step in its plugin's self-test script
  (`src/plugins/forms/main/selftest-script.ts` for forms); a step with no keys waits for its line, and a step's
  `writeFile` writes a file under the self-test's temp home before its keys, as an outside change on disk, and a
  step's `screenshot` (a lowercase name in words joined by `-`) saves a PNG of the window, once the step's line has
  been waited for, to `.selftest/screenshots/<plugin>-<name>.png` (git-ignored, emptied when the self-test starts)
  for the agent to check against `DESIGN.md`. The self-test's user
  config folder sits in its temp home. The script's
  `settings` override plugin settings in the config main serves the page (forms' sets a short
  `keys.whichKeyTimeoutMs`, so a step can wait out the panel); main parts start on the ConfigStore's config, which under the self-test is the empty config folder in its temp
  home, so the defaults, with no script `settings` over them. Each plugin hands
  at most one script, and the scripts run in plugin start order; the keys plugin has no main part, so its steps live
  in forms' script, whose fixture gives them scopes full of binds and a box to type in. The gallery has no main part
  either, so its steps live in forms' and docs' scripts. Chat's script runs its
  sessions over the fake agent harness, its steps covering the resume list, archive and slash completion. Docs'
  (`src/plugins/docs/main/selftest-script.ts`) runs over a fixture (`selftest-fixture.ts`) that writes docs, an index
  and a stand-in `docs_index.py` into the self-test's temp home at start, so its steps never reach the user's docs or
  index.
- A drive run (`npm run drive`) is how the agent checks a change in the running app: every change to what the app
  shows or how it reacts is driven end to end, and its captures read, before the work is done. It runs offscreen as
  an accessory app on its own temp home, beside the user's app, so the agent starts one whenever a check needs it.
  The `drive` skill (`.agents/skills/drive/SKILL.md`) holds the loop. A plugin offers its fixtures to a drive run as
  drive actions (`api.drive`), so a new plugin's fixtures need no core edit.
- Forms visuals are checked live on the preview round (`Space z l o`): the built-in sample shows every card, and each
  further press swaps in the next saved real round, then back to the sample.
- Synthetic keys never reach a global shortcut, never compose a dead key (macOS Option+n) and never meet IME
  composition, and an offscreen window shows no native notification or dialog. Those checks are the user's, in a
  visible `npm start`: the agent lists them in its wrap-up with their steps and does not wait on them.

## Dev quirks

- An app launched from Finder or the Dock inherits launchd's bare PATH, so before plugins start main swaps in the PATH
  the user's login shell builds (`src/main/login-shell-path.ts`), keeping the inherited one when that read fails. Main
  reads it only when the app's parent is launchd (`process.ppid === 1`): a terminal start (`npm start`) and the
  self-test keep the PATH of the shell that ran them, nvm or a venv included. The read's shell leads its own process
  group, and the 3 s cap kills that whole group.
- Under `electron-forge start` the page loads twice at startup, the second load triggered by the dev server. Code
  that acts on page load runs on every load, as the self-test does.
- A session's `ask_round` schema is fixed when the session starts, so after a change to the forms tool contract the
  running session still offers the old shape. Take the fields the server now requires from its error, and send a
  sample round that needs the new schema from a new session.
