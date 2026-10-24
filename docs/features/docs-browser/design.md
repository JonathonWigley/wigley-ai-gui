# Docs browser — settled design

**Contents**

- **Plans** — the three plans and what each lands.
- **Modes and layout (plan A)** — modes, the sessions sidebar, session tabs, keys, rounds.
- **Docs browser (plan B)** — index sources, the tree, viewing and editing, CRUD, load states, disk changes.
- **Core services and seams** — the files and processes services, editor binds, markdown, the document editor.
- **Plugin-source status (plan C)** — cache to source, git status, skill folder files.
- **Out of scope** — follow-ups.

The decisions the user settled in the 2026-10-19 interview (five rounds), kept so each plan is written from them.
Plans A and B were written in that session; plan C is written from this file once B lands, against the code as it then
stands. A decision here stands unless the user changes it.

## Plans

- **A — layout** (landed): modes as a core extension point, the sessions sidebar in place of the tab strip,
  tabs inside a session, scoped editor binds, the relay hello's `harness` field (wigley-ai-marketplace).
- **B — docs** (landed): the core `files` and `processes` services, the markdown document render and code
  highlighter, the document editor, the `docs` plugin (Docs mode and each session's Docs tab), and the docs index's
  `claudeConfigDirs` (wigley-ai-marketplace).
- **C — plugin-source status**: written after B lands.

Each plan lands green on its own, the self-test passing, and is reviewed on its own.

## Modes and layout (plan A)

- A **mode** fills the whole window above the status bar; the core shows one at a time. Plugins register modes through
  the page plugin API (an extension point: a later chat or primer mode is one more registration). A hidden mode keeps
  its state, so leaving Docs with unsaved edits loses nothing.
- Two modes: **Sessions** (plugin `sessions`) and **Docs** (plugin `docs`, plan B).
- `Space k s` shows Sessions mode; pressed while Sessions already shows, it toggles the sessions sidebar. `Space k d`
  does the same for Docs mode and its docs tree. `<Leader>ks` / `<Leader>kd` do the same inside a box. No existing bind
  starts with `Space k`.
- `Space v t` hides and shows the tree of whichever docs view shows: Docs mode's side bar, or a session Docs tab's
  tree pane. `Alt+h` from the doc shows a hidden tree again.
- In a window too narrow for the side bar, the side bar opens over the content, and a pick closes it: selecting a
  session row, or opening a doc by click, `l` or Enter. Expanding or collapsing a tree group keeps it open.
- While a docs view's tree is hidden, by `Space k d`, `Space v t` or a window too narrow for it, a tree key moves focus to the doc
  and runs what that key runs there by the keymap in force (`j` scrolls the doc); a tree command whose keys run
  different commands there, or none, only moves focus (`src/plugins/docs/page/hidden-tree-keys.ts`).
- As a docs view's tree hides, its filter box closes first, keeping the filter, since a hidden box must never hold
  the keys. Every other scope pushed over the docs pane — a docs dialog or picker, the changed-on-disk prompt, help,
  another plugin's — stays open through the tree hiding or opening over the doc, and focus moves to the doc or the
  tree only while none is pushed (`src/plugins/docs/page/start.ts`).
- Every key is a default bind in the default keymap (`src/plugins/keymap.ts`) to a named command, never code
  reacting to a key, so the user's `keymap.json` rebinds any of them.
- **Sessions sidebar**, left, Claude Code style, replacing the tab strip. It lists every connected session (a relay
  connects at session start while the app runs; a session started while the app was closed connects on its first
  form). A row: the project folder on the first line (numbered on a clash, as tabs are today), the harness (Claude /
  Codex) dimmed beside it; while a round is open a second line with its heading and `answered/total`; an accent dot
  for a round not yet opened.
- The sidebar is 16rem wide. The window's minimum width stays 420 px: below 680 px the sidebar hides itself, and
  `Space k s` draws it over the content until pressed again or the window widens.
- **Session tabs**: each session holds tabs other plugins add. A Docs tab appears when the session connects (plan B
  adds it), a Form tab on its first round; both stay while the session's row does. A row leaves when the session
  ends or the user closes it; a closed row comes back with the session's next round, and its plugins add its tabs
  again. Tabs inside a session are not closable. A Form tab with no open round shows the idle text. A tab's plugin
  sets its key scope each time the tab becomes the visible one, and a hidden view keeps no scope.
- Keys: `Option+Shift+o` / `Option+Shift+i` (`<A-S-o>`, `<A-S-i>`) move to the next / previous session;
  `Option+o` / `Option+i` (`<A-o>`, `<A-i>`) move to the next / previous tab inside the selected session. Cmd+W,
  `Space ;` and `<Leader>;` close the selected session's sidebar entry, asking first when a round is open, as they
  closed its tab before.
- A new round in Sessions mode selects its session and its Form tab, as today. A round arriving while Docs mode shows
  leaves Docs in place: a toast names the session and the key (`Space k s`), and the sidebar row gets its dot.
  Sessions decides this (it owns activation and reads which mode shows); forms stays unaware of modes.
- **Harness**: the relay hello gains an optional `harness` field, `claude` when `CLAUDECODE=1`, else `codex`
  (wigley-ai-marketplace `relay.py` and its README). An older relay without it shows no harness. Codex sets neither
  `CLAUDE_CODE_SESSION_ID` nor `CLAUDE_PROJECT_DIR` and runs the relay in the plugin folder, so a Codex session's
  project folder stays unknown: its row reads `Codex session`.

## Docs browser (plan B)

- A `docs` plugin with a main part (index runs, file reads and writes, watching) and a page part (tree, viewer,
  editor). One Docs view per **index source**, `IndexSource { id, title, load(), rebuild?() }`, registered by id in
  main through the `addSource` export (a Disposable; a taken id throws). Docs registers two kinds: the `machine`
  source (`index.json`, its rebuild `docs_index.py build`) for Docs mode, and a `session:<id>` source for each live
  session, added on `sessions.connected` and disposed on `sessions.ended` (`docs_index.py session <id>`, about 0.3 s
  measured; `context <project folder>` for a Codex session, and a 'no folder known' message when the folder is
  unknown) for its Docs tab. The page reaches a source through `loadIndex(sourceId)` and `rebuildIndex(sourceId)`; an
  unknown id rejects naming it. A view runs `load` on its first show, then `rebuild` when the source has one; Rescan
  runs `rebuild`, or `load` for a source with none. The write guard below reads the entries each registered source
  last loaded, so a source's entries stop allowing changes once it is disposed, or once a load of it throws or gives no document.
- **Page exports**: `addView(sourceId, { isVisible })` returns `{ element, shown(), hasUnsavedEdits(), dispose() }`: one element holding
  the view's tree and doc in a split, its keys, `Space v t` and its changes reaching the other views as a session
  tab's do (each session's Docs tab is built through it). `openDoc(path, line?)` shows Docs mode and opens the doc
  there at that 1-based line once the machine view's first index run settles; a path the machine index does not list is refused with a toast.
