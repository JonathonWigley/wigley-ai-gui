# wigley-ai-gui follow-ups

Landed in the UI rework (`docs/features/ui-design/`, plans A–C) and removed from this list: the user config
file, settings and keymap hot reload (the ConfigStore), the layered keymap, the shell registry, plugin-declared theme
tokens, the platform chord formatter, the active-line band, and the sessions and forms-layouts live checks.

- Command palette.
- A chat draft that survives a page reload: a layout reload keeps the draft and its images (the box moves into the
  redrawn composer), but a page reload starts the box empty. It needs the draft kept outside the page
  (`docs/features/layouts/design.md`).
- A layout name picker in Settings mode: each `<owner>.layout` setting (and `shell.layout`) draws as a plain text
  row; a picker listing the owner's layout names, as the theme row lists themes, would read main's `api.layouts.names()`.
- Packaging and installers for macOS and Windows.
- A Latte (light) theme and OS light/dark following. The token model is theme-neutral (`colorScheme` per theme), so
  this is a theme file, its `DESIGN.md` light rules, and a light/dark choice.
- Native window vibrancy (macOS `vibrancy`, Windows 11 mica) behind a window adapter, in place of the CSS backdrop
  under L1 glass (`docs/features/ui-design/design.md`).
- Per-step duration inside an open chat activity line: every chat entry now carries `at` (plan E), so a step row can
  show the time from its `at` to the next entry's; the activity line itself already shows its run's time.
- Design skills in wigley-ai-marketplace: tailor ui-skills' baseline-ui, fixing-accessibility and
  fixing-motion-performance (MIT) and Impeccable's critique, audit, polish and quieter guidance (Apache-2.0; keep
  notices) into wigley skills that read a project's `DESIGN.md`, dropping the detector CLI. Plan it with
  `wigley:feature` in that repo.
- A theme editor in Settings mode (`docs/features/settings/design.md`): the user's `themes/*.json` token sheets are
  hand-edited today, and the userConfig service writes only `settings.json` and `keymap.json`.
