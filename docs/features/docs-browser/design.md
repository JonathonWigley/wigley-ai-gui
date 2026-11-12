# Docs browser — settled design

**Contents**

- **Plans** — the three plans and what each lands.
- **Modes and layout (plan A)** — modes, the sessions sidebar, session tabs, keys, rounds.
- **Docs browser (plan B)** — index sources, the tree, viewing and editing, CRUD, load states, disk changes.
- **Core services and seams** — the files and processes services, editor binds, markdown, the document editor.
- **Ownership and plugin-source status (plan C)** — Mine and Third-party, cache merged into source, git
  statuses, skill folder files.
- **Recency and stars (plan D)** — docs ordered by when a session last loaded them, the time on each row,
  and the Starred group.
- **Out of scope** — follow-ups.

The decisions the user settled in the 2026-10-19 interview (five rounds), and plan C's in the 2026-10-24 interview,
and plan D's in the 2026-10-26 interview, kept so each plan is written from them. A decision here stands unless
the user changes it. `../docs-wiki/design.md` extends this doc: Docs mode opens on a wiki, and this doc's tree is
its All pages view.

## Plans

- **A — layout** (landed): modes as a core extension point, the sessions sidebar in place of the tab strip,
  tabs inside a session, scoped editor binds, the relay hello's `harness` field (wigley-ai-marketplace).
- **B — docs** (landed): the core `files` and `processes` services, the markdown document render and code
  highlighter, the document editor, the `docs` plugin (Docs mode and the `addView` export) and the `docs-session-tab` plugin (each session's Docs tab, disabled by default), and the docs index's
  `claudeConfigDirs` (wigley-ai-marketplace).
- **C — ownership and plugin-source status** (landed): the docs index's `owner`, marketplace clones and merged
  installs (schema 3, wigley-ai-marketplace); the Mine and Third-party tree, read-only third-party docs and the git
  statuses.
- **D — recency and stars** (landed): the docs index's `lastLoaded` (schema 4, wigley-ai-marketplace); docs ordered
  newest loaded first, the time on each row and in the doc view, and the Starred group.

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
  tree pane. Esc from the doc shows a hidden tree again; `Alt+h` moves focus to the tree only while it shows.
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
- **Sessions sidebar**, left, Claude Code style, replacing the tab strip. It lists every session holding a row: a
  relay-connected session (one the app did not start) gets its row when a form first shows or a plugin activates
  it, and its row closes again when its last form closes. A row: the project folder on the first line (numbered on a
  clash, as tabs are today), the harness (Claude / Codex) dimmed beside it; while a round is open a second line with
  its heading and `answered/total`; an accent dot for a round not yet opened.
- The sidebar is 16rem wide. The window's minimum width stays 420 px: below 680 px the sidebar hides itself, and
  `Space k s` draws it over the content until pressed again or the window widens.
- **Session tabs**: each session holds tabs other plugins add. The `docs-session-tab` plugin (disabled by default; plan B
  first added the tab inside `docs`) adds a Docs tab when the session connects, and it stays while the session's row does. A round or primer is a popup over the tabs, not a tab (`../session-popups/design.md`). A row leaves when the session
  ends or the user closes it; a closed row comes back with the session's next round, and its plugins add its tabs
  again. Tabs inside a session are not closable. A tab's plugin
  sets its key scope each time the tab becomes the visible one, and a hidden view keeps no scope.
- Keys: `Option+Shift+o` / `Option+Shift+i` (`<A-S-o>`, `<A-S-i>`) move to the next / previous session;
  `Option+o` / `Option+i` (`<A-o>`, `<A-i>`) move to the next / previous tab inside the selected session. Cmd+W,
  `Space ;` and `<Leader>;` close the selected session's sidebar entry, as they closed its tab before; an open
  round is cancelled with it, with no confirmation.
- A new round in Sessions mode selects its session and opens its popup over the tabs. A round arriving while Docs mode shows
  leaves Docs in place: a toast names the session and the key (`Space k s`), and the sidebar row gets its Needs you label.
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
  runs `rebuild`, or `load` for a source with none. A session's host id change (`/clear` in chat) disposes its source
  and adds a fresh one under the same id (`sessions.hostSessionChanged`), holding no entries; the page's
  `followRows` `hostChanged` rebuilds that session's Docs tab once it has shown, which loads the fresh source. The
  write guard below reads the entries each registered source last loaded, so a source's entries stop allowing changes
  once it is disposed, or once a load of it throws or gives no document.
- **Page exports**: `addView(sourceId, { isVisible })` returns `{ element, shown(), hasUnsavedEdits(), dispose() }`:
  one element holding the view's tree and doc in a split, its keys, `Space v t` and its changes reaching the other
  views as a session tab's do (each session's Docs tab is built through it). `openDoc(path, line?)` shows Docs mode
  and opens the doc there at that 1-based line once the machine view's first index read settles, or, when that read
  does not list the path and a rebuild is coming or running, once that rebuild settles; a path still not listed is
  refused with a toast. A waiting request is dropped when a newer one is asked meanwhile.