- The script is found through `installPath` in each configured Claude config folder's
  `plugins/installed_plugins.json`; a `docs.scriptPath` setting, empty by default, overrides it. `python3 -X utf8`
  runs it: UTF-8 mode lets it print the index's `→` to a Windows console's cp1252 pipe.
- The tree shows the last `index.json` at once; a full `build` (12.7 s, 629 entries, 4 MB measured 2026-10-19) runs
  in the background on launch and on Rescan. After create, rename or delete the tree updates at once and a background
  build fills in load states; until then the changed entry's chips read `pending`.
- **Tree**: Global, then Plugins, then one node per repo; a repo holds its docs by kind and its feature home, and
  splits by clone only when it has more than one. A kind or source the app does not know still loads: an unknown
  kind is a group after the known kinds, an unknown source a root node after the repos holding kind groups, each
  titled from its id (`my-kind` → `My kind`). An unknown source offers no create place, and only its entries' own
  files are changeable, never the rest of its root. Follow-up items open at their `line`. The filter fuzzy-matches each
  doc's title and path through the `FuzzyMatcher` page service and keeps the tree's order. A filter that matches nothing
  shows `No docs match "<filter>"` with `/` then `Esc` to clear it; an empty index shows `No docs in this index` with
  `R` to rescan; while a filter is on and rows show, one muted line above them reads `Filtered: <filter>` with `/` to
  change it. Each key shows as a Kbd and follows a rebind. No line shows until a read returns an index, or after one
  that returns none; the read's message shows instead.