- Editor key replay (a broken key sequence replayed into a box through `EditorHost.typeInto`) has three limits only a custom keymap reaches: focus moving mid-replay sends the rest to the old box, a replayed `:` does not open the vim command prompt, and Shift is lost on named keys.
- A notification click focusing its round is untested live: an unsigned dev build gets no macOS notification (the alerts adapter falls back to Dock bounce and badge), so check it on the first signed build from the packaging follow-up.
- Fuzzy finders: `Space f f` finds a file, `Space f s` searches text, ranked by the `FuzzyMatcher` page service (the fzf adapter, `src/renderer/fzf/`). Deferred from the docs browser (`docs-browser/design.md`).
- **Ctrl+j/k cursor keys in list views** — *agent-ready*: `Ctrl+j`/`Ctrl+k` and `Ctrl+Shift+j`/`Ctrl+Shift+k` in the list views with a cursor — settings sections and rows, the chat, docs and settings pickers, and the chat session list — moving the cursor a line and half a page, so the scroll keys (`docs/keymap.md`, Layers) reach every view.
- Plugin sync from the Docs view: commit, push, update the plugin for each harness (`claude plugin update` and
  Codex's) and reload, acting on docs-browser plan C's statuses (uncommitted, unpushed, not installed, session stale;
  `docs-browser/design.md`). Split out of plan C in its 2026-10-24 interview so it is designed against the landed
  statuses; plan it with `wigley:feature`, its first question which statuses each step acts on. The harness update and
  reload calls belong behind `AgentHarness`, and a push still needs the user's press each time.
- Codex last-loaded times in the docs index (docs-browser plan D, `docs_index.py` README § Last loaded): Codex
  sessions (`~/.codex/sessions/`) record no list of loaded files. Older ones carry a `# AGENTS.md instructions for
  <cwd>` message, and skills show only as `exec_command` calls running `cat …/SKILL.md`, so a reader would match
  those commands by pattern.
- Keyboard link hints (vimium style) in rendered docs, if Tab between links is not enough.
- Images in rendered docs: loading local image files into the page needs a safe file protocol of its own; today they show their alt text.
- **Info tone for the on-demand tag** — *agent-ready*: The `on-demand` load-state tag uses the accent tone (`CHIP_TONES`, `src/plugins/docs/page/doc-view.ts`), against DESIGN.md's rule that colour at rest means a status; it was `status-info` before plan C, and `listed` now reads the same as `not-loaded`. Needs an info tone on the Tag primitive (`src/shared/page/ui/`).
- A Codex harness adapter behind `AgentHarness`, declaring Codex's own session controls (`agent-chat/design.md`).
- A wigley-harness adapter behind `AgentHarness`, so the app drives the C# harness as it drives Claude Code.
- A read-only Chat tab for sessions started in a terminal, following the session's transcript file.
- Each dev drive run could build main and preload into its own `.drive/<run>/build` and launch Electron on it directly instead of through `electron-forge start`, so drive runs and the user's `npm start` stop sharing `.vite/build` (forge plugin-vite fixes that folder at `<project>/.vite`). The start lock in `scripts/` covers drive and self-test starts only. Do this if the user's `npm start` keeps getting hit.
- **Window adapter misses page load 1** — The window adapter numbers page loads from 1 only because both `electronDrivenWindow` calls (`src/main/main.ts`
  `createWindow`, `src/main/selftest.ts` `startSelfTest`) run in the same synchronous pass that starts the first load
  (`src/main/window.ts` `loadURL`); an `await` added between them shifts every load number down by one, so dev starts
  hold the start lock the full 10 s instead of releasing on the startup reload. Create the adapter before the first
  load, or pass it into the window factory, so the count cannot miss load 1 (`src/main/drive/driven-window.ts`
  `navigationCount`).
- **Narrowing leaves the docs filter holding keys** — *agent-ready*: A window narrowing that hides Docs mode's side bar does not tell the mode (`narrowChanged` tells only when leaving `over`, `src/renderer/shell/modes.ts`), so a docs filter box open in the tree keeps the keys while hidden. Telling the mode on a narrowing broke the self-test's fit check before (8b399a5); a narrowing-only call that dismisses the filter without moving focus (`DocsView.dismissFilter`, `src/plugins/docs/page/start.ts`) would close it.
- **Split subscribes to its width key** — *agent-ready*: `Split` could subscribe to its ui-state key instead of each owner calling `reloadWidth()` when shown (docs' session tree, forms' rail, the primer's two splits), so a new split owner cannot forget it (`src/shared/page/ui/split.ts`).
- **Chat dispose leaves the preview row open** — *agent-ready*: chat main's `dispose` (`src/plugins/chat/main/start.ts`) kills sessions and the layouts but does not close an open layout-preview row (`src/plugins/chat/main/preview/chat-preview.ts`), so a plugin unload leaves the sample row in the sessions list. Close the preview in `dispose`.
- "Always allow" on a chat permission card, writing the rule to the project's local Claude settings; Claude's
  permission-prompt tool path for it is undocumented, so it starts with a spike.
- When the docs editor lands: an editor key sequence bound only in other scopes is taken from vim in every editor, so a normal-mode Esc in a docs box runs nothing and logs `<Esc> has no bind in docs.…` while forms binds `<Esc>`; a new round selects its session's Form tab, switching away from a Docs tab mid-edit; and a row removed while its round stays open rebuilds that round's Form tab in a hidden body nothing drops after the round closes.
- A Codex process started from a shell Claude Code spawned inherits `CLAUDECODE=1`, so its row reads `Claude`.
- **Probe messages that get no result** — The Claude harness counts one result per sent message (measured on 2.1.304, `agent-chat/claude-stream.md` § Queued messages); a message that gets no result would leave the session `working` and the turn alert unfired. Chosen: probe the cases that might give none (local slash commands, a rejected message) and record them in claude-stream.md before guarding.
- **One rule for the chat cursor, scroll and keys** — *needs a feature plan*: the chat entry cursor has gathered too many rules (follow the latest, hold an open activity line, land on the newest pending row, fall back to the latest stop when the focused row leaves, scroll-to-bottom following), and they disagree at the edges. Settle exactly how the cursor, scrolling and keyboard input interact. Known case: a cursor following the bottom on an open last run's last step moves up to the run line on any redraw (tool result, new step, turn end, queued change), so Enter collapses the run and `j` restarts at its first step (`src/plugins/chat/page/entry-focus.ts` `focusAfterChange`, `entry-focus.test.ts` row pinning `onLine`). The one-line fix kept in reserve: `focusLatest(isListed ? ids.at(-1) ?? null : lastStopId)`. Source session: Claude Code b8ee3503-3c04-48fc-bd7d-bc4f2ec56c17 in wigley-ai-gui.
- Two tabs' take-overs released out of order give the session back to the first taker's tab even though its take-over has ended (pinned by `sessions/page/tabs.test.ts`); only forms takes over today, so it matters once a second plugin does.
- **Backlog applied save closes another editor** — *agent-ready*: in `src/plugins/backlog/page/backlog-view.ts`, an `applied` save result closes whichever editor is open and selects the saved title, so leaving the editor mid-save and opening another loses that editor. Guard `closeEditor` as `moveEditorBaseline` is guarded: act only when the open editor's path and baseline title match the write.
- **A note opening with "Shipped" files as done** — Notes files a follow-up whose one line is the body's first sentence (`src/plugins/notes/main/note-sender.ts`), and Backlog reads an item whose one line starts with "shipped" as done (`src/shared/followups/followup-file.ts`), so such a note never shows in the append picker (`note-homes.ts` drops done items). Options: prefix or reword a one line that would read as done, or have Backlog mark done by an explicit marker rather than the leading word.
- **Agent settings through an adapter** — Settings mode edits only the app's own `settings.json`, so changing an agent's
  config (Claude's model, effort, permissions, hooks, env, per profile and per user, project and local scope) still
  needs a terminal: in print mode `/config` takes only `key=value` (`agent-chat/claude-stream.md` § Terminal-only
  commands). Add an agent settings seam beside `AgentHarness` (`src/contracts/agent.ts`) that each harness adapter
  fills: the settings it declares (key, label, type, choices, scope, current value) and a write checked by the
  harness's own rules. Settings mode then draws whatever the adapter declares, as the Chat tab draws session controls.
  Claude Code is the first adapter (`src/main/claude-code/`) and Codex's config the next; no file format or key name
  leaves its adapter. The first question is where each harness's key list and types come from (a schema, its CLI, or
  the adapter's own table) and whether a change reaches a running session. Plan it with `wigley:feature`.
- **Agent plugin management** — List each profile's installed plugins and marketplaces (version, enabled, scope), and
  install, update, enable, disable, uninstall and reload them from the app, behind the same harness seam: Claude Code's
  adapter runs `claude plugin` (`list`, `install`, `update`, `enable`, `disable`, `uninstall`, `marketplace`), Codex's
  its own commands. `/reload-plugins` is terminal-only in print mode (`agent-chat/claude-stream.md` § Init), so the
  first question is how a running chat session picks up a changed plugin: a restart with `--resume`, or a stream
  control. Design it with the "Plugin sync from the Docs view" follow-up above, whose update and reload steps would
  call this one's harness calls. Plan it with `wigley:feature`.

## Extensibility review (2026-10-20)

From a review against the AGENTS.md Intent (everything a plugin and hookable, everything hot reloads, macOS and Windows
now, any harness later). Each item names its sites.

## Extensibility review: Unloading and reload

- **Disposable registrations** — *agent-ready*: Every registration returns a `Disposable`: `EventBus.on` / `PluginEvents.on`, `PageChannel.on` and `Bridge.onMessage`
  (preload adds a fresh `ipcRenderer` listener per call), `MainChannel.handle`, `CommandRegistry.register`, `Modes.add`
  (plus `ModeHandle.remove`) and `onChanged`, `keys.onScopeChanged` / `onPending`, `PushedScope.onBaseChanged`,
  `EditorHost.onPendingKeys`. `createMainApi` / `createPageApi` record each one per plugin so the host can unload a
  plugin without its help. `Area.contribute` and `Files.watch` already return a handle: the model.
- A `PluginHost` with `stop(id)` and `reload(id, part)`, disposing dependents in reverse dependency order first;
  `PageStart` gets `dispose`, and quit disposes main parts in reverse order rather than all at once
  (`src/shared/plugin-host.ts`, `src/main/main.ts:240-258`). Dependents hold a dependency's `exports` directly, so a
  reload leaves them stale: hand them a stable proxy or restart them too.
- **Plugins dispose their own handles** — *agent-ready*: Each plugin collects and disposes its own handles once the core returns them: forms page (`start.ts`, `forms-view.ts`
  drops `contribute` handles, the shared `editor-boxes` and reducer store (`src/shared/page/editor-boxes.ts`, `reducer-store.ts`), autosave timers), forms main (`createAgentFormChannelPresenter`,
  close guard, tool contribution; `dispose` also ends every live `FormsSession`, its deadline timers and the preview),
  chat page (`channel.on` ×5, `events.on`, tabs, overlay), keys (dropped area handles, `focusin`/`focusout` listeners,
  which-key timers), sessions page (`narrow` listener, mode), shell (`ResizeObserver`), `installPageKeys` (four
  document/window listeners), `showLayouts`.
- **Disposable tool contributions reach live sessions** — *agent-ready*: Sessions' `contributeTools` and `addCloseGuard` return a `Disposable`, and a contribution reaches sessions already
  connected: start or end its `ToolSession` per live entry, rewrite `tools.json`, have `serveMcp` read a live tool list
  and send `notifications/tools/list_changed`, and keep one unknown-tool check (today both `serveMcp` and `routeCall`).
- View and interaction behaviours ship as plugins the user switches on and off (the completion row's description,
  key hints and the like): a per-plugin enable switch in Settings mode, built on `PluginHost.stop` above, so a
  behaviour is a plugin to enable rather than a setting inside the plugin it changes.
- A runtime plugin loader: a `PluginSource` seam (built-in list and a user folder of `manifest.json`, `main.js`,
  `page.js`), main `import()`s from disk and the page through `dataUrl`, and a `validateManifest` gives every plugin the
  checks `definePlugin` makes at compile time. `requireListed` and the static lists in `src/plugins/{main,page,manifests}.ts`
  are what block it.
- Forms page state survives a page reload: focus, review row and view (review, confirm) go into the draft or a core
  per-plugin page-state slot; pending autosaves flush on `pagehide`; restored rounds don't take over their session again.
- **Layout hot reload keeps the user's place** — *agent-ready*: A layout hot reload keeps the user's place: `round-view.ts` `rebuild` (run by `setLayouts` when a reload changes a
  layout it draws with, and by a card part or review column added or disposed) destroys and remounts every box. It
  focuses the focused box again (`keepFocusedBox`), in insert mode at the text's end when it was inserting, and keeps
  the main column's scroll, but loses the cursor, a visual mode and undo. Add `snapshot`/`restore` to `TextEditor`,
  restore them in `keepFocusedBox`, and swap a CSS-only change without a rebuild. Redraw only the cards a changed
  layout draws, reading `LayoutSet.changed` (kept unread for this, by the user's ruling). Forms is the owner this
  covers: chat's composer keeps its box and draft across a redraw, and docs' doc pane redraws its frame only after the
  editor closes.

## Extensibility review: Hooks plugins don't have yet

- **Core events on the bus** — *agent-ready*: The core emits its own events on the bus under `core`: mode and scope changes, window focus, theme applied, config
  changed, page ready, each typed in `src/contracts`.
- **Runtime command API** — *agent-ready*: Commands at runtime and around other plugins: `commands.register(id, decl, handler)`, `keys.bind(bind)`,
  `commands.intercept(id, (next, ctx) => …)`, `commands.onDidRun`, all disposable, and `MainApi.commands.run`.
- **Hookable standing rule in the AGENTS.md Intent** — A standing rule in the AGENTS.md Intent, so new work stays hookable once these items land: every user action runs as
  a command through the lifecycle above, and every state change a plugin owns is published as an event typed in its
  `contract.ts`. Today publishing is opt-in (AGENTS.md § Architecture says how to emit, not that a plugin must), and
  only `sessions` and the forms page emit; chat and docs emit nothing.
- **Plugin editor remaps** — Plugins may add editor remaps (a manifest's `keys` has binds and groups, no remaps).
- Commands take a count or argument, so `choose1..9` becomes one `forms.choose`.
- **EditorHost.defineEx** — *agent-ready*: `EditorHost.defineEx(name, prefix, handler)`, disposable: the document editor's write/quit become ex commands the
  docs plugin registers, replacing the closed `DOCUMENT_EX_COMMANDS` and the `switch` in `codemirror-vim-host.ts`.
- **Markdown block contributions** — *agent-ready*: `MarkdownRenderer.addBlock({ opener, render })` in the contract's own terms, beside
  the fence registry `addFence` (`docs/features/visuals/design.md`); the wigley `:::changes` / `:::tree` / `:::details`
  blocks move out of the core adapter into a contribution.
- **Per-source alert descriptions** — `Alerts.setOpenCount(source, count)` carries no per-source description: the core sums the counts, but the Windows
  overlay names every source "open agent forms", so chat waiting on the user would read as a form.
- **Window plugin** — *agent-ready*: Window commands (`window.summon`) move into a small `window` plugin.
- Decide whether core services (`markdown`, `editor`, `alerts`) are replaceable by a plugin (a `provides` service
  registry) or deliberately not, and record it in `plugin-framework/design.md`.
- **Chat entry renderers** — *agent-ready*: Chat page exports `addEntryRenderer({ kind, match?, build })`, ordered user layout → plugin renderers → default.
- **Chat and docs events** — *agent-ready*: Chat and docs events, typed in each `contract.ts`: chat's message sent, turn started and finished, and control
  changed (model, permission mode, effort); docs' doc opened, saved, created, trashed, and index rebuilt. Today both
  only listen to `sessions` events and emit none (`src/plugins/{chat,docs}/{main,page}/start.ts`).
- Sessions: `rows()` (page) and `sessions()` (main) queries so a late plugin sees live sessions; `activeChanged` from
  main and a page `tabShown` event; `SessionTabView.hidden()` beside `shown()`; row decorations a tab contributes
  (`handle.setBadge(key, text)`) or a sidebar row layout, since tabs' `setStatus` lines overwrite each other; one close
  mechanism (`beforeClose` on the page and `addCloseGuard` in main both carry forms' "open round" today).
- **keysFor in the core keys API** — *agent-ready*: `keysFor` moves into the core keys API, so a plugin reads a command's keys without depending on `keys`; it returns
  unformatted hints (page and editor) with a keymap-changed subscription so drawn buttons follow a rebind. Box focus
  (`page` or `editor`) becomes a core `keys.onWhereChanged`, replacing keys' own `document.activeElement` reading.

## Extensibility review: Closed lists that become registrations

- **Forms item kinds as registrations** — *agent-ready*: Forms item kinds register as one unit (`registerKind`, main and page, disposable), each declaring its wire keys
  (`argsKey`, `bodyKey`, `resultKey`, `fingerprintJoinsWhenEmpty`) so saved rounds, retro and the Python fingerprint
  stay byte-compatible. `Round` / `FormBody` / `AnswersPayload` hold `Record<kind, …>` inside and convert at the store
  and payload edge. On the page each kind is a `PageKind` module (items, restore/entry codec, reduce, boxes, kit, card
  input, review facts, rail order), replacing `RAIL_ORDER`, `ROUND_ITEMS`, `ANSWER_ARRAYS`, `PICK_ANSWERS`,
  `RECOMMENDED_PICKS`, `TextTarget`, `boxes.ts`, `card-kit.ts` tables, `read-layout.ts`'s `CARD_KINDS`, and the
  kind branches in `view-model.ts` and `round-view.ts`. The AGENTS.md "item kind" checklist shrinks to the module. The
  tool schema then needs the sessions `tools/list_changed` item above, and retro reads unknown result keys.
- **Finding origin specs** — *agent-ready*: Finding origins become one `FindingOriginSpec` each (card, meaning, choice noun, choice bounds, severity required,
  action words, chip, theme token), the single source for the parser, tool text and card input.
  One `Finding` type with `severity: Severity | null` replaces the per-origin types; each saved round carries its
  origin action words so retro reads data rather than keeping `ORIGIN_ACTION_LABELS`.
- **Open forms layout unions** — *agent-ready*: `origin` / `card` / `FindingAction` in forms' `layout.d.ts` become
  strings, so a new finding origin, card or action does not break a user forms layout typed against the closed
  unions.
- **Open ChatEntry kinds** — *agent-ready*: `ChatEntry.kind` opens for harness-specific kinds carrying only `raw`, drawn by the `raw` builder unless a layout
  names them.
- **Derived layer rules** — *agent-ready*: `check-layers.mts` derives each plugin's rules from the folder convention and its manifest's `dependsOn`, and checks
  `src/plugins/{main,page,manifests}.ts` against the folders, rather than about five hand entries per plugin.

## Extensibility review: Platform: macOS and Windows

- **Platform record** — *agent-ready*: A `Platform` record chosen in the composition root (`createMacPlatform` / `createWindowsPlatform`), exposed read-only
  as `services.platform` on both sides: app lifecycle quirks, attention and badge (the alerts adapter splits into mac
  and Windows variants), default program paths, the relay endpoint. Replaces the other `process.platform` reads
  (`main.ts`, `electron-alerts.ts`, `node-files.ts`, sessions' `openRelay` with its direct `os.userInfo`,
  `process.env`, `execPath`, `cwd`); path rules already sit behind `services.paths`.
- **Menu labels by label** — *agent-ready*: The app menu labels commands by `label`, not id.
- **Per-platform chord matching** — *agent-ready*: Chord matching per platform: match the physical `code` only for Option chords on macOS, and `key` otherwise, so
  `<C-q>` lands on the right key on AZERTY and Dvorak; treat Windows AltGr (Ctrl+Alt) as typing, not a chord
  (`page-keys.ts:19-23`); allow non-letter chords (`<C-/>`, `<F5>`).
- **Per-platform program lookup and spawning** — *agent-ready*: Program lookup and spawning per platform behind `ProcessRunner`: `.cmd`/`.bat` shims through `cmd.exe` on Windows,
  a `resolveProgram('python')` (`py -3` → `python` → `python3`) for docs' index script, a PATH lookup for the
  `claude` command instead of `~/.local/bin/claude`, and spawn/kill handles so the Claude adapter stops importing
  `node:child_process`.
- **Round store through Files** — *agent-ready*: Forms' round store and sessions' endpoint files go through the `Files` service instead of sync `node:fs`, and its
  atomic write retries `rename` on Windows `EPERM`/`EBUSY`; today a held file makes a draft show unsaved and `returned`
  silently stay false. The store goes async with an in-memory index refreshed by `files.watch`, and the
  `~/.agents/wigley-forms/rounds` location becomes one named constant beside `SavedRound`.
- **Relay contract test** — *agent-ready*: A relay contract test that runs `startRelayServer` on a temp channel for the current platform, since the self-test
  skips the relay and nothing proves the named pipe.

## Extensibility review: Harness and model seams

- **AgentHarnessRegistry** — *agent-ready*: An `AgentHarnessRegistry` service (`register`, `list`, `get`, `onChanged`), so a harness plugin registers its
  adapter instead of `main.ts` building a fixed array. Harness ids become open strings with a declared `label`;
  sessions' `HARNESSES`, `harnessText`, `groupOf`'s "Codex session", docs' `IndexHarness`, and the fake's
  `id: 'claude'` stop switching on ids.
- **Chat picks a harness** — *agent-ready*: Chat picks a harness: `StartRequest.harness`, a harness step in the start prompt (skipped with one harness),
  replacing `CHAT_HARNESS_ID = 'claude'`.
- **Permission behind the harness** — *agent-ready*: Permission moves behind the harness: `AgentProcessEvents.permission(request)` and
  `AgentProcess.answerPermission(id, decision)`; the adapter mints the entry and owns the reply JSON, and the MCP
  `permission_prompt` route becomes the Claude adapter's private wiring. `CLAUDE_PERMISSION_TOOL` leaves
  `src/contracts/agent.ts` for `src/main/claude-code/`.
- `AgentHarness` grows what a second harness needs: `label`, `capabilities` (interrupt, resume, images, mid-turn send),
  `controls()` readable before start with `AgentStart.initialControls` (model chosen at start), a harness-minted
  session id (`events.sessionId` or returned from `start`), resume listing, and `costUsd` defined per turn with the
  adapter normalising Claude's cumulative value.
- **Controls from the initialize answer** — *agent-ready*: The Claude adapter's `initialize` answer also carries `models` and `current_permission_mode` (`claude-stream.md`
  § Initialize): the model and mode controls could read them at start instead of waiting for the first `init`.
- **Control roles** — *agent-ready*: Controls carry a `role` (`model`, `permissionMode`, `effort`) that chat's pick commands find them by, rather than the
  fixed ids `mode` / `effort` / `model`.
- **Harness settings with the harness** — *agent-ready*: Harness settings live with the harness: `claude.command` leaves core `Settings` for the Claude harness plugin's
  manifest; `AgentStart.profileDir` is reworded harness-neutral; profiles become `{ harness, name, configDir }` owned
  by the harness plugin, so chat's profiles and docs' `claudeConfigDirs` stop being two sources of truth, and docs'
  write guard allows every registered harness's config folders.
- Sessions stops naming Claude: the MCP server name comes from configuration rather than `wigley-forms`, and the
  tool-use id comes through a raw `_meta` on `ToolCallContext` or a per-harness reader, not `claudecode/toolUseId`.
- Owned sessions join by a key the harness adapter supplies, settable after start, or a token passed in the spawn
  environment, rather than requiring a host session id before spawning.
- **Harness-neutral UI copy** — *agent-ready*: UI copy says "the agent" or the harness label rather than Claude (`chat-dialogs.ts`, `permission-tool.ts`,
  `claude-code-harness.ts:367`).
- **Structured round results** — *agent-ready*: Forms round logic returns structured results and the MCP adapter words them: `RoundError` as
  `{ path, problem, detail }`, payloads as an outcome plus a `reason`; `ask_round` / `collect_last_round` wording and
  "relay" leave `round.ts`, `round-type.ts` and the format errors, and `needs_manual_open` leaves forms' `Outcome`
  for the relay's. Each `ItemFormat` splits its model-facing `describe()` schema text from parse and fingerprint.

## Extensibility review: Decoupling and shared services

- Sessions stops knowing forms: `mark(sessionId, { text })` lets the marking plugin word the toast (today "Round
  from…"), the empty-state text is generic or contributed, `SessionRow.marked` is documented generically, and
  `SessionInfo.deadlineSeconds` moves to an opaque host record forms reads. The layout preview passes a `label` instead
  of `projectDir: 'Layout preview'`.
- **Core picker, confirm and folder services** — *agent-ready*: Core page services for what plugins duplicate: `services.picker` (chat-private today, docs needs it) and
  `services.confirm` (built twice, chat and forms); `chooseFolder()` and `openExternal(url)` on `PageServices` with
  the scheme check inside, deleting the per-plugin channel pass-throughs in chat and docs.
- **Shared helpers for copies** — *agent-ready*: Shared helpers in place of copies: `readIfPresent` (docs `script-locator.ts`, chat `recent-folders.ts`, theme
  loader), `upsertById` (chat main and page), one `orList` and `capitalised` (`round.ts`, `finding-text.ts`).
- **Timers service** — *agent-ready*: `timers` joins `MainServices`, taken by `FormsService` (and its 32-bit overflow clamp moves into the adapter) and the
  layout registry, replacing global `setTimeout`.
- **Plugin-scoped logs** — *agent-ready*: Each plugin gets a log already scoped to its id from `createPageApi`, retiring the hand-typed `logSource` strings.
- **Pending-keys hub without a nullable pageKeys** — *agent-ready*: The renderer root builds the pending-keys hub without the nullable `pageKeys` (`renderer.ts:111-117`), and the
  editor-bind miss policy moves into `editor-binds.ts`.

## Extensibility review: Bugs and code

- **Selection lost on an outside rename or trash** — *agent-ready*: When another docs view renames or trashes a doc, a view whose selected row was that doc (its usual row or its
  Starred row) keeps a selection with no row, so `l` and `s` do nothing until the user moves. Star toggles already
  reselect the doc's usual row (`starChange`, `src/plugins/docs/page/docs-view.ts`); `outsideChange` could select
  the renamed doc's new row, or the nearest row after a trash.
- **One newest-wins open rule** — *agent-ready*: Docs opens race each other with no shared rule: `openDoc` drops a waiting request only for a newer `openDoc`, so a
  doc the user opens from the tree or a link while it waits on a rebuild is replaced when the rebuild lands. One
  open-intent sequence shared by `openDoc`, tree leaf opens and in-doc links, checked where the open happens, gives
  one newest-wins rule (`src/plugins/docs/page/docs-view.ts` `openDoc`, `followFile`). A path snapshot was tried and
  dropped: it could not tell an earlier `openDoc`'s own open from a user's.
- **Missed rebuild on a rules folder write** — *agent-ready*: In a drive run, a doc written into the temp home's `.claude/rules/` from outside the app started no rebuild until
  Rescan. Check whether the docs watches cover that folder or the change was debounced away
  (`src/plugins/docs/main/view-watches.ts`).
- **ownsRoot helper** — *agent-ready*: "A `repo` or `features` entry owns its root" is spelled inline in four places; one `ownsRoot(entry)` beside
  `isKnownSource` gives it one home (`src/plugins/docs/tree.ts` `buildTree`, `path-guard.ts`, `page/docs-state.ts`,
  `index-document.ts`).
- **isStringArray reuse** — *agent-ready*: Two inline string-array checks repeat `isStringArray` from `src/shared/json.ts` (`src/plugins/docs/main/script-locator.ts`,
  `src/shared/drive-args.ts`).
- When a plugin first adds a non-session docs view, rename `addView`'s session-worded internals (`SESSION_TREE_SPLIT`,
  `sessionTree`, the `Docs tab shown` log line, the `c` toast) in `src/plugins/docs/page/start.ts`.
- **Split form-state.ts** — *agent-ready*: `form-state.ts` (995 lines) splits into session state, answers (dispatching to `PageKind.reduce`), finding rules
  (into `kinds/finding/`), a save tracker and a draft codec.
- **Rename the FormsView union** — *agent-ready*: Two types named `FormsView` (`form-state.ts:16`, `forms-view.ts:56`): rename the union, which also names the key scope.
- **Forms tool table from one list** — *agent-ready*: Forms' tool routing derives `FORMS_TOOLS` and the dispatch from one list of `{ definition, call }`
  (`tool-session.ts`); `isSavedOutcome` derives from a `SAVED_OUTCOMES` const; `answerResult` and `findingResult`
  share one status ladder on the answerable format.
- **Keep the slash-command list** — *agent-ready*: Chat keeps the harness's slash-command list in `ChatSessionState.commands` rather than dropping it.
- **Sessions page model** — *agent-ready*: The sessions page `start` moves its seven pieces of closure state and its multi-job `apply` into a DOM-free
  `createSessionsPageModel`.
- **Redundant docs.css rule** — *agent-ready*: `src/plugins/docs/page/docs.css` keeps `.docs-tree.is-pane-inactive .ui-row.is-selected`, which the one rule in
  `src/shared/page/ui/row.css` (`.is-pane-inactive .ui-row.is-selected`) now covers. Delete it when the docs page is
  next touched.
- **Derived sessionArgs text** — *agent-ready*: `sessionArgs` in `src/plugins/sessions/main/start.ts` hardcodes `"claude" | "codex"`, while
  `src/shared/agent-forms/drive-actions.ts` derives that text from `DRIVE_SESSION_DEFAULTS.harnesses`
  (`sessionArgsText`). Reuse the derived text so the two cannot drift.
- The forms page counts a notes-only item as `answered` (`isResponded`, `src/plugins/forms/item-response.ts`), while the
  payload's `answered` is pick-only (`isAnswered`). User-visible text still says "answered": the progress line "N of M
  answered" (`view-model.ts`), the card-parts labels 'Answered' and 'Not answered'
  (`src/plugins/forms/page/kinds/card-parts.ts`), and the `p.round-progress` comment in
  `src/plugins/forms/layouts/layout.d.ts`. Decide whether the page says "responded" there.

## Extensibility review: Tests

- **Memory Files folder watch events** — *agent-ready*: The memory Files adapter reports nothing to a watch when it makes, removes or trashes an empty folder, where Node's
  `fs.watch` on the parent reports the folder's name (`src/shared/memory-files.ts` `makeFolder`, the `removeKey`
  callers). No caller depends on it yet.
- **Tests that restate shipped text** — Drop or rewrite tests that restate shipped tables and authored text: `forms/manifest.test.ts` (every bind),
  `finding-origins.test.ts` and `tool-definitions.test.ts` (action words, `maxItems`, description sentences; build a
  local origin table and assert the derived functions), `verdict.test.ts` chip text, `formats.test.ts` `F1`/`N2`,
  `view-model.test.ts` `Saving…`, sessions' `harnessText` and `roundToastText`, `languages.test.ts`'s
  `@codemirror/language-data` aliases, and docs' `nameProblem_Rules_PinnedMessages` unless those messages are a contract.
- **chat-sessions test profiles** — *agent-ready*: `chat-sessions.test.ts` builds its own profiles instead of the shipped `DEFAULT_PROFILES`.
- **form-service test over the memory store** — *agent-ready*: `form-service.test.ts` (`src/shared/agent-forms/`) runs its logic over `createMemoryFormStore`, leaving disk behaviour to `form-store.test.ts`.
- **form-state test builders** — *agent-ready*: `form-state.test.ts` uses the shared `test-rounds.ts` builders.
- **One test naming style** — *agent-ready*: One test naming style: sentences. `Name_Case_Result` names remain in `main-api.test.ts`, `layout-loader.test.ts`,
  `layout-registry.test.ts`, `card-input.test.ts`, `which-key.test.ts`, `help-sections.test.ts`.
- **Shell layout swap failure tests** — *agent-ready*: Shell layout swap failure paths are untested: `mountShell`'s rollback when a layout throws or misses an area, and the generation-guarded restore after a later `setLayout` (`src/renderer/shell/shell.ts`). Plan B's gallery `Space z s` covers only a good swap and its restore; a throwing test layout and a second swap would cover the rest.
- `titleBarOverlayProblem` blames the file at the end of a colour alias chain (`src/main/title-bar-overlay.ts`). Colour tokens accept only hex, `transparent` or an alias today, so it is right; if the colour kind widens (`rgb()`, `color-mix()`), a user alias onto a built-in token would be blamed on the built-in theme and fail start.
- **Nested settings element checks** — *agent-ready*: settings.json array elements are checked for the default element's top-level keys only (`checkElements`, `src/main/config/user-settings.ts`); a nested object inside an element would pass with keys missing. No setting has that shape yet.
- `src/plugins/primer/page/primer-commands.test.ts` (the two tests at "from a task holding 20 items" and "from an add-item
  box on a task holding 20 items") mounts an add-item box on a full task. The page no longer reaches that state, since a
  full task shows no add-item box (`hasAddItemBox`, `src/plugins/primer/page/boxes.ts`). Retarget them at a stale box,
  or drop them.
- **Primer self-test start-order dependence** — The primer self-test's last step (`src/plugins/primer/main/selftest-script.ts`) expects `[sessions] activated Layout
  preview`. That line depends on forms' self-test running just before and leaving its preview row to the left, so a
  change in plugin start order breaks it. Fix: a close log line of its own in the sessions page, or activate a known
  session first.
- **Concurrent resumes of one past session** — *agent-ready*: chat's `resume` (`src/plugins/chat/main/chat-sessions.ts`) checks whether a host session already has a row only before it awaits the history read, so two resumes of the same past session started together can each open a row for one host id. Re-check `holding` and `isOpenOnOtherRow` after the await, as `send` re-checks its row after its pending-history read, with a row in the resume tests. Source session: Claude Code aff23a69-78ce-4e15-af65-feac802dde92 in wigley-ai-gui.
- **Docs page test seam for a session's host id change** — *agent-ready*: after `/clear`, the docs page hears `sessions.sessionHostChanged` and calls `DocsView.sourceReplaced()`, which rebuilds a session Docs tab that has shown (`src/plugins/docs/page/start.ts`, `docs-view.ts`). No test pins it: the docs page has no unit test file, and the chat self-test's clear step never shows chat-second's Docs tab. Either give the docs page a test seam with a row for a shown tab (rebuilds) and an unshown one (does nothing), or add a self-test step that shows the Docs tab before the clear and expects a rebuild line after it. Source session: Claude Code b8ee3503-3c04-48fc-bd7d-bc4f2ec56c17 in wigley-ai-gui.
- **Terminal resume of a cleared conversation** — *needs a feature plan*: after `/clear`, the sessions list refuses any relay hello carrying the row's pre-clear host id while the row lives (`retiredHostIds`, `src/plugins/sessions/main/session-list.ts` `connect`), which is meant for the old process's late relay. A user resuming the pre-clear conversation in a terminal (`claude --resume <old id>`) is refused too, so its forms and primer tool calls fail until the cleared row ends. Options: retire the id only until the old process ends, or give a hello after that a plain connected row. Source session: Claude Code b8ee3503-3c04-48fc-bd7d-bc4f2ec56c17 in wigley-ai-gui.
- **Peer agent messaging** — when an agent sends a message to another agent i need to be able to see that
  when an agent sends a message to another agent i need to be able to see that

  Source session: Claude Code b3e1a3e8-589a-4bbd-adba-abc78ad2405f in ~/Documents/ai-dev
- **don't cancel turn on app close** — when the app is closed i don't want to stop all running sessions, let them keep going and naturally stop on their turn end.
  when the app is closed i don't want to stop all running sessions, let them keep going and naturally stop on their turn end. my goal here is to not cancel sessions in progress when i update the app and have to close it, so if there is a better way let me know
- **fuzzy filter needs to rank choices** — the fuzzy find, for instance when i pick a target in these notes, needs to rank the options.
  the fuzzy find, for instance when i pick a target in these notes, needs to rank the options. if i type gui, i expect wigley-ai-gui to be the top choice because it matches gui and because it was recently updated, but instead i get backlog repo because wigley-ai-gui is in the path. the first name was more important than the path.
- **see what skills are loaded** — at any given time i want to see what skills are loaded for a session at a glance
  at any given time i want to see what skills are loaded for a session at a glance
- **Esc in the split's session picker** — *agent-ready*: while the split's "Show session" picker is open, focus stays
  in the chat editor, so Esc reaches the editor (`<Esc> has no bind in sessions.picker`) and the picker stays open;
  the picker should take focus when it opens. Found while driving the Visuals review fixes.
- **A viewport-sized wide visual ends one scrollbar tall after it grows**: a visual whose root follows the viewport
  (`min-height: 100vh`) and is wider than the column settles one horizontal scrollbar (15 px) taller than it needs once
  its content grows after load (the known limit in `docs/features/visuals/design.md` and
  `src/main/data-protocol/visual-height.test.ts`). One candidate rule: drop a report when the root grew by more than 0
  and no more than the viewport grew; it needs a check that a content-sized visual growing during a frame resize is
  still reported.
- **Chat remounts an unchanged visual on two updates in one task**: two assistant-entry updates landing in one task
  draw the new markdown twice before the mount's sweep, so a visual whose source did not change can mount again. Seen
  in the Visuals review, not reproduced live.
- **A visual may flash light in a dark theme before its first theme post**: the frame's root stays hidden until the
  page's first theme message, but the iframe's own background before that is unproved; check in a real window with a
  dark theme.
