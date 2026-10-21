# Docs browser B — the docs plugin — plan

Feature: docs browser (`../design.md`) · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui, `main` in wigley-ai-marketplace · Written: 2026-10-19

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user browses, reads and edits every agent doc on the machine inside the app. Docs mode (`Space k d`) shows a tree
over the docs index — Global, Plugins, then one node per repo — beside the selected doc, rendered with working links
and highlighted code, with Claude and Codex load-state chips. `i` swaps the doc to a vim editor; `:w` saves. The user
creates (by kind or by path, with path completion), renames and deletes (to the Trash) docs. Each agent session's
Docs tab shows the same view over that session's own index. A change on disk reloads the view.

## Architecture

Systems touched:

- **core main services** (`src/contracts/files.ts` and its adapters `src/main/files/`, `src/shared/memory-files.ts`,
  `src/shared/scoped-files.ts`; new `src/contracts/processes.ts`, `src/main/processes/`; `MainServices` in
  `src/contracts/plugin.ts`, `src/main/main.ts`): the existing files seam gains stat, real paths, folders, rename and
  trash, and a new processes service, for every main part.
- **code highlighting and markdown** (`src/contracts/highlight.ts`, `src/contracts/markdown.ts`,
  `src/renderer/codemirror-vim/`, `src/renderer/markdown-it/markdown-it-renderer.ts`, `src/renderer/renderer.ts`,
  theme tokens): a document render with links and highlighted code.
- **document editor** (`src/contracts/editor.ts`, `src/renderer/codemirror-vim/codemirror-vim-host.ts`): a full-file
  vim editor with languages, line numbers, read-only, and `:w` / `:q` events.
- **docs plugin** (new `src/plugins/docs/`): pure modules shared by both parts, a main part (index runs, guarded file
  changes, watching), a page part (Docs mode, session Docs tabs, the view, CRUD).
- **docs index** (wigley-ai-marketplace `plugins/wigley/scripts/docs-index/`): `claudeConfigDirs`; the plugin version
  bump task 03's rule gives.

## Preconditions

Each re-run by `wigley:make` before the first dispatch:

- Plan A landed: every box in `../plan-a-layout/plan.md` ticked (`grep -c -- "- \[ \]" ../plan-a-layout/plan.md` → 0),
  and its interfaces exist: `grep -c "addTab" src/plugins/sessions/contract.ts` → ≥ 1; `grep -c "modes" src/contracts/plugin.ts`
  → ≥ 1; `grep -c "scope" src/contracts/keymap.ts` shows `EditorBind` with `scope`.
- Docs-ahead commits present: `git -C ~/Documents/dev/wigley-ai-gui log --oneline | grep -c -e 80f9941 -e 57feb26 -e a550cbd` → 3;
  `git -C ~/Documents/dev/personal/wigley-ai-marketplace log --oneline | grep -c -e 44bf63a -e 96ce948` → 2.
- Trees clean in the touched areas: `git -C ~/Documents/dev/wigley-ai-gui status --porcelain -- src scripts package.json`
  → empty; `git -C ~/Documents/dev/personal/wigley-ai-marketplace status --porcelain -- plugins/wigley` → empty.
  On any output, stop and ask the user whose the changes are.
- **Packages — a per-run ask.** The user approved `@codemirror/lang-markdown`, `@codemirror/language-data`,
  `@lezer/highlight`, `@codemirror/language`, `@codemirror/state` and `@codemirror/view` in the interview (the last four
  already installed under `codemirror`, now declared directly); this Mac's settings deny the agent `npm install`.
  Check that all six are in `package.json`'s dependencies; when any is missing, stop before wave 1 and ask the user to
  run `! npm install @codemirror/lang-markdown @codemirror/language-data @lezer/highlight @codemirror/language @codemirror/state @codemirror/view`,
  then commit `package.json`
  and `package-lock.json` as their own commit.
- Docs index schema 1: `grep -c "SCHEMA_VERSION = 1" ~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/model.py`
  → 1.
- The docs index reads only `~/.claude`: `grep -c claudeConfigDirs ~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/config.py`
  → 0.