- The script is found through `installPath` in each configured Claude config folder's
  `plugins/installed_plugins.json`; a `docs.scriptPath` setting, empty by default, overrides it. `python3 -X utf8`
  runs it: UTF-8 mode lets it print the index's `→` to a Windows console's cp1252 pipe.
- The tree shows the last `index.json` at once; a full `build` (12.7 s, 629 entries, 4 MB measured 2026-10-19) runs
  in the background on launch and on Rescan. After create, rename or delete the tree updates at once and a background
  build fills in load states; until then the changed entry's chips read `pending`.
- **Tree**: this is the All pages view; Docs mode's sidebar opens on the wiki and `Space v w` switches between the two (`../docs-wiki/design.md`), and a session's Docs tab holds this tree alone. Two roots by the entry's `owner` (plan C). **Mine**, expanded with its child nodes: Global, then
  Plugins (installed-only plugins no clone carries), then one node per repo. A repo
  holds its docs by kind, then one node per plugin of a marketplace clone (its docs by kind, the install's `plugin`
  entry among them, then an **Installed only** node for its installed files the clone lacks), then its feature home,
  and splits by clone only when it has more than one. **Third-party**, collapsed until the user expands it: Synced
  skills, then one node per plugin. A skill with files beside its `SKILL.md` is a group: `SKILL.md` first, then its
  files by title (the path below the skill folder). A kind or source the app does not know still loads: an unknown
  kind is a group after the known kinds, an unknown source a node under Mine after the repos holding kind groups, each
  titled from its id (`my-kind` → `My kind`). An unknown source offers no create place, and only its entries' own
  files are changeable, never the rest of its root. Follow-up items open at their `line`. The filter fuzzy-matches each
  doc's title through the `FuzzyMatcher` page service, matches its path as a plain case-insensitive substring, since a
  fuzzy match over a full path matches almost any query, and keeps the tree's order. A filter that matches nothing
  shows `No docs match "<filter>"` with `/` then `Esc` to clear it; an empty index shows `No docs in this index` with
  `R` to rescan; while a filter is on and rows show, one muted line above them reads `Filtered: <filter>` with `/` to
  change it. Each key shows as a Kbd and follows a rebind. No line shows until a read returns an index, or after one
  that returns none; the read's message shows instead.
- **Viewing and editing**: a doc opens rendered; `i` swaps the pane to the vim document editor at the line shown; `:w`
  saves; `:q`, `:wq` and Esc in normal mode each return to the rendered view at the scroll the doc had when `i` opened
  the editor (`:q` and Esc are refused with unsaved edits; `:q!` drops them). YAML frontmatter shows as a field table
  above the rendered body. The editor highlights markdown, JSON, TOML and YAML by file extension. A file dropped or pasted into the open editor
  goes in as a markdown link relative to the doc (`![name](path)` for an image); a pasted screenshot is saved beside the
  doc as `images/<doc name>-<yyyyMMdd-HHmmss>[-<n>].<ext>` (`docs/features/file-drop/design.md`). The rendered view shows
  `![…]` as its alt text, not the picture.
- **Load states**: a Claude and a Codex chip on each doc (state; reason on hover), judged for a folder the user picks
  from the index's contexts (`c`), the home folder by default. A session's Docs tab uses that session's own states.
- **Create**: `a` new doc by kind, `A` new file by path. By kind covers instructions, rule, skill, subagent, command,
  learning, reference, feature doc and follow-up; each kind offers only the places the index finds it in, and writes
  at its standard path with a starter template (a skill gets `name`/`description` frontmatter); a follow-up is
  appended to the home's `followups.md` through the shared follow-up file module (`src/shared/followups/`), in the
  file's own shape (`../backlog/design.md` § Tags); a missing or empty `followups.md` starts from
  the canonical new-file text named for the home folder's base name, a title already in the file is refused, and the
  editor opens on the new item's line. The path box lists matching folders and files
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
  `~/wigley-agents`. Never the home folder itself, and never a third-party entry or anything inside a plugin cache or
  a config folder's `skills/synced`.
- **Read-only docs**: a `third-party` entry, and any file inside a plugin cache (an installed-only file), opens
  read-only with one line: `Downloaded copy — <plugin, or synced skill>. Edits are lost on its next update.` for a
  third-party entry, `Installed copy — <plugin key>. Edits are lost on its next update.` for an installed-only file;
  `i`, rename and delete refuse it with that line, and so does main's write guard. Create offers no place inside one.
