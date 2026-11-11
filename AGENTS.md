# wigley-ai-gui

**Contents**

- **Intent** — what every change is judged by: everything a plugin, every action a command, everything drawn through a layout, everything hot reloads, macOS and Windows now,
  any agent harness or model later, one user and no backwards compatibility.
- **Architecture** — build every change for extensibility with `wigley:codebase-design`; the core and its plugins, the
  layers, the relay and agent sessions, and where a new plugin, registration, shell area, mode, session tab, key, event, setting,
  user config file, theme, plugin data, layout, agent harness, session control, agent form type, MCP tool or
  third-party tool goes, and the layer check.
- **Review** — every review recommendation taken without a form round.
- **Running and testing** — the stable and dev apps side by side, `npm run install-app` and the app icon, Node
  version, the self-test and the drive run the agent may start any time, and the checks only a real keyboard proves.
- **Dev quirks** — the startup reload, a session's stale forms schema, and the login shell's PATH and SSH_AUTH_SOCK.

UI work — a view, its CSS, a theme, a primitive, a layout or a key — reads `DESIGN.md` first: it is the standard
every view follows, and it says where a new value or primitive goes. A new or moved key also reads `docs/keymap.md`,
the rule for which key an action takes.

A user's request to change how the app looks or behaves goes into the repo's built-in `default` layout (and the
contract or kit part when the look needs one), because the user is the app's only user and wants every change in the
shipped app. Both apps read each `default`'s `layout.js` and `layout.css` live from the repo clone, so the edit shows
at once with no rebuild; CSS for parts the app draws itself still ships only with a rebuild. A user layout in
`~/.config/wigley-ai-gui/layouts/<owner>/<name>/` is written only when the user asks for one. `settings.json` can
still pick a user layout for an owner (`"<plugin>": { "layout": "<name>" }`, or the core `shell.layout`), which hides
a `default` change from the user's screen: check it before the change, apply the change to that layout too, and name
it in the report.

An Electron app (Forge 8, Vite, TypeScript) growing into a vim-first GUI over the wigley harness: CodeMirror 6 with
vim, app-owned Cmd keys and a global summon shortcut. Its live jobs: it is the only client of the `wigley-forms`
tools, receiving agents' review rounds and feature primers and showing each in a popup over its agent session's tabs
for the user to answer; and it
browses and edits every agent doc on the machine through the docs index, as a wiki over the user's own pages and as a tree of all of them (`docs_index.py`, `plugins/wigley/scripts/docs-index/`
in wigley-ai-marketplace, whose README states the index schema). It also starts Claude Code sessions itself and
chats with them in each session's Chat tab, a round from that session sliding up over the chat in a popup that hides and shows
(`docs/features/agent-chat/design.md`, `docs/features/session-popups/design.md`).

## Intent

The user builds on this app indefinitely, as a base to grow in any direction, and expects to swap any third-party
tool, change how a feature works, or add one, as a local edit. Every change is judged by how well it serves these
goals; a change that closes one off is redesigned, and an existing gap found while working is raised with the user:

- **Everything is a plugin, and everything is hookable.** The core supplies the shell, events, commands and keys,
  settings, themes and services, and nothing else. Every layout, view, event and behaviour, the core's own included,
  is something a plugin can hook into, extend or replace, and a built-in plugin has no more reach than one loaded
  from a user folder would. A closed list, switch or union that a new plugin would have to edit is an extension
  point waiting to become a registration.
