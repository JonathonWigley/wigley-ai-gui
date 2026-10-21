# wigley-ai-gui follow-ups

- Command palette.
- Move the feature primer into the app.
- Packaging and installers for macOS and Windows.
- A Latte (light) theme and OS light/dark following.
- A user config file for settings and the keymap. The editor's insert remaps merge only from the core keymap, which holds none since `jk` was dropped, so the keys help's "Remaps in a text box" section stays empty until this lands.
- A settings window, and settings that hot reload: a change applies to the open window without restarting main, which today owns the settings and serves them to the page only at load. Builds on the user config file above.
- `npm run selftest` on Windows (`tee /dev/stderr` in the script).
- An active-line band in the editors (needs the `@codemirror/view` dependency).
- Editor key replay (a broken key sequence replayed into a box through `EditorHost.typeInto`) has three limits only a custom keymap reaches: focus moving mid-replay sends the rest to the old box, a replayed `:` does not open the vim command prompt, and Shift is lost on named keys.
- Rail notice entries are inert in the review: clicking one could jump to the notice's comment box, as question entries jump to their question.
- A notification click focusing its round is untested live: an unsigned dev build gets no macOS notification (the alerts adapter falls back to Dock bounce and badge), so check it on the first signed build from the packaging follow-up.
- Fuzzy finders: `Space f f` finds a file, `Space f s` searches text, built on a fast Neovim finder's matcher (fzf/fzy style) rather than a home-made one. Deferred from the docs browser (`docs-browser/design.md`).
- Keyboard link hints (vimium style) in rendered docs, if Tab between links is not enough.
- Images in rendered docs: loading local image files into the page needs a safe file protocol of its own; today they show their alt text.
- A Codex harness adapter behind `AgentHarness`, declaring Codex's own session controls (`agent-chat/design.md`).
- A wigley-harness adapter behind `AgentHarness`, so the app drives the C# harness as it drives Claude Code.
- A read-only Chat tab for sessions started in a terminal, following the session's transcript file.
- Images and files pasted or dropped into the chat's message box.
- "Always allow" on a chat permission card, writing the rule to the project's local Claude settings; Claude's
  permission-prompt tool path for it is undocumented, so it starts with a spike.
- Sessions mode's live checks have not been run: rows appearing on connect with `No session selected`, the dimmed `Claude` / `Codex` label (wigley 1.4.0's relay sends it), a round selecting its row and Form tab with the `heading 0/<total>` status line, a background round's accent dot, `Option+Shift+o` / `Option+Shift+i` / `Option+o` / `Space k s` from the real keyboard (macOS turns Option+Shift+o into `Ø`), `Cmd+W` closing a row and the row returning at the end with its next round, the `Cancel this round?` prompt over the sidebar, and the narrow window (below 680 px the sidebar hides and `Space k s` opens it over the form). Also decide whether a row click should close that overlay; today it stays open until `Space k s` or a wider window.
- When the docs editor lands: an editor key sequence bound only in other scopes is taken from vim in every editor, so a normal-mode Esc in a docs box runs nothing and logs `<Esc> has no bind in docs.…` while forms binds `<Esc>`; a new round selects its session's Form tab, switching away from a Docs tab mid-edit; and a row removed while its round stays open rebuilds that round's Form tab in a hidden body nothing drops after the round closes.
- A Codex process started from a shell Claude Code spawned inherits `CLAUDECODE=1`, so its row reads `Claude`.
- Forms layouts: run `npm run selftest` on the review fixes. The run closed before it could, while a dev
  `npm start` held the app's data folder; `1b86e3e` rewrote the preview steps (`Space z l o` waits on
  `[sessions] activated Layout preview`, then `<D-w>` and `n` prove the preview round is the selected session's
  and dismiss the prompt), so they have never run live.
