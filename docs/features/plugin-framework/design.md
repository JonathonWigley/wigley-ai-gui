# Plugin framework — settled design

**Contents**

- **Plans** — the three plans and what each lands.
- **Core and plugins** — what the core owns, what a plugin is, and how plugins talk.
- **Shell and areas** — the permanent areas and who fills them.
- **Sessions (plan A2)** — tabs as agent sessions, the relay, tab lifecycle.
- **Keymap (plan A2)** — the user's new keys, from the keymap rounds.
- **Keys plugin (plan B)** — the `keys` plugin, all page but a main part that registers its layouts: which-key, help on `Space ?`, the leader search on `Space /`, the `showHints` setting and the placement check; the core holds the scope stack and draws the key hints that replaced the bar.
- **Foundation sweeps (Wave 1)** — stopping a plugin, who undoes each registration, typed dependency keys, scoped logs, tool contributions in live sessions, derived layer rules.
- **Commands and state (Waves 2 and 3)** — command arguments and routing, slots and where they live, slots versus events, what clicks and page reloads do.
- **Hot reload (Wave 4)** — the closed bridge, core services that stay fixed, live stop, start and restart, the `ready` and `mayStop` hooks, the live enable switch, and quit waiting for every stop.

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
- Plugins may publish their own events for other plugins to listen to. One event bus per process; the core has no
  events of its own, and a part that needs its siblings started uses `ready()` (§ Hot reload (Wave 4)); a plugin's
  cross-process messages use its own channel. The bus lands in A2, where sessions publish the first events.
- Every built-in plugin starts at launch unless the core setting `plugins.disabled` names it; the list arrived with
  the chat bar's optional views (`docs/features/chat-bar/design.md` § Optional plugins). The list also applies live,
  through the switch (§ Hot reload (Wave 4)).
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
  fill: forms fills it while a round is open, chat later. Since the form popup plan, a round and the primer show in a
  session popup over the session's tabs, not in a tab (`docs/features/session-popups/design.md`).
