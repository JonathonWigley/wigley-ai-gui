# Follow-up master plan

**Contents**

- **Order** — the dependency tiers at a glance.
- **Tier 0: fix and stabilise** — bug sweep, drive reliability, the docs index seam.
- **Tier 1: core seams** — disposables, commands and events, keys, shared services, palette.
- **Tier 2: harness and platform** — harness registry, harness-neutral app, Codex, platform, packaging.
- **Tier 3: open the plugins** — plugin host, layouts service, forms kinds, sessions, chat and docs hooks.
- **Tier 4: features on top** — chat features, themes, docs features.
- **Tier 5: cleanup** — test cleanup, design skills.

This file orders every entry in `followups.md` into steps. Each step is sized for one `wigley:feature` plan, and the
steps are ordered so that the foundations other work builds on come first. Item names here are short labels:
`followups.md` stays the source of each item's detail and sites. When a step's plan closes, remove its entries from
`followups.md` and the step from this file. A new follow-up joins the step it builds on, or becomes a new step placed
after the steps it needs.

## Order

```
 Tier 0  fix and stabilise     1 Bug sweep ── 2 Drive reliability ── 3 Docs index seam (deadline)
              │
 Tier 1  core seams            4 Disposables ─┬─ 5 Commands & events ── 8 Palette & finders
              │                               ├─ 6 Keys core
              │                               └─ 7 Shared page services ─┘
              │
 Tier 2  harness / platform    9 Harness registry ── 10 Harness-neutral ── 11 Codex
              │                12 Platform seam ── 13 Packaging & native window
              │
 Tier 3  open the plugins      14 Plugin host & loader ── 15 Layouts service
              │                16 Forms kinds ── 17 Sessions decoupling ── 18 Chat/markdown hooks
              │
 Tier 4  features on top       19 Chat features   20 Themes   21 Docs features
 Tier 5  cleanup               22 Test cleanup    23 Design skills (other repo)
```

Start with step 1, then step 3, since step 3 must land before docs task 07. Step 2 can run beside them. Step 4 unblocks
most of Tiers 1 and 3.

## Tier 0: fix and stabilise

**1. Correctness bug sweep.** These fixes are small and don't depend on each other; a few of them lose data or leave
stuck UI.
- Layout `copy` corrupts binary files (`Files.copy`)
- Forms submit/cancel has no rollback when `finish` rejects
- The cancel prompt stays over Docs mode
- A refused background close only logs
- The event bus doesn't guard against a throwing listener
- `chat.askPermission` treats null input as missing
- Stale sign-in cancel → a dedicated `loaded` message
- The sessions `connected` map leaks sessions that ended
- `ConfigStore.dispose` during a rebuild
- Refuse a `<` leader
- Split handle removed mid-drag
- The narrow overlay doesn't close on a row click
- Focus ring z-index
- The review list rebuilds on each note keystroke
- `forms.css` scoping and the duplicate `.answer-label`
- Rail notice entries jump to their comment box
- Docs: empty-tree state, and a session Docs tab tree with no hide key
- Raw events: reword `design.md` so the deltas count as covered

**2. Drive reliability and tooling.** Every later step's live checks run through it.
- Restart sometimes never finishes loading (about 1 in 3, cause unknown; debug it first)
- `wait-log` misses a reload between the length read and the wait
- `drag --hold` / `release`
- `SelfTestStep` width, plus the docs hidden-tree self-test step
- A repeat-until-line step kind (removes the gallery page count)
- Drive fixtures for the docs load states and for a fake session that ends itself
- Narration in `selftest-script.ts` becomes per-step `why` and step groups

**3. Docs index seam.** Deadline: settle this before docs task 07 builds on the fixed channel methods.
- `IndexSource` registry with `addSource`; `openDoc(path, line?)`; `DocsView(source)`
- Docs accepts unknown `kind` and `source` values
- Docs delete trashes link locations (`to_json` exports them; includes a wigley-ai-marketplace change)
- Non-recursive `watch` option, only if the `~/.claude` watch costs CPU

## Tier 1: core seams

**4. Disposables everywhere.** Steps 5, 6, 14, 15 and 16 assume handles can be disposed.
- Every registration returns a `Disposable`; `createMainApi`/`createPageApi` record them per plugin
- Each plugin collects and disposes its own handles (forms, chat, keys, sessions, shell, `installPageKeys`,
  `showLayouts`)
- `contributeTools`/`addCloseGuard` become disposable, reach sessions already connected, and send `tools/list_changed`

**5. Commands and events core.** Builds on 4.
- Core events on the bus (mode, scope, focus, theme, config, page ready)
- `commands.register`, `intercept`, `onDidRun`, `MainApi.commands.run`
- Commands take a count or argument (`choose1..9` → `forms.choose`, which gives choice 10 a key)
- The AGENTS.md standing rule: actions are commands and state changes are events
- Per-plugin `Alerts.setCount`
- A `window` plugin
- A log scoped to each plugin's id
- Decide whether plugins can replace core services, and record it in `plugin-framework/design.md`