- Forms layouts live checks, never run. Under `npm start`: `Space z l o` shows the sample with every card kind;
  `Space z l c` toasts the copy path, and saving a `layout.css` added to the copy redraws the open card keeping its
  answer; saving a relatively imported `parts.js` alone shows its change; a `layout.js` syntax error toasts and keeps
  the last look, and fixing it brings the layout back; `Space z l n` / `p` cycle and the choice survives a restart;
  `Space z l o` twice swaps in the newest saved round, whose submit removes the row and reaches no agent; an editor
  completes the kit's parts in a copied `layout.js` from `layouts/layout.d.ts`. In a packaged build
  (`npm run package`, dev instance closed): repeat the copy-and-css and cycle-and-restart checks, since the
  `wigley-data:` scheme, CORS and the CSP under `file://` are unproven.
- Chat raw events drop the streaming deltas (text, thinking and tool input) and `message_start` / `message_delta` / `message_stop`, while `agent-chat/design.md` says every entry carries the events it was built from. Chosen: rule the deltas covered by the start and final assistant events, and say so in design.md.
- The Claude harness counts one result per sent message (measured on 2.1.304, `agent-chat/claude-stream.md` § Queued messages); a message that gets no result would leave the session `working` and the turn alert unfired. Chosen: probe the cases that might give none (local slash commands, a rejected message) and record them in claude-stream.md before guarding.
- Two tabs' take-overs released out of order give the session back to the first taker's tab even though its take-over has ended (pinned by `sessions/page/tabs.test.ts`); only forms takes over today, so it matters once a second plugin does.

## Extensibility review (2026-10-20)

From a review against the AGENTS.md Intent (everything a plugin and hookable, everything hot reloads, macOS and Windows
now, any harness later). Each item names its sites.

### Unloading and reload

- Every registration returns a `Disposable`: `EventBus.on` / `PluginEvents.on`, `PageChannel.on` and `Bridge.onMessage`
  (preload adds a fresh `ipcRenderer` listener per call), `MainChannel.handle`, `CommandRegistry.register`, `Modes.add`
  (plus `ModeHandle.remove`) and `onChanged`, `keys.onScopeChanged` / `onPending`, `PushedScope.onBaseChanged`,
  `EditorHost.onPendingKeys`. `createMainApi` / `createPageApi` record each one per plugin so the host can unload a
  plugin without its help. `Area.contribute` and `Files.watch` already return a handle: the model.
- A `PluginHost` with `stop(id)` and `reload(id, part)`, disposing dependents in reverse dependency order first;
  `PageStart` gets `dispose`, and quit disposes main parts in reverse order rather than all at once
  (`src/shared/plugin-host.ts`, `src/main/main.ts:240-258`). Dependents hold a dependency's `exports` directly, so a
  reload leaves them stale: hand them a stable proxy or restart them too.
- Each plugin collects and disposes its own handles once the core returns them: forms page (`start.ts`, `forms-view.ts`
  drops `contribute` handles, `editor-boxes`, `forms-store`, autosave timers), forms main (`createChannelPresenter`,
  close guard, tool contribution; `dispose` also ends every live `FormsSession`, its deadline timers and the preview),
  chat page (`channel.on` ×5, `events.on`, tabs, overlay), keys (dropped area handles, `focusin`/`focusout` listeners,
  which-key timers), sessions page (`narrow` listener, mode), shell (`ResizeObserver`), `installPageKeys` (four
  document/window listeners), `showLayouts`.
- Sessions' `contributeTools` and `addCloseGuard` return a `Disposable`, and a contribution reaches sessions already
  connected: start or end its `ToolSession` per live entry, rewrite `tools.json`, have `serveMcp` read a live tool list
  and send `notifications/tools/list_changed`, and keep one unknown-tool check (today both `serveMcp` and `routeCall`).
- A main-side `ConfigStore` behind the user config file and settings hot reload above: it owns the user's
  `settings.json`, `keymap.json` and the themes folder, watches them through `Files.watch`, rebuilds `AppConfig`, and
  pushes it over a `Bridge.onConfigChanged`. Plugins get `settings()` / `keys.keymap()` with `onChanged` in place of the
  snapshots; `applyTheme` re-runs; `installPageKeys` gets `setBinds`; `EditorHost.setKeymap` unmaps and remaps vim;
  menu, intercepts and global shortcuts re-install. Today `buildConfig` runs once in `createWindow` and
  `chooseTheme` reads the themes folder once with sync fs (the theme loader should take `Files`).
