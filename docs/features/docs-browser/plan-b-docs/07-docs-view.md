# 07 — Docs view, Docs mode and Docs tabs

Status: in progress
Type: Task
Wave: 4 · Depends on: 02, 04, 05, 06
Plan: [plan.md](plan.md)

The docs plugin's page part: one `DocsView` module over an index source, shown as Docs mode over the machine index and
as a Docs tab in every session over that session's index. The view holds the tree pane and the doc pane: chips, the
load-state context picker, the frontmatter table, the rendered doc with working links, the document editor swap, the
changed-on-disk banner and prompt, and the plugin-cache read-only line. Create, rename, delete and the hook and plugin
detail views are task 08.

Files:
- modify `src/plugins/docs/manifest.ts` (commands, scopes, keys, `dependsOn`)
- create `src/plugins/docs/page/start.ts`, `src/plugins/docs/page/docs-view.ts`, `src/plugins/docs/page/tree-view.ts`,
  `src/plugins/docs/page/doc-view.ts`, `src/plugins/docs/page/docs-state.ts`, `src/plugins/docs/page/docs.css`
- test `src/plugins/docs/page/docs-state.test.ts`
- modify `src/plugins/page.ts` (add `docsPagePart` to `pageParts`, after `chatPagePart`, the list's last)

Consumes:
- from 04: `buildTree`, `TreeNode`, `TreeGroup`, `TreeLeaf` (tree.ts); `splitFrontmatter` (frontmatter.ts);
  `resolveLink`, `LinkTarget` (links.ts); `isIndexedPath` (path-guard.ts); `IndexDocument`, `IndexEntry`,
  `IndexContext`, `IndexHarness`, `LoadStateRecord` (contract.ts); `baseName`, `tildePath` (doc-paths.ts)
- from 06: `DocsChannel`, `IndexLoad`, `SessionSourceSpec`, `WriteResult`, `DocChange` (contract.ts), `docsManifest`
- from 02: `MarkdownRenderer.document(text: string): Promise<string>` (`PageServices.markdown`): links as
  `a.md-link` with `data-href`, headings with `data-anchor`, each block element with a source map (list items included) with `data-source-line` (1-based in
  the text passed in), images as their alt text
- from 05: `EditorHost.createDocument(parent, doc, options, events): DocumentEditor`, `DocumentOptions`,
  `DocumentEditorEvents`, `DocumentEditor` (`setText`, `goToLine`, `focus`, `blur`, `destroy`, `text`)
- from agent chat plan A's landed contracts (`e0afe84`; where this task cites plan A, read the code):
  `PageApi.modes` (`src/contracts/plugin.ts`) — `Modes.add(mode: Mode): ModeHandle` with `Mode { id; title; element;
  shown(): void; hidden(): void }`, `ModeHandle.show`, `ModeHandle.isShown`, `Modes.shown(): string`,
  `Modes.onChanged`; `SessionsPageExports.addTab(sessionId, tab: SessionTabView): SessionTabHandle`
  (`src/plugins/sessions/contract.ts`) with `SessionTabView { id; title; element; beforeClose(): boolean; shown():
  void }` and `SessionTabHandle.remove`, `SessionTabHandle.isVisible`; `SessionsPageEvents.sessionAdded`
  `{ sessionId, projectDir, harness, hostSessionId }` (emitted for each row as it arrives, the rows of main's first
  state included) and `sessionRemoved` `{ sessionId }`; `EditorBind.scope` (`src/contracts/keymap.ts`). `Mode.shown`
  and `SessionTabView.shown` exist so a hidden view never keeps the key scope; each docs `shown()` sets the scope of
  the pane that last had focus (`focusScope()`).
- `element`, `markdownElement`, `button` (`src/shared/page/dom.ts`), `errorText` — in the tree

## Produces

```ts
// src/plugins/docs/page/docs-state.ts — the view's pure state rules
export interface TreeRow { node: TreeNode; depth: number; isExpanded: boolean; }
export interface TreeState { expanded: ReadonlySet<string>; selectedId: string | null; filter: string; }
export function rootIds(tree: readonly TreeNode[]): Set<string>;
// `pathOf` reads a leaf's entry path, for the filter.
export function visibleRows(tree: readonly TreeNode[], state: TreeState, pathOf: (entryId: string) => string): TreeRow[];
// The row id `by` rows from `selectedId` (clamped at both ends); the first row's id when `selectedId` is not shown;
// null when no row shows.
export function stepSelection(rows: readonly TreeRow[], selectedId: string | null, by: 1 | -1): string | null;
// The id of the group holding `nodeId`, or null for a root.
export function parentId(tree: readonly TreeNode[], nodeId: string): string | null;
export interface Chip { text: string; tooltip: string; }
export function chips(context: IndexContext | null, entryId: string, isPending: boolean): { claude: Chip; codex: Chip };
// Home folder's context first, then the rest by folder in code-unit order.
export function contextChoices(document: IndexDocument, homeDir: string): IndexContext[];
// 1-based source line of the top visible rendered block: the last of `blocks` (source line and top offset, in page
// order) whose top is ≤ `scrollTop`, plus the frontmatter offset (`bodyStartLine - 1`); `bodyStartLine` when none is.
export function topVisibleLine(blocks: readonly { line: number; top: number }[], scrollTop: number, bodyStartLine: number): number;
// The text a fenced block needs to show `text` whole: backticks one longer than its longest run, at least three.
export function codeFence(text: string): string;

// src/plugins/docs/page/docs-view.ts
export type DocsSource =
  | { type: 'machine' }
  | { type: 'session'; spec: SessionSourceSpec };
export interface DocsView {
  element: HTMLElement;
  // Runs the source the first time; later calls do nothing (Docs mode's build, a tab's first show).
  showFirstTime(): void;
  // Runs the source again: `R`.
  rescan(): void;
  toggleTree(): boolean;                 // returns whether the tree now shows
  focusScope(): 'tree' | 'doc';          // the scope this view's keys use now
  hasUnsavedEdits(): boolean;
  dispose(): void;
  commands: DocsViewCommands;            // what each page command does on this view
}
export function createDocsView(deps: DocsViewDeps): DocsView;

// src/plugins/docs/page/start.ts
export const docsPagePart: PagePart<typeof docsManifest>;
```

`DocsViewDeps` holds what the view uses and nothing more: `viewId: string`, `source: DocsSource`, `channel:
PageChannel<DocsChannel>`, `homeDir: Promise<string>`, `editor: EditorHost`, `markdown: MarkdownRenderer`,
`toast`, `log`, `setScope(scope: 'tree' | 'doc')`, `isActive(): boolean`. `DocsViewCommands` has one method per
page command below that acts on a view (`treeDown(): void` … `edit(): void`); task 08 adds its own.

## Decisions

**Manifest** (plan.md Decisions, keys; design.md § Docs browser, Keys; § Modes and layout: every key is a default bind
to a named command). `dependsOn: ['sessions', 'keys']`. Scopes, with the title help shows:
`tree: 'In the docs tree'`, `doc: 'In a doc'`, `conflict: 'In the changed-on-disk prompt'`,
`picker: 'In a docs list'` (the context picker; task 08 reuses it), `box: 'In a docs text box'` (the filter box;
task 08 reuses it). Commands (all `runsIn: 'page'`), `label` /
`group`:

| Command | Label | Group | Keys (scope) |
|---|---|---|---|
| `showMode` | `docs (again: toggle the tree)` | `modes` | page `[' ', 'k', 'd']` (`any`); editor `<Leader>kd` (`any`) |
| `treeDown` | `next row` | `tree` | `j` (tree) |
| `treeUp` | `previous row` | `tree` | `k` (tree) |
| `treeOpen` | `open or expand` | `tree` | `l`, `Enter` (tree) |
| `treeClose` | `collapse or go to the parent` | `tree` | `h` (tree) |
| `filter` | `filter by title or path` | `tree` | `/` (tree) |
| `rescan` | `rescan the docs` | `tree` | `R` (tree) |
| `pickContext` | `pick the load-state folder` | `tree` | `c` (tree) |
| `focusDoc` | `focus the doc` | `focus` | `<C-l>` (tree) |
| `focusTree` | `focus the tree` | `focus` | `<C-h>` (doc) |
| `scrollDown` | `scroll down` | `doc` | `j` (doc) |
| `scrollUp` | `scroll up` | `doc` | `k` (doc) |
| `edit` | `edit the doc` | `doc` | `i` (doc) |
| `conflictReload` | `reload from disk` | `conflict` | `r` (conflict) |
| `conflictOverwrite` | `overwrite the disk` | `conflict` | `o` (conflict) |
| `conflictCancel` | `keep editing` | `conflict` | `Escape` (conflict) |
| `pickerDown` | `next choice` | `picker` | `j` (picker) |
| `pickerUp` | `previous choice` | `picker` | `k` (picker) |
| `pickerChoose` | `choose` | `picker` | `Enter`, `l` (picker) |
| `pickerCancel` | `cancel` | `picker` | `Escape` (picker) |
| `boxComplete` | `complete the path` | `box` | `Tab` (box) |
| `boxAccept` | `accept` | `box` | `Enter` (box) |
| `boxCancel` | `cancel` | `box` | `Escape` (box) |

No existing bind clashes with `Space k d`: the other `Space k` binds are sessions' `Space k s` and chat's `Space k n`. `<C-h>` / `<C-l>` are
already forms' page chords in scope `forms`; scopes differ, so no clash. The filter box and scope `box` land here
(below); task 08's path and name boxes reuse them.

**Filter** (plan.md Decisions, keys `/`). `/` opens a one-line text box (a plain `<input>`, see Text boxes) at the
top of the tree pane, prefilled with the current filter. As the user types, the tree shows only leaves whose title
or path holds the typed text (case-insensitive) and the groups above them, every such group expanded; `Enter` keeps
the filter and returns to the tree (log `filtered the tree: <text>`; empty text logs `cleared the filter`); `Escape`
clears the filter and returns (log `cleared the filter`). Scope while the box is open: `box`, pushed (`api.keys.
pushScope('box')`) and popped on close. Scope `box` (title `In a docs text box`) and its commands live in this task:
`boxComplete` (`complete the path`, group `box`, `Tab`), `boxAccept` (`accept`, group `box`, `Enter`), `boxCancel`
(`cancel`, group `box`, `Escape`). In the filter box `boxComplete` does nothing.

**Text boxes** — a plain `<input>`, not a vim box: Tab must complete and Enter accept while typing (plan.md Decisions,
Path box completion), which vim's insert mode keeps for itself. Page keys fire on keydowns outside editors, so the
input's own `keydown` listener calls `stopPropagation()` on every key except `Tab`, `Enter`, `Escape` and chords
(Control, Alt or Meta held): typed characters, Space included, never reach the page keys, while the box's three binds
and every chord do. AGENTS.md § A key: keys still run commands through binds.

**One view, two sources** (plan.md Decisions, first bullet). `createDocsView` takes a `DocsSource`:
- machine: at creation `machineIndex()` (log `machine index read: <n> entries`, or `machine index: <message>` when
  the load has a message); `showFirstTime()` and `rescan()` call `rebuild()`; while a rebuild runs the tree's status
  line reads `Rebuilding the docs index…`; on its result the tree reloads (log `index rebuilt: <n> entries`, or
  `index rebuild: <message>`).
- session: nothing at creation; the status line reads `Not read yet`; `showFirstTime()` and `rescan()` call
  `sessionIndex(spec)`, the status line reading `Reading this session's docs…` while it runs (log
  `session index read: <n> entries`, or `session index: <message>`).
- A load's `message` shows in the status line above the tree; null clears it. A load whose `document` is null leaves
  an empty tree (machine: the last document stays when the rebuild returns one; the source's rules are 06's).
- A tree rebuild keeps the expanded ids, the selection and the filter (node ids are stable, 04).

**Tree pane** (plan.md Decisions, Tree; keys). Rows from `visibleRows`; at the first load the roots are expanded
(`rootIds`), the first row selected. `j`/`k` move (`stepSelection`, clamped). `l`/`Enter` on a group toggles it open
(log `expanded <title>`), on an open group moves to its first child; on a leaf opens the doc (below). `h` on an
expanded group collapses it (log `collapsed <title>`); else selects `parentId` (nothing at a root). A click on a row
selects it and does what `l` does. Each row shows a caret (`▸` closed group, `▾` open group, none for a leaf) and
its title, indented `depth × 1rem`; the selected row has class `is-selected` and scrolls into view.

**Doc pane** (plan.md Decisions, Load-state chips, Rendered doc, Read-only).
- Opening a leaf: read the file (`readDoc(entry.path)`), show the header — title, the path `tildePath`'d, the two
  chips — and the body; `watchDoc(viewId, path)`; log `opened <baseName(path)>`. A `plugin` leaf reads no file and
  watches nothing (its `path` is the install folder): the header and task 08's detail view only. A follow-up (any
  entry with a `line`) scrolls to its line: of the body's `[data-source-line]` elements at any depth (task 02 stamps
  every block-open token that has a source map, list items included), the one whose line plus the frontmatter
  offset is the greatest one ≤ the entry's `line`.