- **Every action is a command, shared state is published.** Every user action runs as a command, and every state
  change another plugin reads or a page reload keeps is published as an event or slot typed in its `contract.ts`, or
  held by its own main part behind its channel (forms' and primer's rounds, notes' drafts), so a plugin can hook, bind
  or read what the app itself does. A view's private draw state stays in the view. Drags and
  focus guards stay plain listeners, and a layout wanting something else writes its own listener knowingly.
- **Everything draws through a layout.** Every surface — each plugin's views, the overlays and dialogs, the shell
  chrome — draws through a user-editable layout, so any part of the app's look changes by editing a layout file,
  without a rebuild. A new view or surface ships with its layout contract and its `default` layout
  (`docs/features/layouts/design.md`).
- **Everything hot reloads.** A changed plugin, layout, theme, keymap or setting applies to the running app without
  a restart and without losing the user's work. So every registration a plugin makes can be undone, and state that
  must outlive a reload is kept where the reload does not reach it. Today settings, keymap, themes and layouts hot
  reload, plugins start and stop live from the `plugins.disabled` switch, and a plugin in the user folder reloads with
  new code on save (A user plugin, below). A built-in's code still needs a rebuild.
- **macOS and Windows, both working now.** A platform-specific need — key binds and their labels, paths, spawning
  processes, file watching, the icon badge, the relay's transport — is an adapter behind a contract, picked in the
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
src/contracts/   interfaces and records crossing a seam, the plugin API among them (`active-time.ts`: the `ActiveTime`
                 record of a clock that counts only while something runs; `state.ts`: the `SlotKey` records, writers and
                 readers behind `api.state`, with `JsonSafe`; `core-state.ts`: the core's own slots;
                 `plugin-catalog.ts`: `CatalogEntry`, `PluginSource`, the user side's `WatchedPluginSource` and the
                 `PluginCatalog` the host, the plugin switch and the config read;
                 `list-picker.ts`: the shared list picker's contract behind `services.picker`; `system-stats.ts`: the
                 `SystemStats` service behind `services.systemStats` and its raw sample; `screen-capture.ts`: the
                 `ScreenCapture` service behind `services.screenCapture`, the windows the OS can stream); imports nothing
src/config/      core commands and scopes, default settings, the core token registry and the built-in
                 themes  → read only by main
src/shared/      implementation both processes use (CommandRegistry, the plugin host, manifest merging, the event bus,
                 theme variables, `plugin-url.ts`: the `wigley-plugin:` URLs of a user plugin's files and the path each
                 serves from, `errorText`, `formatTokens` (`182k`), the fake agent harness, `fake-fuzzy-matcher.test-support.ts`: the fuzzy matcher's test double, `active-time.ts`: the functions over an `ActiveTime`,
                 `platform.ts`: one builder of the `Platform` record per OS,
                 `command-args.ts`: `checkCommandArg`, which checks a run's argument against its manifest declaration,
                 `command-router.ts`: the run and intercept chain each process builds its commands on, over
                 `command-registry.ts`, which holds `onDidRun`,
                 `runtime-commands.ts`: the commands and binds parts add while they run, as each process's catalog, and a
                 part's `commands.onDidRun`,
                 `keys-for.ts`: the keys that run a command, as help and hints read them,
                 `plan-progress.ts`: a plan's boxes, waves, review rounds and task statuses from its plan.md and task
                 documents, and `plan-copies.ts`: a plan folder's copies across a clone and its git worktrees and the
                 moved one among them (progress unlike the main tree's and not behind it), both read by workflow-large and backlog)
  plugin-catalog/ `validateManifest` and the manifest JSON Schema: the checks a user plugin's manifest meets at load →
                 pure, no I/O
  state/         `slot-store.ts`: the slot store main's holder, the page mirror and the plugin harness share
  layouts/       the layout registry behind the core LayoutService (main side)
  layout-url.ts  the `wigley-layout:` URLs that serve layout files to the page
  visual-url.ts  the `wigley-visual:` URLs that serve a visual's document by its source hash
  visual-messages.ts the messages between a visual's frame and the page: theme in, height and `Esc` out
  sample-visuals.ts the sample UI mockup and flowchart the fake harness's `fake: visual` reply and the chat layout
                 preview draw
  file-url.ts    what `layout-url.ts` and `data-url.ts` share: per-segment encoding, scheme and revision checks,
                 and per-segment decoding that refuses an encoded `/`
  agent-forms/   the agent form lifecycle every agent form type shares (forms' rounds, the primer): the service with
                 its per-session open form, deadline, re-attach and hand-back, its optional auto-answer
                 (`AgentFormAutoAnswer`: while `isOn` holds for a session, an open call shows no form and saves and
                 returns the type's own answers at once, the file marked `auto_answered`; answers the user gave come
                 first — a re-send of the form still unfinished in the window waits on it, a finished form no reply
                 has carried is returned or handed back as usual, and a re-send of the form the user last submitted
                 gets those answers again), the wake (a form the user finishes
                 while no call waits on it sends its session a message naming the collect tool, through the
                 `AgentFormWake` the service is handed: chat's `send` for a session chat owns, nothing for any
                 other), the detach at an app quit (forms' and primer's `quit` stop: no waiting call is
                 answered and no form closes, so the relay holds each call and sends it to the next app run,
                 where a re-sent collect reopens the session's newest form an earlier connection left open and no
                 live session holds),
                 the saved-form folder and memory stores,
                 the channel and scripted presenters, the MCP tool session, the drive actions that open a
                 form type's forms in a drive run's sessions, and the layout preview helper
                 (`agent-form-preview.ts`: a form type's sample in a session of its own, its form asked again and a
                 draft waited on; forms and the primer build their previews on it) → main-side only
  paths/         the POSIX and Windows adapters behind `Paths`, picked by each composition root
  local-channel/ the local channel transport: a Unix socket on macOS, a named pipe on Windows, its path and its
                 newline-JSON framing; the sessions plugin's relay and the session host share it → main-side only,
                 no electron import
  followups/     the follow-up file module: parses a features home's follow-ups file into items (title, one line,
                 tags, body, line span, done) and turns a create, edit, tag change or delete into the file's new
                 text, in the file's own shape (triage.md § The project's follow-ups in wigley-ai-marketplace) →
                 pure, no I/O; Backlog and Docs' create dialog both write follow-ups through it
  image-types.ts the image media types the app attaches and pastes (chat and notes share it), the 5 MB base64 cap `MAX_IMAGE_BASE64`, and the helpers `extensionOf`, `base64LengthOf` and `base64Of`
  shrink-image.ts `shrinkToFit`: steps an image over the 5 MB cap down until it fits, through an `ImageEncoder` (the page's canvas adapter, or main's `services.images`)
  page/          page-only DOM builders plugins share: the paste and drop helpers (`file-drop/`: the text-paste rule, the file chip pattern, the canvas adapter behind `ImageEncoder`), the layout host
                 (`layout-host/`: showing layouts, the pick chain, drawing a part, rollback, `BaseKit` (the kit every
                 owner's kit extends, with the shared `icon`, `chevron`, `edge`, `rowTrailing`, `meter`, `sparkline`, `duration` and `state`) and
                 `ownerBaseKitDeps` (the deps an owner's base kit is built from), the markdown mount
                 (`markdown-mount.ts`: draws markdown into an element, hydrates each registered fence's placeholder
                 through its contribution, reuses a mounted fence view while its language, closed flag and source are unchanged, and
                 disposes the rest; `kit.markdown` and the docs view draw through it), `fake-visual-frames.ts` (the visual
                 frames fake plugin tests open visuals through), `layout-parts.ts`
                 (`createLayoutParts`: an owner's shown layouts and its draws, kept by slot), `app-slot.ts` (where an
                 app element sits in a part), `read-layout-module.ts` (`readLayoutParts` and `requireLayoutParts`, the
                 reader skeleton), `test-layouts.ts` (the test helpers owners share),
                 `fake-layout-state.test-support.ts` (`noLayoutState`, the `kit.state` of a kit under test that reads no slot) and
                 `fake-kit-commands.test-support.ts` (`fakeKitCommandsOf`, the commands of a kit under test, each run going to a fake)), the reducer store, autosave,
                 editor boxes, the confirm prompt, the session form popup helper, the session form status line, the
                 session form lifecycle (the open forms' reducer, the close guard, send and close from main, the page
                 events queue), and the page place slots' helpers (`place-slot.ts`: `placeWrites`, which drops a write
                 equal to the last, and `pruneKeys`, which deletes the keys of rows or forms that ended while no page
                 ran, called once the restore window settles;
                 `page-hide.ts`: `onPageHide`, which hears the page's teardown; `session-form-places.ts`: the
                 place follow, restore and prune that forms and the primer share)
                 → imported only by src/renderer and plugins' page/ parts
    pane-tree/   the pane tree: panes as leaves of nested splits, kept as proportions (`pane-tree.ts`: split, close,
                 the pane toward a direction, focus, swap and nudge → pure), and its view (`pane-tree-view.ts`: a slot
                 per pane its owner fills, drag handles, the focused border, the outer focus and resize targets); a
                 leaf is an id string, so it knows nothing of sessions; Sessions mode is its owner
    ui/          the design primitives `DESIGN.md` lists, each a builder with its CSS beside it; `icon.ts` is the only
                 module naming the Codicons font
src/main/        core main process; main.ts is its composition root
  plugin-catalog/ the plugin catalog: the one live list of plugins over a built-in source and a user-folder source (a
                 load copies a user plugin to a revision folder and imports it by file URL through `import-module.ts`,
                 main's one dynamic import), and `plugin-types.ts`, which writes the contract types to
                 `plugins/_types/`
  plugins/       the main-side plugin API: per-plugin channel routing and services; `plugin-switch.ts`: the live
                 switch over `plugins.disabled` and the catalog; `applied-plugins.ts`: the applied disabled list, the plugins whose
                 parts do not run, which the served config carries as `plugins.disabled`
  page-parts.ts  asks the page's plugin host to stop, start or check its parts, over `bridge:plugin-parts`
  quit-wait.ts   the quit's hold in every mode and its `quit is waiting on …` log
  state/         the slot holder (`slot-holder.ts`): every slot's value, page-owned ones included, in main's memory, each
                 change numbered for the page mirror; `window-focus-slot.ts` writes `core.windowFocused`
  runtime-wiring.ts the runtime commands' wiring: each process's catalog slot merged into the served config, the
                 command router's remote hop to the page
  page-commands.ts runs a page command from main and resolves when the page says it settled
  config/        the ConfigStore: watches the user config folder, layers settings, keymap and themes over the
                 defaults, and tells its listeners each new config, which main.ts pushes to the page; and the
                 userConfig service, which reads and writes the user's `settings.json` and `keymap.json` layers
                 through the ConfigStore's own checks
  themes/        theme loader: parses a theme by the token registry and resolves `extends`
  ui-state/      the uiState file: app-written view state (`ui-state.json`) in the app instance's user data folder
  alerts/        the icon badge behind Alerts: the Dock badge on macOS, a taskbar overlay dot on Windows, none on
                 Linux; the badge sums the open counts each source sets. The app raises no system notification: a
                 finished turn or an open form marks its session's row instead
  images/        Electron's nativeImage behind ImageEncoder: re-encodes an image smaller, as PNG or JPEG only
  system-stats/  the macOS and Windows adapters behind SystemStats, each reading the OS's own commands (`ps`, `vm_stat`,
                 `ioreg`, `netstat`; CIM and performance counters on Windows) and Node's `os.cpus()` into one raw
                 sample of cumulative counters, each parser a pure function over a command's text;
                 `docs/features/system-stats/design.md`
  screen-capture/ the adapters behind ScreenCapture: `screen-capture.ts` (the service over an OS window lister and
                 `electron-capture.ts`, Electron's `desktopCapturer` sources, Screen Recording access and its settings
                 pane on macOS), `mac-window-list.ts` and `windows-window-list.ts` (each lists the OS's windows with
                 owner pid and bounds in points: JXA over CoreGraphics; PowerShell over user32 and DWM, per-monitor-DPI
                 aware), `window-rows.ts` (their shared JSON row parser) and `unavailable-screen-capture.ts` (Linux,
                 whose list rejects); `docs/features/live-view/design.md`
  files/         file reads (whole as text or bytes, or the first bytes), modified times, atomic writes, append,
                 rename, trash, folder lists and watching, behind Files; on macOS any watch opening or closing
                 drops other watches' pending events, so each live watch hears `onMissed` and its caller rescans
  processes/     runs a program, killed past an optional timeout, and returns its exit code and output, or starts one
                 detached, its output appended to a log file, so it outlives the app's quit, behind ProcessRunner;
                 `limitRuns` caps how many of a runner's programs run at once (git's runner: 4);
                 `requiredStdout` runs a program and returns its stdout, rejecting naming the program when it cannot
                 run, times out or exits non-zero
  session-host/  the app's client of the session host behind SessionHost: connects, starts the host when none
                 answers, drains an older protocol's host, and hands out hosted processes;
                 `docs/features/session-host/design.md`
  git/           git adapter behind Git, over ProcessRunner: a clone's top folder, changed and unpushed paths,
                 upstream and its blobs, fetch and last fetch, a ref's commit and whether one commit is an ancestor of another, a file's text at HEAD, a clone's origin repo name, a clone's worktrees (`worktrees`: each checkout's path, branch and whether it is the main tree) and its shared git folder (`commonDir`), a log over named paths, and a commit of named paths
                 only → the only place the app runs `git`, except the Backlog self-test's fixture repo (its `init`,
                 `config`, `add` and first commit, and its `git log` check, run through `services.processes`)
  layouts/       the core LayoutService: one registry per owner over the user config folder's `layouts/`, which writes
                 `kit.d.ts` and each owner's `layout.d.ts` and sends each owner's set of layouts to the page
  data-protocol/ the `wigley-data:` scheme serving each plugin's data folder to the page, the `wigley-layout:`
                 scheme serving the layouts folder, the `wigley-plugin:` scheme serving each user plugin's revision copy, and the `wigley-visual:` scheme serving each visual the page hands
                 over (`visual-documents.ts`: kept in memory by source hash, with its bootstrap script and a no-network
                 CSP header); `window.ts` refuses any frame navigation off that scheme; `docs/features/visuals/design.md`
  drive/         the drive run: the page driver the self-test shares, the commands, their HTTP server, plugins'
                 drive actions and the video recorder, over a `DrivenWindow` → no electron import
src/session-host/ the session host process, its own composition root and build entry: owns every agent process,
                 logs their pipes, ends idle ones while no app is connected → imports only src/contracts,
                 and src/shared; no electron import
src/preload/     exposes only a one-time claim (`bridge-claim.ts`, as `window.wigley.claim()`) that hands the Bridge to the
                 page's first caller
src/renderer/    core page; renderer.ts is its composition root
  shell/         the shell registry, its areas and the default `ShellLayout`, and the modes; `shell-chrome.ts` draws the
                 title bar's context, dev tag and config problems, the activity bar's items and each toast through
                 the shell's layout (`layouts/`, the `shell.layout` setting)
  plugins/       the page-side plugin API
  state/         the page mirror (`page-state.ts`: main's snapshot, then each push, and the page's own writes sent back)
                 and `core-slots.ts`, which writes `core.mode`, `core.scope` and `core.theme`
  page-restores.ts the page's restore windows behind `api.restores`, one per page load and live start: the tracked
                 restores, and when each window settles (§ A slot)
  key-anchors.ts the anchors: draws a command's keys into an element a view names (§ Key hints); `anchor-wiring.ts`
                 redraws and shows or hides them on a keymap or scope change, and `box-focus.ts` tells whether focus is in
                 a text box
  markdown-it/   markdown adapter behind MarkdownRenderer   → the only markdown-it import
  visual-frames/ the visual frames service plugins open a visual through: the sandboxed frame on the `wigley-visual:`
                 scheme, the theme posted in on load and on each change, and the height and `Esc` it posts out
  fzf/           fuzzy matcher adapter behind FuzzyMatcher: the `/` filters match with it and keep their order, while
                 the list pickers and the slash completion rank with it. Long free text (a description, a one-line
                 summary, a full path) goes by plain substring (`src/shared/matches-substring.ts`) in a filter that
                 hides rows; a list picker's label tier stays fuzzy over paths, because a picker ranks and name tiers
                 win                                                                                          → the only fzf import
  codemirror-vim/ editor (with fuzzy slash completion) and code-highlight adapters behind EditorHost and CodeHighlighter,
                 and the code colours
                 → the only codemirror, @codemirror, @lezer and @replit import
  fabric/        markup adapter behind MarkupEditor: pen, text, arrow and box drawn over an image, undo and redo,
                 flattened to a PNG                         → the only fabric import
src/plugins/     every plugin, one folder each; manifests.ts lists every built-in manifest, keymap.ts holds
                 every built-in default key, main.ts and page.ts the parts each root starts
  sessions/      manifest.ts, contract.ts (also the `sessions.rows`, `sessions.selection`, `sessions.active`,
                 `sessions.activity` and `sessions.place` slots, the last holding each session's selected tab, selection
                 count and hidden popups, `followRows`, and the row's `owner`: the plugin a row with no place in the side bar belongs to), session-title.ts (the title rules main and page share), main/ (the
                 session list — rows, their titles and project names (a registered namer's, chat's projects, else the origin repo's), the selected session, written to the `rows` and `selection` slots, tool routing — the
                 `set_session_title` tool, relay, endpoint files, MCP adapter → the only @modelcontextprotocol import),
                 page/ (Sessions mode: the sidebar, whose rows sit in project groups under Favorites and Recent sections, then
                 the sections other plugins register through `addSection`, each claiming its own rows —
                 recency order in session-recency.ts, favorite projects in project-favorites.ts, the order in
                 sidebar-order.ts, the drawing in sidebar-view.ts — the pane tree of whole sessions with its split, swap and close commands and the
                 shared list picker's `picker` scope, each session's tabs and popups (`addTab`, `addPopup`, the hidden bar), the row and bar parts other plugins add,
                 each row's activities, the rename dialog, and the layout preview rows),
                 layouts/ (the sessions Layout contract and the built-in `default` layout, with the `popup` and `popupBar` parts);
                 `docs/features/session-popups/design.md`, `docs/features/session-titles/design.md`, `docs/features/session-groups/design.md`
  agents/        manifest.ts, contract.ts, roster.ts (the pure reducer folding agent events into a session's roster),
                 main/ (hears `chat.agentEvent`, keeps each session's roster, appends each event to
                 `logs/<host session id>.jsonl` in its plugin data, the layout preview, and writes the `agents.rosters`
                 slot the views below read); draws nothing; `docs/features/agent-tower/design.md`
  agent-lines/   main/ (registers its layouts, hands the lines' self-test script), page/ (the working line
                 under each session row while it runs a subagent or task, through sessions' `addRowPart`), layouts/ (its Layout contract and
                 `default` layout); in `plugins.disabled` by default
  agent-strip/   main/ (registers its layouts, hands its self-test script), page/ (the strip of subagent and task boxes above the Chat composer's box, through chat's
                 `addComposerPart`, with a stop on chat's entry cursor), layouts/ (its Layout contract and `default`
                 layout); `docs/features/chat-bar/design.md`
  agent-skills/  main/ (registers its layouts, hands its self-test script), page/ (the session hub's Skills section,
                 through chat's `addSidePart`), layouts/ (its Layout contract and `default` layout);
                 `docs/features/chat-bar/design.md`
  context-sources/ manifest.ts, contract.ts (the `context-sources.breakdowns` slot: each session's last main-agent
                 `contextBreakdown` agent event), main/ (folds `chat.agentEvent` into the slot, deletes on
                 `sessions.ended`, hands its self-test script), page/ (the session hub's Context section through chat's
                 `addSidePart`: the sources' bar, the window's fill, a row per source that opens into its items),
                 layouts/ (its Layout contract and `default` layout); `docs/features/chat-bar/design.md` § The session hub
  live-view/     manifest.ts, contract.ts (the `live-view.picks` slot: each session's stream pick), window-pick.ts (the
                 editor window lookup, the crop and the moved check, as pure functions), main/ (the `show_live_view`
                 and `hide_live_view` tools, the window list through `services.screenCapture`, the preview sample, its
                 self-test script), page/ (live-section.ts, the session hub's Live section through chat's
                 `addSidePart` with `shrinksLast`, streaming only while on screen; stream-source.ts, the capture or
                 `sample:` stream; layout/, the layout reader), layouts/ (its Layout contract and `default` layout);
                 `docs/features/live-view/design.md`
  auto-retro/    manifest.ts, contract.ts, main/ (hears `chat.sessionClosed` and `chat.sessionCleared`, queues a user
                 close or a clear in `queue.json` in its plugin data, launches one unattended `/wigley:retro auto` session at a time through chat's `launch`, and
                 closes it through chat's `close` once its turn ends with nothing running), page/ (the Retro section
                 through sessions' `addSection`, its header's queued count), layouts/ (its Layout contract and `default`
                 layout); `docs/features/auto-retro/design.md`
  auto-compact/  manifest.ts and main/ only (folds `chat.agentEvent` into each host session's last main usage,
                 registers the send gate that compacts a cold-cache session before a message when its context is above
                 the `minTokens` setting, and gives chat the same threshold for the harness's idle compaction; reads
                 `workflow.flows` and, through chat's `compact`, compacts a workflow session once per wait when its main
                 turn ends while its subagents run and its context is above the `agentWaitMinTokens` setting, the
                 rule in `main/agent-wait.ts`); `docs/features/auto-compact/design.md`
  session-log/   manifest.ts and main/ only (hears chat's and sessions' lifecycle events, appends each to
                 `session-events.jsonl` in its plugin data, registers the Recently closed resume section through chat's
                 `addResumeSection`, hands its self-test script); `docs/features/session-log/design.md`
  session-stash/ manifest.ts, contract.ts, main/ (keeps each asked stash until its session's user close, writes it to
                 `stashed.json` in its plugin data, removes it on resume, registers the Stashed resume section through
                 chat's `addResumeSection` ahead of session-log's, hands its self-test script), page/ (`Space '`: the
                 note dialog over the focused pane's session, then sessions' `closeSession`), layouts/ (its Layout
                 contract and `default` layout); `docs/features/session-stash/design.md`
  window/        manifest.ts and main/ only (the `window.summon` command, which brings the app forward through
                 `services.window.summon`)
  claude-code/   manifest.ts (the `command` and `profiles` settings), main/ (the Claude Code CLI adapter behind
                 AgentHarness, registered through `services.agentHarnesses`: it resolves a profile's config folder,
                 lists and reads Claude's saved sessions and project folders, runs `claude auth` sign-in, sign-out and
                 status and `claude -p /usage` (the plan usage poll), asks each session for `get_context_usage` and
                 `get_settings`, and contributes Claude's `permission_prompt` MCP tool, routed to the session's
                 process) → the only place the app spawns `claude`; `docs/features/agent-harnesses/design.md`
  forms/         manifest.ts, contract.ts, main/ (the round form type, its MCP tools, the preview
                 round; the agents' service auto-answers a headless chat session's rounds with every item's
                 recommendation, outcome `auto_answered`, and the preview's never does), page/ (the round popup), layouts/ (the Layout contract and the built-in `default` layout)
  primer/        manifest.ts, contract.ts, main/ (the feature primer form type, its MCP tools, fixtures,
                 preview/: the layout preview's sample primer in a session of its own),
                 page/ (the primer popup: the tasks, items and card columns, the feature, task and item cards, and
                 the review pane), layouts/ (the primer Layout contract and the built-in `default` layout)
  docs/          manifest.ts, contract.ts, main/ (the index source registry, docs index runs, file changes inside
                 the indexed folders only and never to a third-party doc, watching the open file, the git statuses
                 of marketplace clone plugin files, the log behind Recent changes), page/ (one docs view per source — the machine view's wiki sidebar built
                 from `~/wigley-agents/wiki/Main.md`, its Main and list pages, and the tree under Starred, Mine and
                 Third-party roots by the index's `owner`, the only sidebar of a session's docs view, rendered page with its status chips, right column and section editing, document editor (takes dropped and pasted files as relative links) —
                 shown as Docs mode over the machine's index, its sidebar in the side
                 bar, and as a split of tree and page in each view `addView` hands out, the `docs-session-tab` plugin's
                 session tab among them), layouts/ (the docs Layout contract and the built-in `default` layout);
                 `docs/features/docs-browser/design.md`, `docs/features/docs-wiki/design.md`
  backlog/       manifest.ts, contract.ts, main/ (the follow-up files, plans and features of every features home,
                 read through docs' index and written through its guard, file watching, each in-repo home's
                 uncommitted state and its Commit, each item's images under the home's `followups-images/`, the
                 `load`, `tags` and `fileNote` it exports to notes), page/ (Backlog mode: repos and homes in the side bar, the
                 follow-up list with its editor, read-only plans and features, `docs/features/backlog/design.md`),
                 layouts/ (the backlog Layout contract and the built-in `default` layout)
  practice/      manifest.ts, contract.ts, main/ (the practice folder's problems through one problem store, the judge
                 that compiles and runs C++ through `services.processes`, the generated driver and prelude, progress and
                 the review ladder, the `add_practice_problem` and `read_practice_state` tools, the import and
                 interviewer sessions through chat's `launch` and `resume`, a `problems/` watch started at the first
                 list, the self-test's script and its `writeFixture` drive action), page/ (Practice mode: the problem
                 list in the side bar, the stacked problem pane, editor and console, the interviewer pane through chat's
                 `mountChat`, the import box), layouts/ (the practice Layout contract and the built-in `default`
                 layout); `docs/features/practice/design.md`
  chat/          manifest.ts, contract.ts, main/ (owned sessions' agent processes and chat entries, written to the `chat.session`, `chat.entries`,
                 `chat.controls`, `chat.commands`, `chat.queued` and `chat.returned` slots through `chat-slots.ts`, the
                 start_session and set_headless MCP tools, recent folders, archived sessions, resume, sign-in, preview/: the
                 layout preview's sample session, held with no process), page/ (the
                 Chat tab with its attached images and image viewer, app slash commands and the sign-in dialog,
                 the start prompt with its project, folder, profile, sign-in and session steps), layouts/ (the chat Layout contract
                 and the built-in `default` chat layout); `image-rules.ts` at the root holds the attach rules both
                 parts share; main exports `launch` (a background session with a first message) and
                 `defaultProfile` to notes, `send` and `profileOf` to forms and the primer (the form wake), `send`, `clear`, `launch` and `profileOf` to workflow-large, `activeTime` (a session's clock) to workflow, `isHeadless` (whether a session is headless) to forms, workflow and workflow-large, `launchedHeadless` (whether its process started headless) to workflow, `launch` (with `unattended`: every permission prompt denied at once) and `close` (one owned session, with a reason) to auto-retro, `addInstructions` (text every session chat starts carries to its harness, before `HEADLESS_NOTE` while the row is headless)
                 to visual and workflow, `addSendGate`, `addIdleCompactThreshold` and `compact` (an app compaction of an idle session) to auto-compact, `addResumeSection` (a titled list of saved sessions at the top of the start prompt) to session-stash and session-log, `addPoolProvider` (a pool project's clone folders, `docs/features/projects/design.md`) to unity-pool, `launch` and `resume` (each with `instructions`, text that one session alone carries to its harness, and `owner`, the plugin whose row it is), `defaultProfile`, `profileOf`, `send` and `close` to practice, and `launch` and `closeSessionsIn` to self-test scripts; page exports `mountChat` (a session's chat view built into another plugin's element) to practice, `addCompletionRow` (a draw for the `/` completion's rows) and `activeTime` (a session's clock), `setHeadless` (turns a session's headless flag on or off) to workflow; its page publishes the `chat.focus` slot (the visible Chat tab's focused session, entry and block), which visual reads; the `start_session` tool and workflow-large's make-in-new-session copy the asking session's headless flag into their launch; its page also draws each session's run time and profile under its row, through
                 sessions' `addRowPart` and the `rowClock` and `rowProfile` layout parts; main keeps each session's clock, `docs/features/session-clock/design.md`
  keys/          manifest.ts, contract.ts (types `KeysPageEvents`), main/ (registers the layouts only), page/ (which-key, the help overlay,
                 the leader search (`leader-search.ts`), the title bar's Keys button, and the placement check over the core's anchors), layouts/
                 (the keys Layout contract and the built-in `default` layout)
  gallery/       manifest.ts, main/ (registers the layouts only), page/ (Gallery mode: every primitive in every state,
                 a transparency switch, and a swap of the shell to a test layout), layouts/ (the gallery Layout
                 contract and the built-in `default` layout)
  settings/      manifest.ts, contract.ts, main/ (the userConfig reads and writes, `Cmd+,`), page/ (Settings mode:
                 a form over every setting, every command's binds with its key recorder (`key-recorder.ts`) and the leader tree
                 (`leader-tree.ts`, `leader-menu-view.ts`), `docs/features/settings/design.md`), layouts/
                 (the settings Layout contract and the built-in `default` layout)
  notes/         manifest.ts, contract.ts, main/ (the kept draft in plugin data, window captures through `services.window.capture`, sending a note
                 to a follow-up through backlog's exports or to a new session through chat's), page/ (the note
                 popup over any mode: fields, images, markup, target, session and follow-up pickers,
                 `docs/features/notes/design.md`), layouts/ (the notes Layout contract and the built-in `default`
                 layout)
  usage/         manifest.ts, contract.ts, main/ (polls each registered harness's profiles' plan usage, folds
                 `chat.planUsage` and `chat.agentEvent` into the `usage.snapshot` slot), page/ (the status-bar plan line, each session's context line
                 above the Chat box through chat's `addComposerPart` and its spend in the Chat status line through `addStatusPart`, its context meter and cache mark under each session row, and the right-bar details),
                 layouts/ (the usage Layout contract and the built-in `default` layout),
                 `docs/features/usage/design.md`
  usage-tab-line/ page/ only (each session's usage line in its tab bar through sessions' `addBarPart`, drawn by
                 usage's own session-line part through a usage page export, so the line has one look); in
                 `plugins.disabled` by default
  docs-session-tab/ page/ only (each session's Docs tab through sessions' `addTab`, a split of tree and page built
                 through docs' `addView`); in `plugins.disabled` by default; `docs/features/docs-browser/design.md`
  workflow/      manifest.ts, contract.ts, flow.ts (the pure fold of signals into a session's flow, run through the
                 rules of the flow's current workflow alone), main/ (the engine: hears `chat.agentEvent` and the sessions
                 events, keeps each session's flow in its plugin data and writes it to the `workflow.flows` slot, contributes
                 `set_workflow_step` and `set_workflow_checklist` through sessions' `contributeTools` (each result of a headless
                 session but an error ends on chat's `HEADLESS_NOTE`, and the first from either tool after headless turns off on
                 `HEADLESS_OFF_NOTE`: one line state per app session across tool sessions, started at the first result under each host
                 id from chat's `launchedHeadless`, the flag the session's process started with), appends a line to
                 `runs.jsonl` when a workflow finishes, and exports `addWorkflow`, which each workflow plugin calls), page/
                 (hosts the row chip, the composer strip and the side pane, each drawn through the flow's workflow's layout,
                 and the preview; exports `addWorkflow` and `createWorkflowDraw`), layouts/ (the workflow Layout contract and kit, no
                 layout of its own); it names no skill and no workflow's stages beyond idle (`IDLE_STAGE`); the strip ends on the Headless chip (`kit.headlessChip`), which runs `toggleHeadless`, and the row shows a `Headless` tag while the session is headless; the chip's `No workflow`, `Working` and `Headless` tags are the exception to
                 the layout rule: the engine draws them with no layout, since no workflow owns such a flow or the flag; `docs/features/workflow/design.md`,
                 `docs/features/workflow-levels/design.md`
  workflow-large/ manifest.ts, contract.ts, large-workflow.ts, stages/<stage>/ (one stage each: main.ts its entry rule, page.ts its look), main/ (watches every copy of a plan
                 folder across a clone's worktrees and git's shared folder, follows the copy a run reports through
                 `plan.py`'s `plan-runs/<row>.json` in the endpoint folder or its own `set_workflow_plan` tool, runs Clear & make and the auto-start countdown, its self-test script), page/ (the plan checklist,
                 the countdown, the preview samples), layouts/ (the built-in `default` layout); Large's workflow: the
                 `wigley:feature` run, make, review, fix and close
  workflow-spike/ manifest.ts, contract.ts, stages/<stage>/ (interview, build, check, land, done; build, check and
                 interview re-enter per ask), main/ (its self-test script), page/, layouts/ (the built-in `default`
                 layout); claims `wigley:spike`
  workflow-small/ manifest.ts, contract.ts, stages/<stage>/ (scope, build, check, land, done, answered), main/ (its self-test
                 script), page/, layouts/ (the built-in `default` layout); claims `wigley:small`
  workflow-medium/ manifest.ts, contract.ts, medium-state.ts (fix cycles), stages/<stage>/ (interview, build, review, fix,
                 land, done), main/ (its self-test script), page/, layouts/ (the built-in `default` layout); claims
                 `wigley:medium`
  unity-pool/    manifest.ts, contract.ts, main/ (watches `~/.local/state/unity-pool/*/state.json` into the `unity-pool.snapshot` slot, runs
                 `unity-pool hold|release` for the panel, gives chat its pools' clone folders, hands its self-test script), page/ (the clone badge under
                 each session row through sessions' `addRowPart`, the right-bar panel), layouts/ (the unity-pool
                 Layout contract and the built-in `default` layout); `docs/features/unity-pool/design.md`
  system-stats/  manifest.ts, contract.ts (the `system-stats.snapshot` slot), main/ (polls `services.systemStats` while a
                 page shows the panel, folds two samples into the snapshot with rates, groups and 60 s history, joins
                 `chat.session` pids with `sessions.rows` titles into one group per session's process tree, hands its
                 self-test script), page/ (the right-bar panel through `api.areas.rightBar.contribute` with `focus` and
                 `left`, hidden and shown by `Space v y`), layouts/ (the system-stats Layout contract and the built-in
                 `default` layout); `docs/features/system-stats/design.md`
  app-update/    manifest.ts, contract.ts (the `app-update.status` slot: none, available with its short sha, installing,
                 failed with the error), main/ (fetches `services.appBuild`'s clone every 15 minutes and on window focus,
                 decides in update-decision.ts, starts `install-app --ref origin/main` through
                 `processes.startDetached` with the per-OS line in install-command.ts, polls the exit-code file the line
                 writes, hands its self-test script over a fixture seed), page/ (the Update available button at the
                 title bar's end through `api.areas.titleBar.contribute`, shown only while the status is not none),
                 layouts/ (its Layout contract and `default` layout); the dev app bakes no commit and checks nothing;
                 `docs/features/app-update/design.md`
  visual/        manifest.ts, contract.ts, main/ (the session note it hands chat's `addInstructions`, the layout
                 registration), page/ (`html-fence.ts`, the `html` fence contribution: the "drawing visual…" card for
                 an open block, a visual frame for a closed one; `visual-registry.ts` the source of each closed
                 visual on the page; `visual-width.ts` a visual's width, the agent's wide mark and its flip;
                 `visual-overlay.ts` and `visual-commands.ts` the full-size overlay and its `v` key on chat's
                 focused entry, opening at the first visual in the cursor's block, `h`/`l` between visuals and `Esc` to
                 close, and the `w` key flipping that same visual's width),
                 layouts/ (the visual Layout contract and the built-in `default` layout);
                 `docs/features/visuals/design.md`
```

Each Claude Code or Codex session runs the marketplace's `relay.py` (`plugins/wigley/scripts/forms/` in
wigley-ai-marketplace, whose README states the tool contract, the saved-round file format
the `retro` skill reads, and the relay's side of the channel). A change to either contract
lands in both repos together. Each relay connection is one agent session, owned by the `sessions` plugin. A
connected session (one the app did not start, such as a terminal `claude` or Codex session) has no row in the sessions
sidebar until a plugin needs the user there: `mark` or `activate` adds its row, as a form opening does, and `release` closes it
again once every close guard allows, as the form presenter does after every form close, by submit, cancel or
any other close (the close guard of a session's other open form keeps the row). The user may also close the row,
which `mark` or `activate` brings back; it leaves for good when the session disconnects. A row `release` closed
while selected comes back selected when the session's next form marks it within 30 seconds (a back-to-back
round), unless the user picked another row first; later, it comes back marked. A session the
app starts (`open`) is an owned session: its row exists from start, the relay connection whose hello carries its
row id (`WIGLEY_SESSION_ROW` in the process's environment) joins that row instead of adding one, and the host
session id is set when the harness reports it (a newer relay takes the join from an older one still
connected, as when the harness restarts its MCP connection), and the row ends when its owner ends it: chat keeps
its rows through its own restart or reload, its stop `keep`ing each one for the restarted part's restore to adopt
(`OwnedSession.keep`), so the places of the session's tabs survive it, and across a relaunch, re-attaching each one whose process the session host still runs, and after a process
exits, resting until the next message, and ends one only when the user closes it (`docs/features/agent-chat/design.md` § Saved sessions). A plugin's close
guard (`addCloseGuard`) refuses a close while the plugin still has something open there (forms: an open round; primer:
an open primer), since main, not the page, decides. The user's close key ends the hold first: a tab or popup that
`closesAtOnce` has the guard's `cancelHold` cancel the round, then the close goes through with no prompt. The review's
Cancel prompt is a different act: it cancels the round and leaves the session open.

- **A plugin** is a folder in `src/plugins/<id>/`: `manifest.ts` declares its commands (each with a label, a group
  and the process it runs in), key scopes (each with the title help shows over its keys), settings
  and the plugins it depends on (a built-in plugin's default keys sit in `src/plugins/keymap.ts`); `main/`
  and `page/` each export a part, the manifest with a start function that receives that process's plugin API and
  returns the handlers for the manifest's commands that run in that process, plus `exports` and `dispose`.
  `exports(consumer)` gives each dependent its own view of the plugin's exports, and every registration a
  dependent makes through it is filed with `consumer.track`, so the host undoes it when that dependent stops.
  `dispose` undoes only what the plugin API cannot see (A registration, below). The compiler checks every command that runs in a process has a handler there and
  every key names a declared command running in the key's process (page and editor keys a page command; app,
  global and intercept keys a main one). A built-in plugin's manifest joins `src/plugins/manifests.ts`, which main
  builds the served keymap, labels and settings from, and its parts join `src/plugins/main.ts` and
  `src/plugins/page.ts`, which the built-in plugin source hands the plugin catalog (A user plugin, below). A main part starts at app
  launch and a page part on every page load, and either starts or stops live after that. The plugin host's
  `start(ids)` starts the named parts in dependency order and throws, starting none, when one depends on a part not
  started; `stop(id)` stops the plugin's dependents first, in reverse start order, then awaits the part's `dispose`
  and disposes its registrations; `restart(id)` stops the plugin with its dependents and starts them again, new
  registrations and the same slots. A main part's `dispose` hears how it stops (`PartStop`): `restart` for a restart
  or reload that starts it again, `end` for a switch-off and a removal, `quit` for the app's quit. A part's optional `ready()` runs once every part of its process has started,
  and after a live start once the parts that start brought up have started: put work that needs its siblings
  started there, not in `start`. A part's optional `mayStop()` gives a reason in words the user reads when it must
  not stop now (a round is open); the switch asks it before a switch-off, and a restart and quit do not. Quit
  stops every main part this way, waits for every stop in every mode, and logs `quit is waiting on <ids>` after 5
  seconds; from its first task on main sends the page no plugin message: those stops end rows the next start
  restores, and a page told of it would save them as gone (panes, recency).
- **A registration** — a listener, a handler, a contribution, a scope, a mode, a timer, a watch, a command —
  returns a `Disposable` (`src/contracts/disposable.ts`), so a plugin can stop and start again. The plugin API
  records each registration a plugin makes through `api`, its per-plugin service views included (timers,
  `files.watch`, `processes.run`, editors, alert counts), and the host disposes them when the plugin stops. A
  registration made after the stop is disposed at once. A plugin's own `dispose` undoes only what `api` cannot see:
  DOM listeners on `window` or `document`, observers, animation frames, and promises it still waits on.
- **A disabled plugin** is one named in the core setting `plugins.disabled`: none of its parts run, and the list applies
  live. Main's plugin switch (`src/main/plugins/plugin-switch.ts`) takes each new list and follows the plugin
  catalog: a plugin that arrives starts, one that leaves stops as a switch-off does, and one with a new entry reloads
  with its dependents (A user plugin, below). A switch-off sets the applied
  list and pushes the served config before it stops any part, so a disabled plugin's binds leave while their handlers
  still exist; it then stops the page parts (the page answers over `bridge:plugin-parts`), then the main parts, and
  clears the owners' slots. A switch-on starts the main parts, sets the applied list, then starts the page parts. A
  restart sets the plugin and its dependents as the applied paused list, whose binds alone the served config drops, and
  pushes the served config before its page stop; it clears the list and pushes again after its main start, before its
  page start. The served config drops a disabled plugin's commands, binds and key scopes (`appliedCommands`, `appliedScopes` and
  `withAppliedList` in `src/shared/plugin-manifests.ts`), so help, which-key and Settings' keymap section list none. A
  plugin that a running plugin depends on is locked (`neededBy` names the dependents), and naming it is a config
  problem, so the last good config stays. A part's `mayStop` refusal is also held as a `settings.json` config problem,
  and the switch asks again every 2 seconds until the part lets go or the list changes. Settings' Plugins section
  (`src/plugins/settings/page/plugin-rows*.ts`) switches plugins from the `core.plugins` slot, shows what locks a row,
  and drive actions `core.stopPlugin`, `core.startPlugin` and `core.restartPlugin` do the same for a run. A view that
  can be switched off is its own plugin over a data plugin that stays on (`docs/features/chat-bar/design.md` § Optional
  plugins).
- **A user plugin** is a folder in `~/.config/wigley-ai-gui/plugins/<id>/`: `manifest.json`, an optional `main.js`
  and an optional `page.js`, plain ES modules that each export a named `start(api)`, typed with `// @ts-check` against the `.d.ts` files and
  `manifest.schema.json` the app writes to `plugins/_types/` at start, and an optional `layouts/default/`. From
  `main.js` or `page.js` the types come in with
  `/** @import { UserMainApi, UserMainStart } from '../_types/plugin' */` (`UserPageApi` and `UserPageStart` for the
  page), a dependency's contract with
  `/** @import { ChatMainExports } from '../_types/plugins/chat/contract' */`, and the manifest's type with
  `/** @import { PluginManifest } from '../_types/contracts/plugin' */`; `manifest.json` names its schema with
  `"$schema": "../_types/manifest.schema.json"`. The relative path follows the file's depth: a `.js` under
  `layouts/default/` reaches `_types` by `../../../_types`. The plugin
  catalog (`src/main/plugin-catalog/`) is the one live list of plugins: it merges the built-in source and the
  user-folder source, a user plugin with a built-in's id replacing the whole built-in, and the host, the switch, the
  config schema and the `core.plugins` slot read it. `validateManifest` runs at load the checks `definePlugin` makes at
  compile time. Main imports `main.js` from a per-revision copy of the folder; the page imports `page.js` on the
  `wigley-plugin:` scheme. A save reloads the plugin once the edits settle, and `core.reloadPlugin` (no default key)
  reloads it with no change; a reload stops its dependents too. A load that fails keeps the last good version and shows the error as a
  config problem and on its Settings row. Settings and binds under a plugin that is not loaded are kept and ignored.
  Each load copies the folder to `<userData>/plugin-code/<id>/<revision>/` and no step deletes an old revision.
  A user plugin draws only through its layout kit and bundles its own packages
  (`docs/features/plugin-framework/design.md` § Runtime loader (Wave 4 step 3)).
- **A plugin talks** to its other process over its own channel (`api.channel`), typed by its `contract.ts`, and to
  another plugin through the exported API of a plugin its manifest depends on, or through events. The manifest's
  `dependsOn` has a `main` and a `page` list, each naming the plugins whose exports that process reads or whose
  events it hears there. A plugin reads a dependency with `api.dependency(key)`, where the key is the typed
  `DependencyKey` the provider's `contract.ts` exports for that process (`sessionsMainKey`, `sessionsPageKey`). The
  compiler rejects a key for the other process or for a plugin missing from that process's list. A plugin imports
  only `src/contracts`, `src/shared`, its own folder, and the `contract.ts` of a plugin its manifest depends on or
  reads, which types that plugin's exports, keys and events.
- **A slot** is a value a late reader wants, typed by a `SlotKey` in the owner's `contract.ts`: one value, keyed values,
  or keyed lists whose items are added or replaced by id. `api.state.publish(key)` gives the owner the only writer, and
  `api.state.read(key)` gives any plugin `get` and a disposable `on`; a layout reads through `kit.state.read(id)`. The
  core holds every slot in main's memory and mirrors it to the page, page-owned slots included, so the value outlives an
  owner's restart and a page reload, not an app restart. A plugin the switch turns off has its slots cleared
  (`clearOwner`); a restart keeps them. A page plugin keeps what a reload restores — a draft, a selected row, a view —
  in a `<id>.place` slot it writes as the state changes and reads at start (`chat.place` with `chat.draftImages`,
  `forms.place`, `primer.place`, `docs.place`, `sessions.place`, among others). A restore that settles after the part's
  start returns and can move the key base goes to `api.restores.track` (docs' reopened doc once its view shows, forms'
  and primer's open forms read, sessions' first placing of the panes), and `api.restores.onSettled` hears the
  restore window settle: every part its opener started ran `ready()` and none of its tracked restores is pending
  (`PageRestores` in `src/contracts/plugin.ts`). Restores belong to a restore window, which a page load or a live start
  opens: the page calls `pageHost.ready(); restores.partsReady()` once the page's parts started at load, and the
  `start` answer reopens the window before its parts start and calls `partsReady` after. A part that prunes the places
  of rows main does not hold prunes from `onSettled`, so the rows chat's restore reopens are in the mirror first. A key
  base change before the window settles is a restore's, so notes' restored popup stays open through it.
  `sessions.activity` clears itself at each page start, since its sources set their activities again, and
  `sessions.active` goes back to null until the first panes are placed. A new start publishes the same key and reads the
  last value. Slot values are JSON; what is not stays in the owner's closure. A plugin that only reads a slot or hears
  an event lists its owner in the manifest's `reads`, which carries no start order. A value belongs in a slot and a
  moment in an event. The core's own slots are `core.mode`, `core.scope`, `core.theme`, `core.windowFocused`,
  `core.agentHarnesses` (each registered harness's label and declarations, keyed by harness id),
  `core.plugins` (each catalog plugin's label, origin, whether it runs, what depends on it and its load problem, then each plugin that failed its first load) and the two runtime command
  catalogs (`src/contracts/core-state.ts`) (`docs/features/plugin-framework/design.md` § Commands and state).
- **A command** takes at most one argument, declared in the manifest as a number, a string or a small record;
  a handler reads it as `context.arg`. `api.commands.run` works from either process, and the core routes it to the
  process the command runs in. `commands.register` and `keys.bind` add commands and binds at runtime as a layer under
  the user's `keymap.json`; `commands.intercept` wraps a command and `commands.onDidRun` hears it. A bind carries the
  argument as `arg`, checked at load. A click runs a command too: a layout's `kit.button(parent, label, command, { arg })`
  and `kit.command(qualifiedId, arg)` name one by id, and a view's own click handler runs the command a key would.
- **An event** is published with `api.events.emit` under the publishing plugin's id (`closed` in plugin
  `sessions` is `sessions.closed`) and heard with `api.events.on` by any plugin; its payload type lives in
  the publisher's `contract.ts`, and the core has no events of its own: a part that needs
  its siblings started uses `ready()`. A state change a late reader wants is
  a slot, and an event is the moment: a note filed, a doc saved, a turn started or finished, a message sent, a help
  overlay opened. Each process has its own bus, and nothing crosses processes on it: a plugin's own
  channel does that.
- **The shell** is a registry of areas — title bar, activity bar, side bar, main, right bar, panel, status bar, overlay — laid
  out by one `ShellLayout` module in `src/renderer/shell/`. A page plugin may replace the layout through the shell
  API (`shell.setLayout`); every contribution it makes returns a `Disposable`, and so does replacing the layout. The
  areas are the fixed set `AreaName` names, and a contribution carries an order and an alignment. Reworking the window's structure is
  editing the default layout or adding a plugin; track sizes are theme tokens, except the side and right bars' widths, which
  open at their tokens and then are the user's, resized through the split core and kept in `uiState`
  (`shell.side-bar-width`, `shell.right-bar-width`). The right bar sits beside `main` across every mode, stays hidden
  while empty, and takes contributions through `api.areas.rightBar`; a contribution with rows to act on passes
  `focus` with it, which sets its own key scope and cursor, and `left`, which the core calls when its turn ends, and becomes a stop for the core's focus keys. In a window too narrow for both bars beside `main`,
  the side bar narrows to its least width first; the right bar then narrows to its own, and lies over `main`'s end when
  the room left with the side bar at its least width is less than its least width and `main`'s. Only the side bar
  resizes by keys; the right bar by drag alone.
- **A mode** fills the content sheet, and the core shows one at a time: a plugin registers its mode, with its icon,
  title and an optional side bar element, through the page plugin API, and binds the command that shows it
  (Sessions on `Space k s`, Docs on `Space k d`; pressed while its mode already shows, the same command toggles the
  side bar). The activity bar lists every mode, the side bar slot shows the shown mode's side bar, and the mode's
  handle sets the title bar's context. In a window too narrow for it the side bar opens over the content, and a plugin
  calls its handle's `picked()` when the user picks something in its side bar, which closes that overlay. The core tells the
  shown mode when its side bar hides (`sideBarHidden`) or opens over the content (`sideBarOpenedOver`), and its plugin
  moves focus out of or into the side bar there; a window narrowing hides it without telling, so focus survives a
  narrow-and-widen round trip. A mode with a side bar gives `focusSideBar`, which sets the side bar's key scope and
  focuses its list, and every mode gives `focusMain`, which gives main's last pane back its scope and focus; the
  core's focus keys reach the side bar and the right bar only through these (A focus target, below). A hidden mode keeps its state,
  so leaving one never loses work in it, but it keeps no keys: each mode, each session tab and each session popup is told when it becomes
  the visible one (`shown`), a session tab also when it stops (`hidden`), and its plugin sets its key scope there.
  Sessions emits `tabShown` for each tab told it shows. A new full-window feature is a new mode, with no
  core edit.
- **A session tab** is added to a session by the plugin that fills it, through the `sessions` page export `addTab`:
  chat adds a Chat tab to each session it starts, and the `docs-session-tab` plugin (disabled by default) a Docs tab to each
  session when it connects. A session's tabs drop when its row leaves, closed by the user or ended, and
  each plugin forgets the session when its row leaves the `sessions.rows` slot (`followRows`); the user moves between tabs with `Option+o` /
  `Option+i` and between sessions with `Option+Shift+o` / `Option+Shift+i`. A tab names its Codicon (`icon`), and
  the tab bar draws it with the title as its tooltip.
- **A session popup** is a surface that slides up over a session's tabs while a plugin has something for the user,
  added through the `sessions` page export `addPopup` (`SessionPopupView` in, `SessionPopupHandle` out; one per id per
  session). Forms adds one for a session's rounds and primer for its primer, through the shared
  `src/shared/page/session-form-popups.ts`, and disposes it when the last form leaves. `<Leader>bp`
  (`sessions.togglePopup`, scope `any`) hides and shows it; hidden, it leaves a bar at the bottom of the session's frame.
  An open popup is the visible surface and holds the key scope, and its `beforeClose` joins the tabs' close guards.
  A page reload brings back the popup of a round or primer the last page showed, hidden when that page had hidden it.
  The sessions layout draws it through the `popup` and `popupBar` parts (`docs/features/session-popups/design.md`).
- **A session part** (`SessionPart`) is what a plugin draws for every session on a sessions surface: sessions hands
  it a wrapper and the session id, and the part draws through its own plugin's layout. It has the same shape as forms'
  `addCardPart`. A **row part** draws under every session row in the side bar, through the `sessions` page export
  `addRowPart`; the agent-lines plugin's working line, workflow's chip (the level badge, the stage tag, and the `No workflow`, `Working` and `Headless` tags), chat's run time and profile, usage's context meter and cache mark, unity-pool's clone badge, and the round status that forms and primer draw (`forms.status`, `primer.status`) are among them. A row part's optional `tooltip` joins the row's tooltip. A **bar part** draws in every session's tab
  bar, which moves with its session between panes, through `addBarPart`; the usage-tab-line plugin's per-session line
  is one.
  Information about one session goes in a session part, not on a shared bar.
- **A row activity** is the short state a session's row shows beside its title — a label holding its word (working,
  needs you, done, answered, error, ready to make, closed), also in the row's tooltip; the default layout leaves working off the title line, since the workflow chip's tag says it. A page plugin sets one per session under its own source id through the
  `sessions` page export `setActivity`, and the row shows the highest rank, so a new state is a registration in the
  plugin that knows it, never an edit to sessions. One that sets an `emphasis` also asks the row to catch the eye at a
  scan of the list: `raised` for a state the user may come to when ready, `urgent` for one blocked on the user. A **session title** has three sources (user, agent, first message) kept on the row;
  the agent sets its own through the `set_session_title` tool (`docs/features/session-titles/design.md`).
- **A composer part** is what a plugin draws above the Chat composer's box, through the `chat` page export
  `addComposerPart`, the same shape as a session part: chat hands each part a wrapper and the session id. The workflow
  plugin's strip and the agent strip are two. A part may offer a **stop**: `j` on the entry cursor's last stop (the
  newest pending row, else the last block of the last entry or an open last run's last step) hands the cursor to it, and the part holds
  its own key scope until it hands the cursor back.
- **A side part** is what a plugin draws in the session hub beside the Chat tab's transcript, through the `chat` page
  export `addSidePart`: a composer part's shape plus a `title` and an `order`, and `build` also gets a handle that sets
  the section's summary. Chat draws each part's section frame, keeps its collapse and sizes the hub by a drag on its start edge or by Alt+Shift+h/l while the hub has the keys. The workflow plugin's side pane (one section per workflow, `Plan` for Large and `Checklist` for the others),
  the agent-skills plugin's list, the context-sources plugin's breakdown and the live-view plugin's stream are four. A part marked `shrinksLast` keeps its height while the others give theirs up. A side part takes no key scope and no stop: the hub is a pane of chat's
  own (Alt+l from the transcript or the box), whose cursor walks the section heads chat draws, `Enter` or `l`
  folding one.
- **A status part** is what a plugin draws in the Chat status line under the box, through the `chat` page export
  `addStatusPart`, the same shape; the usage plugin's spend is one. Usage's context line is a composer part.
- **A send gate** is a rule a plugin runs before chat main writes a message to an idle session, through the `chat`
  main export `addSendGate`. A gate answers a hold (`{ action: 'compact', reason }`) or nothing, and the first hold
  wins; chat does the holding, so a new pre-send rule is a gate in its own plugin. The `auto-compact` plugin's is the first
  (`docs/features/auto-compact/design.md`).
- **A chat pane** is one pane of Sessions mode's pane tree (`src/shared/page/pane-tree/`, the sessions plugin its
  owner): it shows one whole session, tab bar included, and a session shows in at most one pane. The side bar drives
  the focused pane, and the visible surface, whose `shown` sets the key scope and whose `isVisible` reads true, is the
  focused pane's top open popup, else its selected tab; a tab in an unfocused pane is on screen but holds no keys. A pane keeps at least 280 px
  of width beside another pane and 160 px of height above or below one (`docs/features/chat-panes/design.md`).
  A **row with an owner** — opened with an `owner`, the plugin it belongs to; not the "owned session" of `open` — has
  no place in the side bar, the next and previous session keys or the pane tree: it shows only where its owner mounts
  its chat view through chat's `mountChat` (Practice's interviewer, `docs/features/practice/design.md`). The start
  prompt's saved sessions leave out a session on such a row, and a `resume` whose `owner` differs from the held row's
  (no owner counting as one) rejects; Practice then launches a fresh interviewer.
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
  `<D-w>`; its key is a lowercase letter, a digit, `;`, `'`, Enter or Tab, as in `<A-'>`, and Tab needs no modifier: `<Tab>`, `<S-Tab>`), matched on the physical key, since macOS turns Option+o into `ø`; a chord bind fires inside a text box
  too, in every vim mode, ahead of the editor, except a key the editor takes itself (`EditorHost.takesChordKey`: an open completion popup's). A plugin's own text box may keep typed keys from the page keys while
  Tab, Enter, Escape and chords still reach its scope's binds (`textBoxInput`, `src/shared/page/text-box.ts`, which docs and settings share). An editor key carries a scope as a page key does and runs only while
  that scope is in force, so two plugins' editors may bind one vim key in different scopes. It fires in normal mode,
  or in insert mode with `mode: 'insert'` (one key the host can type unbound, today only `<CR>`, as in the chat
  picker's filter). Vim keeps one mapping per key sequence and mode for every editor, so a sequence bound in any
  scope runs nothing in the others (the page logs `<keys> has no bind in <scope>`; an insert key types as it does
  unbound, Enter breaking the line), and startup fails on two binds in one mode with the same keys in overlapping
  scopes or on keys that begin another same-mode bind's longer keys in any scope. Esc while a sequence waits cancels
  it and runs nothing.
- **Debug and testing keys** sit under `Space z`, so everyday keys stay clear of them (the layout previews under
  `Space z l`: forms' on `Space z l o`, the primer's on `Space z l p`, sessions' on `Space z l s`, chat's on
  `Space z l c`, agents' on `Space z l a` and workflow's (Large's sample session in every stage) on `Space z l w`; the gallery's `Space z g`, which shows Gallery
  mode, and its `Space z s`, which swaps the shell to a test layout and back).
- **A key scope** in force is the top of the page core's scope stack: `api.keys.setScope` sets a plugin's base
  scope (forms' view), and `api.keys.pushScope` lays a scope over it until its `pop` (help's `keys.help`), so a
  modal view never fights the plugin under it for the scope. The pushed scope's `onBaseChanged` hears the set scope
  change under it, so a modal view can close when the view beneath it moves on (help closes on it).
- **A resize target** is the divider the core's resize commands (`panes.resizePaneLeft` / `Right` / `Up` / `Down`,
  `Alt+Shift+hjkl`) move. A view hands the core its focused pane's divider with
  `api.panes.setResizeTarget(target)` each time it sets its key scope, after `keys.setScope`: the right divider of
  the focused pane when it has one, else its left one, as tmux picks, and `null` when no split pane has focus. Every
  base scope change drops the target. A `ResizeTarget` (`src/contracts/panes.ts`) is one `nudge(direction)`, which
  returns false when the direction's axis is not its own (a side-by-side `Split` given up or down, a column `Split`
  given left or right) or its handle has no layout box (a stacked, start-hidden or end-hidden `Split`), so a hidden view divider passes the press on; every `Split` is
  one. A press goes to the view's target, then, when it returns false or none is set, to the outer panes' target, then
  to the side bar (left and right only); a press nothing takes logs `no pane divider runs <direction>`.
- **A focus target** is how the core's focus commands (`panes.focusLeft` / `Right` / `Up` / `Down`, `Alt+hjkl`) move
  inside a view, as smart-splits does between Neovim and tmux. A view hands it over with
  `api.panes.setFocusTarget(target)` beside its resize target, and every base scope change drops it too. Its
  `move(direction)` moves focus to the view's own pane that way and returns true, or returns false at the view's edge;
  the core then moves to the outer pane that way, then, at main's edge, to the **areas**: left to the shown mode's
  side bar through the mode's `focusSideBar`, right to the right bar's first contribution that took `focus`, Alt+j/k
  between such contributions, and back to main from either through the mode's `focusMain`. The core keeps which
  area holds the keys and resets it to main on every base scope change it did not make, so a click into main ends
  an area's turn; the right bar's turn also ends when the DOM focus moves out of it, to an element or to none (a click
  on no focusable spot in main), and the core then calls the contribution's `left` and blurs whatever the
  contribution still holds focused; focus gone to no element, or to an element whose view sets no base scope of its own
  as the focus move settles, also runs the mode's `focusMain`. Under a pushed scope
  the focus moving into its overlay leaves the turn running, and a disposed stop holding the keys gives main its keys
  back only once no scope is pushed. A narrow mode's side bar opened over main holds the keys as the side area. A hidden side bar or right bar is no stop. Every move takes the DOM focus with it, so no box in
  the pane left behind keeps the caret. The core does nothing at the outer edge but log `no pane <direction>`.
  While a scope is pushed (a dialog, a confirm, a picker, help) the core asks neither and logs
  `no pane <direction> while a scope is pushed`: a move would change the set scope, whose `onBaseChanged` dismisses
  the pushed scope, or move focus behind it. **The outer panes** are the
  panes around the view, handed over by the mode that tiles them with `api.panes.setOuterPanes({ focus, resize })`
  and kept across scope changes until that mode sets null (Sessions mode's chat panes and Practice's interviewer
  pane, each set while its mode shows). A
  view never binds `Alt+hjkl` itself: the key engine cannot hold a key in one scope and in `any` both. The split core draws each handle's
  resize prompt (`⌥⇧H ◂ ▸ ⌥⇧L`, shown on hover, during a drag and for a moment after a nudge) through the anchor
  function it is given: a view passes its `keys.anchor`, the shell anchors the side bar handle's prompt through the
  keys `mountShell` is given. A `Split` and the side bar's `SplitDivider` have `dispose`, which disconnects the observer, removes
  the drag listeners and disposes the prompt's anchors; a view that drops a split calls it.
- **A drop target** is how files dropped or pasted reach a plugin's text box: the view registers its element and
  `take(files)` with `api.drops.addTarget`, which returns a `Disposable`. The page core routes a drop to the innermost
  target under the pointer and a paste to the innermost target holding focus (else the one that last held it); a
  one-line input under the pointer or focused takes plain paths ahead of any target; a drop on nothing toasts
  `Nothing here takes files`, and no file drop navigates the window. A target inserts at its box's cursor through
  `TextEditor.insert`, keeping focus and the vim mode. A file's path comes from the Bridge's `pathForFile`; a file with
  none (a screenshot) is saved through `savePasted` first. What each surface makes of a file is
  `docs/features/file-drop/design.md`.
- **Key hints** read the merged keymap. The core draws every hint in place. The `keys` plugin keeps which-key after a
  pending prefix, the leader search on `Space /`, help on `Space ?` (`<Leader>?` in a box, and the title bar's Keys button), the `showHints` setting and
  the placement check. The app has no bottom key list: a key shows where it acts, as a game puts a button prompt beside the thing it moves
  (`docs/features/key-hints/design.md`).
  - **An anchor** is an element a view names, with the command it runs and the scope it fires in, through
    `api.keys.anchor`, which returns a Disposable. The core (`src/renderer/key-anchors.ts`) draws the KeyPrompt
    primitive into it, redraws it on each keymap change, draws nothing when the command is unbound or the keys plugin's
    `showHints` setting (`"keys": { "showHints": false }` in `settings.json`, which the plugin hands the core through
    `keys.setHintsShown`) is off, so the anchor takes no space, and hides it, keeping its space, until the page parts
    have started and while its scope is not the one in force (an anchor with no scope always shows). With the keys
    plugin stopped or disabled, hints show. A plugin draws no key
    hint of its own.
  - **The view places and styles each anchor** by one of four placement kinds (`DESIGN.md` § Keys and focus): an edge
    prompt, a cursor prompt, a control hint or a box hint. The parts around anchors — chevrons, edge prompts, box
    hints, stacks of one command's anchors, and recording and disposing anchors — come from
    `src/shared/page/ui/key-anchors.ts`.
  - **Vim's own keys** — the key sequences listed in `src/shared/vim-keys.ts` (`j`, `k`, `gg`, Enter, Esc, the `<C-j>` scroll
    keys and the like), in any spelling of them (`<esc>`, `<Return>`, `<c-j>`) — need no anchor and show in help
    only; a view may still anchor one, as Accept does with Enter. An anchor prints the command's first bind that is
    not one of vim's own keys, or its first bind when every bind is; the user's binds come before the defaults. Leader
    sequences show in which-key.
  - **Every other bind has an anchor.** At the end of a whole self-test run (a filtered run skips it; the
    `keys-check-placement` page event, named with the line's prefix in `src/shared/placement-check.ts`, which the
    runner and the plugin share) the plugin logs `[keys] unplaced <keys> <command> in <scope>`, once per scope and bind, for each bind firing in a
    scope that was in force during the page load whose command no anchor named during the page load, in that scope or
    with no scope, on an element seen on the page (connected when the anchor drew, hid or showed, was disposed, or at
    the check). Leader sequences and vim's own keys are left out. The self-test fails on that line, so a new
    built-in key ships with its place on screen. A target drawn only in some states (a ninth choice, a permission
    card, the Model and Controls chips) is placed by a self-test fixture state that builds it, shown or hidden; never
    by a stand-in element made only to satisfy the gate.
  - Every layout's `keyHint` and `keysFor` kit calls (`BaseKit`) keep their shape and route through anchors. The
    shell's kit takes any plugin's qualified command id, and its anchors show once the page parts have started.

  Every hint is drawn by the Kbd primitive through `formatChord` (`formatVimToken` for a text box's keys),
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
  check: `formats.test.ts` fails when main's `ITEM_KINDS` or `ANSWERABLE_KINDS` misses a kind, and `ANSWERABLE_ORDER` in
  `form-state.ts` is added to by hand for an answerable kind.
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
  `src/contracts/agent.ts`, which a harness plugin registers through the main service `services.agentHarnesses`
  (the `claude-code` plugin registers Claude's); the registry publishes each harness's label and declarations in
  `core.agentHarnesses`, and no code outside a harness's plugin names its CLI, files, environment or ids
  (`docs/features/agent-harnesses/design.md`). The fake in `src/shared/`, registered by the composition root under
  the id `fake`, drives the tests and the self-test. The adapter alone reads its harness's output and turns it into chat entries, each carrying the raw
  events and `at`, the time it first appeared (stamped through the injected `Clock`, or read from the transcript for
  history), so a chat layout can show any field and the chat never parses a harness's JSON. The Claude adapter's
  readings of the CLI (`docs/features/agent-chat/claude-stream.md`): it reports permission mode `manual` as
  `default`, no event reports effort but `get_settings` does, `total_cost_usd` is cumulative per process, only a `control_request`
  interrupt keeps the process alive (SIGINT ends it), and a message written during a tool turn folds into that turn
  with no `result` of its own, so the adapter tracks each message by its client `uuid` (§ Message lifecycle) rather
  than counting results. Listing a folder's saved sessions and reading one into chat
  entries are adapter calls too (`listSessions`, `history`), so Claude's transcript format stays in
  `src/plugins/claude-code/main/transcripts.ts`. That format is undocumented and was measured on the installed CLI, so a
  resume that lists nothing or draws raw entries starts with `transcripts.ts` and a fresh look at a transcript's line
  shapes.
- **An agent event** — a subagent spawned or finished, a tool call, context usage, a compaction, a user message — is
  the harness-neutral record (`AgentEvent` in `src/contracts/agent.ts`) the adapter sends through
  `AgentProcessEvents.agentEvent` beside the chat entries, naming its agent (`main` or a subagent's id). Chat main
  forwards each owned session's as `chat.agentEvent`; the agents plugin and the Agent Tower read only these, never a
  harness's JSON (`docs/features/agent-tower/design.md`). A new kind of event is a new member of the union, added
  when a producer emits it.
- **A session control** — Claude's permission mode, effort and model — is declared by the harness adapter (id,
  label, choices, current value, and an optional `role`), and the Chat tab draws whatever its adapter declares. Chat's
  pick keys find a control by its role (`model`, `permissionMode`, `effort`), never by its id. A role gets its key as a
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
  names no tool. Before it runs a call, sessions asks each **tool-call guard** (`addToolCallGuard`, beside
  `addCloseGuard`), so a rule over calls is one registration. A contribution marks its tools main-agent-only with `{ mainAgentOnly: true }` (the
  workflow tools and `set_session_title`); chat's guard, which it registers through `addToolCallGuard`, answers a subagent's call of such a tool with a success that
  changes nothing. `contributeTools` returns a `Disposable`, and a contribution or its disposal reaches every live
  session: sessions starts or ends the contribution's tool session there and sends MCP
  `notifications/tools/list_changed`. Stopping sessions leaves `endpoint.json` and `tools.json` in place, since the
  relay answers `tools/list` from `tools.json` while the app is away.
- **An ambient service** — the clock, timers, ids, the home folder, files (with watching), processes, git (main only), image re-encoding (`images`, main only), the machine's CPU, GPU, memory, network and disk readings (`systemStats`, main only), the windows the OS can stream (`screenCapture`, main only), opening a link in the default browser, how the app was started (`runMode`: live, self-test or drive), the `Platform` record of the OS the app runs on (`platform`, with the OS string as `platform.os`; a page reads the same record as `api.platform`) — reaches a plugin
  through `api.services`, filled in by the composition root, so a test hands the plugin a fake. Each plugin gets
  its own view of the services that hold something open, so stopping the plugin clears its pending timers, closes its
  watches, aborts its running processes, destroys its editors and zeroes its alert counts. `services.log` is
  scoped to the plugin: a plugin calls `log(message)`, and the line shows as `[<id>] message` under its own id. The page's services add `picker` (the shared list picker,
  wired to the plugin's scope, log and overlay), `chooseFolder` (the native folder dialog, null when dismissed) and
  `openExternal` (an http or https link in the default app; main refuses any other). The page's home folder
  is the real path of main's, served in the config, so every view shows a folder under it as `~` through
  `services.homeDir`. A plugin cannot replace a core service: each is built at one place in its composition root, and
  plugins extend it through its seams.
- **A path** is handled through `services.paths` on both sides, the `Paths` contract (`src/contracts/paths.ts`)
  with a POSIX and a Windows adapter in `src/shared/paths/`, each composition root picking one: main by the OS it
  runs on, the page by the served `platform.os`. Page and shared code that joins, splits or shows a full path calls it,
  and so does every path compare in either process, so no plugin writes `/` into a full path or compares paths as
  strings; main-side code may join and split with `node:path`, which follows the OS main runs on, and a Unix socket
  path, which exists only on POSIX, is written with `/` and `path.posix`. Windows paths show with backslashes and the home folder
  as `~`, accept either separator when typed, and compare case-insensitively. A path relative to a scoped `Files`
  (plugin data) stays `/`-separated on every OS.
- **A setting** is a core setting in `src/contracts/settings.ts` and `src/config/settings.ts`, or a plugin's own in
  its manifest's `settings`. Each one declares a label and a one-line description by its dotted path, in
  `settingInfo` beside its default (`src/config/settings.ts` or the manifest), which Settings mode draws as its row;
  the compiler fails on a setting with no declaration. The user overrides any of them in `settings.json` (plugin
  settings under the plugin id), by hand or from Settings mode. The ConfigStore rejects a `settings.json` naming a
  setting that no longer exists, and the app keeps no table of renamed settings, so a change that renames, moves or
  removes a setting also edits `~/.config/wigley-ai-gui/settings.json` to match, and the report names that edit. When
  it moves a layout setting to another owner or changes a layout contract, the report also names each user layout
  under `layouts/` that the change orphans or leaves on the old contract.
- **The user config folder** is `~/.config/wigley-ai-gui/` on both OSes: `settings.json`, `keymap.json`,
  `themes/` and `layouts/`, each holding only what the user changes, shared by the stable and dev apps. Main's ConfigStore watches it and serves every new config to
  the page over the Bridge, so everything hot reloads: plugins read `settings()` and `keys.keymap()` with
  `onChanged` rather than keeping a copy, and a setting read only when something is created (window size, the claude
  command) applies to the next one. A broken file keeps the last good config and shows the problem as a title bar
  badge and a toast. Code that writes `settings.json` or `keymap.json` goes through the `userConfig` main service, which runs the
  ConfigStore's check on the new layer and refuses one that fails, so a write never leaves a broken file; themes
  are written by hand. App-written state, such as split widths, goes to the `uiState` service, never to the user's config.
- **A third-party tool** gets a contract in `src/contracts/` and an adapter folder of its own; the core hands
  plugins the shared ones (editor, markdown, fuzzy matcher) as services. Swapping it is a new adapter folder against the same
  contract, and one changed line in the composition root. Reach for a maintained library behind an adapter, and the
  upstream tool's own behaviour (vim's for keys, neovim's pickers), before porting a subset or writing custom logic:
  the user picks the established behaviour every time.
- **Plugin data** — files a plugin keeps for the user — lives in the plugin's own folder,
  `plugins/<id>/` in the app instance's user data folder, so the stable and dev apps keep separate data (in the
  self-test, `plugin-data/` in the temp home; in a drive run, in the run's own home). Main reaches it through
  `api.data`, the files service scoped to that folder, which refuses a path outside it. The page loads a file from
  it by the URL `api.dataUrl(path, revision)` builds on the `wigley-data:` scheme, which the page's CSP allows for
  scripts and styles; `revision` sits in the URL's path, so a changed module and every relative import under it load
  fresh. The scheme serves plugin data only: layouts load on their own `wigley-layout:` scheme and a user plugin's code on `wigley-plugin:`
  (`wigley-plugin://<id>/~<revision>/<path>`, served from the plugin's revision copy under
  `<userData>/plugin-code/<id>/<revision>/`, which the page's CSP also allows for scripts and styles).
- **A layout** is an owner's user-editable look; the owner is a plugin or the shell. Layouts live in the user config
  folder, `layouts/<owner>/<name>/layout.js` with an optional `layout.css`, shared by the stable and dev apps; each
  owner's built-in `default` is read live from the repo clone (`docs/features/layouts/design.md` § Live defaults).
  Main's core LayoutService watches that folder and announces each owner's set of layouts, each with its own revision,
  so saving one reloads only that one. A plugin's main part registers its contract text with `api.layouts.register` and
  its page part draws with `api.layouts.show`, handing over its built-in `default` layout, its reader and its setting;
  the shell registers with the core (`layouts.register('shell', shellLayoutTypes, 'src/renderer/shell/layouts/default')`
  in `main.ts`) and shows through the page host in `renderer.ts`. Each app writes `layouts/kit.d.ts` (the shared kit
  types) and `layouts/<owner>/layout.d.ts` at start. The page's layout host (`src/shared/page/layout-host/`) picks the
  layout (the owner's setting — `<plugin>.layout`, or the core `shell.layout` — and `default` when unset), checks it
  with the owner's reader, draws each part, rolls back a part that throws and draws it with `default`, redraws on a
  reload, and refreshes every show on each config change. The page claims the Bridge once at start, so a layout reaches
  the app only through its kit, and no `window.wigley` holds the Bridge; this is no sandbox, since a layout shares the
  page's DOM. A layout draws every pane and every repeated row, card or entry; the app keeps selection, keys, scrolling,
  split widths, text boxes and editors. The root of every part a layout draws carries `data-layout="<name>"` and
  `data-layout-owner="<owner>"`, and each loaded layout gets its own stylesheet link, so a layout's CSS selects under
  its own name and restyles nothing another layout drew; the default's CSS is one link of its own, ahead of them. A
  loaded layout stays available while its revision is current, so a round naming one another round loaded draws with it
  at once. A view that needs agent data to show anything has a preview sample under `Space z l` for iterating its layout
  in place. A user plugin's `default` layout is `layouts/default/` in its own folder, which its main part registers
  with `api.layouts.register` and which the page reads live, as the clone's `default` is read; its page part draws a
  part through its layout kit with the show's `draw(part, parent, input)`, the way a built-in page part does.
  `docs/features/layouts/design.md` lists every owner and its surfaces.
  - **A part a layout leaves out** (not defined, or set to `undefined`) draws with `default`. A part may add only its
    root to its parent: one that leaves another node beside it falls back like one that throws.
  - **A list picker draws a layout's rows** (`drawRow`): the picker owns a drawn row's click, its `ui-row--action`
    class and mousedown handling, appends `trailing` when the row left it out, and runs the row's dispose before the
    row draws again and on close.
  - `src/shared/layouts/layout-contracts.test.ts` type-checks every owner's `layout.d.ts` against the shared kit, so a
    member that clashes with `BaseKit` fails the suite.
- **A chat layout** draws each entry kind through a builder that takes `(parent, entry, kit)`, appends its element
  to `parent` and returns it (`src/plugins/chat/layouts/layout.d.ts`). `ChatKit` extends the shared base kit
  (`markdown`, `card`, `statusDot` with `setDotStatus`, `sectionHeader`, `keyHint` and the rest) with chat's parts:
  `json`, `expander` (a collapsible card), `collapsibleCard`, `collapsibleRow` (the plain one-line collapsible a
  step row draws with), `edgeCard` (a card with a status edge),
  `permissionActions` (Allow once / Deny with their keys), and `images` (a user entry's thumbnails, which open the
  image viewer). Every part takes its parent first. Beside the entries, the layout draws the other Chat tab surfaces
  through parts that take `(parent, input, kit)` and return a `PartView`: `activity` (one run of the agent's steps,
  `docs/features/agent-chat/design.md` § Activity line), `working` (the activity dock in the session hub's Main agent
  section: the running turn, then its finished line, § Activity dock), `workingLine` (its one line in the composer's `working` slot), `sideSection` and `sessionFacts` (the hub's section frame and Session header),
  `queuedMessage` (one pending message's row, § Pending messages), `completionDescription` (a `/` completion row's description), `composer`, `statusLine`, `attachments`, `pickerRow`, `pickerHeading`, `signIn`, `reasonBox`, `closeConfirm` and
  `imageViewer`, each with a kit that extends the base kit (`activity`, `working`, `queuedMessage`, `pickerHeading` and `imageViewer`
  take the base kit itself). Beside the parts, the boolean `activityInTranscript` says whether the entry list draws
  the activity lines and their steps; a layout that leaves it out takes `default`'s, `false`.
  A user chat layout defines only the entry builders and the parts it changes: a kind or part it leaves out draws with
  `default`, with no toast. A user builder that throws draws with `default`; the entry toasts once per kind, naming what
  drew it: `default`, or a bare line when `default` throws too.
- **A forms layout** draws the forms view: a card per item kind (`question`, `finding`, `notice`) and the `head`,
  `rail`, `review` and `notices` panes. The `notices` pane is the round's one notices page, after every finding and
  question: a line per notice that opens to that notice's card. Its contract is `src/plugins/forms/layouts/layout.d.ts`: the input for each card and
  pane, and the kit of ready-made parts (sections, grouped choices, answer controls, verdict, rail entry, notice line, review row,
  round note, send and cancel buttons, other plugins' card parts (`contributedParts`), the plain parts `card`, `tag`,
  `kbd`, `button` — a command id with its `arg`, variant and `keys` — and `sectionHeader`, and
  `command(qualifiedId, arg?)` and `keysFor(qualifiedId)`
  for any plugin's command), each of which keeps itself up to date. The app keeps which item is selected, the keys,
  scrolling, the split width, the rail header's open count and saved state, and the cancel dialog. The built-in `default` layout is
  `layouts/default/layout.js`, plain JS that `// @ts-check` types against that contract; it defines every card and
  the rail, review and notices panes, and draws the forms look. The user's forms layouts are folders in
  `~/.config/wigley-ai-gui/layouts/forms/`; a user layout defines only the cards and panes it changes.
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
- `npm run lint` runs `scripts/check-layers.mts`, which fails on an import crossing a boundary its rules do not
  allow. A plugin's rules are derived in `scripts/layer-rules.mts` from the folder convention and its manifest's
  per-process `dependsOn` and `reads`: its `main/` may import the `contract.ts` of each plugin in `dependsOn.main` or
  `reads.main`, and its `page/` those in `dependsOn.page` or `reads.page`. Each plugin's `contract.ts` is a layer of its own, with `src/contracts` and the
  contracts of the plugins it depends on or reads. `src/shared/paths` and `src/shared/followups` are allowed in every
  plugin root, `main/` and `page/`, and the four page kits (`src/shared/page` and its `ui`, `layout-host` and `file-drop`
  folders) in every `page/`. A plugin needing more, such as a `node:` package or an extra sublayer, gets an entry in the
  `PLUGIN_EXTRAS` table in `check-layers.mts`. The core layers `src/main/plugin-catalog` (node and file access, for loading a user plugin) and
  `src/shared/plugin-catalog` (pure manifest checks) are rules of their own. The script also fails when `src/plugins/main.ts`, `page.ts` or
  `manifests.ts` misses a plugin folder's part or manifest, or lists one twice. A new core layer or adapter gets a
  `CORE_LAYERS` entry in `check-layers.mts`, and the composition root's entry lists it. A plugin contract's
  `contract.test-support.ts`, the fixtures of its records (sessions' `sessionRow`), belongs to that contract's layer,
  so any file that may import the contract may import it. A plugin's test follows its
  folder's rules, faking a provider with `fakeDependency`; a test that must start a real provider part has a whole-file
  `sublayers` entry under its plugin in `PLUGIN_EXTRAS`. A page part test that draws a layout part starts the part
  with `startDrawingPagePart` (`src/shared/page/layout-host/page-part-harness.test-support.ts`), whose
  `layouts.show` draws through the real owner show; `startPagePart`'s `draw` throws, since `src/shared` may not
  import the layout host.
- It also runs `scripts/check-styles.mts`, which fails on a raw colour, length, duration or font stack in CSS or an
  inline style under `src/`, and on `backdrop-filter` outside `src/shared/page/ui/materials.css`. It judges every file under
  `src/` and takes no argument.

## Review

The user takes every recommendation in a review of this repo, so a review here — `wigley:review`, or `wigley:make`'s
step 6 — sends no `wigley-forms` round for its findings and questions. Each item takes its recommended pick, and the
run carries on as if the user had submitted the round with every item on its recommendation: `Fix now` and
`Step back` dispatched and re-reviewed, `Follow-up` appended to the follow-ups, `Leave it` left. Follow-up rounds
after the fixes land are taken the same way. The reply lists the pick each item took beside the round's notices, so
the user can still overrule one. A pick that would push, install third-party code or destroy the user's state still
stops for the user, per `~/wigley-agents/AGENTS.md` § Hard gates.

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
  `<appData>/wigley-ai-gui-selftest` and a drive run's its run folder's `user-data/`, both with Chromium's HTTP and code
  caches off, since no run reuses them (a dev start serves the page's modules from a fresh dev server URL); a drive run points its Claude
  sessions at `<run home>/.agents/<instance id>`. "Auri" is only the name the app shows (`app.setName` at start,
  for the Mac app menu's items): the exe, the bundle and every path keep `wigley-ai-gui`. Under `npm start` the Mac Dock still says Electron, since Electron cannot rename
  the Dock label of an unbundled app.

- `npm run install-app` builds and installs the stable app from a committed ref (`main` unless `--ref` names
  another). It packages in a build-only worktree beside the repo, `../.wigley-ai-gui-build`, so neither
  uncommitted edits nor the dev app's `.vite/build` are touched, and runs `npm ci` there when its `node_modules` is
  missing or the lockfile changed since the last one. It copies the packaged app beside the install while the
  stable app still runs, then quits that app, never force-killing it: one still running after 15 s fails the install
  and leaves the installed app untouched, the staged copy waiting for the next run, which deletes it. Quitting ends
  no session: the session host keeps running from the old build (`docs/features/session-host/design.md`). On macOS
  it then swaps the copy in for `/Applications/wigley-ai-gui.app`. On Windows a running host locks its exe's folder,
  so each build installs into its own `app-<short sha>` folder under `%LOCALAPPDATA%\Programs\wigley-ai-gui\`, the
  Start menu shortcut named Auri moves to it, and each older `app-*` folder is deleted when no process holds it. It
  starts the app again when it was running. Each OS builds its own app; a
  locally built app needs no signing identity. On macOS, packaging rewrites the bundle's shown names
  (`CFBundleName`, which the menu bar shows, and `CFBundleDisplayName`) to Auri in `Info.plist`, renames the
  `wigley-ai-gui Helper*.app` bundles to `Auri Helper*.app` (Electron finds its helpers by `CFBundleName`), and
  re-signs it (`forge.config.mts`'s `postPackage`), which refuses an `osxSign` config. It signs with the
  self-signed certificate `npm run create-signing-identity` makes once per Mac, in a keychain of its own, and
  ad hoc on a Mac without one. macOS ties an ad hoc app's privacy grants to its code hash, so each ad hoc install
  loses them and asks again; a denied Documents grant makes every session in `~/Documents` exit with `EPERM`. The
  `install` skill (`.agents/skills/install/SKILL.md`) holds the steps. The installed app's icon is `assets/icon/` (`icon.ico`, `icon.icns` and `icon.png`, drawn from `auri-source.png`),
  which `node scripts/make-icon.mts` rebuilds on Windows (`make-icon.ps1` holds the crop); the dev app keeps Electron's icon.
- Node is pinned in `.nvmrc`. A shell that started on another version runs commands as
  `source ~/.nvm/nvm.sh && nvm use && npm run …`.
- `npm test` runs the Vitest suite: every module whose correctness follows from inputs and outputs — round
  logic, saved rounds, answer state, markdown, theme loading, the keymap — is tested there, without Electron. It also
  type-checks the type tests, `*.test-d.ts` files holding the claims that misuse fails to compile, through `tsc`
  (`typecheck` in `vitest.config.mts`), and runs them once more at run time. Two adapters of one contract run one
  suite of shared cases, kept in a `*.test-support.ts` module (the Files contract in
  `src/shared/files-contract.test-support.ts`).
- `npm run selftest` is the agent's loop, run filtered to what the change touches, which the user allows any time:
  `--plugin <id>` for each touched plugin, or `--group <name>` for the touched groups. A whole run runs every script, several
  minutes of a full Electron app against well under one for a plugin, so it runs only when the user asks for one in
  the current turn; a merge, a re-check after a fix and a final
  pass all run filtered too, and only when the change's risk tier calls for a live run
  (`~/wigley-agents/decisions.md` § Risk). `npm run selftest -- --plugin <id>` runs only that plugin's script (repeat the flag or
  give a comma list), and `--group <name>` (repeatable) runs that group, named `<plugin>: <name>` as the report prints
  it or bare for that name in every script (a name several scripts share usually needs its `<plugin>: ` prefix, since a
  bare name that cuts an earlier script short is refused), together with the groups before it in its script, since a
  group starts from the page they left. A filtered run serves the page every script's binds and settings, checks a script's result
  only when the run reaches the script's last group, and skips the end-of-run placement check. It fails before any
  step on a plugin or group no script holds, naming the known ones, and on a filter that cuts a script short of its
  last group and keeps a script after it, since the cut script leaves its fixture open: run that script's groups on
  their own. A cut script's result that rejects by the end of the run still fails it. It renders the window
  offscreen as an accessory app, so it never takes the user's foreground; the core's driver (`src/main/selftest.ts`,
  its step runner in `src/main/selftest-runner.ts`) runs the script a plugin hands it — the forms plugin's opens
  fixture sessions through `sessions` and their rounds through `FormsService` — drives keys with
  `sendInputEvent`, checks the lines each step adds to the page's log and the result the script checks, and exits
  non-zero on a failure. A key behaviour the agent adds or fixes gets a step in its plugin's self-test script
  (`src/plugins/forms/main/selftest-script.ts` for forms, `src/plugins/primer/main/selftest-script.ts` for the
  primer, `src/plugins/agent-lines/main/selftest-script.ts` for the sidebar working line, `src/plugins/agent-strip/main/selftest-script.ts` for the strip, `src/plugins/workflow-large/main/selftest-script.ts` for
  Large, `src/plugins/workflow-spike/main/selftest-script.ts` for Spike, `src/plugins/workflow-small/main/selftest-script.ts` for Small, `src/plugins/workflow-medium/main/selftest-script.ts` for Medium, `src/plugins/unity-pool/main/selftest-script.ts` for the pool badge and panel, `src/plugins/session-log/main/selftest-script.ts` for Recently closed, `src/plugins/session-stash/main/selftest-script.ts` for Stashed, `src/plugins/context-sources/main/selftest-script.ts` for the hub's Context section, `src/plugins/live-view/main/selftest-script.ts` for the hub's Live section, `src/plugins/app-update/main/selftest-script.ts` for the update button, `src/plugins/system-stats/main/selftest-script.ts` for the system stats panel, `src/main/selftest-user-plugin.ts` for the runtime plugin loader, handed over by `main.ts` under the fixture's id `selftest-user`); a step with no keys waits for its line, and a step's `writeFile` writes a file under the self-test's temp
  home before its keys, as an outside change on disk, a step's `remove` deletes a file or folder there after the
  write and before the keys, and a step's `screenshot` (a lowercase name in words joined by
  `-`) saves a PNG of the window, once the step's line has been waited for, to
  `.selftest/screenshots/<plugin>-<name>.png` (git-ignored, emptied when the self-test starts)
  for the agent to check against `DESIGN.md`. A script's steps sit in named groups, each with a `why` saying what
  the group proves, and a step may add its own `why`; the report prints `group <plugin>: <name>` before the group's
  steps, and a failed step prints the group's why and the step's own. The groups are checked when the handover
  closes, once every part has started: a blank or repeated group name, a blank `why`, a bad `width` or a bad
  `repeat` (or a `repeat` beside `alsoExpect`) fails the self-test before any step runs. A step's `width` (a positive
  whole number, or `'start'`, the width the self-test began on) sets the window's content width before the step's
  write and keys and holds it, the fit check returning to it, until a later step sets another or the script ends;
  every script starts and ends on the start width. A run a reload interrupted does not restore the width itself: the
  next run resizes back on opening. A step's `repeat: { until, max }` presses its keys again after each `expect` line
  until the `until` line is logged; the first press counts toward `max` (a whole number of at least 2), and passing
  the cap without `until` fails. It reports one line, `<keys> ×<presses> -> <until>`, and its `screenshot` saves one
  PNG per press, `<plugin>-<name>-<n>.png`, file n after press n. A step's `alsoExpect` holds patterns that must each
  match a line logged after the step began, before or after `expect`, for a line carrying a value the script cannot
  know (chat's clear step matches the notes line naming the row's random new host id) or a second line the step's keys
  cause, in either order. A line the fixture's opening causes goes in `open`'s `alsoShown` patterns, waited for with
  the shown line from before `open`: logged before the first step began, it would never reach that step's
  `alsoExpect` (usage's script waits there for usage-tab-line's session line). The self-test's user config
  folder sits in its temp home. The script's `settings` override plugin settings in the config main serves the page
  (forms' sets a short `keys.whichKeyTimeoutMs`, so a step can wait out the panel); main parts start on the
  ConfigStore's config, which under the self-test is the empty config folder in its temp home, so the defaults, with
  no script `settings` over them. Each plugin hands at most one script, and the scripts run in plugin start order; the
  keys plugin's main part only registers its layouts and hands no script, so its steps live in forms' script, whose
  fixture gives them scopes full of binds and a box to type in. The gallery's main part hands none either, so its
  steps live in forms' and docs' scripts. Chat's script runs its sessions
  over the fake agent harness, whose controls are Mode, Effort, Model and Verbosity so every chip and its pick key draws, its steps covering the resume list, archive and slash completion. Docs'
  (`src/plugins/docs/main/selftest-script.ts`) runs over a fixture (`selftest-fixture.ts`) that writes docs, an
  index and a stand-in `docs_index.py` into the temp home at start when the home holds none yet, and again at each
  script run, so its steps never reach the user's docs or index. Settings'
  (`src/plugins/settings/main/selftest-script.ts`) drives the form over the temp home's empty config folder, its
  steps editing `settings.json` and `keymap.json` through the form and, as outside changes, through `writeFile`. The
  self-test emulates page focus as a drive run does, so a focus-dependent check can be a self-test step.
- A drive run (`npm run drive`) is how the agent checks a change in the running app: a change to what the app
  shows or how it reacts, at a risk tier that calls for a live run (`~/wigley-agents/decisions.md` § Risk),
  is driven end to end, and its captures read, before the work is done. It runs offscreen as
  an accessory app on its own temp home, beside the user's app, so the agent starts one whenever a check needs it.
  The `drive` skill (`.agents/skills/drive/SKILL.md`) holds the loop. A plugin offers its fixtures to a drive run as
  drive actions (`api.drive`), so a new plugin's fixtures need no core edit.
- Forms visuals are checked live on the preview round (`Space z l o`): the built-in sample shows every card, and each
  further press swaps in the next saved real round, then back to the sample.
- Synthetic keys never reach a global shortcut, never compose a dead key (macOS Option+n) and never meet IME
  composition, and an offscreen window shows no native notification or dialog. Those checks are the user's, in a
  visible `npm start`: the agent lists them in its wrap-up with their steps and does not wait on them.

## Dev quirks

- An app launched from Finder or the Dock inherits launchd's environment, so before plugins start main swaps in the
  PATH and SSH_AUTH_SOCK the user's login shell builds (`src/main/login-shell-env.ts`), keeping each inherited one when
  the read fails or the shell sets it empty. PATH, since launchd's bare one finds the system's programs, not the
  user's; SSH_AUTH_SOCK, since launchd's agent is not the one a profile exports (1Password's), so an ssh host whose
  config reads `IdentityAgent SSH_AUTH_SOCK` gets no key and the app update's `git fetch` of the clone is denied. Main
  reads them only when the app's parent is launchd (`process.ppid === 1`): a terminal start (`npm start`) and the
  self-test keep the environment of the shell that ran them, nvm or a venv included. The read's shell leads its own process
  group. The read ends at the end marker, not when stdout closes, since a process the profile starts can hold stdout
  open; the end marker or the 3 s cap kills that whole group.
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
