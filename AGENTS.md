# wigley-ai-gui

**Contents**

- **Architecture** — build every change for extensibility with `wigley:codebase-design`; the core and its plugins, the
  layers, the relay and agent sessions, and where a new plugin, mode, session tab, key, event, setting, theme, plugin
  data, forms layout, round source, MCP tool or third-party tool goes, and the layer check.
- **Running and testing** — Node version, the self-test the agent may run any time, and the visible run that is the user's.
- **Dev quirks** — the startup reload and the unwired ACP adapter and mock agent.

An Electron app (Forge 8, Vite, TypeScript) growing into a vim-first GUI over the wigley harness: CodeMirror 6 with
vim, app-owned Cmd keys and a global summon shortcut. Its live jobs: it is the only client of the `wigley-forms`
tools, receiving agents' review rounds and showing each in its agent session's Form tab for the user to answer; and it
browses and edits every agent doc on the machine through the docs index (`docs_index.py`, `plugins/wigley/scripts/docs-index/`
in wigley-ai-marketplace, whose README states the index schema). An ACP client, built but not yet wired, is for
driving an agent process over stdio.

## Architecture

The user builds on this app indefinitely and expects to swap any third-party tool, change how a feature works, or add
one, as a local edit. So every change is designed with `wigley:codebase-design`, loaded before writing code: deep
modules behind small interfaces in `src/contracts/`, each third-party library behind one adapter, and wiring only in a
composition root.

The app is a **core** and its **plugins**, as in Neovim or VS Code. The core supplies the shell's areas and
modes, the command and key engine, settings, themes, the Bridge and services; every feature is a plugin, built-ins included, and
reaches the app only through the plugin API, so a new tool has the same reach as anything already built.

```
src/contracts/   interfaces and records crossing a seam, the plugin API among them; imports nothing
src/config/      core keymap (leader, remaps, app chords) and settings, and the built-in themes  → read only by main
src/shared/      implementation both processes use (CommandRegistry, the plugin host, manifest merging, the event bus,
                 theme variables, `errorText`)
  page/          page-only DOM builders plugins share       → imported only by src/renderer and plugins' page/ parts
src/main/        core main process; main.ts is its composition root
  plugins/       the main-side plugin API: per-plugin channel routing and services
  themes/        theme loader: parses and chooses the built-in or user theme
  alerts/        native notification, Dock bounce or taskbar flash, and the badge, behind Alerts
  acp/           ACP adapter behind AgentClient             → the only client-side @agentclientprotocol/sdk import
  files/         file reads, atomic writes, rename, trash, folder lists and watching, behind Files
  processes/     runs a program and returns its exit code and output, behind ProcessRunner
  data-protocol/ the `wigley-data:` scheme serving each plugin's data folder to the page
src/preload/     the Bridge, exposed as window.wigley
src/renderer/    core page; renderer.ts is its composition root
  shell/         the window's areas (activity bar, side bar, main, panel, status bar, overlay layer) and its modes
  plugins/       the page-side plugin API
  markdown-it/   markdown adapter behind MarkdownRenderer   → the only markdown-it import
  codemirror-vim/ editor and code-highlight adapters behind EditorHost and CodeHighlighter → the only codemirror,
                 @codemirror, @lezer and @replit import
src/plugins/     every plugin, one folder each; manifests.ts lists every built-in manifest, main.ts and page.ts the
                 parts each root starts
  sessions/      manifest.ts, contract.ts, main/ (the session list — rows, the selected session, tool routing — relay,
                 endpoint files, MCP adapter → the only @modelcontextprotocol import), page/ (Sessions mode: the
                 sidebar and each session's tabs)
  forms/         manifest.ts, contract.ts, main/ (round logic, saved rounds, its MCP tools, layouts, the preview
                 round), page/ (the Form tab), layouts/ (the Layout contract and the built-in `default` layout)
  docs/          manifest.ts, contract.ts, main/ (docs index runs, file changes inside the indexed folders only,
                 watching the open file), page/ (one docs view — tree, rendered doc, document editor — shown as
                 Docs mode over the machine's index and as each session's Docs tab over that session's)
  keys/          manifest.ts, contract.ts, page/ (which-key, the help overlay, the status bar's key list, and the
                 keys-for-command lookup it exports); no main part
src/mock-agent/  a separate executable the ACP adapter spawns in dev
```