- **Hook and plugin entries** show a detail view (event, matcher, command / version, enabled) whose edit key opens
  the settings or config file holding it in the same editor.
- **Disk changes**: the open file is watched, through a one-level watch (`recursive: false`) on its folder, so a doc
  directly in `~/.claude` hears no transcript write under `~/.claude/projects`. The rendered view reloads by itself; while editing, a banner says the
  file changed, and `:w` asks reload-or-overwrite.
- **Links**: a relative link to a file opens it in the browser, an http or https link opens in the default browser (any other scheme is refused), a
  `#heading` link moves within the doc; the wiki adds section links, `wiki:` and `wigley:` links and the doc's history (`../docs-wiki/design.md` § Links, § Keys). Links are real anchors: Tab moves between them, Enter follows. Forms keep literal links.
  Images show their alt text.
- **Keys** (scopes `docs.tree`, `docs.doc`, `docs.conflict`, `docs.picker`, `docs.box`, `docs.confirm`): tree `j`/`k`
  move; `l` opens a doc, expands a collapsed group or steps into an expanded one; Enter opens a doc and focuses
  it (on the doc already shown it only focuses it, keeping an open editor), or toggles a group, expanding or
  collapsing it as `l` and `h` do, and under a filter, which shows every group expanded, steps into a group as `l`
  does; `h` collapses a group or goes to the parent; `/` filter, `a`, `A`, `r`, `d`, `R` rescan,
  `c` pick the load-state folder, `s` star or unstar the selected doc; `Alt+l` / `Alt+h` (the core's `panes.focusRight` / `panes.focusLeft`) move focus between tree and doc while the tree shows (the doc pane's `‹ tree ⌥H` edge prompt hides with the tree, and the empty doc's hint names `Esc tree`); `Ctrl+j`/`Ctrl+k` and
  `Ctrl+Shift+j`/`Ctrl+Shift+k` scroll the doc beside the tree.
  The wiki adds `e`, `Ctrl+h`, `Ctrl+l`, `Ctrl+o`, `Ctrl+i`, `gh`, `l` and Enter on the doc, and `gh` on the tree (`../docs-wiki/design.md` § Keys), and `s` refuses on a wiki row.
  Doc `j`/`k` scroll, `Ctrl+j`/`Ctrl+k` scroll the doc a line and `Ctrl+Shift+j`/`Ctrl+Shift+k` half a page, the
  editor too while editing, `i` edit, Esc (`docs.backToTree`) focuses the tree, showing it first when hidden; Esc in the editor's normal mode closes
  the editor as `:q` does.
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
  the page; `docs-session-tab` adds a Docs tab per session, and forms a popup through `addPopup`. The pattern mirrors main's `contributeTools`.
- **Markdown** (seam): the markdown service gains a document render with links and highlighted code; `block` and
  `inline` keep literal links. The highlighter reaches the markdown adapter through its own contract, so markdown-it
  and CodeMirror each stay behind one adapter folder.
- **Document editor** (depth): separate from the small text box: load text, go to line, read-only, the file's
  language, and `:w` / `:q` / `:wq` / `:q!` as save and close events. Form boxes keep their small interface.
- **Pure, tested modules** (locality): index parsing and its `schemaVersion` check, tree grouping, path completion,
  frontmatter split, kind templates and target paths, link resolution, the on-disk-changed check.

## Ownership and plugin-source status (plan C)

The user's aim: see which docs are the user's own — on disk, edited in place or pushed — apart from downloaded
third-party copies, edit the user's own marketplace skills from the clone, and see how each edit stands against what
sessions load.

- **Ownership is the index's** (schema 3, `docs_index.py` README): each entry's `owner` is `mine` or `third-party`.
  Third-party: a file of an installed plugin whose marketplace has no indexed clone listing it, and a synced skill bucket
  (`~/.claude/skills/synced/`, Anthropic's skills). Mine: everything else. The app groups, guards and offers create
  places by `owner` alone, and reads no plugin config of its own.
- **Marketplace clones**: a clone holding `.claude-plugin/marketplace.json` has each listed plugin's files indexed
  from its `source` folder. An installed plugin whose marketplace URL names the same `<owner>/<repo>` as a clone's
  origin (an SSH host alias and `https` match) is merged into the clone: each installed file with a counterpart
  leaves the document, and the clone entry carries its install in `meta.installed` (harness, version, cache path) and
  takes its load states. So the user sees each own file once, at the path the user edits, with how it loads. An
  installed file the clone lacks shows under the plugin's Installed only node, read-only.
- **Statuses**, per clone plugin file and per harness, each one step of commit → push → update → restart. The app
  runs `git` through the processes service; the index runs none. Each shows as a chip on the doc and a mark on its
  tree row:

  ```
  working file ≠ HEAD                → Uncommitted
  HEAD ahead of its upstream (@{u})  → Unpushed
  @{u} ≠ installed copy              → Not installed · <harness>   (or: no installed copy, a new file)
  session loaded another version     → Session stale               (a session's Docs tab only)
  ```

  "Not installed" hashes each installed copy's bytes (and again with CRLF turned to LF) as a git blob and compares it
  with the file's blob in `git ls-tree @{u}`, which works for Codex, whose install records no commit; it is judged
  only for a harness the plugin is installed for. A clone branch with no upstream shows Uncommitted alone. "Session
  stale" compares the session context's `loadedPlugins` version with the Claude installed copy's; a session that
  named no file of the plugin shows none. A file with every status clear shows none. A plugin, repo or clone node
  shows the rollup (`3 uncommitted · 12 not installed for Codex`).
- **Fetch**: when Docs first opens and on Rescan, each clone with plugin files runs `git fetch` in the background,
  capped at 15 s; statuses show at once from the last fetch and refresh after it. A failed or capped fetch shows
  `origin as of <time>` on the repo node (the clone node in a split repo), the time of the clone's last fetch, or
  `origin never fetched` when it has none.
- **Skill folder files**: every file beside a skill's `SKILL.md`, at any depth, is a `skill-file` entry (references,
  templates, scripts the skill tells agents to run), `not-loaded` for both harnesses.
- The schema change lands in both repos together, with no fallback for schema 2.

## Recency and stars (plan D)

The user's aim: see the docs agents use most recently first, see when each was last loaded, and keep favourite docs
at the top of the tree.

- **Last loaded is the index's** (schema 4, `docs_index.py` README § Last loaded): each entry's `lastLoaded` is the
  latest transcript row that loaded it — an instruction or nested load, an `@` mention, a skill, a `Read`, a subagent
  launch, a slash command — subagent transcripts included. Docs mode reads the machine-wide time; a session's Docs tab
  reads that session's own, as it reads that session's load states. Codex records no loaded files, so Codex sessions
  add no times (follow-up). Times refresh with each index build: launch and Rescan for Docs mode, each load of a
  session's Docs tab.
- **Order**: inside every group, its docs sort by `lastLoaded`, newest first, and docs with none follow, by title
  as before. A skill group counts as a doc here: it sorts among its siblings by the newest time of any file in it,
  and keeps `SKILL.md` first inside it. Every other group keeps its fixed place (Global, Plugins, repos, clones,
  plugins, kinds in index order, feature folders), so a doc stays where the user knows it. A follow-up item takes its
  file's time.
- **Time on a row**: a doc with a time shows it dimmed at the row's end, short and relative — `now` under a minute
  (and for a time ahead of the clock), `4m` under an hour, `3h` under a day, `2d` under a week, `5w` under 8 weeks,
  then the local date, `Mar 3`, with the year when it is not the current one (`Mar 3, 2025`) — and the full local
  date and time on hover. A doc never loaded shows none. The doc view adds `Loaded 3h ago` (`Loaded just now`, `Loaded Mar 3`) beside its
  load chips. A row's time is drawn fresh on each redraw of the tree; nothing redraws on a timer.
- **Starred**: `s` on a doc row stars or unstars it, and the row shows a filled star at its start, where a group shows its chevron. A **Starred** group above Mine
  lists every starred doc the view's index holds, newest loaded first; each also stays in its usual place, starred
  there too. The group shows only when it holds a doc, carries no status rollup, and the filter applies to it as to
  any group. The group starts expanded, also when it first appears in a later tree (the first star, or an index
  that now holds a starred doc). `s` on a group row does nothing. An unstar in any view that removes the view's selected Starred row selects
  the doc's usual row there, since the Starred row is gone. A rename that carries every star leaves a collapsed Starred
  group collapsed. Opening a doc in Docs mode from elsewhere selects its usual place.
- **One star set**, saved in the docs plugin's `uiState` by entry id, shared by Docs mode and every session's Docs
  tab; starring in one view shows in all. The stable and dev apps keep separate stars, as they keep separate split
  widths. A rename or move through the app carries the star to the new path; a trash through the app drops the star
  of every entry it removes; a rename or trash that leaves the set the same saves nothing. A starred doc that leaves
  the index another way keeps its star, hidden until it returns.

## Out of scope

Follow-ups in `../followups.md`: fuzzy finders (`Space f f` files, `Space f s` text, on a Neovim finder's matcher),
keyboard link hints, images in rendered docs, the user config file, settings hot reload, the plugin sync action
(commit, push, update and reload from the Docs view, on plan C's statuses), and Codex last-loaded times (plan D).