- Plugin version: task 03 bumps per the marketplace's one-bump-per-pushed-series rule (its task document says how);
  at plan time local `main` read `1.4.0`, unpushed, and origin `1.3.1` (measured at plan time, re-verify).

## Docs written ahead

- wigley-ai-gui `AGENTS.md` (intro's docs sentence, the `files/`, `processes/`, `codemirror-vim/` and `docs/` lines of
  the layout tree, **An ambient service**, **A third-party tool**) — commits `80f9941`, `57feb26`, `a550cbd`.
- wigley-ai-marketplace `plugins/wigley/scripts/docs-index/README.md` (Config: `claudeConfigDirs`; Commands:
  `session`) — commit `44bf63a`; (Config's shape sentence, Load states' config-folder rules, plugin `installs`) —
  commit `96ce948`.
- `../design.md` § Docs browser, § Core services and seams.

## Mandatory Reads

- `~/Documents/dev/wigley-ai-gui/AGENTS.md`
- `~/Documents/dev/personal/wigley-ai-marketplace/AGENTS.md`, `CLAUDE.md` (task 05 only)
- `~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/README.md` (the index schema and
  load states; tasks 05, 06, 07, 08, 09)
- `../design.md`
- Skills: `wigley:codebase-design`, `wigley:writing-code`, `wigley:writing-tests`

## Design Overview

```
 docs main part                                   docs page part
 ┌───────────────────────────────────────┐        ┌──────────────────────────────────────────────┐
 │ IndexSource adapters                  │ channel│ DocsView(source)                             │
 │  machine: files.read(index.json)      │◀──────▶│  tree pane │ doc pane                        │
 │           processes.run(python3 build)│        │  (tree.ts) │ chips · frontmatter table       │
 │  session: processes.run(session <id>) │        │            │ markdown.document(body) ⇄ editor│
 │           / context <dir>             │        │            │ banner on disk change           │
 │ guarded file ops (path-guard)         │        ├──────────────────────────────────────────────┤
 │  read · write(expected) · create      │        │ Docs mode  = DocsView(machine)   Space k d   │
 │  rename · trash · list · watch        │        │ Docs tab   = DocsView(session)   addTab      │
 └──────────────┬────────────────────────┘        └──────────────────────────────────────────────┘
                │ services.files / services.processes (core, Node adapters; fakes in tests)
```

**Decisions** (each from `../design.md`; the section names the round)

- One `DocsView` module serves Docs mode and every session's Docs tab, given an index source; the main part runs the
  sources. Machine source: read `<home>/.agents/wigley-docs/index.json` at once (a missing file shows an empty tree
  with the message `No docs index yet — building…`), then `python3 <script> build` in the background on the first
  Docs mode show and on `R`; the tree reloads when it finishes. Session source: `python3 <script> session <host
  session id>` for a Claude session (or a session with no harness and a host session id, from a relay older than plan A), `python3 <script> context <project folder>` for a Codex session with a folder,
  and the message `No project folder is known for this session` otherwise; run on first show of the tab and on `R`.
  A script exit other than 0 shows its stderr's first line in the view and logs the whole.
- The script: `docs.scriptPath` setting when non-empty; else the `installPath` of `wigley@wigley-ai-marketplace` in
  `<dir>/plugins/installed_plugins.json` for each `<dir>` of `claudeConfigDirs` read from
  `<home>/.agents/wigley-docs/config.json` (default `["~/.claude"]`), first found, + `/scripts/docs-index/docs_index.py`.
  None found → the view shows `docs_index.py not found — set docs.scriptPath`.
- The index document is parsed and checked in TypeScript (`index-document.ts`): `schemaVersion` other than 1 shows
  `Unsupported docs index schema <n>; this app reads 1` and nothing else.
- Tree (`tree.ts`): roots `Global`, `Plugins`, then one node per `repo` name (sorted by name, case-insensitive);
  Global and each plugin and repo group their entries by kind (kind order as `KINDS` in the README); a repo with more
  than one `root` among its `source: repo` entries splits by clone (node title: the root's folder path with the home
  folder as `~`); a repo's `source: features` entries sit in a `Features` node inside the repo node, grouped by
  feature slug (`meta.feature` or `meta.slug`; a feature doc with neither by its feature folder, task 04). Entries in a group sort by title. Follow-up items open at their `line`.