- **Viewing and editing**: a doc opens rendered; `i` swaps the pane to the vim document editor at the line shown;
  `:w` saves, `:q` returns to the rendered view (refused with unsaved edits; `:q!` drops them), `:wq` both. YAML
  frontmatter shows as a field table above the rendered body. The editor highlights markdown, JSON, TOML and YAML by
  file extension.
- **Load states**: a Claude and a Codex chip on each doc (state; reason on hover), judged for a folder the user picks
  from the index's contexts (`c`), the home folder by default. A session's Docs tab uses that session's own states.
- **Create**: `a` new doc by kind, `A` new file by path. By kind covers instructions, rule, skill, subagent, command,
  learning, reference, feature doc and follow-up; each kind offers only the places the index finds it in, and writes
  at its standard path with a starter template (a skill gets `name`/`description` frontmatter); a follow-up is
  appended as a `- **title** — …` item to the home's `followups.md`. The path box lists matching folders and files
  under the chosen place as the user types, and Tab completes the shared part, as a shell does.
- **Rename** (`r`) uses the same path box, so it also moves a file. **Delete** (`d`) moves the file to the Trash after
  a confirm prompt; a skill's whole folder goes with its SKILL.md. Every link the index walked to the file or
  folder going goes with it — each entry's `walked` paths (schema 2) name where a walk reached it through a link,
  and the link trashed is the nearest one at or above that path resolving into what goes — so deleting a synced
  skill also removes `~/.claude/skills/<name>`. The prompt names every path, and the guard must allow every one or
  none goes. Deleting a symlink sends the file or folder it
  finally points to to the Trash and then the link, the prompt naming both; the guard below must allow both, or neither
  goes. In a chain of links only the first link and the final target go; a link in between stays, dangling. When the
  link's trash fails after its target went, the target's removal still shows and the failure is toasted.
- Main writes, renames and deletes only files the index lists, files inside a repo or feature home the index lists,
  and files inside a folder the index walks for global docs: each Claude config folder, `~/.codex`, `~/.agents` and
  `~/wigley-agents`. Never the home folder itself, and never anything inside a plugin cache.
- **Plugin cache files** open read-only with a line naming the plugin; the source repo's copy is the one to edit.
- **Hook and plugin entries** show a detail view (event, matcher, command / version, enabled) whose edit key opens
  the settings or config file holding it in the same editor.
- **Disk changes**: the open file is watched, through a one-level watch (`recursive: false`) on its folder, so a doc
  directly in `~/.claude` hears no transcript write under `~/.claude/projects`. The rendered view reloads by itself; while editing, a banner says the
  file changed, and `:w` asks reload-or-overwrite.
- **Links**: a relative link to a file opens it in the browser, an http or https link opens in the default browser (any other scheme is refused), a
  `#heading` link scrolls. Links are real anchors: Tab moves between them, Enter follows. Forms keep literal links.
  Images show their alt text.