**6. Keys core.** Builds on 4.
- `keysFor` moves into core keys with a keymap-changed subscription, plus `keys.onWhereChanged`
- One `keyHint` helper instead of the four copies
- Docs prompts draw their keys with Kbd
- A setting that turns every key hint on or off
- `keys.bind` at runtime, and plugin editor remaps
- The pending-keys hub without the nullable `pageKeys`; the miss policy moves into `editor-binds.ts`
- Chord matching per platform (AZERTY/Dvorak, AltGr, non-letter chords)
- Editor key replay limits (focus moving mid-replay, `:`, Shift)

**7. Shared page services and helpers.** Builds on 4.
- `services.picker`, `services.confirm`, `chooseFolder`, `openExternal`
- `readIfPresent`, `upsertById`, `orList`, `capitalised`
- `timers` added to `MainServices`
- One vim-mode status item fed by `EditorHost`
- `Split` subscribes to its own ui-state key
- An info tone on Tag, which fixes the docs `on-demand` chip

**8. Command palette and fuzzy finders.** Builds on 5 (command labels) and 7 (picker).
- Command palette
- `Space f f` / `Space f s`, on a vetted matcher (installing it is an ask)
- The app menu labels commands by `label`

## Tier 2: harness and platform

**9. Harness registry and interface.** Builds on 4.
- `AgentHarnessRegistry`, with harness ids as open strings
- `AgentHarness` grows `label`, `capabilities`, early `controls()`, harness-minted ids, resume and per-turn cost
- Controls carry a `role`
- Permission moves behind the harness
- Chat picks a harness
- Probe the turns that get no result, and record them in `claude-stream.md`

**10. Harness-neutral app.** Builds on 9.
- Harness settings and profiles move into the harness plugin; the docs write guard works per harness
- Sessions stops naming Claude (MCP server name, tool-use id)
- Owned sessions join by a key the adapter supplies
- UI copy says "the agent"
- `ChatEntry.kind` opens for harness-specific kinds
- Forms returns structured results; the MCP adapter words them

**11. Codex adapter.** Builds on 10.
- Codex harness adapter with its own session controls
- A Codex process inheriting `CLAUDECODE=1` reads as Claude

**12. Platform seam.** Independent of 9–11; step 13 needs it.
- `Platform` record (lifecycle, alerts split, paths, relay endpoint)
- `ProcessRunner` per platform (Windows shims, python lookup, finding `claude` on PATH)
- Forms store and endpoint files go through `Files`, async, with an `EPERM`/`EBUSY` retry
- A relay contract test

**13. Packaging and native window.** Builds on 12.
- macOS and Windows installers
- Native vibrancy/mica behind a window adapter
- A live check that a notification click focuses its round, on the first signed build

## Tier 3: open the plugins

**14. Plugin host and runtime loader.** Builds on 4 and 5.
- `PluginHost.stop`/`reload`, disposal in reverse order, stable proxies for dependents
- `PluginSource` with a user plugin folder and `validateManifest`
- `check-layers.mts` derives its rules from folders and manifests
- Forms page state survives a reload

**15. Layouts as a core service.** Builds on 4 and 14.
- `api.layouts.define` with scoped CSS, replacing the wiring copied in forms and chat
- Partial user layouts that fall back per kind
- A layout hot reload keeps the user's place (`TextEditor` snapshot/restore)

**16. Forms kinds and restructure.** Builds on 4 (`tools/list_changed`), 5 and 15.
- `registerKind` / `PageKind` modules
- `FindingOriginSpec`, with one `Finding` type
- Split `form-state.ts`; rename one of the two `FormsView` types; `form-state.test.ts` uses the shared builders
- Tool routing from one list; `SAVED_OUTCOMES`; a shared status ladder
- Forms page exports and events; `kit.command` / `kit.keysFor`

**17. Sessions decoupling.** Builds on 5 and 16.
- Sessions stops knowing forms (`mark` text, `deadlineSeconds`, the preview `label`)
- `rows()`/`sessions()` queries, `activeChanged`, `tabShown`, `hidden()`, row badges
- One close mechanism
- `createSessionsPageModel`
- Take-overs released out of order

**18. Chat, docs and markdown hooks.** Builds on 5 and 15.
- Chat `addEntryRenderer`
- Chat and docs events typed in their contracts
- Chat keeps the slash-command list
- `MarkdownRenderer.addBlock`/`addFence`; the wigley blocks move out of core
- `EditorHost.defineEx`

## Tier 4: features on top

**19. Chat features.** Builds on 9 and 18.
- Files other than images in the chat box
- "Always allow" (starts with a spike)
- How long each tool call took
- A read-only Chat tab for terminal sessions
- wigley-harness (C#) adapter (needs 10)

**20. Themes.** Builds on 7.
- Latte theme, OS light/dark following, and the `DESIGN.md` light rules
- Theme editor in Settings

**21. Docs features and primer.** Builds on 3 and 18.
- Images in rendered docs (safe file protocol)
- Keyboard link hints
- The docs editor-landing issues (Esc, a new round stealing focus, the hidden Form tab body)
- Move the feature primer into the app

## Tier 5: cleanup

**22. Test cleanup.** This goes last because the earlier steps rewrite many of these tests anyway.
- Drop tests that restate tables and authored text
- `chat-sessions` builds its own profiles
- `forms-service` runs on the memory store
- One test naming style
- Cover the shell layout swap failure paths
- The latent `titleBarOverlayProblem` and settings-array notes, revisited only if their trigger appears

**23. Design skills in wigley-ai-marketplace.** No dependencies, so this can run any time. Plan it in that repo.
