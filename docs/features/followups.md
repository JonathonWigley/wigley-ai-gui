# wigley-ai-gui follow-ups

Landed in the UI rework (`docs/features/ui-design/`, plans A–C) and removed from this list: the user config
file, settings and keymap hot reload (the ConfigStore), the layered keymap, the shell registry, plugin-declared theme
tokens, the platform chord formatter, the active-line band, and the sessions and forms-layouts live checks.

- Command palette.
- Move the feature primer into the app.
- Packaging and installers for macOS and Windows.
- A Latte (light) theme and OS light/dark following. The token model is theme-neutral (`colorScheme` per theme), so
  this is a theme file, its `DESIGN.md` light rules, and a light/dark choice.
- Native window vibrancy (macOS `vibrancy`, Windows 11 mica) behind a window adapter, in place of the CSS backdrop
  under L1 glass (`docs/features/ui-design/design.md`).
- Per-tool-call duration on chat tool cards: the harness reports duration per turn result only, so the adapter would
  time each tool call.
- Design skills in wigley-ai-marketplace: tailor ui-skills' baseline-ui, fixing-accessibility and
  fixing-motion-performance (MIT) and Impeccable's critique, audit, polish and quieter guidance (Apache-2.0; keep
  notices) into wigley skills that read a project's `DESIGN.md`, dropping the detector CLI. Plan it with
  `wigley:feature` in that repo.
- A settings window over the user config files.
- A setting that turns every key hint on or off (the conflict prompt, the trash y/n, chat's and forms' hints). Hints already come from `keysFor`, so one setting can blank them in one place. Builds on the user config folder.
- Editor key replay (a broken key sequence replayed into a box through `EditorHost.typeInto`) has three limits only a custom keymap reaches: focus moving mid-replay sends the rest to the old box, a replayed `:` does not open the vim command prompt, and Shift is lost on named keys.
- Rail notice entries are inert in the review: clicking one could jump to the notice's comment box, as question entries jump to their question.
- A notification click focusing its round is untested live: an unsigned dev build gets no macOS notification (the alerts adapter falls back to Dock bounce and badge), so check it on the first signed build from the packaging follow-up.
- Fuzzy finders: `Space f f` finds a file, `Space f s` searches text, built on a fast Neovim finder's matcher (fzf/fzy style) rather than a home-made one. Deferred from the docs browser (`docs-browser/design.md`).
- Keyboard link hints (vimium style) in rendered docs, if Tab between links is not enough.
- Images in rendered docs: loading local image files into the page needs a safe file protocol of its own; today they show their alt text.
- Docs delete trashes every link that points at a trashed target. Deleting a synced skill from the tree trashes the repo's folder and leaves `~/.claude/skills/<name>` dangling, because each index entry carries only its real path. The docs index exports the link locations it walked, which `to_json` leaves out today, and `trashTargets` adds them (wigley-ai-marketplace `plugins/wigley/scripts/docs-index` `model.py` `to_json`; `src/plugins/docs/main/doc-files.ts` `trashTargets`).
- The docs main part watches an open doc's parent folder with the recursive `watch`, so a doc directly in `~/.claude` also sees every transcript write under `~/.claude/projects`. Kept: the watch filters by name on a debounced FSEvents stream. If it costs CPU while sessions stream, add a non-recursive option to `watch` on the Files contract (`src/plugins/docs/main/view-watches.ts`, `src/contracts/files.ts`).
- A row click in the narrow side bar overlay (below 680 px, opened over the content by `Space k s`) leaves the overlay covering the form the user picked the row to see; close it on the click, as a choice made. Sites: `src/renderer/shell/modes.ts`'s side bar state (`sideBarLayout`, `sideBarAfterResize`) and the sessions row click (`src/plugins/sessions/page/sidebar-view.ts`, `onClick`). Recommended by the agent in ui-design plan C's live check S9; the user can keep today's behaviour by dropping this entry.
- A docs tree with no rows — a filter matching nothing, or an empty index — draws no empty state, and once Enter closes the filter box nothing shows a filter is on. One line naming the filter and `/` then Esc to clear it (`src/plugins/docs/page/tree-view.ts`).
- The `on-demand` load-state tag uses the accent tone (`CHIP_TONES`, `src/plugins/docs/page/doc-view.ts`), against DESIGN.md's rule that colour at rest means a status; it was `status-info` before plan C, and `listed` now reads the same as `not-loaded`. Needs an info tone on the Tag primitive (`src/shared/page/ui/`).
- Docs prints keys as plain text inside three sentences — the conflict prompt (`conflictText`, `src/plugins/docs/page/docs-state.ts`), the trash question and the no-place text (`src/plugins/docs/page/docs-dialogs.ts`) — where AGENTS.md and DESIGN.md say every hint is drawn by Kbd. Draw them through `kbd`, or carve out keys inside a sentence in both docs.
- A session Docs tab's tree has no key to hide it: the split never hides the tree, and `Space k d` toggles only Docs mode's side bar (`src/plugins/docs/page/start.ts`).
- One `keyHint` helper in place of four copies of "read `keysFor`, then nothing or a Kbd": chat's `keyHint(keys, platform, command, scope)` (`src/plugins/chat/page/key-hint.ts`), forms' `keyHint` / `appendKeyHint`, which also redraws on keymap change (`src/plugins/forms/page/kinds/card-parts.ts`), sessions' `noSelectionHint` (`src/plugins/sessions/page/start.ts`) and keys' `closeHelpHint` (`src/plugins/keys/page/start.ts`). Chat redraws on each draw and forms on `onChanged`; one helper settles one way.
- A Codex harness adapter behind `AgentHarness`, declaring Codex's own session controls (`agent-chat/design.md`).
- A wigley-harness adapter behind `AgentHarness`, so the app drives the C# harness as it drives Claude Code.
- A read-only Chat tab for sessions started in a terminal, following the session's transcript file.
- Images and files pasted or dropped into the chat's message box.
- Drive fixtures for two live checks the agent could not reach: docs load states other than `launch` (`on-demand`, `shadowed`, `pending`, `listed`, `not-loaded`, with their reasons) from `docs.seed` or `docs.connectSession` (`src/plugins/docs/main/start.ts`), and a fake-harness message that ends its own session, so the ended composer's disabled chips and send show (`sessionEnded`; the fake harness in chat main). Until then those two halves are settled only in code (`CHIP_TONES`, `src/plugins/docs/page/doc-view.ts`).
- The doc editor's focus ring (`.wg-document-editor.cm-focused::after`) sits at z-index 300, set in `src/renderer/codemirror-vim/editor-theme.ts`, and can draw over the side bar overlay and help, as the vim panel did before its fix; seen in code, not yet on screen.
- A dev drive run's page sometimes never finishes loading after `restart` (about 1 in 3 in the final verification of agent-drive): `executeJavaScript` never resolves, so `ready` rejects with "The page never finished loading within 30 s" and `restart` or `quit` ends the run by SIGTERM. The cause is unknown; every dev run's `electron-forge start` rebuilding the shared `.vite/build` is the suspect (`src/main/drive/page-driver.ts` `waitFor`, `scripts/drive.mts` `stop`).
- The docs hidden-tree key routing (tree focused, window too narrow for the tree) has a unit test of its rule and a drive check, but no self-test step: the self-test's fit check restores the width before the next step, so no step can hold a narrow window. A `SelfTestStep` width (`src/contracts/plugin.ts`, `src/main/selftest.ts`) would give it one.
- `chat.askPermission` with `input: null` asks with the default input, since `args.input ?? DEFAULT_PERMISSION_INPUT` treats null as left out; the drive-args `…Or` readers apply a default only to a left-out field (`src/plugins/chat/main/start.ts`).
- The sessions plugin's drive `connected` map keeps a session that ended other than through `sessions.end`; forms drops its own on `sessions.ended`, and sessions could do the same (`src/plugins/sessions/main/start.ts`).
- `wait-log`, and every caller that reads the log length before waiting, misses a page reload that lands between that read and the wait's start; a log mark that carries the navigation count would close it (`markLog`-style change at the `waitForNewLogLine` call sites in `src/main/drive/drive-commands.ts` and `src/main/selftest.ts`).
- `Split` could subscribe to its ui-state key instead of each owner calling `reloadWidth()` when shown (docs' session tree, forms' rail), so a new split owner cannot forget it (`src/shared/page/ui/split.ts`).
- A drag style that shows only while the button is held cannot be checked with the drive run's `query`, because `drag` releases before it returns; a `drag --hold` that leaves the button down until a later `release` would make it reachable (`src/main/drive/page-driver.ts`).
- "Always allow" on a chat permission card, writing the rule to the project's local Claude settings; Claude's
  permission-prompt tool path for it is undocumented, so it starts with a spike.