- Settings read once at start move to the live read: forms' `deadlineSeconds` (copied into both `FormsService`s) and
  `autosaveDelayMs`; keys' help sections and DOM (built once from the keymap, while which-key and the bar read per event).
- A runtime plugin loader: a `PluginSource` seam (built-in list and a user folder of `manifest.json`, `main.js`,
  `page.js`), main `import()`s from disk and the page through `dataUrl`, and a `validateManifest` gives every plugin the
  checks `definePlugin` makes at compile time. `requireListed` and the static lists in `src/plugins/{main,page,manifests}.ts`
  are what block it.
- The event bus catches a throwing listener, logs it under the listening plugin, and calls the rest
  (`src/shared/event-bus.ts:23-27`); today one bad listener breaks the publisher.
- Forms page state survives a page reload: focus, review row and view (review, confirm) go into the draft or a core
  per-plugin page-state slot; pending autosaves flush on `pagehide`; restored rounds don't take over their session again.
- A layout hot reload keeps the user's place: `round-view.ts` `setLayout` destroys every box, losing focus, cursor, vim
  mode and undo. Add `snapshot`/`restore` to `TextEditor`, restore the active box, and swap a CSS-only change without
  a rebuild.

### Hooks plugins don't have yet

- The core emits its own events on the bus under `core`: mode and scope changes, window focus, theme applied, config
  changed, page ready, each typed in `src/contracts`.
- Commands at runtime and around other plugins: `commands.register(id, decl, handler)`, `keys.bind(bind)`,
  `commands.intercept(id, (next, ctx) => …)`, `commands.onDidRun`, all disposable, and `MainApi.commands.run`.
- Commands take a count or argument, so `choose1..9` and `jumpTo1..9` become one `forms.choose` and one `forms.jumpTo`
  (and choice 10 gets a key: `DIGITS` stops at 9 while `MAX_CHOICES` is 10).
- The keymap merges in layers (core < plugins in dependency order < user file), a later layer shadowing an earlier
  bind with a log line and an `unbind` entry, so only a clash inside one layer throws (`key-sequences.ts:55-73`,
  `editor-binds.ts:41-66`, `mergeKeymap`). Plugins may add editor remaps. The page leader comes from a `keymap.pageLeader`
  rather than `PAGE_LEADER_KEY = ' '` in keys.
- The shell becomes a registry: `addArea(id, { placement })`, `contribute(element, { order, align })`, a replaceable
  `ShellLayout` over the fixed grid, and a mode's side bar or panel as a shell slot the core shows with the mode. No
  plugin uses `activityBar`, `sideBar` or `panel` today; Sessions draws its own side bar inside its mode.
- Layouts as a core service: `api.layouts.define(slot, { contractText, defaultSource, read })` in both processes,
  owning the channel, the `layouts/<slot>/` folder, the CSS link, the toasts and one set of cycle/copy/preview commands.
  Replaces the hand wiring duplicated in forms and chat (`main/start.ts`, `page/start.ts`, three channel methods per
  contract, keys per manifest), and gives any view (sessions sidebar row, docs, help, status bar) a user look. A
  layout's CSS gets scoped so it can't restyle another plugin.
- Theme tokens declared by plugins: a manifest's `themeTokens` with palette defaults, qualified `<pluginId>.<token>`;
  the core's `THEME_TOKENS` keeps only shell tokens (it holds `whichKey.*`, `origin.*`, `severity.*` today), and a
  missing plugin token falls back to its default.
- `EditorHost.defineEx(name, prefix, handler)`, disposable: the document editor's write/quit become ex commands the
  docs plugin registers, replacing the closed `DOCUMENT_EX_COMMANDS` and the `switch` in `codemirror-vim-host.ts`.
  Run `documentExClash` at definition or move it into its test.