- The sessions plugin owns the relay: each relay connection is a session, and plugins contribute MCP tools to it
  (forms contributes `ask_round` and `collect_last_round`; the primer's tools are the named second set). The tool
  list `relay.py` answers when the app is closed lives in wigley-ai-marketplace; A2 leaves that repo alone.
- A session gets a tab when it first sends a round; the tab stays, showing the session idle between rounds, until
  the session disconnects or the user closes it.
- A session is labelled by its project folder, numbered when two sessions share one (`wigley-ai-gui 2`); while a round is open the session's row tooltip adds `<round heading> <answered>/<total>` after the label, as the row part forms contributes.
- Cmd+W, `Space ;` and `<Leader>;` (in a box) close the session tab. With a round open that is not being sent they cancel the round and close the session at once, with no confirmation, and the session's own process ends with the row. A round being sent keeps the session.

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
- The fold keys `zM` and `zR` do not exist, and a card's context and its choice reasons are always shown.
  `za` is bound in forms: it opens or closes the cursor's notice line (`forms.toggleNotice`).

## Keys plugin (plan B)

Landed as one page-only `keys` plugin (depends on no plugin) holding which-key and the help overlay; it has since gained a
main part that only registers its layouts (`src/plugins/keys/main/start.ts`). Key
hints in place later replaced the plugin's bottom key list: the core keys API's `anchor` (`PageApi['keys']`) draws a
command's keys into an element a view names, and the plugin's `showHints` setting (`"keys": { "showHints": false }` in
`settings.json`) tells the core to turn the hints off; with the plugin stopped or disabled, hints show. The title bar's Keys button, which opens help, is the plugin's too
(`docs/features/key-hints/design.md`).

- Which-key opens `whichKeyDelayMs` (200 ms) after a prefix key (the leader), as a full-width glass shelf on the
  window's bottom edge, listing what can follow in up to four columns; it redraws at once on a deeper prefix and closes when the
  sequence ends or on Esc. `whichKeyTimeoutMs` (default `null`,
  wait for the next key or Esc) ends a sequence the shelf has shown that long. A group's label and `›` draw in the `accent` colour and an action's label in `fg-secondary`, from the
  `which-key-prefix` and `which-key-command` theme tokens.
- It also opens inside a box in vim normal mode: `@replit/codemirror-vim` 6.4.0 keeps the typed keys in
  `getCM(view).state.vim.inputState.keyBuffer` and fires `vim-keypress` per key and `vim-command-done` when the
  pending input clears; the editor adapter reports them through `EditorHost.onPendingKeys` and `cancelPendingKeys`,
  and a test fails if an upgrade drops that state. The remaining keys come from the app's own keymap, not vim's.
  A count-prefixed sequence (`3 Space`) gets no shelf.
- `Space /` opens the leader search: the shared list picker over the leader actions in force, which runs the pick
  with its arg.
- `Space ?` (`<Leader>?` in a box) opens the full help overlay; bare `?` is freed. Help lays the `help` scope
  (`keys.help`, Esc closes) over the page's scope with `api.keys.pushScope`, and closes itself when the scope under it
  changes (the `PushedScope`'s `onBaseChanged`), so a prompt such as chat's end-session confirm shows at once.
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
- **Stop now, reload later.** `stop(id)` lands in Wave 1, and quit uses it for main parts in reverse start order, so
  disposal has a real caller. Wave 4 added the live `start`, `restart` and the enable switch on the same stop; a reload
  with new code waits for the runtime loader. A stop at quit leaves what must outlast it: chat's stop detaches the
  processes the session host keeps (`docs/features/session-host/design.md`), and main sends the page no plugin message
  from the first quit task on, so rows those stops end stay in the page's saved panes and recency.
- **Typed keys per process.** `dependsOn` splits into `main` and `page` lists, so an edge only the page uses (workflow-heavy
  on docs) no longer orders or blocks the main part. A list still names a plugin whose events the process only
  hears, since start order is how a listener exists before the first emit.
- **Scoped logs on both sides.** Most hand-typed log sources were on main, so both processes get the scoped log.
  Sessions' relay lines log as `[sessions]`. A `child` sub-source was rejected, since only sessions had one.
- **Tool lists change live.** A contribution and its disposal reach every live session with
  `notifications/tools/list_changed`, which Claude Code honours (code.claude.com/docs/en/mcp, Dynamic tool updates).
  The relay in wigley-ai-marketplace advertises `listChanged` when it answers `initialize` for an absent app, since its
  replayed handshake drops the app's own answer.

## Commands and state (Waves 2 and 3)

Settled in the 2026-11-04 interview for Waves 0, 2 and 3 of `docs/features/intent-alignment/master-plan.md`. Waves 0,
2 and 3 have landed and their plan folders are gone.

- **One argument per command.** A manifest declares it as a number, a string or a small record of those. Plugin code
  runs an argument command through a typed `CommandKey` from `contract.ts`, and a `keymap.json` bind carries an `arg`
  checked at load. A free-form argument was rejected because every handler would cast. Strings only was rejected
  because the session-and-box sites would pack two values into one string.
- **Commands run from either process.** The core routes a run to the process that declares the command, so a click and
  a palette entry have one path. Each plugin's channel bridge for this went. `intercept` and `onDidRun` work in the
  process that runs the handler. A handler returns nothing or a promise: a command acts, and a query reads a slot.
- **The command catalog is a slot.** Runtime commands and binds sit in core slots, one per process, and main merges them
  into the served config. The binds form a layer under the user's `keymap.json`, so the user's binds still win. This
  is why the registry landed before the command API.
- **A slot holds a value a late reader wants.** Its change notice replaces any matching event. An event marks a moment
  (turn finished, doc saved). Publishing both for every change was rejected: two paths carry one change.
- **All slots live in main's memory, page-owned ones included.** The page takes a snapshot before its parts start and a
  sequence number orders every later change, which replaces the hand-written race rules chat, sessions, agents, usage, workflow and unity-pool kept for it. Each process-held store was
  rejected because Wave 3 would then need a second store for reloads. Writing every slot to disk was rejected because
  chat entries would duplicate the transcript. Durable data stays in plugin data and `uiState`.
- **Slot values are JSON.** Processes, resolvers, timers and watches stay in the owner's closure, and the owner rebuilds
  them on start.
- **Chat entries stay whole.** A keyed list slot adds or replaces one entry by id, so the wire traffic is what it was
  before the registry. Text deltas were rejected for now: they add an operation type and replay rules against a cost
  nobody has measured, and they can come later behind the same slot.
- **A slot outlives its owner's stop.** The next start publishes the same key, reads the last value and rebuilds from
  it. A key another live part holds throws, and a page load releases the previous page's claims. A disabled or
  never-started owner reads undefined, and the live switch empties a switched-off plugin's slots (§ Hot reload (Wave
  4)). `sessions.activity` clears itself at a page start, since each source sets its activity again, and
  `sessions.active` goes back to null until the first panes are placed.