- Load-state chips: `Claude <state>` and `Codex <state>` from the chosen context's `states[id]`; no state → `—`;
  reason as the chip's tooltip; `pending` for an entry changed since the last build. `c` picks the context folder from
  the index's `contexts` (home first, then by folder); default the home folder's context. A session tab uses its
  document's single context and has no picker.
- Rendered doc: frontmatter (a leading `---` block) splits off and shows as a two-column field table; the body
  renders with `markdown.document`. Links: a relative or absolute file path (optionally `#L<n>` or `:<n>`) opens that
  file in the same view when the index lists it or it sits inside an indexed folder (else a toast `Not an indexed
  doc: <path>`); `http(s)://` and `mailto:` open in the default browser through the docs main part
  (`shell.openExternal` stays in main); `#heading` scrolls to the heading whose slug matches (markdown-it's slug rule
  is the implementer's choice, used for both ids and lookups). Images render their alt text.
- Editing: `i` in the doc pane swaps to the document editor at the top visible line; `:w` writes when the file on
  disk still equals the text the editor loaded, else asks `File changed on disk — r reload, o overwrite, Esc cancel`;
  `:q` with unsaved edits is refused with the toast `Unsaved changes — :w to save, :q! to discard`; `:q!` drops them;
  `:wq` writes then returns. A watched change while rendered reloads the view; while editing shows the banner
  `Changed on disk since you opened it` until the next successful write or reload.
- Read-only: entries under a plugin install folder (`source: plugin`) open read-only, with the line
  `Plugin cache — <plugin>. Edit the source repo's copy.`; `i` toasts that line instead of editing. The same holds
  for any file opened inside a `source: plugin` entry's root.
- Hook entries show event, matcher and command, and `i` opens the settings file at the entry's `path`. Plugin entries
  read no file (their `path` is the install folder): they show harness, version, enabled and installs, and `i` opens
  `<dir>/plugins/installed_plugins.json` for the first `claudeConfigDirs` folder that lists the plugin's key (Codex:
  `~/.codex/config.toml`) at the key's line, editable.
- Create by kind (`a`): kind list `instructions, rule, skill, subagent, command, learning, reference, feature-doc,
  followup`; the place list holds only places where the index already holds that kind (the folders its entries'
  paths imply), plus Global for a kind found globally; then a name. Targets and templates live in `kinds.ts` and are
  pinned in task 04. Create by path (`A`): a path box under the selected node's folder with completion. Rename (`r`)
  uses the same path box, prefilled with the current path. Delete (`d`) asks `Move <name> to the Trash? y/n`; a
  skill's `SKILL.md` trashes its folder.
- Path box completion (`path-completion.ts`): as the user types, lists entries of the typed folder whose names start
  with the typed last segment (folders first, `/` suffixed, then files, each by name), at most 12; Tab completes the
  longest common prefix of the matches, or the single match; Enter accepts the typed path; Esc cancels.
- Main refuses every write, create, rename and trash outside the guard: the target's real path must be a path the
  current machine index lists, or lie inside one of its entries' `root`s, inside a `source: global` entry's folder,
  or inside a configured Claude config folder — and never inside a plugin install folder. The refusal names the path.
- After create, rename or trash the tree updates at once from the change and the machine source starts a background
  build; the changed entry's chips read `pending` until it lands.
- Docs mode keys (scope `docs.tree`): `j`/`k` move, `l`/Enter open or expand, `h` collapse or go to the parent, `/`
  filter by title or path, `a`, `A`, `r`, `d`, `R`, `c`, `<C-l>` focus the doc pane. Scope `docs.doc`: `j`/`k`
  scroll, `i` edit, `<C-h>` focus the tree. `Space k d` (`<Leader>kd` in a box) shows Docs mode, or toggles its tree
  when Docs already shows.