Each Claude Code or Codex session runs the marketplace's `relay.py` (`plugins/wigley/scripts/forms/` in
wigley-ai-marketplace, whose README states the tool contract, the saved-round file format
the `retro` skill reads, and the relay's side of the channel). A change to either contract
lands in both repos together. Each relay connection is one agent session, owned by the `sessions` plugin; every
connected session has a row in the sessions sidebar until it disconnects or the user closes the row. A plugin's close
guard (`addCloseGuard`) refuses the user's close while the plugin still has something open there (forms: an open
round), since main, not the page, decides.

- **A plugin** is a folder in `src/plugins/<id>/`: `manifest.ts` declares its commands (each with a label, a group
  and the process it runs in), key scopes (each with the title help shows over its keys), default keys, settings
  and the plugins it depends on; `main/` and
  `page/` each export a part, the manifest with a start function that receives that process's plugin API and
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
- **A mode** fills the window above the status bar, and the core shows one at a time: a plugin registers its mode
  through the page plugin API and binds the command that shows it (Sessions on `Space k s`, Docs on `Space k d`;
  pressed while its mode already shows, the same command toggles that mode's sidebar). A hidden mode keeps its state,
  so leaving one never loses work in it, but it keeps no keys: each mode and each session tab is told when it becomes
  the visible one (`shown`), and its plugin sets its key scope there. A new full-window feature is a new mode, with no
  core edit.
- **A session tab** is added to a session by the plugin that fills it, through the `sessions` page export `addTab`:
  forms adds a Form tab where a session's round view is created, when the session has no Form tab, and the docs
  plugin, once it lands, a Docs tab when the session connects. A session's tabs drop when its row leaves, closed by the user or ended, and
  `sessions.sessionRemoved` tells each plugin to forget the session; the user moves between tabs with `Option+o` /
  `Option+i` and between sessions with `Option+Shift+o` / `Option+Shift+i`.
- **A key** is a default bind in its plugin's manifest naming that plugin's command; the core qualifies both, so
  `nextItem` in plugin `forms` runs as `forms.nextItem`, and its scope `review` is `forms.review`. Keys never call
  code directly, so rebinding never touches a handler. `src/config/keymap.ts` holds only the core's keys and is where
  the user's overrides land. Each process checks at startup that every key it owns names a registered command, and
  the page also rejects a key bound twice in one scope. A page key may be a chord in vim notation (`<C-h>`, `<A-o>`,
  `<D-w>`), matched on the physical key, since macOS turns Option+o into `ø`; a chord bind fires inside a text box
  too, in every vim mode, ahead of the editor. An editor key carries a scope as a page key does and runs only while
  that scope is in force, so two plugins' editors may bind one vim key in different scopes. Vim keeps one mapping per
  key sequence for every editor, so a sequence bound in any scope runs nothing in the others (the page logs
  `<keys> has no bind in <scope>`), and startup fails on two binds with the same keys in overlapping scopes or on keys
  that begin another bind's longer keys in any scope. Esc while a sequence waits cancels it and runs nothing.
- **Debug and testing keys** sit under `Space z`, so everyday keys stay clear of them (forms' layout keys are
  `Space z l …`).
- **A key scope** in force is the top of the page core's scope stack: `api.keys.setScope` sets a plugin's base
  scope (forms' view), and `api.keys.pushScope` lays a scope over it until its `pop` (help's `keys.help`), so a
  modal view never fights the plugin under it for the scope. The pushed scope's `onBaseChanged` hears the set scope
  change under it, so a modal view can close when the view beneath it moves on (help closes on it).
- **Key hints** belong to the `keys` plugin, which reads the merged keymap: which-key after a pending prefix, help on
  `Space ?` (`<Leader>?` in a box), and the status bar's keys that don't start with the leader. A plugin declares
  its keys, labels, groups and scope titles, and draws no key hints of its own: a view that shows a key beside its
  control (every forms button whose command has a page bind) depends on `keys` and reads it from that plugin's `keysFor`
  export, so a rebind reaches the control, and draws no hint when the command is unbound. The core and the editor
  host report a pending prefix through `api.keys`; the editor host reads it from vim's pending input, behind
  `EditorHost`.
- **A theme** is a JSON file of a `palette` and semantic `tokens` (a token names a palette entry or gives a hex).
  Built-in themes live in `src/config/themes/`; the user's own live in the `themes` folder of Electron's per-user
  data folder and override a built-in of the same name. Views read tokens as CSS variables and never name a
  colour. A broken theme falls back to Catppuccin Mocha and shows its error.
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
  The rest it cannot check: the `FINDING_ORIGINS` list in the contract, an `origin.*` theme token in
  `THEME_TOKENS` and every built-in theme with its `.badge-origin` rule in `forms.css`, and retro's
  `ORIGIN_ACTION_LABELS` in the marketplace's `answers.py`, which otherwise labels the new origin's actions with the
  Defect words. Every card shows all its choices and its action row, the recommended ones badged, and Accept (Enter)
  takes them whole: the user ruled out folding the alternatives away, since it biased answers toward the
  recommendation.
- **A round source** — MCP today, the wigley harness next — is an adapter that calls `FormsService`; it never
  reaches the round store, the deadline or the window directly.
- **An MCP tool** is contributed to the `sessions` plugin by the plugin that runs it, with a handler per session;
  sessions writes every contributed tool into `tools.json` and routes each call by tool name, so its MCP adapter
  names no tool.
- **An ambient service** — the clock, ids, the home folder, files (with watching), processes — reaches a plugin
  through `api.services`, filled in by the composition root, so a test hands the plugin a fake.
- **A setting** is a core setting in `src/contracts/settings.ts` and `src/config/settings.ts`, or a plugin's own in
  its manifest's `settings`. Main owns the config and serves it to the page over the Bridge, so a user config file
  later lands in `main.ts` alone.
- **A third-party tool** gets a contract in `src/contracts/` and an adapter folder of its own; the core hands
  plugins the shared ones (editor, markdown) as services. Swapping it is a new adapter folder against the same
  contract, and one changed line in the composition root.
- **Plugin data** — files a plugin keeps for the user, such as forms layouts — lives in the plugin's own folder,
  `plugins/<id>/` in Electron's per-user data folder (a temp folder in the self-test). Main reaches it through
  `api.data`, the files service scoped to that folder, which refuses a path outside it. The page loads a file from
  it by the URL `api.dataUrl(path, revision)` builds on the `wigley-data:` scheme, which the page's CSP allows for
  scripts and styles; `revision` sits in the URL's path, so a changed module and every relative import under it load
  fresh.
- **A forms layout** builds each item's cards, and may add a head above them. Its contract is
  `src/plugins/forms/layouts/layout.d.ts`: the card input for each kind, and the kit of ready-made parts (sections,
  choice list, answer controls, verdict, action row), each of which keeps itself up to date. The built-in `default`
  layout is `layouts/default/layout.js`, plain JS that `// @ts-check` types against that contract, and it draws the
  forms look. The user's layouts are folders in forms' plugin data, `layouts/<name>/layout.js` and an optional
  `layout.css`, and the app writes `layouts/layout.d.ts` there at every start. Saving the active layout's files
  redraws open rounds and keeps every answer. `Space z l n` / `Space z l p` cycle the layouts, `Space z l c` copies
  the active one into a new folder, and `Space z l o` opens the preview round, which sends nothing. A card that
  throws falls back to `default`, and a reload that fails keeps the last good layout.
- `npm run lint` runs `scripts/check-layers.mts`, which fails on an import crossing a boundary its `LAYERS` table does
  not allow. A new layer, adapter or plugin folder gets a `LAYERS` entry, and the composition root's entry lists it.

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
  (`src/plugins/forms/main/selftest-script.ts` for forms); a step with no keys waits for its line. The script's
  `settings` override plugin settings in the config main serves the page (forms' sets a short
  `keys.whichKeyTimeoutMs`, so a step can wait out the panel); main parts start on their defaults. Only one script
  runs, so the keys plugin's steps live in forms' script, whose fixture gives them scopes full of binds and a box to
  type in.
- Forms visuals are checked live on the preview round (`Space z l o`): the built-in sample shows every card, and each
  further press swaps in the next saved real round.
- A visible `npm start` takes the user's foreground and keyboard, so that run is the user's: the agent gives the user
  the steps to try. The global shortcut needs it — macOS keys reach a global shortcut only from the real keyboard.

## Dev quirks

- Under `electron-forge start` the page loads twice at startup, the second load triggered by the dev server. Code
  that acts on page load runs on every load, as the self-test does.
- Nothing in the app calls the ACP adapter or the mock agent; both still build for the harness work.