- A failed open — `readDoc` or `markdown.document` rejecting — toasts `Could not open <tildePath(path)>: <error
  text>` (error), logs the same text, and leaves the pane on the previous doc.
- Chips (`chips`): `Claude <state>` / `Codex <state>` from the context's `states[entryId]`; a harness with no state
  reads `Claude —` / `Codex —`; tooltip the reason (`''` with none); a pending entry reads `Claude pending` /
  `Codex pending` with tooltip `Changed since the last build` (pending is task 08's; 07 passes `false`). A file opened
  by link that is not an entry shows no chips. Each chip carries `data-state` = the state (`none`, `pending`).
- Context (`c`): machine view only — the picker lists `contextChoices` by `tildePath(folder)`; choosing one re-reads
  the chips (log `context <tilde folder>`). Default: the home folder's context, else the first. A session view uses
  its document's single context; `c` there toasts `A session's Docs tab uses the session's own load states` (info).
  The picker is a list overlay over the view, scope `picker` pushed while open; `j`/`k` move, `Enter`/`l` choose,
  `Escape` cancels; it opens with the current choice selected.
- Frontmatter: `splitFrontmatter(text)`; a non-empty `fields` shows as a two-column table (class
  `docs-frontmatter`), key cells then value cells as text; the body renders with `markdown.document(body)` into a
  `div.md.docs-body` (`markdownElement`).
- A file whose name does not end in `.md` renders as one fenced block: `codeFence(text)` + the file's extension
  (lower-case, no dot) + `\n` + text + `\n` + `codeFence(text)`, so JSON, TOML and YAML show highlighted (02's
  unknown language renders plain).
- Plugin cache: any open path `isInside` the `root` of a `source: plugin` entry of this view's document (an entry or
  a file reached by link) is read-only and shows the line `Plugin cache — <plugin>. Edit the source repo's copy.`
  under the header (plan.md, verbatim), `<plugin>` that entry's `plugin`; `i` toasts that line (info) instead of
  editing. A `plugin`-kind leaf is exempt: its `i` opens its config file (task 08), outside the install folder.
