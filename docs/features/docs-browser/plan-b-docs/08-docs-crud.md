# 08 — Create, rename, delete, detail views

Status: done
Type: Task
Wave: 5 · Depends on: 07
Plan: [plan.md](plan.md)

Docs CRUD on the view task 07 built: create by kind (`a`), create by path (`A`) with the completion list, rename (`r`)
through the same path box, delete (`d`) to the Trash after a confirm; the tree updating at once from each change with
`pending` chips until a background build lands; and the hook and plugin detail views.

Files:
- modify `src/plugins/docs/manifest.ts` (commands, scope `confirm`, keys)
- create `src/plugins/docs/page/docs-dialogs.ts` (kind and place lists on 07's picker, the name box and path box on
  07's text box, the completion list, the Trash confirm)
- modify `src/plugins/docs/page/docs-state.ts` · test `src/plugins/docs/page/docs-state.test.ts` (provisional changes,
  pending)
- modify `src/plugins/docs/page/docs-view.ts`, `src/plugins/docs/page/doc-view.ts`, `src/plugins/docs/page/start.ts`,
  `src/plugins/docs/page/docs.css`

Consumes:
- from 04: `CREATE_KINDS`, `placesFor`, `nameProblem`, `skillFolder` (kinds.ts); `CreateKind`, `CreatePlace`, `DocKind`,
  `IndexEntry`, `IndexDocument` (contract.ts); `completionQuery`,
  `completions`, `completeTyped`, `COMPLETION_LIMIT`, `Completion` (path-completion.ts); `metaString` (index-document.ts); `TreeGroup` (tree.ts); `baseName`, `parentFolder`, `isInside`,
  `tildePath` (doc-paths.ts)
- from 06: `DocsChannel` `createDoc`, `renameDoc`, `trashDoc`, `listFolder`, `rebuild`, `sessionIndex`,
  `pluginConfigFile`;
  `CreateRequest`, `CreatedDoc`
- from 07: `createDocsView`, `DocsView`, `DocsViewCommands`, the picker (scope `picker`), the text box (scope `box`,
  `boxComplete` / `boxAccept` / `boxCancel`), the editor swap, `chips(context, entryId, isPending)`, `visibleRows`

## Produces

```ts
// src/plugins/docs/page/docs-state.ts (added)
export type DocChangeRecord =
  | { type: 'created'; entry: IndexEntry }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'trashed'; path: string };
// The document with the change applied, before any build sees it.
export function applyChange(document: IndexDocument, change: DocChangeRecord): IndexDocument;
// The entry a new file gets until a build lists it.
export function provisionalEntry(path: string, kind: DocKind | null, entries: readonly IndexEntry[]): IndexEntry;
// The pending paths still waiting once a source run that started at change `settledSeq` lands.
export function settlePending(pending: ReadonlyMap<string, number>, settledSeq: number): Map<string, number>;

// src/plugins/docs/page/docs-view.ts — DocsViewCommands gains:
createByKind(): void; createByPath(): void; rename(): void; trash(): void; confirmYes(): void; confirmNo(): void;
// DocsView gains, for start.ts: a build after another view's change.
rebuildInBackground(): void;
// DocsViewDeps gains: afterChange(): void — start wires it to the machine view's rebuildInBackground.
```

## Decisions

**Manifest** (plan.md Decisions, keys; design.md § Docs browser, Create / Rename / Delete). Scope
`confirm: 'In the Trash confirmation'`. Commands (`runsIn: 'page'`):

| Command | Label | Group | Keys (scope) |
|---|---|---|---|
| `createByKind` | `new doc by kind` | `change` | `a` (tree) |
| `createByPath` | `new file by path` | `change` | `A` (tree) |
| `rename` | `rename or move` | `change` | `r` (tree) |
| `trash` | `move to the Trash` | `change` | `d` (tree) |
| `confirmYes` | `yes, move it to the Trash` | `confirm` | `y` (confirm) |
| `confirmNo` | `keep it` | `confirm` | `n`, `Escape` (confirm) |

**Unsaved edits first.** While the view's editor holds unsaved edits, `a` and `A` toast `Unsaved changes — :w to
save, :q! to discard` (error) before any dialog opens: a created file opens in the editor, which 07 refuses while
edits are unsaved.

**Create by kind** (`a`; plan.md Decisions, Create by kind; kinds.ts targets and templates from 04).
1. The picker lists `CREATE_KINDS` titled `instructions`, `rule`, `skill`, `subagent`, `command`, `learning`,
   `reference`, `feature doc`, `follow-up`; log `create: pick a kind`.
2. A chosen kind's places: `placesFor(kind, <this view's document entries>, homeDir)`. None → toast
   `No place holds a <kind title> yet — A creates a file by path` (info), log `create cancelled`. Else the picker
   lists them by `title`; log `create <kind title>: pick a place`.
3. A chosen place opens the text box labelled `Title` for a follow-up, else `Name`; log
   `create <kind title>: name it`. `Enter`: `nameProblem` non-null → toast it (error), the box stays; else
   `createDoc({ type: 'kind', kind, place, name })`. Success: the change applies (below), the box closes, the doc opens
   in the editor at the returned line, log `created <baseName(path)>`; for a follow-up log `created follow-up
   <name>`. A rejection toasts main's text (error) and keeps the box.
4. `Escape` at any step closes everything, log `create cancelled`.

**Create by path** (`A`; plan.md Decisions, Create by path and Path box completion).
- The text box, labelled `New file`, prefilled with `tildePath(folder) + '/'`: `folder` is the selected leaf's
  `parentFolder(entry.path)`, the selected group's `folder` (04), or the home folder when nothing is selected
  (`~/`). The cursor sits at the end. Log `create by path: type the path`.
- Completion: the prefilled text's folder is listed when the box opens; on each input change,
  `completionQuery(typed, homeDir)`, `listFolder(folder)` (each folder listed once per open box, its promise kept),
  `completions(entries, prefix)`; the list under the box (an element with class `docs-completion`) shows the first
  `COMPLETION_LIMIT` (12) `text`s, hidden when there are none. `Tab` (`boxComplete`) awaits the listing of
  `completionQuery(<the box's text now>).folder`, then puts `completeTyped(typed, <all matches>)` into the box,
  cursor at the end, list refreshed, log `completed to <the box's text>` — a Tab pressed before the listing returns
  never completes from stale or empty matches.
- `Enter`: `createDoc({ type: 'path', path: typed })`; success → the change applies, the doc opens in the editor at
  line 1, log `created <baseName(path)>`; rejection → toast (error), the box stays. `Escape` → log `create cancelled`.

**Rename** (`r`; plan.md Decisions, Rename uses the same path box).
- On a group → toast `Select a doc to rename` (info). On an entry that is an item inside a file — a `line` set, or
  kind `hook` or `plugin` — toast `<title> is an item inside <baseName(path)>; it cannot be renamed or moved to the
  Trash alone` (info). On a `source: plugin` entry → toast `Plugin cache — <plugin>. Edit the source repo's copy.`
  (info). While the view's editor holds unsaved edits on that file → `Unsaved changes — :w to save, :q! to discard`.
- The text box labelled `Rename to`, prefilled with `tildePath(entry.path)`, with the same completion; log
  `rename: type the new path`. `Escape` closes it, log `rename cancelled`. `Enter`:
  `renameDoc(entry.path, typed)`; success → the change applies (`from` the old path, `to` the result), the open doc
  follows to the new path (re-watched), log `renamed <old baseName> to <new baseName>`; for a skill's `SKILL.md` the
  names logged are the folder names. Rejection → toast (error), the box stays.

**Delete** (`d`; plan.md Decisions, Delete). The same refusals as rename (the group toast reads `Select a doc to move
to the Trash`). Else push scope `confirm` and show `Move <name> to the Trash? y/n` (plan.md verbatim), `<name>` the
skill's folder name when `skillFolder(path)` is non-null, else `baseName(path)`; log `asked to move <name> to the Trash`. `y`: `trashDoc(path)`; success → the change
applies (`path` the result), a doc pane showing a trashed file empties, log `moved <name> to the Trash`; rejection →
toast (error). `n` / `Escape`: log `kept <name>`. Either pops the scope.

**Changes apply at once; chips read `pending`** (plan.md Decisions: after create, rename or trash the tree updates at
once and the machine source starts a background build; the changed entry's chips read `pending` until it lands).
- Each view counts its changes (`changeSeq`, from 1). A change: `document = applyChange(document, record)`, the tree
  rebuilds and selects the changed leaf (expanding its groups); each new or moved path enters `pending` with the
  change's seq; then the view's own source runs again (machine: `rebuild()`; session: `sessionIndex(spec)`), and
  `deps.afterChange()` asks the machine view for `rebuildInBackground()` when this view is a session view.
- When a source run lands, it replaces the document and `pending = settlePending(pending, <changeSeq when the run
  was asked>)`: 06's queued `rebuild` guarantees a run asked after a change covers it.
- Chips of an entry whose path is in `pending` read `Claude pending` / `Codex pending` (07's `chips`).
- `applyChange`:
  - `created` → the entry is added (an entry with the same `id` is replaced).
  - `renamed` → each entry whose `path` equals `from` or lies inside `from` (a skill folder) takes the path with the
    `from` prefix replaced by `to`, and so does its `id`; a title equal to the old `baseName` becomes the new one;
    states keyed by an old id move to the new id in every context.
  - `trashed` → each entry whose `path` equals the path or lies inside it is dropped.
- `provisionalEntry(path, kind, entries)`: the owner is the entry with the deepest non-null `root` holding `path`
  (`isInside`) whose `source` is not `plugin` — its `source`, `repo` and `root` are copied; else `source: global`,
  `repo` and `root` null; `plugin` null; `line` null; `meta` `{}`; `id` = `path`. `kind` given → that kind; null (a
  file made by path) → `skillFolder(path)` (04) non-null → `skill`; a path holding `/rules/` → `rule`, `/agents/` → `subagent`,
  `/commands/` → `command`; a name of `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` or `AGENTS.override.md` →
  `instructions`; else `feature-doc` when the owner's source is `features`, else `reference`. `title`: a skill's
  folder name, else `baseName(path)`. The confirm's and logs' skill naming (Rename, Delete) uses `skillFolder` too,
  the rule main's rename and trash follow (06). A follow-up made by kind adds `kind: 'followup'`, `id` `<path>#L<line>`,
  `line`, `title` the name, `meta` `{ status: 'open', gist: '', section: null }`, owner as above.

**Hook and plugin detail views** (plan.md Decisions: hook entries show event, matcher and command; plugin entries show
harness, version, enabled and installs; `i` on either opens the settings or config file at its path in the editor).
- A two-column field table (the frontmatter table's look) in place of the body. Hook: `Event` (`meta.event`),
  `Matcher` (`meta.matcher`, `—` when null), `Command` (`meta.command`). Plugin: `Harness` (`Claude` / `Codex` from
  `meta.harness`), `Version`, `Enabled` (`yes` / `no` when `meta.enabled` is a boolean, else `—`), `Installs` (each
  `meta.installs` item as `<scope>` or `<scope> · <tildePath(projectPath)>`, joined with `, `; `—` when none).
- Hook `i` opens `entry.path` (the settings file) in the document editor at the first line holding the hook's
  `meta.command` as written, else line 1; `:q` returns to the detail view. A hook under a plugin install folder (a
  plugin's `hooks/hooks.json`) is read-only as in 07.
- Plugin `i`: a plugin entry's `path` is its install folder (README § The index file), so `i` asks main for
  `pluginConfigFile(title, meta.harness)` (06) and opens that file at its line — exempt from 07's plugin-cache rule,
  since the file is a config file, not the cached copy. Null → toast `No config file lists <title>` (info). The
  open file's watch and `:w` follow 07's rules; `:q` returns to the detail view.

**Logs** (source `docs`): every log line named above, verbatim; task 09's steps wait on them.

## GIVEN / WHEN / THEN

- GIVEN the index holds global rules WHEN `a`, `rule`, the Global place, a name and Enter THEN the file is written with `# <name>\n\n`, its leaf shows at once with `pending` chips, and the editor opens at line 3.
- GIVEN no kind `learning` in the index WHEN `a` and `learning` THEN the toast `No place holds a learning yet — A creates a file by path`.
- GIVEN the path box holds `~/dev/wi` and the folder holds `wigley-ai-gui/` alone WHEN Tab THEN the box reads `~/dev/wigley-ai-gui/`.
- GIVEN a skill's `SKILL.md` selected WHEN `d` and `y` THEN its folder goes to the Trash and its leaf leaves the tree.
- GIVEN a change at seq 2 and a run asked at seq 1 WHEN that run lands THEN the path stays pending; the run asked at seq 2 clears it.
- GIVEN a hook entry WHEN opened THEN Event, Matcher and Command show; `i` opens the settings file in the editor.
- GIVEN a plugin entry WHEN `i` THEN the `installed_plugins.json` that lists its key opens at the key's line, editable.
- GIVEN unsaved edits in the editor WHEN `a` THEN the unsaved-changes toast and no dialog.

## Tests

`docs-state.test.ts` (added; entries built in the test with home `/Users/u`):
- `applyChange_Created_AddsEntry` — a document with one entry plus `created` `/Users/u/dev/r/b.md` → two entries, the second's path `/Users/u/dev/r/b.md`.
- `applyChange_RenamedFile_PathIdAndTitle` — entry `/r/a.md` titled `a.md` renamed to `/r/sub/b.md` → path and id `/r/sub/b.md`, title `b.md`; an entry titled `Alpha` keeps its title.
- `applyChange_RenamedFolder_MovesEntriesInside` — skill `/r/skills/s/SKILL.md` with `from` `/r/skills/s`, `to` `/r/skills/t` → path `/r/skills/t/SKILL.md`.
- `applyChange_Renamed_StatesFollowId` — a context `states['/r/a.md']` → `states['/r/sub/b.md']`, the old key gone.
- `applyChange_TrashedFolder_DropsEntriesInside` — entries `/r/skills/s/SKILL.md`, `/r/skills/s/ref.md`, `/r/other.md`, trashed `/r/skills/s` → only `/r/other.md`.
- `provisionalEntry_InsideRepoRoot_CopiesOwner` — entries hold repo `r` root `/Users/u/dev/r` and a deeper repo `n` root `/Users/u/dev/r/nested`; path `/Users/u/dev/r/nested/x.md`, kind null → `source: 'repo'`, `repo: 'n'`, `root: '/Users/u/dev/r/nested'`, kind `reference`, title `x.md`.
- `provisionalEntry_GuessesKindFromPath` — kind null: `/Users/u/dev/r/.claude/skills/tidy/SKILL.md` → `skill`, title `tidy`; `/Users/u/dev/r/.claude/rules/a.md` → `rule`; `/Users/u/dev/r/.claude/agents/a.md` → `subagent`; `/Users/u/dev/r/.claude/commands/a.md` → `command`; `/Users/u/dev/r/web/AGENTS.md` → `instructions`.
- `provisionalEntry_FeaturesOwner_FeatureDoc` — owner `source: 'features'` root `/Users/u/wigley-features/r`, path `/Users/u/wigley-features/r/f/notes.md` → `feature-doc`.
- `provisionalEntry_OutsideEveryRoot_Global` — `/Users/u/.claude/rules/x.md` with no root holding it, kind `rule` given → `source: 'global'`, `repo` null, `root` null, kind `rule`.
- `provisionalEntry_PluginRootIgnored` — the only root holding the path is a `source: plugin` entry's → `source: 'global'`.
- `settlePending_ClearsOnlySettledChanges` — pending `{ '/a': 1, '/b': 2 }`, settled 1 → `{ '/b': 2 }`; settled 2 → `{}`.

Dialog flows, the completion list and the confirm are proved by task 09's self-test steps and task 11's live checks.

## Done when

`npm run typecheck`, `npm run lint` pass; the test gate runs the tests above; `npm run selftest` still passes.

## Commit

One commit for the group: "Docs: create by kind and by path, rename, delete to the Trash, pending chips, hook and plugin details".

## Proof

`a6abd2e` · diff read, every Produces present, typecheck and lint pass; the self-test clause moves to the gate after 09. Concerns in plan.md's Run log.