- Code highlighting: `@codemirror/language-data` finds a language by name or file name; `@lezer/highlight`'s
  `classHighlighter` emits `tok-*` classes for both the editor and rendered code; new `syntax.*` theme tokens colour
  them (this lands the follow-up 'Syntax-highlighting theme tokens'). An unknown fence language renders plain.

**Out of scope**: plugin-source status and skill folder files (plan C), fuzzy finders, keyboard link hints, images,
editing several files in splits.

## File Structure

Existing files modified:

- `src/contracts/files.ts` — `Files` gains `stat`, `realPath`, `makeFolder`, `rename`, `trash`; `FileStat` (task 01).
- `src/main/files/node-files.ts` (+ test) — the five members; `createNodeFiles({ trashItem })` (task 01).
- `src/shared/memory-files.ts` (+ new test), `src/shared/scoped-files.ts` (+ test),
  `src/shared/layouts/layout-registry.test.ts` — every other `Files` implementation gains the five members (task 01).
- `src/contracts/plugin.ts` — `MainServices.processes: ProcessRunner` (task 01; `files` is there already);
  `MainServices.openExternal(url: string): Promise<void>` (task 06; Electron's `shell.openExternal`, logged only in the
  self-test).
- `src/contracts/markdown.ts` — `MarkdownRenderer.document(text: string): Promise<string>`.
- `src/contracts/editor.ts` — `EditorHost.createDocument`, `DocumentEditor`, `DocumentEditorEvents`,
  `DocumentOptions`.
- `src/contracts/theme.ts`, `src/config/themes/catppuccin-mocha.json` — `syntax.*` tokens.
- `src/main/main.ts` — passes `trashItem` to `createNodeFiles` (`rm` under the self-test) and fills `processes`.
- `src/renderer/renderer.ts` — builds the highlighter and hands it to the markdown adapter.
- `src/renderer/markdown-it/markdown-it-renderer.ts` (+ test) — `document`.
- `src/renderer/codemirror-vim/codemirror-vim-host.ts`, `editor-theme.ts` — `createDocument`.
- `src/plugins/manifests.ts`, `main.ts`, `page.ts` — the docs plugin.
- `src/plugins/forms/main/selftest-script.ts` — the steps the session Docs tabs change (task 09).
- `scripts/check-layers.mts` — every entry this plan needs lands in task 01 alone, so wave-1 tasks share no file:
  `src/main/processes`, `src/plugins/docs`, `src/plugins/docs/contract.ts`, `src/plugins/docs/main`,
  `src/plugins/docs/page`, the composition roots' lists, and the six `@codemirror/*` and `@lezer/highlight` packages
  for `src/renderer/codemirror-vim` (`src/main/files` is in the table already).
- `package.json`, `package-lock.json` — the user's install (Preconditions).
- wigley-ai-marketplace `plugins/wigley/scripts/docs-index/` (`config.py`, `environment.py`, `discover.py`,
  `claude_rules.py`, `session.py`, `docs_index.py`, tests) and both `plugin.json` manifests.

New files (each justified by a seam or a decision above):

- `src/contracts/processes.ts`, `src/contracts/highlight.ts` — the seams.
- `src/main/processes/node-processes.ts` (+ test) — the adapter.
- `src/shared/fake-processes.ts` — the second adapter, for plugin tests, beside `memory-files.ts`.
- `src/renderer/codemirror-vim/languages.ts` — language lookup shared by the editor and the highlighter;
  `src/renderer/codemirror-vim/codemirror-highlighter.ts` — `CodeHighlighter` adapter.
- `src/plugins/docs/manifest.ts`, `contract.ts`, and pure shared modules (+ tests): `index-document.ts`, `tree.ts`,
  `frontmatter.ts`, `kinds.ts`, `links.ts`, `path-completion.ts`, `path-guard.ts`.
