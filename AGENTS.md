# wigley-ai-gui

**Contents**

- **Intent** — what every change is judged by: everything a plugin, everything hot reloads, macOS and Windows now,
  any agent harness or model later, one user and no backwards compatibility.
- **Architecture** — build every change for extensibility with `wigley:codebase-design`; the core and its plugins, the
  layers, the relay and agent sessions, and where a new plugin, shell area, mode, session tab, key, event, setting,
  user config file, theme, plugin data, layout, agent harness, session control, agent form type, MCP tool or
  third-party tool goes, and the layer check.
- **Running and testing** — the stable and dev apps side by side, `npm run install-app` and the app icon, Node
  version, the self-test and the drive run the agent may start any time, and the checks only a real keyboard proves.
- **Dev quirks** — the startup reload, a session's stale forms schema, and the login-shell PATH.

UI work — a view, its CSS, a theme, a primitive, a layout or a key — reads `DESIGN.md` first: it is the standard
every view follows, and it says where a new value or primitive goes. A new or moved key also reads `docs/keymap.md`,
the rule for which key an action takes.

An Electron app (Forge 8, Vite, TypeScript) growing into a vim-first GUI over the wigley harness: CodeMirror 6 with
vim, app-owned Cmd keys and a global summon shortcut. Its live jobs: it is the only client of the `wigley-forms`
tools, receiving agents' review rounds and feature primers and showing each in its agent session's Form or Primer tab
for the user to answer; and it
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
- **One user, no backwards compatibility.** The user is the app's only user and updates the app and
  wigley-ai-marketplace together. A change replaces a shape in place, with no migration, fallback or version
  shim: a contract, a config or data file the app writes, the docs index schema. A shape both repos read changes in
  both in the same piece of work.

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
  agent-forms/   the agent form lifecycle every agent form type shares (forms' rounds, the primer): the service with
                 its per-session open form, deadline, re-attach and hand-back, the saved-form folder and memory stores,
                 the channel and scripted presenters, the MCP tool session, and the drive actions that open a
                 form type's forms in a drive run's sessions → main-side only
  paths/         the POSIX and Windows adapters behind `Paths`, picked by each composition root
  followups/     the follow-up file module: parses a features home's follow-ups file into items (title, one line,
                 tags, body, line span, done) and turns a create, edit, tag change or delete into the file's new
                 text, in the file's own shape (triage.md § The project's follow-ups in wigley-ai-marketplace) →
                 pure, no I/O; Backlog and Docs' create dialog both write follow-ups through it
  page/          page-only DOM builders plugins share: the layout loader, the reducer store, autosave, editor boxes,
                 key hints, the confirm prompt, the session form tab helper, the session form status line, and the
                 session form lifecycle (the open forms' reducer, the close guard, send and close from main, the page
                 events queue)
                 → imported only by src/renderer and plugins' page/ parts
    ui/          the design primitives `DESIGN.md` lists, each a builder with its CSS beside it; `icon.ts` is the only
                 module naming the Codicons font
src/main/        core main process; main.ts is its composition root
  plugins/       the main-side plugin API: per-plugin channel routing and services
  config/        the ConfigStore: watches the user config folder, layers settings, keymap and themes over the
                 defaults, and tells its listeners each new config, which main.ts pushes to the page; and the
                 userConfig service, which reads and writes the user's `settings.json` and `keymap.json` layers
                 through the ConfigStore's own checks
  themes/        theme loader: parses a theme by the token registry and resolves `extends`
  ui-state/      the uiState file: app-written view state (`ui-state.json`) in the app instance's user data folder
  alerts/        native notification, Dock bounce or taskbar flash, and the badge, behind Alerts; the badge sums the
                 open counts each source sets
  claude-code/   Claude Code CLI adapter behind AgentHarness, which also lists and reads Claude's saved sessions and
                 project folders and runs `claude auth` sign-in, sign-out and status → the only place the app spawns `claude`
  files/         file reads (whole as text or bytes, or the first bytes), modified times, atomic writes, rename, trash, folder lists
                 and watching, behind Files
  processes/     runs a program, killed past an optional timeout, and returns its exit code and output, behind
                 ProcessRunner
  git/           git adapter behind Git, over ProcessRunner: a clone's file statuses, upstream, last fetch, fetch
                 and a commit of named paths only → the only place the app runs `git`
  data-protocol/ the `wigley-data:` scheme serving each plugin's data folder to the page
  drive/         the drive run: the page driver the self-test shares, the commands, their HTTP server, plugins'
                 drive actions and the video recorder, over a `DrivenWindow` → no electron import