- **Soft reads.** A manifest's `reads` list allows a slot read, or hearing an event, with the contract import and no
  start order. `dependsOn` stays for exports and for needing the other plugin started first.
- **Forms' and primer's rounds stay on their channels.** Their owners' state is mostly live `ask_round` calls, so a slot
  would hold a partial copy.
- **Every click that changes anything runs a command.** Cursor moves and section collapses count; drags and focus
  guards do not. A partial sweep would have made the standing rule false from the day it landed.
- **`kit.button` takes a command and an optional argument.** A layout wanting something else writes its own listener by
  hand, knowingly. No layout in the user config folder relied on a closure when this was settled.
- **A click that behaves differently by what it hits is one command per behaviour.** An argument has no optional
  fields (`checkCommandArg` checks every field of a record), so an absent field is `''` or `0`. Docs' Recent rows
  reopen the shown doc while a section link scrolls within it, so `docs.openRecentPage` and `docs.openDocAt` stay two
  commands. One command whose behaviour hangs on an absent field was rejected: the argument check cannot express it.
- **A command that needs an argument lists only when a key binds it.** Settings shows one row per bound
  argument, because a row id means nothing in a list. Help and which-key keep one merged line, such as `1–9 pick the
  numbered choice`. `keymap.json` can still bind any of them.
- **A page reload keeps the user's work and place in every plugin:** chat's draft and images, forms, primer, docs with
  its unsaved edits, notes, backlog and settings, and sessions' selected tab and hidden popups in each session; a
  round or primer the last page showed comes back in its session popup. Page slots write on each change. The 400 ms autosaves that go to main flush on `pagehide`. Limits stand, each a follow-up in `followups.md`:
  among them, an open markup session in notes or forms does not return (the fields do), box focus and vim insert mode
  do not return, a Settings row's open edit box loses its typed text (cursor and filter return), and page slots live
  in main's memory, so an app restart loses them.
- **The two close seams each have one job.** Main's `addCloseGuard` refuses and returns the reason sessions shows as a
  toast, and it alone holds forms' and primer's open round. A tab's or popup's `beforeClose` stays for what the page
  knows or must ask (chat's confirm, the Docs tab's unsaved edits, a form being sent). One seam only was rejected: a guard in main cannot wait
  on a dialog, and a guard only on the page would break the rule that main decides.