- Hook and plugin entries: task 08 shows their detail view; in this task their doc pane shows the header and no body.

**Links** (plan.md Decisions, Links; design.md: links are real anchors, Tab moves between them, Enter follows; task
02 renders each link as `<a class="md-link" href="#" data-href="<href>">`). A `click` listener on the body handles
every `a.md-link` (Enter on a focused anchor fires `click`): `preventDefault()`, then
`resolveLink(<its data-href>, openPath, homeDir)`:
- `external` → `openExternal(url)`; log `opened link <url>`.
- `heading` → `pane.querySelector('[data-anchor="' + CSS.escape(fragment) + '"]')` inside this view's own doc pane
  (headings carry no `id`: Docs mode and every Docs tab share one page; 02's GitHub slug rule; the fragment arrives
  percent-decoded from 04) scrolls to the top of the pane; none → toast `No heading #<fragment> in this doc` (info).
- `file` → when `isIndexedPath(path, document.entries)` (this view's document) opens it in the same view (selecting
  its leaf when an entry's path equals it, at `line` when given, then at `#fragment` when given); else toast
  `Not an indexed doc: <path>` (error; plan.md verbatim, the full path).
- `unsupported` → toast `This link does not open here: <href>` (info).

**Focus and scope** (plan.md Decisions, keys; AGENTS.md § A key scope). Each view tracks which pane holds focus:
`tree` or `doc`. `<C-l>` moves to the doc pane — the open editor when one is open, else the pane element
(`tabIndex = -1`, so Tab reaches its links); log `doc focused`; `<C-h>` moves to the tree (log `tree focused`); hiding the tree moves to `doc`. The view calls
`setScope(focusScope())` only while it is active (`isActive()`); start sets the scope when a view becomes active.
`j`/`k` in the doc pane scroll it by 48 px.

**Editor swap** (plan.md Decisions, Editing).
- `i`: read-only → toast as above. Else hide the rendered body and `createDocument(parent, text, { fileName:
  baseName(path), readOnly: false, line }, events)` inside a wrapper `div.docs-editor` that fills the doc pane,
  with `line` = `topVisibleLine(blocks, scrollTop, bodyStartLine)`: `blocks` are the body's `[data-source-line]`
  elements at any depth in page order, each with its `offsetTop` — the scrolling doc pane is `position: relative`
  (docs.css), so `offsetTop` is measured from it and compares with its `scrollTop`; offset by the frontmatter;
  focus it; log `editing <name>`. The text loaded is the file text the view last read.
- `write` (`:w`): `writeDoc(path, editor.text(), loadedText)` → `written`: `loadedText` = the text written, banner
  cleared, toast `Wrote <name>` (success), log `wrote <name>`. → `changedOnDisk`: blur the editor, push scope
  `conflict`, show the prompt `File changed on disk — r reload, o overwrite, Esc cancel` (plan.md verbatim). `r`:
  `setText(diskText)`, `loadedText = diskText`, banner cleared, log `reloaded <name>`; `o`: `writeDoc(path, text,
  null)`, then as `written`; `Escape`: nothing. Each pops the scope, closes the prompt and focuses the editor.
- `quit(false)` (`:q`) with `editor.text() !== loadedText`: toast `Unsaved changes — :w to save, :q! to discard`
  (error; plan.md verbatim), log `refused :q with unsaved edits on <name>`. Else, and `quit(true)` (`:q!`, log
  `dropped edits on <name>` when it drops any): destroy the editor, re-render from `loadedText`, log
  `closed the editor on <name>`, focus the doc pane.
- `writeQuit` (`:wq`, `:x`): the write above; on `written` the close above.
- A rejected write (the guard's refusal) toasts its error text (error) and keeps the editor.
- While the editor holds unsaved edits, opening another doc (tree or link) is refused with the same `Unsaved changes —
  :w to save, :q! to discard` toast.

**Disk changes** (plan.md Decisions, Editing; design.md Disk changes). On `docChanged` for this view's id and open
path: rendered → re-read and re-render (log `reloaded <name>`); editing → re-read, and when the disk text differs from
`loadedText` show the banner `Changed on disk since you opened it` (plan.md verbatim) until the next successful write
or reload (log `changed on disk: <name>`). The view's own write fires the watch too: then disk equals `loadedText` and
no banner shows.

**Docs mode** (plan.md Decisions, keys; design.md § Modes and layout; `Mode` in `src/contracts/plugin.ts`). Start registers
`api.modes.add({ id: 'docs', title: 'Docs', element, shown, hidden })` with the machine view's element, `hidden` an
empty function (a hidden mode keeps its DOM, state and unsaved edits); Sessions registers
first, so Docs starts hidden. The page keeps `isDocsModeShown`: `true` in `shown()`, and `modeId === 'docs.docs'` in
an `api.modes.onChanged` listener (`add` calls the first mode's `shown` before it returns, so `shown()` must not read the handle `add` returns). `shown()` sets the
machine view's scope and calls its `showFirstTime()` (the first Docs mode show of the page load runs the build).
`showMode`: Docs hidden → `handle.show()` (the modes core logs `showed Docs mode`); shown → `toggleTree()`, log
`tree hidden` / `tree shown`.

**Docs tabs** (design.md § Modes and layout, Session tabs: a Docs tab appears when the session connects, stays until
the session ends). On `sessions.sessionAdded`: create a session view (view id `session:<sessionId>`, source
`{ type: 'session', spec: { hostSessionId, projectDir, harness } }`) and `addTab(sessionId, { id: 'docs', title:
'Docs', element, beforeClose, shown })`; log `Docs tab added for <projectDir, or 'a session with no folder'>`.
`shown()` sets that view's scope, logs `Docs tab shown` and calls `showFirstTime()`; it reads no handle, since
`addTab` may call it before returning (a session's first tab is selected at once). `beforeClose()` returns false and
toasts `Unsaved changes — :w to save, :q! to discard` while the view has unsaved edits; else true. On
`sessions.sessionRemoved`: `handle.remove()` and `view.dispose()` (stops its watch, destroys its editor).

**Which view a command acts on** — the active view: the machine view while `isDocsModeShown`, else the session view
whose tab handle reads `isVisible()`; none → the command does nothing. `showMode` is not view-bound. A view's own
change (a pane focus move, a box closing) sets the scope only while it is the active view (`isActive()`).

**Page start**: `unwatchAll()` first (a reload leaves main's watches behind, 06); `homeDir()` once, its promise handed
to every view.

**CSS** (`docs.css`, tokens only, AGENTS.md § A theme): the view a two-column grid, tree `18rem` and doc
`minmax(0, 1fr)`; `.docs-view.is-tree-hidden` one column. The scrolling doc pane (`.docs-doc`) is
`position: relative` (the `offsetTop` rule above); `.docs-editor` fills it. Row titles, the header path and the status line end in an
ellipsis (`.docs-row-title`, `.docs-path`, `.docs-status`). The frontmatter table and code scroll in their own box.
Chip colours by `data-state`: `launch` `--wg-success`, `on-demand` `--wg-info`, `listed` `--wg-accent`, `shadowed`
`--wg-warning`, `not-loaded` and `none` `--wg-text-faint`, `pending` `--wg-warning`. The banner uses `--wg-warning`;
the read-only line `--wg-text-muted`.

## GIVEN / WHEN / THEN

- GIVEN Sessions mode shows WHEN `Space k d` THEN Docs mode shows (`showed Docs mode`) and the machine index rebuilds once in the background.
- GIVEN Docs mode shows WHEN `Space k d` THEN the tree hides; again, it shows.
- GIVEN a filter `rule` WHEN the rows are listed THEN only leaves holding `rule` in title or path, under their expanded groups.
- GIVEN an entry with states `{ claude: launch }` WHEN its chips are read THEN `Claude launch` and `Codex —`.
- GIVEN the editor holds unsaved edits WHEN `:q` THEN the toast `Unsaved changes — :w to save, :q! to discard` and the editor stays.
- GIVEN the file changed on disk WHEN `:w` THEN the prompt `File changed on disk — r reload, o overwrite, Esc cancel`.
- GIVEN a link to a file outside every indexed folder WHEN followed THEN the toast `Not an indexed doc: <path>`.
- GIVEN a session connects WHEN sessions publishes `sessionAdded` THEN that session gains a Docs tab; on `sessionRemoved` it goes.

## Tests

`docs-state.test.ts` (trees built in the test with 04's `TreeNode` shapes; a helper `group(id, title, children)` and
`leaf(id, title, entryId)`):
- `visibleRows_CollapsedGroup_HidesChildren` — root `a` expanded holding group `b` collapsed holding leaf `c` → rows `a` (depth 0), `b` (depth 1).
- `visibleRows_Filter_ShowsMatchesUnderExpandedGroups` — leaves titled `Style` (path `/r/rules/style.md`) and `Other` (path `/r/x.md`) under collapsed groups; filter `STYLE`; entries map supplied for paths → rows: the root, its group, `Style`; groups' `isExpanded` true.
- `visibleRows_FilterMatchesPath_Shown` — filter `rules/` matches `Style` by its path.
- `stepSelection_AtEnds_Clamps` — rows `a, b, c`: from `c` by 1 → `c`; from `a` by −1 → `a`; from `b` by 1 → `c`.
- `stepSelection_SelectedNotShown_FirstRow` — selected `z` → `a`; no rows → null.
- `parentId_LeafInGroup_GroupId` — `c` → `b`; root `a` → null.
- `chips_StatesPresent_TextAndReason` — states `{ e: { claude: { state: 'launch', reason: 'user CLAUDE.md' } } }` → claude `{ text: 'Claude launch', tooltip: 'user CLAUDE.md' }`, codex `{ text: 'Codex —', tooltip: '' }`.
- `chips_Pending_PendingText` — `Claude pending` / `Codex pending`, tooltip `Changed since the last build`.
- `chips_NoContext_Dashes` — null context → `Claude —`, `Codex —`.
- `contextChoices_HomeFirstThenByFolder` — contexts `/Users/u/dev/b`, `/Users/u`, `/Users/u/dev/a` → folders `['/Users/u', '/Users/u/dev/a', '/Users/u/dev/b']`.
- `topVisibleLine_LastBlockAtOrAboveScroll` — blocks `[{line: 1, top: 0}, {line: 5, top: 100}, {line: 9, top: 200}]`, scrollTop 150, bodyStartLine 4 → `8` (block line 5 + 3); scrollTop 0 → `4`.
- `codeFence_LongestRunPlusOne` — text with a ```` ```` ```` run of four → five backticks; plain text → three.

Keys, focus, rendering and the editor swap are proved by task 09's self-test steps and task 11's live checks.

## Done when

`npm run typecheck`, `npm run lint` pass; the test gate runs the tests above; `npm run selftest` still passes.

## Commit

One commit for the group: "Docs view: Docs mode, a Docs tab per session, rendered docs with links, the document editor".

## Proof