src/preload/     the Bridge, exposed as window.wigley
src/renderer/    core page; renderer.ts is its composition root
  shell/         the shell registry, its areas and the default `ShellLayout`, and the modes
  plugins/       the page-side plugin API
  markdown-it/   markdown adapter behind MarkdownRenderer   → the only markdown-it import
  fzf/           fuzzy matcher adapter behind FuzzyMatcher, which every `/` filter and the slash completion rank
                 with                                       → the only fzf import
  codemirror-vim/ editor (with fuzzy slash completion) and code-highlight adapters behind EditorHost and CodeHighlighter,
                 and the code colours
                 → the only codemirror, @codemirror, @lezer and @replit import
src/plugins/     every plugin, one folder each; manifests.ts lists every built-in manifest, keymap.ts holds
                 every built-in default key, main.ts and page.ts the parts each root starts
  sessions/      manifest.ts, contract.ts, main/ (the session list — rows, the selected session, tool routing — relay,
                 endpoint files, MCP adapter → the only @modelcontextprotocol import), page/ (Sessions mode: the
                 sidebar and each session's tabs)
  forms/         manifest.ts, contract.ts, main/ (the round form type, its MCP tools, layouts, the preview
                 round), page/ (the Form tab), layouts/ (the Layout contract and the built-in `default` layout)
  primer/        manifest.ts, contract.ts, main/ (the feature primer form type, its MCP tools, fixtures),
                 page/ (the Primer tab: the task rail, the task card and the review pane)
  docs/          manifest.ts, contract.ts, main/ (the index source registry, docs index runs, file changes inside
                 the indexed folders only and never to a third-party doc, watching the open file, the git statuses
                 of marketplace clone plugin files), page/ (one docs view per source — tree under Starred, Mine and
                 Third-party roots by the index's `owner`, rendered doc with its status chips, document editor —
                 shown as Docs mode over the machine's index, its tree in the side
                 bar, and as a split of tree and doc in each view `addView` hands out, each session's Docs tab
                 among them)
  backlog/       manifest.ts, contract.ts, main/ (the follow-up files, plans and features of every features home,
                 read through docs' index and written through its guard, file watching, each in-repo home's
                 uncommitted state and its Commit), page/ (Backlog mode: repos and homes in the side bar, the
                 follow-up list with its editor, read-only plans and features, `docs/features/backlog/design.md`)
  chat/          manifest.ts, contract.ts, main/ (owned sessions' agent processes and chat entries, the
                 permission_prompt MCP tool, recent folders, archived sessions, resume, sign-in), page/ (the
                 Chat tab with its attached images and image viewer, app slash commands and the sign-in dialog,
                 the start prompt with its folder, profile, sign-in and session steps), layouts/ (the chat Layout contract
                 and the built-in `default` chat layout)
  keys/          manifest.ts, contract.ts, page/ (which-key, the help overlay, the status bar's key list, and the
                 keys-for-command lookup it exports); no main part
  gallery/       manifest.ts, page/ (Gallery mode: every primitive in every state, a transparency switch, and a
                 swap of the shell to a test layout); no main part
  settings/      manifest.ts, contract.ts, main/ (the userConfig reads and writes, `Cmd+,`), page/ (Settings mode:
                 a form over every setting and every command's binds, `docs/features/settings/design.md`)
```

Each Claude Code or Codex session runs the marketplace's `relay.py` (`plugins/wigley/scripts/forms/` in
wigley-ai-marketplace, whose README states the tool contract, the saved-round file format
the `retro` skill reads, and the relay's side of the channel). A change to either contract
lands in both repos together. Each relay connection is one agent session, owned by the `sessions` plugin; every
connected session has a row in the sessions sidebar until it disconnects or the user closes the row. A session the
app starts (`open`) is an owned session: its row exists from start, the relay connection whose hello carries its
host session id joins that row instead of adding one (a newer relay takes the join from an older one still
connected, as when the harness restarts its MCP connection), and the row ends when its owner ends it: chat keeps a
self-ended session's row, its Chat tab showing the ended composer in the `chat.ended` key scope, until the user closes
it or resumes that session's conversation, which closes the ended row first. A plugin's close
guard (`addCloseGuard`) refuses the user's close while the plugin still has something open there (forms: an open
round; primer: an open primer), since main, not the page, decides.

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
  handle sets the title bar's context. In a window too narrow for it the side bar opens over the content, and a plugin
  calls its handle's `picked()` when the user picks something in its side bar, which closes that overlay. The core tells the
  shown mode when its side bar hides (`sideBarHidden`) or opens over the content (`sideBarOpenedOver`), and its plugin
  moves focus out of or into the side bar there; a window narrowing hides it without telling, so focus survives a
  narrow-and-widen round trip. A hidden mode keeps its state,
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
  Tab, Enter, Escape and chords still reach its scope's binds (`textBoxInput`, `src/shared/page/text-box.ts`, which docs and settings share). An editor key carries a scope as a page key does and runs only while
  that scope is in force, so two plugins' editors may bind one vim key in different scopes. It fires in normal mode,
  or in insert mode with `mode: 'insert'` (one key the host can type unbound, today only `<CR>`, as in the chat
  picker's filter). Vim keeps one mapping per key sequence and mode for every editor, so a sequence bound in any
  scope runs nothing in the others (the page logs `<keys> has no bind in <scope>`; an insert key types as it does
  unbound, Enter breaking the line), and startup fails on two binds in one mode with the same keys in overlapping
  scopes or on keys that begin another same-mode bind's longer keys in any scope. Esc while a sequence waits cancels
  it and runs nothing.
- **Debug and testing keys** sit under `Space z`, so everyday keys stay clear of them (forms' layout preview is
  `Space z l o`, the gallery's `Space z g`, which shows Gallery mode, and its `Space z s`, which swaps the shell to a
  test layout and back).
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
  which prints a chord for the platform the served config names: on macOS the modifiers and Return, Tab, Esc,
  Backspace, Delete and the arrows as glyphs (⌃ ⌥ ⇧ ⌘, ↩ ⇥ ⎋ ⌫ ⌦ ← ↑ → ↓) and every other named key, Space
  included, by name; elsewhere as words. Help prints intercepted chords (`chordName`) and accelerators
  (`formatAccelerator`) the same way. The core and the editor
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
  fixed keys (`parseRound`, `readFormBody`, the answers payload) and the per-kind records: `ROUND_ITEM_LISTS` and
  `FINGERPRINT_LISTS` in `round.ts`, `ROUND_ITEMS` in `page/form-state.ts`, and for an answerable kind `ANSWER_LISTS` in
  `round-type.ts`, and `ANSWER_ARRAYS`, `PICK_ANSWERS` and `RECOMMENDED_PICKS` (what Enter accepts) in
  `form-state.ts`, then its card input and kit parts in the Layout contract (`layouts/layout.d.ts`), the page's
  layout tables (`KIT_BUILDERS` in `page/layout/card-kit.ts`, `CARD_KINDS` in `read-layout.ts`, `LayoutPart` in
  `layout-resolver.ts`) and its card in the `default` layout. The order lists are plain arrays the compiler cannot
  check: `formats.test.ts` fails when main's `ITEM_KINDS` or `ANSWERABLE_KINDS` misses a kind, and `RAIL_ORDER` in
  `form-state.ts` is added to by hand.
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
  Defect words. Every finding card shows all its choices grouped under the action each one names (`fix_now` when it
  names none), numbered down the card, and an action with no choices takes one number on its own header; picking a
  choice or a bare header sets the action, so choice and action are one pick. The recommended pick is tagged
  Recommended in the accent, and Accept (Enter) takes it: the user ruled out folding the alternatives away, since
  it biased answers toward the recommendation. A deferral action shows its `action_reasons` entry under its header;
  the tool asks for the entry of the recommended action, and accepts one for any deferral action the origin offers.
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
- **An agent form type** — a kind of form an agent opens and waits on, forms' round and the feature primer today —
  is an `AgentFormType` (`src/contracts/agent-forms.ts`): how to parse the agent's args, fingerprint them, read the
  page's body back and build each reply payload. Its plugin hands the type to the shared service in
  `src/shared/agent-forms/`, which owns the one open form per session, the deadline, re-attach, hand-back and the
  saved-form files, and adds only its own MCP tools and page.
- **An agent form source** — MCP today, the wigley harness next — is an adapter that calls the form type's
  `AgentFormService`; it never reaches the store, the deadline or the window directly. It reads saved forms only
  through a function the composition root injects, as the layout preview reads saved round args through `savedArgs`.
- **A docs index source** — the machine index, one per live session today — is an `IndexSource` registered through
  the `docs` main export `addSource`, which returns a Disposable; the source's entries feed the docs write guard while
  it is registered. A plugin shows a docs view over a source through the `docs` page export `addView`, and opens a
  doc in Docs mode with `openDoc`.
- **An MCP tool** is contributed to the `sessions` plugin by the plugin that runs it, with a handler per session;
  sessions writes every contributed tool into `tools.json` and routes each call by tool name, so its MCP adapter
  names no tool.
- **An ambient service** — the clock, ids, the home folder, files (with watching), processes, git (main only), opening a link in the default browser, how the app was started (`runMode`: live, self-test or drive) — reaches a plugin
  through `api.services`, filled in by the composition root, so a test hands the plugin a fake. The page's home folder
  is the real path of main's, served in the config, so every view shows a folder under it as `~` through
  `services.homeDir`.
- **A path** is handled through `services.paths` on both sides, the `Paths` contract (`src/contracts/paths.ts`)
  with a POSIX and a Windows adapter in `src/shared/paths/`, each composition root picking one: main by the OS it
  runs on, the page by the served `platform`. Page and shared code that joins, splits or shows a full path calls it,
  and so does every path compare in either process, so no plugin writes `/` into a full path or compares paths as
  strings; main-side code may join and split with `node:path`, which follows the OS main runs on, and a Unix socket
  path, which exists only on POSIX, is written with `/` and `path.posix`. Windows paths show with backslashes and the home folder
  as `~`, accept either separator when typed, and compare case-insensitively. A path relative to a scoped `Files`
  (plugin data) stays `/`-separated on every OS.
- **A setting** is a core setting in `src/contracts/settings.ts` and `src/config/settings.ts`, or a plugin's own in
  its manifest's `settings`. Each one declares a label and a one-line description by its dotted path, in
  `settingInfo` beside its default (`src/config/settings.ts` or the manifest), which Settings mode draws as its row;
  the compiler fails on a setting with no declaration. The user overrides any of them in `settings.json` (plugin
  settings under the plugin id), by hand or from Settings mode.
- **The user config folder** is `~/.config/wigley-ai-gui/` on both OSes: `settings.json`, `keymap.json` and
  `themes/`, each holding only what the user changes. Main's ConfigStore watches it and serves every new config to
  the page over the Bridge, so everything hot reloads: plugins read `settings()` and `keys.keymap()` with
  `onChanged` rather than keeping a copy, and a setting read only when something is created (window size, the claude
  command) applies to the next one. A broken file keeps the last good config and shows the problem in the status
  bar. Code that writes `settings.json` or `keymap.json` goes through the `userConfig` main service, which runs the
  ConfigStore's check on the new layer and refuses one that fails, so a write never leaves a broken file; themes
  are written by hand. App-written state, such as split widths, goes to the `uiState` service, never to the user's config.
- **A third-party tool** gets a contract in `src/contracts/` and an adapter folder of its own; the core hands
  plugins the shared ones (editor, markdown, fuzzy matcher) as services. Swapping it is a new adapter folder against the same
  contract, and one changed line in the composition root. Reach for a maintained library behind an adapter, and the
  upstream tool's own behaviour (vim's for keys, neovim's pickers), before porting a subset or writing custom logic:
  the user picks the established behaviour every time.
- **Plugin data** — files a plugin keeps for the user, such as forms layouts — lives in the plugin's own folder,
  `plugins/<id>/` in the app instance's user data folder, so the stable and dev apps keep separate data (in the
  self-test, `plugin-data/` in the temp home; in a drive run, in the run's own home). Main reaches it through
  `api.data`, the files service scoped to that folder, which refuses a path outside it. The page loads a file from
  it by the URL `api.dataUrl(path, revision)` builds on the `wigley-data:` scheme, which the page's CSP allows for
  scripts and styles; `revision` sits in the URL's path, so a changed module and every relative import under it load
  fresh.
- **A layout** is a plugin's user-editable look: the shared registry (`src/shared/layouts/`) and loader
  (`src/shared/page/`) take the plugin's data folder, contract text, default layout and validator, and each plugin
  keeps its own contract and built-in `default`. Forms' layouts draw the forms view and chat's build chat entries, a
  chat entry's layout reading the entry's raw events for anything the entry does not name. The registry watches every
  layout folder and announces the set of layouts, each with its own revision, so saving one reloads only that one;
  the user's layout is a plugin setting (`forms.layout`, `chat.layout`, `default` when unset). The root of every
  card and pane a layout draws carries `data-layout="<name>"`, and each loaded layout gets its own stylesheet link,
  so a layout's CSS selects under its own name and restyles nothing another layout drew. A loaded layout stays
  available while its revision is current, so a round naming one another round loaded draws with it at once.
- **A chat layout** builds each entry kind's element from the entry and a `ChatKit`
  (`src/plugins/chat/layouts/layout.d.ts`): `markdown`, `json`, `expander` (a collapsible card), `collapsibleCard`,
  `card`, `statusDot` with `setDotStatus`, `sectionHeader`, and `permissionActions` (Allow once / Deny with their
  keys), and `images` (a user entry's thumbnails, which open the image viewer).
- **A forms layout** draws the forms view: a card per item kind (`question`, `finding`, `notice`) and the `head`,
  `rail` and `review` panes. Its contract is `src/plugins/forms/layouts/layout.d.ts`: the input for each card and
  pane, and the kit of ready-made parts (sections, grouped choices, answer controls, verdict, rail entry, review row,
  round note, send and cancel buttons, other plugins' card parts (`contributedParts`), the plain parts `card`, `tag`,
  `kbd`, `button` — variant and `keys` — and `sectionHeader`, and `command(qualifiedId)` and `keysFor(qualifiedId)`
  for any plugin's command), each of which keeps itself up to date. The app keeps which item is selected, the keys,
  scrolling, the split width, the status bar line and the cancel dialog. The built-in `default` layout is
  `layouts/default/layout.js`, plain JS that `// @ts-check` types against that contract; it defines every card and
  the rail and review panes, and draws the forms look. The user's layouts are folders in forms' plugin data,
  `layouts/<name>/layout.js` and an optional `layout.css`, and the app writes `layouts/layout.d.ts` there at every
  start; a user layout defines only the cards and panes it changes.
  - **Which layout draws what:** a card comes from the first layout defining its kind among the item's `layout`,
    the round's `layout`, the `forms.layout` setting and `default`; a pane the same way without the item. One page
    module resolves this, so round-view names no layout. An `ask_round` naming a layout missing from the folder
    fails with the names the folder holds. A user layout counts as missing until the layout registry has listed it,
    which briefly it has not at app start and just after a new layout folder is written, so an agent retries such a
    refusal once.
  - **An agent wanting a look no layout has** writes a new layout folder, names it in the round, and lists each
    layout it wrote or changed in a notice on that round, so the user sees the file while its look is on screen.
  - **Reloads:** saving a layout's code (`.js`, `.mjs`), style (`.css`), data (`.json`), image or font files redraws
    the open rounds and keeps every answer; editor swap and lock files do not. A card or pane that throws falls back
    to `default`, and a reload that fails keeps the last good version of that layout.
  - `Space z l o` opens the preview round in the user's layout and selects its row; the round sends nothing and
    raises no notification or badge.
  - **Other plugins** reach the forms view through the page exports (`FormsPageExports` in
    `src/plugins/forms/contract.ts`): `activeRound`, `answers`, `addCardPart` (drawn where a card calls
    `kit.contributedParts`, else at the card's end) and `addReviewColumn` (one `span.review-cell` per review row). The
    page emits `roundShown`, `answerChanged`, `roundFinished` and `viewChanged` (`FormsPageEvents`, from
    `page/forms-events.ts`), each logged as `[forms] event <name> …`.
- `npm run lint` runs `scripts/check-layers.mts`, which fails on an import crossing a boundary its `LAYERS` table does
  not allow. A new layer, adapter or plugin folder gets a `LAYERS` entry, and the composition root's entry lists it.
  Every plugin's `page/` layer and `src/shared/page` may import `src/shared/page/ui`.
- It also runs `scripts/check-styles.mts`, which fails on a raw colour, length, duration or font stack in CSS or an
  inline style under `src/`, and on `backdrop-filter` outside `src/shared/page/ui/materials.css`. It judges every file under
  `src/` and takes no argument.

## Running and testing

- **The stable app and the dev app** run side by side, so the user keeps working in the stable app while editing
  and testing the repo. A packaged app is the stable one; `npm start` is the dev one. `main.ts` decides this once,
  from `app.isPackaged`, as the app instance (`src/contracts/app-instance.ts`):

  ```
                      stable (installed)                 dev (npm start)
  shows as            Auri                               Auri Dev, with a Dev tag in the title bar
  user data, lock     <appData>/wigley-ai-gui            <appData>/wigley-ai-gui-dev
  relay endpoint      ~/.agents/wigley-ai-gui/           ~/.agents/wigley-ai-gui-dev/
  global shortcuts    registered                         none
  user config         ~/.config/wigley-ai-gui/, shared by both
  ```

  An agent session's relay finds the stable app by default. The dev app gets rounds from the sessions its own Chat tab
  starts, which the app points at its endpoint folder, and from a session started with `WIGLEY_AI_GUI_ENDPOINT_DIR`
  set to the full path of `~/.agents/wigley-ai-gui-dev` (the relay expands no `~`). The self-test's user data is
  `<appData>/wigley-ai-gui-selftest` and a drive run's its run folder's `user-data/`; a drive run points its Claude
  sessions at `<run home>/.agents/<instance id>`. "Auri" is only the name the app shows (`app.setName` at start,
  for the Mac app menu's items): the exe, the bundle and every path keep `wigley-ai-gui`. Under `npm start` the Mac Dock still says Electron, since Electron cannot rename
  the Dock label of an unbundled app.

- `npm run install-app` builds and installs the stable app from a committed ref (`main` unless `--ref` names
  another). It packages in a build-only worktree beside the repo, `../.wigley-ai-gui-build`, so neither
  uncommitted edits nor the dev app's `.vite/build` are touched, and runs `npm ci` there when its `node_modules` is
  missing or the lockfile changed since the last one. It copies the packaged app beside the install while the
  stable app still runs, then quits that app (Windows refuses to rename a running exe's folder), never
  force-killing it: one still running after 15 s fails the install and leaves the installed app untouched, the
  staged copy waiting for the next run, which deletes it. Then it swaps the copy in for
  `%LOCALAPPDATA%\Programs\wigley-ai-gui` (with a Start menu shortcut named Auri) or
  `/Applications/wigley-ai-gui.app`, and starts the app again when it was running. Each OS builds its own app; a
  locally built app needs no signing identity. On macOS, packaging rewrites the bundle's shown names
  (`CFBundleName`, which the menu bar shows, and `CFBundleDisplayName`) to Auri in `Info.plist`, renames the
  `wigley-ai-gui Helper*.app` bundles to `Auri Helper*.app` (Electron finds its helpers by `CFBundleName`), and
  re-signs it ad hoc (`forge.config.mts`'s `postPackage`), which refuses an `osxSign` config. The
  installed app's icon is `assets/icon/` (`icon.ico`, `icon.icns` and `icon.png`, drawn from `auri-source.png`),
  which `node scripts/make-icon.mts` rebuilds on Windows (`make-icon.ps1` holds the crop); the dev app keeps Electron's icon.
- Node is pinned in `.nvmrc`. A shell that started on another version runs commands as
  `source ~/.nvm/nvm.sh && nvm use && npm run …`.
- `npm test` runs the Vitest suite: every module whose correctness follows from inputs and outputs — round
  logic, saved rounds, answer state, markdown, theme loading, the keymap — is tested there, without Electron.
- `npm run selftest` is the agent's loop, and the user allows the agent to run it any time. It renders the window
  offscreen as an accessory app, so it never takes the user's foreground; the core's driver (`src/main/selftest.ts`,
  its step runner in `src/main/selftest-runner.ts`) runs the script a plugin hands it — the forms plugin's opens
  fixture sessions through `sessions` and their rounds through `FormsService` — drives keys with
  `sendInputEvent`, checks the lines each step adds to the page's log and the result the script checks, and exits
  non-zero on a failure. A key behaviour the agent adds or fixes gets a step in its plugin's self-test script
  (`src/plugins/forms/main/selftest-script.ts` for forms, `src/plugins/primer/main/selftest-script.ts` for the
  primer); a step with no keys waits for its line, and a step's
  `writeFile` writes a file under the self-test's temp home before its keys, as an outside change on disk, and a
  step's `screenshot` (a lowercase name in words joined by `-`) saves a PNG of the window, once the step's line has
  been waited for, to `.selftest/screenshots/<plugin>-<name>.png` (git-ignored, emptied when the self-test starts)
  for the agent to check against `DESIGN.md`. A script's steps sit in named groups, each with a `why` saying what
  the group proves, and a step may add its own `why`; the report prints `group <plugin>: <name>` before the group's
  steps, and a failed step prints the group's why and the step's own. The groups are checked when the handover
  closes, once every part has started: a blank or repeated group name, a blank `why`, a bad `width` or a bad
  `repeat` fails the self-test before any step runs. A step's `width` (a positive whole number, or `'start'`, the
  width the self-test began on) sets the window's content width before the step's write and keys and holds it, the
  fit check returning to it, until a later step sets another or the script ends; every script starts and ends on the
  start width. A run a reload interrupted does not restore the width itself: the next run resizes back on opening. A
  step's `repeat: { until, max }` presses its keys again after each `expect` line until the `until` line is logged;
  the first press counts toward `max` (a whole number of at least 2), and passing the cap without `until` fails. It
  reports one line, `<keys> ×<presses> -> <until>`, and its `screenshot` saves one PNG per press,
  `<plugin>-<name>-<n>.png`, file n after press n. The self-test's user config folder sits in its temp home. The
  script's `settings` override plugin settings in the config main serves the page (forms' sets a short
  `keys.whichKeyTimeoutMs`, so a step can wait out the panel); main parts start on the ConfigStore's config, which
  under the self-test is the empty config folder in its temp home, so the defaults, with no script `settings` over
  them. Each plugin hands at most one script, and the scripts run in plugin start order; the keys plugin has no main
  part, so its steps live in forms' script, whose fixture gives them scopes full of binds and a box to type in. The
  gallery has no main part either, so its steps live in forms' and docs' scripts. Chat's script runs its sessions
  over the fake agent harness, its steps covering the resume list, archive and slash completion. Docs'
  (`src/plugins/docs/main/selftest-script.ts`) runs over a fixture (`selftest-fixture.ts`) that writes docs, an
  index and a stand-in `docs_index.py` into the temp home at start when the home holds none yet, and again at each
  script run, so its steps never reach the user's docs or index. Settings'
  (`src/plugins/settings/main/selftest-script.ts`) drives the form over the temp home's empty config folder, its
  steps editing `settings.json` and `keymap.json` through the form and, as outside changes, through `writeFile`. The
  self-test emulates page focus as a drive run does, so a focus-dependent check can be a self-test step.
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
- Under `electron-forge start` the page usually loads twice at startup: Forge's dev server reloads every connected
  page when a build lands after the page connected, which nothing guarantees. Code that acts on page load runs on
  every load, as the self-test does. Main numbers each load by the window's navigation count, 1 for the first: the
  self-test prints `[selftest] page load <n> starts its run`, and a drive run's `ready` returns `load`.
- Every `electron-forge start` (a dev drive run, the self-test, the user's `npm start`) empties and rewrites the one
  `.vite/build` and bakes its own dev-server URL into `main.cjs`. Two starts that overlap launch Electron on a
  missing `main.cjs` (Electron's "Error launching app" dialog, on the user's screen) or point one app's page at the
  other's dev server. Dev drive starts (`start`, `restart`) and `npm run selftest` take `.drive/start.lock`, which
  holds the taker's pid, from just before the spawn until the app reports load 2, past the startup reload that
  re-reads `preload.cjs` from `.vite/build`: a drive start asks `ready` until it does, the self-test reads its page
  load lines. A page with no reload 10 s after load 1 reported releases the lock anyway, and a reload later than that
  can still read another start's build; the self-test also releases when its child closes, and a packaged drive start
  skips the lock. A start that finds a live holder prints `Waiting for another dev start (pid <pid>) to finish`; a
  dead holder's lock is cleared; after 120 s the start fails naming the lock's absolute path to delete when no start
  is running. The user's `npm start` is outside it, so work that runs drive checks beside a peer's runs in a
  worktree, which has its own `.vite`.
- A session's `ask_round` schema is fixed when the session starts, so after a change to the forms tool contract the
  running session still offers the old shape. Take the fields the server now requires from its error, and send a
  sample round that needs the new schema from a new session.