- **Keys** (scopes `docs.tree`, `docs.doc`, `docs.conflict`, `docs.picker`, `docs.box`, `docs.confirm`): tree `j`/`k`
  move; `l` opens a doc, expands a collapsed group or steps into an expanded one; Enter opens a doc or toggles a
  group, expanding or collapsing it as `l` and `h` do, and under a filter, which shows every group expanded, steps
  into a group as `l` does; `h` collapses a group or goes to the parent; `/` filter, `a`, `A`, `r`, `d`, `R` rescan,
  `c` pick the load-state folder; `Alt+l` / `Alt+h` move focus between tree and doc.
  Doc `j`/`k` scroll, `Ctrl+j`/`Ctrl+k` scroll the doc half a page, the editor too while editing, `i` edit.
  Conflict prompt `r` reload, `o` overwrite, Esc keep editing. Picker `j`/`k` move, Enter or `l` choose, Esc cancel. Text box Tab
  completes the path, Enter accepts, Esc cancels. Trash confirm `y` yes, `n` or Esc keep.
- **Packages** (the user's yes): `@codemirror/lang-markdown`, `@codemirror/language-data`; `@lezer/highlight`,
  `@codemirror/language`, `@codemirror/state` and `@codemirror/view`, already installed under `codemirror`, declared
  directly. No highlight.js: rendered code is highlighted with the same
  CodeMirror language parsers.
- **Second Claude config folder**: sessions here also run with `CLAUDE_CONFIG_DIR=~/.claude-personal`. The docs index
  gains `claudeConfigDirs` (default `["~/.claude"]`); each folder is indexed as part of the global layer; `session`
  searches every folder's `projects/` for the transcript. On this Mac the order is `~/.claude`, then
  `~/.claude-personal`: most sessions run under `~/.claude`. Lands in plan B as its one wigley-ai-marketplace task.

## Core services and seams

From the design review; each named by the `wigley:codebase-design` term behind it.

- **files** (depth, leverage): a core main service — read, atomic write, rename, trash, list folder, watch — behind
  one contract, a Node adapter and an in-memory fake. The user asked for a shared watcher; other plugins get it here.
- **processes** (seam): a core main service that runs a program and returns its exit code and output; a Node adapter
  and a fake.
- **Editor binds get a scope** (seam), like page binds, and do nothing outside it. Today forms' editor binds
  (`<Esc>` → leave box, every `<Leader>` bind) run in every vim editor. Plan A.
- **Session tabs** (seam): sessions exports `addTab` (replacing `fill`) and publishes sessions arriving and leaving on
  the page; forms adds its Form tab, docs a Docs tab per session. The pattern mirrors main's `contributeTools`.
- **Markdown** (seam): the markdown service gains a document render with links and highlighted code; `block` and
  `inline` keep literal links. The highlighter reaches the markdown adapter through its own contract, so markdown-it
  and CodeMirror each stay behind one adapter folder.
- **Document editor** (depth): separate from the small text box: load text, go to line, read-only, the file's
  language, and `:w` / `:q` / `:wq` / `:q!` as save and close events. Form boxes keep their small interface.
- **Pure, tested modules** (locality): index parsing and its `schemaVersion` check, tree grouping, path completion,
  frontmatter split, kind templates and target paths, link resolution, the on-disk-changed check.

## Plugin-source status (plan C)

- `docs_index.py` records, for each plugin cache entry, its source entry: `known_marketplaces.json` gives the
  marketplace's git URL (repo name), its `.claude-plugin/marketplace.json` gives the plugin folder
  (`./plugins/wigley`), and any indexed clone of that repo holds the file. It also records, for a `session` document,
  which plugin version's files the session loaded.
- The app hides a cache entry that has a source, and runs `git` live (through the processes service), when Docs opens
  and on Rescan, for four statuses shown on the source repo's node and on each session that loaded it:
  uncommitted changes, unpushed commits, pushed but not yet installed (installed `gitCommitSha` behind origin), and
  installed but the session started on an older version.
- The index adds only agent-instruction files: every file in a skill's folder (references, templates, scripts it
  tells agents to run). No settings, keybindings or config files.
- The index's schema change bumps `schemaVersion` in both repos together.

## Out of scope

Follow-ups in `../followups.md`: fuzzy finders (`Space f f` files, `Space f s` text, on a Neovim finder's matcher),
keyboard link hints, images in rendered docs, the user config file, settings hot reload.
