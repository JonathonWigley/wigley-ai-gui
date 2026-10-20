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

- **core main services** (`src/contracts/files.ts`, `src/contracts/processes.ts`, `MainServices` in
  `src/contracts/plugin.ts`, new `src/main/files/`, `src/main/processes/`, `src/main/main.ts`): files (with watching)
  and processes for every main part.
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

- `src/contracts/plugin.ts` — `MainServices.files: Files`, `MainServices.processes: ProcessRunner` (task 01);
  `MainServices.openExternal(url: string): Promise<void>` (task 06; Electron's `shell.openExternal`, logged only in the
  self-test).
- `src/contracts/markdown.ts` — `MarkdownRenderer.document(text: string): Promise<string>`.
- `src/contracts/editor.ts` — `EditorHost.createDocument`, `DocumentEditor`, `DocumentEditorEvents`,
  `DocumentOptions`.
- `src/contracts/theme.ts`, `src/config/themes/catppuccin-mocha.json` — `syntax.*` tokens.
- `src/main/main.ts` — fills `files` and `processes`.
- `src/renderer/renderer.ts` — builds the highlighter and hands it to the markdown adapter.
- `src/renderer/markdown-it/markdown-it-renderer.ts` (+ test) — `document`.
- `src/renderer/codemirror-vim/codemirror-vim-host.ts`, `editor-theme.ts` — `createDocument`.
- `src/plugins/manifests.ts`, `main.ts`, `page.ts` — the docs plugin.
- `src/plugins/forms/main/selftest-script.ts` — docs steps (only one self-test script runs).
- `scripts/check-layers.mts` — every entry this plan needs lands in task 01 alone, so wave-1 tasks share no file:
  `src/main/files`, `src/main/processes`, `src/plugins/docs`, `src/plugins/docs/main`, `src/plugins/docs/page`,
  `src/shared/testing`, the composition roots' lists, and `@codemirror/lang-markdown`, `@codemirror/language-data`,
  `@lezer/highlight` for `src/renderer/codemirror-vim`.
- `package.json`, `package-lock.json` — the user's install (Preconditions).
- wigley-ai-marketplace `plugins/wigley/scripts/docs-index/` (`config.py`, `environment.py`, `discover.py`,
  `claude_rules.py`, `session.py`, `docs_index.py`, tests) and both `plugin.json` manifests.

New files (each justified by a seam or a decision above):

- `src/contracts/files.ts`, `src/contracts/processes.ts`, `src/contracts/highlight.ts` — the seams.
- `src/main/files/node-files.ts` (+ test on a temp folder), `src/main/processes/node-processes.ts` (+ test) — adapters.
- `src/shared/testing/memory-files.ts`, `src/shared/testing/fake-processes.ts` — the second adapters, for plugin tests.
- `src/renderer/codemirror-vim/languages.ts` — language lookup shared by the editor and the highlighter;
  `src/renderer/codemirror-vim/codemirror-highlighter.ts` — `CodeHighlighter` adapter.
- `src/plugins/docs/manifest.ts`, `contract.ts`, and pure shared modules (+ tests): `index-document.ts`, `tree.ts`,
  `frontmatter.ts`, `kinds.ts`, `links.ts`, `path-completion.ts`, `path-guard.ts`.
- `src/plugins/docs/main/start.ts`, `index-sources.ts`, `script-locator.ts`, `doc-files.ts` (+ tests),
  `selftest-fixture.ts`.
- `src/plugins/docs/page/start.ts`, `docs-view.ts`, `tree-view.ts`, `doc-view.ts`, `docs-dialogs.ts`, `docs.css`,
  and page-side state modules with tests where a decision lives (`docs-state.ts`).

Interfaces every task shares (exact names; the task documents spell them the same):

```ts
// src/contracts/files.ts
export interface FileStat { isFolder: boolean; modifiedMs: number; size: number; }
export interface FolderEntry { name: string; isFolder: boolean; }
export interface FileWatch { close(): void; }
export interface Files {
  read(path: string): Promise<string>;
  // Writes through a temp file in the same folder, then renames.
  write(path: string, text: string): Promise<void>;
  stat(path: string): Promise<FileStat | null>;     // null when nothing is there
  realPath(path: string): Promise<string>;
  list(folder: string): Promise<FolderEntry[]>;
  makeFolder(path: string): Promise<void>;           // with parents
  rename(from: string, to: string): Promise<void>;
  trash(path: string): Promise<void>;                // the OS Trash
  // Calls `changed` after the file at `path` changes or is replaced, debounced 100 ms.
  watch(path: string, changed: () => void): FileWatch;
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
`src/contracts`, `src/shared` and `node:` only (main.ts injects Electron's `shell.trashItem`); only `src/shared/testing` holds fakes, and
only tests import it.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Core files and processes services](01-core-services.md)
- [ ] [Docs index: claudeConfigDirs](03-index-config-dirs.md)
- [ ] [Docs pure modules](04-docs-pure-modules.md)

### Wave 2
- [ ] [Code highlighter and markdown document render](02-highlight-and-document-render.md) — after 01 (its lint needs 01's layer entries)
- [ ] [Docs main part](06-docs-main.md) — after 01, 04

### Wave 3
- [ ] [Document editor](05-document-editor.md) — after 02

### Wave 4
- [ ] [Docs view, Docs mode and Docs tabs](07-docs-view.md) — after 02, 04, 05, 06

### Wave 5
- [ ] [Create, rename, delete, detail views](08-docs-crud.md) — after 07

### Wave 6
- [ ] [Self-test](09-selftest.md) — after 08

### Wave 7
- [ ] [Doc re-read](10-doc-re-read.md) — after 09

### Wave 8
- [ ] [Final verification](11-final-verification.md) — after 10

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