- When the docs editor lands: an editor key sequence bound only in other scopes is taken from vim in every editor, so a normal-mode Esc in a docs box runs nothing and logs `<Esc> has no bind in docs.…` while forms binds `<Esc>`; a new round selects its session's Form tab, switching away from a Docs tab mid-edit; and a row removed while its round stays open rebuilds that round's Form tab in a hidden body nothing drops after the round closes.
- A Codex process started from a shell Claude Code spawned inherits `CLAUDECODE=1`, so its row reads `Claude`.
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
- A standing rule in the AGENTS.md Intent, so new work stays hookable once these items land: every user action runs as
  a command through the lifecycle above, and every state change a plugin owns is published as an event typed in its
  `contract.ts`. Today publishing is opt-in (AGENTS.md § Architecture says how to emit, not that a plugin must), and
  only `sessions` emits; forms, chat and docs shipped emitting nothing.
- Plugins may add editor remaps (a manifest's `keys` has binds and groups, no remaps).
- Commands take a count or argument, so `choose1..9` becomes one `forms.choose` (and choice 10 gets a key: `DIGITS`
  stops at 9 while `MAX_CHOICES` is 10).
- Layouts as a core service: `api.layouts.define(slot, { contractText, defaultSource, read })` in both processes,
  owning the channel, the `layouts/<slot>/` folder, the CSS link, the toasts and one set of cycle/copy/preview commands.
  Replaces the hand wiring duplicated in forms and chat (`main/start.ts`, `page/start.ts`, three channel methods per
  contract, keys per manifest), and gives any view (sessions sidebar row, docs, help, status bar) a user look. A
  layout's CSS gets scoped so it can't restyle another plugin.
- `EditorHost.defineEx(name, prefix, handler)`, disposable: the document editor's write/quit become ex commands the
  docs plugin registers, replacing the closed `DOCUMENT_EX_COMMANDS` and the `switch` in `codemirror-vim-host.ts`.
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
- Chat and docs events, typed in each `contract.ts`: chat's message sent, turn started and finished, and control
  changed (model, permission mode, effort); docs' doc opened, saved, created, trashed, and index rebuilt. Today both
  only listen to `sessions` events and emit none (`src/plugins/{chat,docs}/{main,page}/start.ts`).
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
  and Windows variants), default program paths, the relay endpoint. Replaces the other `process.platform` reads
  (`main.ts`, `electron-alerts.ts`, `node-files.ts`, sessions' `openRelay` with its direct `os.userInfo`,
  `process.env`, `execPath`, `cwd`); path rules already sit behind `services.paths`.