- `MarkdownRenderer.addBlock({ opener, render })` and `addFence(language, render)` in the contract's own terms; the
  wigley `:::changes` / `:::tree` / `:::details` blocks move out of the core adapter into a contribution. One fence
  rule serves both `block` and `document` (the `diff` fence renders through two paths today).
- `Alerts.setCount(count, description)` per plugin, qualified and summed by the core; today one global count carries
  forms' "open review rounds" wording, and chat waiting on the user would overwrite it.
- Window commands (`window.summon`) move into a small `window` plugin.
- Decide whether core services (`markdown`, `editor`, `alerts`) are replaceable by a plugin (a `provides` service
  registry) or deliberately not, and record it in `plugin-framework/design.md`.
- Forms page exports and events: `activeRound()`, `answers(roundId)`, card parts and review columns, and
  `roundShown` / `answerChanged` / `roundFinished` / `viewChanged`. Today it exports nothing and emits nothing.
  Its layout kit gains `kit.command(qualifiedId)` and `kit.keysFor(qualifiedId)` for other plugins' commands.
- Chat page exports `addEntryRenderer({ kind, match?, build })`, ordered user layout → plugin renderers → default.
- Sessions: `rows()` (page) and `sessions()` (main) queries so a late plugin sees live sessions; `activeChanged` from
  main and a page `tabShown` event; `SessionTabView.hidden()` beside `shown()`; row decorations a tab contributes
  (`handle.setBadge(key, text)`) or a sidebar row layout, since tabs' `setStatus` lines overwrite each other; one close
  mechanism (`beforeClose` on the page and `addCloseGuard` in main both carry forms' "open round" today).
- `keysFor` moves into the core keys API, so `sessions` no longer depends on `keys` just to spell its toast; it returns
  unformatted hints (page and editor) with a keymap-changed subscription so drawn buttons follow a rebind. Box focus
  (`page` or `editor`) becomes a core `keys.onWhereChanged`, replacing keys' own `document.activeElement` reading.
- Docs: an `IndexSource { id, load, rebuild? }` registry in main, addressed by source id, with `addSource` exported;
  the page exports `openDoc(path, line?)` and the `DocsView(source)` factory. Settle before docs task 07 builds the
  view on the fixed `machineIndex` / `rebuild` / `sessionIndex` channel methods.

### Closed lists that become registrations

- Forms item kinds register as one unit (`registerKind`, main and page, disposable), each declaring its wire keys
  (`argsKey`, `bodyKey`, `resultKey`, `fingerprintJoinsWhenEmpty`) so saved rounds, retro and the Python fingerprint
  stay byte-compatible. `Round` / `FormBody` / `AnswersPayload` hold `Record<kind, …>` inside and convert at the store
  and payload edge. On the page each kind is a `PageKind` module (items, restore/entry codec, reduce, boxes, kit, card
  input, review facts, rail order), replacing `RAIL_ORDER`, `ROUND_ITEMS`, `ANSWER_ARRAYS`, `PICK_ANSWERS`,
  `RECOMMENDED_PICKS`, `TextTarget`, `boxes.ts`, `card-kit.ts` tables, `read-layout.ts`'s unchecked `CARD_KINDS`, and the
  kind branches in `view-model.ts` and `round-view.ts`. The AGENTS.md "item kind" checklist shrinks to the module. The
  tool schema then needs the sessions `tools/list_changed` item above, and retro reads unknown result keys.
- Finding origins become one `FindingOriginSpec` each (card, meaning, choice noun, choice bounds, severity required,
  action words, chip, theme token), the single source for the parser, tool text, card input, manifest command labels
  (today the literal `'fix now · decide now · fix anyway'`) and `defectActionWord`. One `Finding` type with
  `severity: Severity | null` replaces the per-origin types; each saved round carries its origin action words so retro
  reads data rather than keeping `ORIGIN_ACTION_LABELS`.
- User layouts define only the cards or entries they change: `cards` and chat's `entries` become partial records that
  fall back per kind to `default` (the fallback for a throwing card already exists), and `origin` / `card` /
  `FindingAction` in `layout.d.ts` become strings. Today a missing card or entry rejects the whole layout, so adding a
  kind breaks every user layout.
- `ChatEntry.kind` opens for harness-specific kinds carrying only `raw`, drawn by the `raw` builder unless a layout
  names them.
- Docs accepts unknown `kind` and `source` values in the index, grouped under a title from the id after the known ones
  (`index-document.ts`, `tree.ts`, `kinds.ts`); today one unknown kind fails the whole index, so `docs_index.py` can't
  add a kind before the app ships it.
- `check-layers.mts` derives each plugin's rules from the folder convention and its manifest's `dependsOn`, and checks
  `src/plugins/{main,page,manifests}.ts` against the folders, rather than about five hand entries per plugin.

### Platform: macOS and Windows

- A `Platform` record chosen in the composition root (`createMacPlatform` / `createWindowsPlatform`), exposed read-only
  as `services.platform` on both sides: app lifecycle quirks, attention and badge (the alerts adapter splits into mac
  and Windows variants), default program paths, the relay endpoint, the primary modifier and its label, path rules.
  Replaces the 12 `process.platform` reads (`main.ts`, `electron-alerts.ts`, `node-files.ts`, sessions' `openRelay`
  with its direct `os.userInfo`, `process.env`, `execPath`, `cwd`).
- A portable primary modifier in the chord notation (`<M-w>`: Cmd on macOS, Ctrl elsewhere, like Electron's
  `CommandOrControl`), resolved in `mergeKeymap`, used for `<D-w>` (sessions close), `<D-Enter>` (chat) and the forms
  self-test's close steps; the summon accelerator `Control+Alt+Command+W` uses `CommandOrControl`. An optional
  per-bind `platforms` field covers a truly platform-only key.
- One `formatChord(chord, platform)` in `key-hints` used by help, the key bar, which-key and `keysFor`, printing ⌘/⌥ or
  Cmd/Option on macOS and Ctrl/Alt on Windows; today hints print raw `<D-w>` and `chordName` (written twice, in
  `keybindings.ts` and `key-hints.ts`) says Command everywhere. The menu labels commands by `label`, not id.
- Chord matching per platform: match the physical `code` only for Option chords on macOS, and `key` otherwise, so
  `<C-q>` lands on the right key on AZERTY and Dvorak; treat Windows AltGr (Ctrl+Alt) as typing, not a chord
  (`page-keys.ts:19-23`); allow non-letter chords (`<C-/>`, `<F5>`).
- One platform-aware path module in `src/shared/paths.ts` (join, parent, base, isAbsolute, isInside and samePath
  case-folded on Windows, tilde, display), taking a `PathStyle` main serves to the page. It replaces docs'
  `doc-paths.ts` (rejects every `C:\` path, so docs can't run on Windows), docs' `expandTilde` and shared
  `expandHome`, `scoped-files.ts` (`realPath` rejects every Windows path), the `/` joins in `main-api.ts`, chat's
  `folderName`, and the raw-string `projectDir` comparisons in forms' `isOwnedBy` and chat's recent folders.
- Program lookup and spawning per platform behind `ProcessRunner`: `.cmd`/`.bat` shims through `cmd.exe` on Windows,
  a `resolveProgram('python')` (`py -3` → `python` → `python3`) for docs' index script, a PATH lookup for the
  `claude` command instead of `~/.local/bin/claude`, and spawn/kill handles so the Claude adapter stops importing
  `node:child_process`.
- Forms' round store and sessions' endpoint files go through the `Files` service instead of sync `node:fs`, and its
  atomic write retries `rename` on Windows `EPERM`/`EBUSY`; today a held file makes a draft show unsaved and `returned`
  silently stay false. The store goes async with an in-memory index refreshed by `files.watch`, and the
  `~/.agents/wigley-forms/rounds` location becomes one named constant beside `SavedRound`.
- A relay contract test that runs `startRelayServer` on a temp channel for the current platform, since the self-test
  skips the relay and nothing proves the named pipe.

### Harness and model seams

- An `AgentHarnessRegistry` service (`register`, `list`, `get`, `onChanged`), so a harness plugin registers its
  adapter instead of `main.ts` building a fixed array. Harness ids become open strings with a declared `label`;
  sessions' `HARNESSES`, `harnessText`, `groupOf`'s "Codex session", docs' `IndexHarness`, and the fake's
  `id: 'claude'` stop switching on ids.
- Chat picks a harness: `StartRequest.harness`, a harness step in the start prompt (skipped with one harness),
  replacing `CHAT_HARNESS_ID = 'claude'`.
- Permission moves behind the harness: `AgentProcessEvents.permission(request)` and
  `AgentProcess.answerPermission(id, decision)`; the adapter mints the entry and owns the reply JSON, and the MCP
  `permission_prompt` route becomes the Claude adapter's private wiring. `CLAUDE_PERMISSION_TOOL` leaves
  `src/contracts/agent.ts` for `src/main/claude-code/`.
- `AgentHarness` grows what a second harness needs: `label`, `capabilities` (interrupt, resume, images, mid-turn send),
  `controls()` readable before start with `AgentStart.initialControls` (model chosen at start), a harness-minted
  session id (`events.sessionId` or returned from `start`), resume listing, and `costUsd` defined per turn with the
  adapter normalising Claude's cumulative value.
- Controls carry a `role` (`model`, `permissionMode`, `effort`) that chat's pick commands find them by, rather than the
  fixed ids `mode` / `effort` / `model`.
- Harness settings live with the harness: `claude.command` leaves core `Settings` for the Claude harness plugin's
  manifest; `AgentStart.profileDir` is reworded harness-neutral; profiles become `{ harness, name, configDir }` owned
  by the harness plugin, so chat's profiles and docs' `claudeConfigDirs` stop being two sources of truth, and docs'
  write guard allows every registered harness's config folders.
- Sessions stops naming Claude: the MCP server name comes from configuration rather than `wigley-forms`, and the
  tool-use id comes through a raw `_meta` on `ToolCallContext` or a per-harness reader, not `claudecode/toolUseId`.
- Owned sessions join by a key the harness adapter supplies, settable after start, or a token passed in the spawn
  environment, rather than requiring a host session id before spawning.
- UI copy says "the agent" or the harness label rather than Claude (`chat-dialogs.ts`, `permission-tool.ts`,
  `claude-code-harness.ts:367`).
- Forms round logic returns structured results and the MCP adapter words them: `RoundError` as
  `{ path, problem, detail }`, payloads as an outcome plus a `reason`; `ask_round` / `collect_last_round` wording and
  "relay" leave `round.ts`, `forms-service.ts` and the format errors, and `needs_manual_open` leaves forms' `Outcome`
  for the relay's. Each `ItemFormat` splits its model-facing `describe()` schema text from parse and fingerprint.

### Decoupling and shared services

- Sessions stops knowing forms: `mark(sessionId, { text })` lets the marking plugin word the toast (today "Round
  from…"), the empty-state text is generic or contributed, `SessionRow.marked` is documented generically, and
  `SessionInfo.deadlineSeconds` moves to an opaque host record forms reads. The layout preview passes a `label` instead
  of `projectDir: 'Layout preview'`.
- Core page services for what plugins duplicate: `services.picker` (chat-private today, docs needs it) and
  `services.confirm` (built twice, chat and forms); `homeDir`, `chooseFolder()` and `openExternal(url)` on
  `PageServices` with the scheme check inside, deleting the per-plugin channel pass-throughs in chat and docs.
- Shared helpers in place of copies: `readIfPresent` (docs `script-locator.ts`, chat `recent-folders.ts`, theme
  loader), `upsertById` (chat main and page), one `orList` and `capitalised` (`round.ts`, `finding-text.ts`).
- One status item for the focused editor's vim mode, fed by `EditorHost`; forms contributes only its save state while
  its Form tab shows. Today forms' status line shows forms' mode over Docs and Chat, and chat builds its own readout.
- `timers` joins `MainServices`, taken by `FormsService` (and its 32-bit overflow clamp moves into the adapter) and the
  layout registry, replacing global `setTimeout`.
- Each plugin gets a log already scoped to its id from `createPageApi`, retiring the hand-typed `logSource` strings.
- The self-test picks one service set (`selfTestServices` or `liveServices`) in `main.ts` rather than an `isSelfTest`
  ternary per service.
- The renderer root builds the pending-keys hub without the nullable `pageKeys` (`renderer.ts:111-117`), and the
  editor-bind miss policy moves into `editor-binds.ts`.

### Bugs and code

- Layout `copy` corrupts images and fonts: `Files` is UTF-8 only (`layout-registry.ts:201-207`). Add `Files.copy` or
  byte reads, with a test over non-UTF-8 bytes.
- Forms submit and cancel close the round on the page before main confirms, with no rollback when `finish` rejects
  (`forms-commands.ts:447-475`): close on main's `roundClosed`, or restore and toast.
- The cancel prompt can stay over Docs mode where its keys don't act (`forms-view.ts:108`): tie it to the Form tab
  showing, or push its scope and pop on hide.
- A background session's refused close only logs (`forms-commands.ts:422-434`): toast, or select it and confirm.
- `form-state.ts` (995 lines) splits into session state, answers (dispatching to `PageKind.reduce`), finding rules
  (into `kinds/finding/`), a save tracker and a draft codec.
- Two types named `FormsView` (`form-state.ts:16`, `forms-view.ts:56`): rename the union, which also names the key scope.
- `forms.css` scopes its generic classes (`.field`, `.label`, `.box`, `.choice`, …) under the Form tab and merges the
  two `.answer-label` rules.
- The review list rebuilds every row and its markdown on each keystroke in the round note (`round-view.ts:389-402`).
- `forms/main/selftest-script.ts`'s 57-line narration becomes a `why` on each `SelfTestStep` and named step groups.
- Forms' tool routing derives `FORMS_TOOLS` and the dispatch from one list of `{ definition, call }`
  (`tool-session.ts`); `isSavedOutcome` derives from a `SAVED_OUTCOMES` const; `answerResult` and `findingResult`
  share one status ladder on the answerable format.
- Chat keeps the harness's slash-command list in `ChatSessionState.commands` rather than dropping it.
- The sessions page `start` moves its seven pieces of closure state and its multi-job `apply` into a DOM-free
  `createSessionsPageModel`.

### Tests

- Drop or rewrite tests that restate shipped tables and authored text: `forms/manifest.test.ts` (every bind),
  `finding-origins.test.ts` and `tool-definitions.test.ts` (action words, `maxItems`, description sentences; build a
  local origin table and assert the derived functions), `verdict.test.ts` chip text, `formats.test.ts` `F1`/`N2`,
  `view-model.test.ts` `Saving…`, sessions' `harnessText` and `roundToastText`, `languages.test.ts`'s
  `@codemirror/language-data` aliases, and docs' `nameProblem_Rules_PinnedMessages` unless those messages are a contract.
- `chat-sessions.test.ts` builds its own profiles instead of the shipped `DEFAULT_PROFILES`.
- `forms-service.test.ts` runs its logic over `createMemoryRoundStore`, leaving disk behaviour to `round-store.test.ts`.
- `form-state.test.ts` uses the shared `test-rounds.ts` builders.
- One test naming style: sentences. `Name_Case_Result` names remain in `main-api.test.ts`, `layout-loader.test.ts`,
  `layout-registry.test.ts`, `card-input.test.ts`, `which-key.test.ts`, `key-bar.test.ts`, `help-sections.test.ts`.