- `src/plugins/docs/main/start.ts`, `index-sources.ts`, `script-locator.ts`, `doc-files.ts` (+ tests),
  `selftest-fixture.ts`, `selftest-script.ts` (the docs plugin's own self-test script, task 09).
- `src/plugins/docs/page/start.ts`, `docs-view.ts`, `tree-view.ts`, `doc-view.ts`, `docs-dialogs.ts`, `docs.css`,
  and page-side state modules with tests where a decision lives (`docs-state.ts`).

Interfaces every task shares (exact names; the task documents spell them the same):

```ts
// src/contracts/files.ts — the tree's members, then task 01's five
export interface FileEntry { path: string; kind: 'file' | 'folder'; }  // path relative to the folder listed
export interface FileStat { isFolder: boolean; }
export interface FileWatch { close(): void; }
export interface Files {
  read(path: string): Promise<string>;
  // Writes through a temp file in the same folder, then renames; creates parents.
  write(path: string, text: string): Promise<void>;
  list(folder: string, options?: { recursive?: boolean }): Promise<FileEntry[]>;  // missing folder → []
  // Reports each changed path under `folder`, relative to it, debounced 100 ms per path.
  watch(folder: string, onChange: (path: string) => void, onError?: (error: unknown) => void): FileWatch;
  stat(path: string): Promise<FileStat | null>;     // follows links; null when nothing is there
  realPath(path: string): Promise<string>;
  makeFolder(path: string): Promise<void>;           // with parents
  rename(from: string, to: string): Promise<void>;   // rejects `<to> already exists`
  trash(path: string): Promise<void>;                // the OS Trash; deletes for good under the self-test
}

// src/contracts/processes.ts
export interface ProcessResult { code: number; stdout: string; stderr: string; }
export interface ProcessRunner {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<ProcessResult>;
}

// src/contracts/highlight.ts
export interface CodeHighlighter {
  // HTML of `code` with tok-* spans, or null when `language` is unknown.
  highlight(code: string, language: string): Promise<string | null>;
}

// src/contracts/editor.ts (added)
export interface DocumentOptions { fileName: string; readOnly: boolean; line: number; }
export interface DocumentEditorEvents {
  changed(text: string): void;
  write(): void;               // :w
  quit(force: boolean): void;  // :q, :q!
  writeQuit(): void;           // :wq, :x
  modeChanged(mode: VimMode): void;
}
export interface DocumentEditor extends TextEditor {
  setText(text: string): void;   // replaces the whole text, keeping the cursor line where it can
  goToLine(line: number): void;  // 1-based
}
// EditorHost gains:
//   createDocument(parent: HTMLElement, doc: string, options: DocumentOptions, events: DocumentEditorEvents): DocumentEditor;
```

The index-document and create types (`src/plugins/docs/contract.ts`) and the pure-module signatures are produced in
task 04, the docs channel (added to the same `contract.ts`) in task 06, and named there. Plan A's task documents
produce `Mode.shown()`, `SessionTabView.shown()` and `SessionTabHandle.isVisible()`, which tasks 07 and 08 consume.

Boundary rules: `src/plugins/docs` imports `src/contracts`, `src/shared`, and `src/plugins/sessions/contract.ts`
(page: also `src/plugins/keys/contract.ts`, `src/shared/page`); `src/main/files` and `src/main/processes` import
`src/contracts` and `node:` only (main.ts injects Electron's `shell.trashItem`); test doubles live in `src/shared`
beside the tree's own (`memory-files.ts`, `fake-agent-harness.ts`), named for what they are.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Core files and processes services](01-core-services.md)
- [x] [Docs index: claudeConfigDirs](03-index-config-dirs.md)
- [x] [Docs pure modules](04-docs-pure-modules.md)

### Wave 2
- [x] [Code highlighter and markdown document render](02-highlight-and-document-render.md) — after 01 (its lint needs 01's layer entries)
- [x] [Docs main part](06-docs-main.md) — after 01, 04

### Wave 3
- [x] [Document editor](05-document-editor.md) — after 02

### Wave 4
- [x] [Docs view, Docs mode and Docs tabs](07-docs-view.md) — after 02, 04, 05, 06

### Wave 5
- [x] [Create, rename, delete, detail views](08-docs-crud.md) — after 07

### Wave 6
- [x] [Self-test](09-selftest.md) — after 08

### Wave 7
- [x] [Doc re-read](10-doc-re-read.md) — after 09

### Wave 8
- [ ] [Final verification](11-final-verification.md) — after 10

## Run log

Review base: wigley-ai-gui `22c3c425c50c4177851ff96a75a1e5f9c6cfb2f0` · wigley-ai-marketplace `b619e201ae82735a399cedc0a16309efdbefe73e`

Peer session `wigley-ai-gui-39` runs agent-chat plan A on the same tree: every commit is pathspec-scoped and the
review range is this run's explicit commit list.

### Groups
- 03 · wigley-ai-marketplace `b13aa84` · proved: diff read, every Produces present, 148 docs-index tests and
  `check_manifests.py` pass · concerns: on this Mac `~/.claude-personal/plugins`, `skills` and `CLAUDE.md` are symlinks
  into `~/.claude`, so shared files come out as single entries judged as user files whichever folder is judged; task 11
  confirms on the real build. A config folder not named `.claude` now reads `Claude Code file` for Codex, as the
  README intends
- 04 · wigley-ai-gui `03b19ed` · proved: diff read, all 47 Produces names exported, typecheck, 65 tests, lint pass ·
  concerns: a feature slug equal to a kind name (`task`) gets the same tree id as that kind's group under Features;
  `changeRefusal` makes a global ancestor `CLAUDE.md`'s whole parent folder writable, which can be the home folder;
  a global `instructions` place outside `~/wigley-agents` creates a file nothing loads
- 01 · wigley-ai-gui `af32f7f` · proved: diff read, the five methods in the contract and all four Files, processes
  seam, adapter and fake present, main.ts wiring, typecheck and lint pass (worker: 1282 tests and selftest pass) ·
  concerns: Node `rename` checks `to` then moves, so a path created at `to` in between is replaced (no
  non-replacing rename in Node); `node-processes.test.ts` assumes Vitest runs on plain Node
- 06 · wigley-ai-gui `751d48e` · proved: diff read, all 49 Produces names present, docs part last in `mainParts`,
  typecheck and lint pass (worker: 48 new tests and selftest pass) · concerns: a dangling symlink counts as missing,
  so a write there replaces the link with a plain file; a non-missing read error during script lookup rejects
  instead of skipping that file; the start wiring has no unit test (09's steps cover it)
- 02 · wigley-ai-gui `a2172ee` · proved: diff read, every
  Produces present, 16 `syntax.*` tokens in theme and catppuccin, renderer wiring, typecheck and lint pass (worker:
  1354 tests and selftest pass) · concerns: the document instance's render rules cast `env` to `DocumentEnv`, safe
  only while `renderDocument` is that instance's one caller
- 05 · wigley-ai-gui `92330de` · proved: diff read, every Produces present, typecheck and lint pass (worker: 1359
  tests and selftest pass) · concerns: a failed language load leaves plain text and an unhandled rejection in the
  console; the editor's ex keys, read-only edits, start line and highlighting run only in a DOM, left to 09 and 11
- 07 · wigley-ai-gui `af98bc3` · proved: diff read, every Produces present, typecheck and lint pass (worker: 1372
  tests pass) · self-test: 38 fail / 114 pass, all after sessions gained a Docs tab — first `<A-o>` → `no other tab
  in selftest 2`, `<A-S-i>` → `nothing shown in Codex session`, `[chat] Chat tab shown in chat-selftest` (the rest of
  chat's follow) — task 09's to fix · concerns: `:q` destroys the editor inside its own ex handler (live check, 11);
  each removed session leaves an inert `docChanged` listener (the channel has no `off`); `dispose()` does not pop an
  open filter box's scope
- 08 · wigley-ai-gui `a6abd2e` · proved: diff read, every Produces present, typecheck and lint pass (worker: 139 docs
  tests pass; self-test fails only 07's 38 Docs-tab steps) · concerns: 07's `dispose()` filter-box scope and inert
  `docChanged` listeners stay open; Tab in the path box may move browser focus if the keys engine lets the default
  through (live check); the dialog flows have no unit tests (09's steps, 11's checks)
- 09 · wigley-ai-gui `c5bc3de` + fix `e461903` · proved: diff read, typecheck and lint pass; the self-test exposed
  one product bug (create by kind or path left the key scope on the tree, failing docs steps 18 and 27), fixed in
  `e461903` (`openInEditor` calls `focusDoc`); after the fix `npm run selftest` gives 208 PASS, 0 FAIL, twice, with
  forms', chat's and docs' results as expected · concerns: why the doc pane's `focusin` did not fire under the
  self-test is unproven (likely no OS focus); fix holds either way
- 10 · wigley-ai-gui `1939b4f` · proved: diff read; four AGENTS.md lines fixed (Docs tab clause, `openExternal` in
  the ambient services, text-box key rule, docs self-test sentence), followups' `@codemirror/view` note dropped; the
  intro, layout tree, third-party-tool line, the docs-index README and design.md hold · concerns: design.md's
  "scopes docs.tree, docs.doc" omits the dialog scopes (conflict, picker, box, confirm) — carried to Close
### Contract changes
- `tree.ts`: adds `compareTitles(a, b): number` (base-sensitivity `localeCompare`, code-unit tie-break), used by
  `kinds.ts` · why: places sort as tree nodes do · consumers: 08 may use it · group 04
- `_Scope` (private) gains `written_home` · why: other-folder reasons need the unresolved home for `home_relative`
  · consumers: none · group 03
- `script-locator.ts` also exports `readIfPresent`, `installedPluginsFile`, `DOCS_CONFIG_FILE`; `index-sources.ts`
  exports `MACHINE_INDEX_FILE` · why: doc-files and the fixture share them and the Files list allowed no new shared
  module · consumers: 08, 09 · group 06
- `Chip` gains `state` (sets `data-state`); `DocsViewDeps` gains `pushScope('conflict' | 'picker' | 'box')`;
  `DocsViewCommands` holds all 22 view commands; new exports `createDocView`/`DocTarget`, `createTreeView`,
  `textBoxInput` (the list picker stays internal to docs-view.ts) · consumers: 08 · group 07
- 07's list picker moves from `docs-view.ts` to `docs-dialogs.ts` (else the two import each other);
  `DocsPushedScope` gains `'confirm'`; `DocTarget.isHeaderOnly` → `detail: DocDetail | null`; `DocView` gains
  `retarget`, `clear`, `edit(line?)`; `TreeView` gains `selected()` (`tree-view.ts`, outside 08's Files list)
  · consumers: 09 · group 08
### Rulings
- links: an href `<no colon>:<digits>` ending or followed by `#`/`?` is a line suffix, not a scheme (the pinned test
  `resolve_ColonLine_Resolved` contradicts step 3's regex) — `x:123` would read as a file and toast — group 04
- links: `file://` hrefs decode once; an empty fragment is `null` — group 04
- path-completion: a relative folder part resolves against the home folder — group 04
- kinds: `createTarget` trims the name; `placesFor` takes the first entry's title for a shared folder — group 04
- index-document: a non-object context reports `malformed: folder` — group 04
- 03's locate test passes the real path of the temp `dotclaude` (macOS `/var` → `/private/var`) — group 03
- Run 03 and 04 now; hold 01, 02, 05–11 and the package install until agent-chat plan A closes, then rewrite task 09
  for agent-chat's per-plugin self-test scripts before dispatching it — the plans share `plugin.ts`, `main.ts`,
  `check-layers.mts`, the plugin lists and `package.json` — user, in the preflight round · lead
- Version: origin `main` and local both read `1.4.0`, so task 03 bumps both manifests to `1.5.0` · lead
- Files seam: `src/contracts/files.ts` already exists (`191f4d7`, the forms layouts run) with a recursive `list`
  of `{ path, kind }` and a folder `watch`. Task 01 extends it in place with `stat`, `realPath`, `makeFolder`,
  `rename` and `trash`, in the Node adapter and in `src/shared/memory-files.ts`, and keeps `list` and `watch` as
  they are; 06 maps `list` to `{ name, isFolder }` and watches a doc's folder, filtering on the file's name; tasks
  01, 06 and 09 and plan.md's File Structure are amended before dispatch — user, in the resume round · lead
- Order: docs browser B runs to close before agent-chat plan B starts, since both extend the files seam and the
  editor host — user, in the resume round · lead
- Agent-chat A closed at `e0afe84`; tasks 01–11's remaining docs are re-checked against it (jk remap gone,
  `EditorBind` mode `insert`, per-plugin self-test scripts, `TabsState.selections`, take-over release wording)
  before dispatch · lead
- The amended 06 watches a doc's parent folder with the tree's recursive `watch`, so a doc directly in `~/.claude`
  also sees every transcript write under `~/.claude/projects`; kept, since one watch per open view filters by name
  on a debounced FSEvents stream and the user chose to keep `watch` as it is — costs a little CPU while sessions
  stream; a non-recursive option is the fix if it shows · lead
- Tasks 07 and 08's "`npm run selftest` still passes" is proved at the test gate after 09, which holds the forms
  and chat step edits that Docs tabs require; 07's and 08's per-group proof is the diff read and compile · lead
- 09 also edits chat's self-test steps a chat session's Docs tab breaks (amendment worker's concern: 07 gives
  every session a Docs tab and pins no tab order) · lead
- Node `rename` passes a non-ENOENT `lstat(to)` error on without moving; MemoryFiles `rename` refuses a move into
  its own subtree; MemoryFiles `makeFolder` on a file rejects `EEXIST`; scopedFiles `realPath` checks the inside
  by `/`-prefix of real paths; the self-test `trashItem` is `rm` recursive without `force` — group 01
- rename and trash act on the guard's real path, as write does: a hand-typed path through a symlink moves or
  trashes the link's target, not the link (index paths are already real) — matches write's symlink rule — a user
  deleting a linked doc by typed path loses the target · group 06
- overlapping `watchDoc` calls for one view: the later wins; `unwatchAll` also cancels a watch still starting
  · group 06
- the table test asserts `<table data-source-line="1">` (Source lines rule puts it on `table_open`); fences
  highlight with `Promise.all`; repeated slugs take a numeric suffix; paths split on `/` and `\\` — group 02
- hosted entries gain an optional `answerEx` so the shared ex handler reaches a document's events; the host
  imports `syntax.css` itself; `documentExEvent` throws on an unknown name — group 05
- `<C-h>` with the tree hidden shows it; an index read error shows in the status line and keeps the doc; an
  older overlapping load never overwrites a newer; the filter box, picker and conflict prompt close when the base
  scope changes under them; the view's own write never raises the banner — group 07
- a source run that lands re-applies every change made after it was asked, on top of its document, so a run asked
  before a create never drops the new leaf — group 08
- chat sessions open on their Docs tab; chat's `shownLine` is `[sessions] activated chat-selftest` and its first
  step became three `<A-o>` steps selecting each session's Chat tab; later chat steps unchanged — group 09
### Review rounds
### Test gate
- Pass 1, tests this run wrote or edited (22 files) and pass 2, tests importing a changed module by resolved path (18
  files: `contracts/plugin`, `contracts/theme`, `contracts/editor`, `shared/memory-files` importers); a first
  basename grep pulled in containers (`contract`, `manifest`, `start`) and was re-derived · vitest: 40 files, 496
  tests passed; docs-index 148 tests OK; typecheck and lint clean · `npm run selftest` 208 PASS, forms', chat's and
  docs' results as expected, `all passed` · log scan: 4 `[Unhandled error] TypeError … 'searchState_'` from
  `@replit/codemirror-vim` after docs editor ex commands (`:w`, refused `:q`, the editor a create opens) — fix
  dispatched
- Gate fix `94e9067` (the host destroys a view on the next microtask, so vim's `onPromptClose` no longer reads a
  nulled `cm.state.vim` after `:q`; the 4 errors were the `:q`/`:q!` steps, printed above their PASS lines): no test
  imports the host; `npm run selftest` 208 PASS, 0 FAIL, 0 unhandled errors on two runs; typecheck and lint clean