- The app menu labels commands by `label`, not id.
- Chord matching per platform: match the physical `code` only for Option chords on macOS, and `key` otherwise, so
  `<C-q>` lands on the right key on AZERTY and Dvorak; treat Windows AltGr (Ctrl+Alt) as typing, not a chord
  (`page-keys.ts:19-23`); allow non-letter chords (`<C-/>`, `<F5>`).
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
  `services.confirm` (built twice, chat and forms); `chooseFolder()` and `openExternal(url)` on `PageServices` with
  the scheme check inside, deleting the per-plugin channel pass-throughs in chat and docs.
- Shared helpers in place of copies: `readIfPresent` (docs `script-locator.ts`, chat `recent-folders.ts`, theme
  loader), `upsertById` (chat main and page), one `orList` and `capitalised` (`round.ts`, `finding-text.ts`).
- One status item for the focused editor's vim mode, fed by `EditorHost`; forms contributes only its save state while
  its Form tab shows. Today forms' status line shows forms' mode over Docs and Chat, and chat builds its own readout.
- `timers` joins `MainServices`, taken by `FormsService` (and its 32-bit overflow clamp moves into the adapter) and the
  layout registry, replacing global `setTimeout`.
- Each plugin gets a log already scoped to its id from `createPageApi`, retiring the hand-typed `logSource` strings.
- The renderer root builds the pending-keys hub without the nullable `pageKeys` (`renderer.ts:111-117`), and the
  editor-bind miss policy moves into `editor-binds.ts`.

### Bugs and code

- Layout `copy` corrupts images and fonts: `Files` is UTF-8 only (`layout-registry.ts:201-207`). Add `Files.copy` or
  byte reads, with a test over non-UTF-8 bytes.
- Forms submit and cancel close the round on the page before main confirms, with no rollback when `finish` rejects
  (`forms-commands.ts:447-475`): close on main's `roundClosed`, or restore and toast.
- The cancel prompt can stay over Docs mode where its keys don't act (`forms-view.ts:108`): tie it to the Form tab
  showing, or push its scope and pop on hide.
- A Split handle removed from the document mid-drag never saves the dragged width unless it is pressed again, since only its next press or its own `lostpointercapture` ends the drag (`src/shared/page/ui/split.ts`). A teardown that ends the drag when the split leaves the document would save it.
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
- Shell layout swap failure paths are untested: `mountShell`'s rollback when a layout throws or misses an area, and the generation-guarded restore after a later `setLayout` (`src/renderer/shell/shell.ts`). Plan B's gallery `Space z s` covers only a good swap and its restore; a throwing test layout and a second swap would cover the rest.
- `titleBarOverlayProblem` blames the file at the end of a colour alias chain (`src/main/title-bar-overlay.ts`). Colour tokens accept only hex, `transparent` or an alias today, so it is right; if the colour kind widens (`rgb()`, `color-mix()`), a user alias onto a built-in token would be blamed on the built-in theme and fail start.
- settings.json array elements are checked for the default element's top-level keys only (`checkElements`, `src/main/config/user-settings.ts`); a nested object inside an element would pass with keys missing. No setting has that shape yet.
- `ConfigStore.dispose` during a running rebuild lets that rebuild still replace `current` once (no listener hears it) (`src/main/config/config-store.ts`).
- The forms self-test's gallery steps pin the page count: four `<C-j>` steps expect `[gallery] paged down` and the fifth `reached the end` (`src/plugins/forms/main/selftest-script.ts`), so a gallery section that adds a page breaks the run. A step kind that repeats a key until a given line and saves one screenshot per press would remove the count.
- Refuse `<` as a keymap.json leader, with the existing "must be one key" message (`readLeader`, `src/main/config/user-keymap.ts`). A `<` leader (also stored for `<lt>`) joins any later `>` in a bind into one named key: `<Leader>a>` reads as `<a>`, in the page tokenizer (`vimTokens`, `src/shared/key-hints.ts`) and in vim alike. No default bind has `>` after the leader.