- **The user's close key on an open round is one instant act.** Cmd+W, `Space ;` and `<Leader>;` cancel the round and
  close the session with no confirmation, chat's busy confirm included, because the user wants the session gone at once.
  Main does the cancel and the close in one step (`closeSession(id, atOnce)` runs each guard's `cancelHold` first), so
  no second pass can ask again. Only a tab or popup that says `closesAtOnce` makes the key act this way; with none,
  chat's busy confirm still asks. The Docs tab's unsaved edits and a form already being sent still hold the session, since the first
  loses work and the second has already left. Another plugin's `closeSession` call never cancels: main refuses it with
  the guard's reason. The review's Cancel prompt is a different act: it cancels the round and leaves the session open.
- **Row decoration is the row part.** Row parts and activities landed after the follow-up asked for `setBadge`, so
  `setStatus` gave way to a row part and `setBadge` is not added. A part's optional `SessionPart.tooltip` joins the
  row's tooltip, which is how a round's status shows.

## Hot reload (Wave 4)

Settled in the 2026-11-07 interview for Wave 4 steps 1 and 2 of `docs/features/intent-alignment/master-plan.md`, and
landed. The runtime plugin loader (step 3) gets its own plan, because its design rests on a reload that has run.

- **The raw bridge is closed.** The preload exposes `window.wigley` as `{ claim() }` alone. The core calls `claim()`
  once at start and gets the Bridge; a second call throws `the bridge was already claimed`, so no global holds the
  Bridge. Layouts, and later the plugins the loader reads from a user folder, reach the app only through the kit and the
  plugin API, so every call stays inside a contract and its disposal. A sanctioned power-user hook was rejected: reload
  can undo only what the API tracked, and the kit already covers what a layout needs (`kit.command`, `kit.state.read`).
  This is not a sandbox. Layouts and plugin data modules still share the page's DOM, as they must to draw. The window
  states `contextIsolation` and `sandbox` in code, so a changed Electron default cannot open the page.
- **Core services are not replaceable by a plugin.** Markdown, editor, alerts, the fuzzy matcher and markup stay
  adapters that the composition root picks. Plugins extend them through seams, such as markdown fences and the
  picker's layout hooks. Each service is built at one place in its composition root, so the app swaps a service
  everywhere by changing that one line (the user's condition). A `provides` registry was rejected for now: it adds
  start order and live swapping that no second provider needs yet, and it can come later behind the same contracts.
- **A restart takes the dependents with it.** The host stops a plugin's dependents first, then the plugin, then starts
  the plugin and every dependent it stopped, in the parts list's order with each part's dependencies first, a dependency
  whose stop is still in flight counting as not started. So a dependent may keep its view of a provider's exports for
  its whole run. A stable export proxy was rejected: every export would have to survive a restart, and a registration
  made through the old run would belong to a provider that is gone.
- **`ready()` replaces the page-ready event.** A part's start may return `ready()`. The host calls it once every part
  has started at page load, and after a live start, once the whole set that start brought up has started; a start whose
  part throws readies the parts it already started and leaves them up. A core slot or a replayed event was rejected:
  readiness is a phase of the part's lifecycle, so the host that owns the lifecycle calls it, and no part writes its own
  "already ready?" check.
- **`mayStop()` refuses a switch-off that would lose work.** A part may return `mayStop()`, which gives a reason while
  it holds open work (an open round, unsaved doc edits), in the same shape as the close guard. The host asks it before a
  switch-off, and the switch refuses with that reason. A refusal reaches the user as a `settings.json` config problem,
  `"plugins.disabled" names "<id>", which cannot stop now: <reason>`, and the switch asks again every 2 seconds until
  the part lets go or the list changes. Settings asks first, so its own pick is refused with a toast and writes nothing.
  A confirm that drops the work, and keeping the work across a switch-off, were rejected: one loses work, and the other
  keeps slots for a plugin that is off.
- **Switching off clears a plugin's slots; a restart keeps them.** A plugin switched off has its slots emptied, so a
  reader does not see stale rows, and each reader's `on` hears the change. A stop and start of the same plugin keeps its
  slots, so it starts from the last value as before.
- **The switch runs in main.** One main module (`src/main/plugins/plugin-switch.ts`) compares the disabled list on each
  config change. It stops page parts before main parts, and starts main parts before page parts, so no page part calls a
  main handler that has gone. A switch-off sets the applied list and pushes the served config before it stops any part,
  so the plugin's binds leave while their handlers still exist; a switch-on sets the list after the main parts start and
  before the page parts start. It publishes each plugin's state (label, description, on or off, and the plugins that need
  it) in the `core.plugins` slot. Config's dependency check and the lock use the same `neededBy` rule, so a refused
  write and a locked switch cannot disagree.
- **A plugin others need is locked.** Settings shows its switch as locked, with "needed by" naming the plugins that are
  on and depend on it. The user switches those off first. Switching the dependents off with it was rejected, because
  `sessions` or `chat` would take 15 or more plugins down in one press.
- **Settings has a Plugins section.** It shows one row per plugin: the plugin's label, a one-line description, and on
  or off, set with the picker the boolean settings use (`docs/features/settings/design.md` § Plugins section). Each
  manifest declares the label and the description. The raw `plugins.disabled` row is gone from Core, since its box
  would write the list without asking the switch; a hand edit of `settings.json` stays the raw route.
- **The served config follows the running set.** Help, which-key and Settings stop listing a plugin that is off: the
  served config drops its commands, binds and key scopes, and Settings' keymap schema drops the scopes too. The lists
  frozen at start are removed.
- **Chat switched off works as at quit.** The agent processes go on running in the session host, and their rows close.
  Chat switched on again joins them again, as after a relaunch.
- **Quit waits for every stop to settle**, in every run mode, however long that takes, and logs
  `quit is waiting on <ids>` to stderr after 5 seconds, naming each part still stopping. A cap was rejected by the user:
  a hung stop shows in the log, and quitting past it would cut the save the wait is for.
- **No reload key yet.** Built-in code does not change while the app runs, so the drive actions `core.stopPlugin`,
  `core.startPlugin` and `core.restartPlugin` stop, start and restart a plugin to prove the host. The loader plan adds
  the reload the user runs.
