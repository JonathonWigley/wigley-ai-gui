# 04 — Docs pure modules

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

The docs plugin's contract with the index document's types, and seven pure modules in `src/plugins/docs/`, shared by the docs main part (06) and page part (07, 08): the index document
and its schema check, the tree, the frontmatter split, the create-by-kind kinds, link resolution, path completion and
the change guard, plus one path helper module they all use. No module here imports `node:`, `electron` or the DOM:
both processes import them, and `src/plugins/docs` may import only `src/contracts` and `src/shared` (plan.md
Boundary rules). Paths are POSIX strings (`/` separators); the app runs on macOS.

Files:
- create `src/plugins/docs/contract.ts` (the index and create types; task 06 adds the channel to it)
- create `src/plugins/docs/doc-paths.ts` · test `src/plugins/docs/doc-paths.test.ts`
- create `src/plugins/docs/index-document.ts` · test `src/plugins/docs/index-document.test.ts`
- create `src/plugins/docs/tree.ts` · test `src/plugins/docs/tree.test.ts`
- create `src/plugins/docs/frontmatter.ts` · test `src/plugins/docs/frontmatter.test.ts`
- create `src/plugins/docs/kinds.ts` · test `src/plugins/docs/kinds.test.ts`
- create `src/plugins/docs/links.ts` · test `src/plugins/docs/links.test.ts`
- create `src/plugins/docs/path-completion.ts` · test `src/plugins/docs/path-completion.test.ts`
- create `src/plugins/docs/path-guard.ts` · test `src/plugins/docs/path-guard.test.ts`

Consumes: nothing from another task. `completions` takes its own structural entry type, the same shape as 01's
`FolderEntry`, so this wave-1 task never waits on 01.

## Produces

```ts
// src/plugins/docs/doc-paths.ts — POSIX path helpers; no node:path.
export function parentFolder(path: string): string;            // '/a/b/c.md' → '/a/b'; '/a' → '/'
export function baseName(path: string): string;                // '/a/b/c.md' → 'c.md'; '/a/b/' → 'b'
export function joinPath(folder: string, ...segments: string[]): string; // joins with '/', then normalizePath
export function normalizePath(path: string): string;           // folds '//' , '.', '..' (never above '/'), drops a trailing '/' except on '/'
export function isInside(path: string, folder: string): boolean; // path === folder, or starts with folder + '/'
export function tildePath(path: string, homeDir: string): string; // homeDir → '~', homeDir/x → '~/x', else unchanged
export function expandTilde(text: string, homeDir: string): string; // '~' → homeDir, '~/x' → homeDir/x, '~user/x' and others unchanged
export function commonFolder(paths: readonly string[]): string; // deepest folder holding every path's parentFolder; '/' when none; throws on []

// src/plugins/docs/contract.ts — types only here; 06 adds the channel. 01's layer table lets
// `src/plugins/docs/contract.ts` import `src/contracts` alone, so the shared types live here and the pure modules
// import them (the `src/plugins/docs` layer may import the contract).
export type DocKind =
  | 'instructions' | 'reference' | 'learning' | 'rule' | 'skill' | 'subagent' | 'command' | 'prompt'
  | 'hook' | 'plugin' | 'annotation' | 'feature' | 'task' | 'plan' | 'feature-doc' | 'followup';
export type DocSource = 'global' | 'repo' | 'plugin' | 'features';
export type LoadState = 'launch' | 'on-demand' | 'listed' | 'shadowed' | 'not-loaded';
export type IndexHarness = 'claude' | 'codex';
export interface LoadStateRecord { state: LoadState; reason: string; }
export interface IndexEntry {
  id: string; kind: DocKind; source: DocSource;
  repo: string | null; root: string | null; plugin: string | null;
  path: string; line: number | null; title: string;
  meta: Record<string, unknown>;
}
export interface IndexContext {
  folder: string; sessionId: string | null;
  states: Record<string, Partial<Record<IndexHarness, LoadStateRecord>>>;
}
export interface IndexDocument {
  schemaVersion: 1; generatedAt: string;
  entries: IndexEntry[]; contexts: IndexContext[];
}
export type CreateKind =
  | 'instructions' | 'rule' | 'skill' | 'subagent' | 'command' | 'learning' | 'reference' | 'feature-doc' | 'followup';
export interface CreatePlace { title: string; folder: string; source: DocSource; }

// src/plugins/docs/index-document.ts
export const INDEX_SCHEMA_VERSION = 1;
// The README's KINDS order (model.py KINDS); the tree groups kinds in this order.
export const DOC_KINDS: readonly DocKind[];
export type ParsedIndex = { ok: true; document: IndexDocument } | { ok: false; message: string };
export function parseIndexDocument(text: string): ParsedIndex;
// A meta field as a string; null when absent or not a string.
export function metaString(entry: IndexEntry, key: string): string | null;

// src/plugins/docs/tree.ts
export type TreeNode = TreeGroup | TreeLeaf;
export interface TreeGroup {
  type: 'group'; id: string; title: string;
  folder: string;               // commonFolder of every descendant entry's path
  children: TreeNode[];
}
export interface TreeLeaf { type: 'entry'; id: string; title: string; entryId: string; }
export const KIND_TITLES: Record<DocKind, string>;
export function buildTree(entries: readonly IndexEntry[], homeDir: string): TreeNode[];

// src/plugins/docs/frontmatter.ts
export interface SplitDoc {
  fields: [string, string][];   // in file order
  body: string;
  bodyStartLine: number;        // 1-based line of the body's first line in the whole text
}
export function splitFrontmatter(text: string): SplitDoc;

// src/plugins/docs/kinds.ts
export const CREATE_KINDS: readonly CreateKind[];  // the order the kind list shows
export interface CreateContents { text: string; line: number; } // line: 1-based, where the editor opens
export interface CreateTarget {
  path: string;
  appends: boolean;             // true only for a follow-up: the file may exist
  // The file's text after the create, from its text now (null: no file).
  contents(existing: string | null): CreateContents;
}
export function placesFor(kind: CreateKind, entries: readonly IndexEntry[], homeDir: string): CreatePlace[];
export function nameProblem(kind: CreateKind, name: string): string | null;
export function createTarget(kind: CreateKind, place: CreatePlace, name: string): CreateTarget;
// The skill folder a path's file heads, or null: `parentFolder(path)` when `baseName(path)` is `SKILL.md` and the
// folder above that is named `skills`. Main's rename and trash (06) and the page's provisional entry (08) both use it.
export function skillFolder(path: string): string | null;

// src/plugins/docs/links.ts
export type LinkTarget =
  | { type: 'external'; url: string }
  | { type: 'heading'; fragment: string }
  | { type: 'file'; path: string; line: number | null; fragment: string | null }
  | { type: 'unsupported'; href: string };
export function resolveLink(href: string, fromFile: string, homeDir: string): LinkTarget;

// src/plugins/docs/path-completion.ts
export const COMPLETION_LIMIT = 12;
export interface CompletionQuery { folder: string; prefix: string; }
export interface Completion { name: string; isFolder: boolean; text: string; } // text: name, + '/' for a folder
export function completionQuery(typed: string, homeDir: string): CompletionQuery;
// `{ name, isFolder }` is 01's `FolderEntry` shape; 06's `listFolder` result passes as is.
export function completions(entries: readonly { name: string; isFolder: boolean }[], prefix: string): Completion[];
export function completeTyped(typed: string, matches: readonly Completion[]): string;

// src/plugins/docs/path-guard.ts
export function isIndexedPath(path: string, entries: readonly IndexEntry[]): boolean;
export function changeRefusal(
  realTarget: string, entries: readonly IndexEntry[], claudeConfigDirs: readonly string[],
): string | null;
```

## Decisions

**doc-paths.ts** (no `node:path` in a module both processes import; plan.md Boundary rules). `commonFolder` compares
whole segments: `commonFolder(['/a/bc/x.md', '/a/b/y.md'])` is `/a`, never `/a/b`.

**index-document.ts** (plan.md Decisions: the index document is parsed and checked in TypeScript; the README's
§ The index file is the schema).

- `DOC_KINDS` = `instructions, reference, learning, rule, skill, subagent, command, prompt, hook, plugin, annotation,
  feature, task, plan, feature-doc, followup` — the README table order and `model.py` `KINDS`.
- `parseIndexDocument` checks in this order and returns the first message, verbatim (`<…>` filled):
  1. `JSON.parse` throws → `Docs index is not valid JSON: <error message>`
  2. not an object, or `schemaVersion` not a number → `Docs index has no schemaVersion`
  3. `schemaVersion` other than 1 → `Unsupported docs index schema <n>; this app reads 1` (pinned in plan.md)
  4. `entries` not an array → `Docs index has no entries list`; `contexts` not an array → `Docs index has no contexts list`
  5. each entry, by 0-based index `<i>`: not an object; `id`, `path`, `title` not strings; `kind` not in `DOC_KINDS`;
     `source` not one of the four; `line` neither a number nor null; `meta` not an object; `source` `repo` or
     `features` without a string `repo` and `root`; `source` `plugin` without a string `plugin` and `root` →
     `Docs index entry <i> is malformed: <field>`, `<field>` the first failing field name in the order listed
     (`id, kind, source, repo, root, plugin, path, line, title, meta`; a non-object entry names `entry`).
  6. each context `<i>`: `folder` not a string, `sessionId` neither string nor null, `states` not an object →
     `Docs index context <i> is malformed: <field>`. The states inside are taken as they are.
  `generatedAt` is kept as given (a missing one reads `''`). Nothing else is checked: a newer schema bumps
  `schemaVersion` (README).

**tree.ts** (plan.md Decisions, Tree).

- Roots, in order: `Global` (entries with `source: global`), `Plugins` (`source: plugin`), then one node per `repo`
  name over `source: repo` and `source: features` entries, sorted by name case-insensitive (`localeCompare` with
  `{ sensitivity: 'base' }`, ties by code-unit order). A root with no entries is left out.
- Global, each plugin node, each clone node and a single-clone repo node hold **kind groups**: one group per kind
  present, in `DOC_KINDS` order, titled from `KIND_TITLES`: instructions `Instructions`, reference `References`,
  learning `Learnings`, rule `Rules`, skill `Skills`, subagent `Subagents`, command `Commands`, prompt `Prompts`, hook
  `Hooks`, plugin `Plugins`, annotation `Annotations`, feature `Features`, task `Tasks`, plan `Plans`, feature-doc
  `Feature docs`, followup `Follow-ups`.
- `Plugins` holds one node per `plugin` value (`<plugin>@<marketplace>`), titled by it, sorted as repos are.
- A repo whose `source: repo` entries hold more than one distinct `root` holds one clone node per root, titled
  `tildePath(root, homeDir)`, sorted by title; else its kind groups sit directly in the repo node.
- A repo with `source: features` entries holds, after the clones or kind groups, a node titled `Features`. Inside it,
  one node per feature slug, titled by the slug and sorted as repos are, then kind groups for entries with no slug.
  An entry's slug: `meta.feature` (task, plan), else `meta.slug` (feature), else the first folder below `root` when
  the entry's path sits in a subfolder of `root` and that folder is not `followups`; else none. A slug node lists its
  entries directly (no kind groups), ordered by kind (`DOC_KINDS` order), then title. (plan.md names only
  `meta.feature` / `meta.slug`; a feature folder's `feature-doc` has neither, so the folder rule places it — named in
  the drafter's report.)
- Entries inside a group sort by title (as repos sort), ties by `id`.
- Node ids, stable across rebuilds so the page keeps expansion and selection: `global`, `global/<kind>`, `plugins`,
  `plugins/<plugin>`, `plugins/<plugin>/<kind>`, `repo:<name>`, `repo:<name>/<kind>`,
  `repo:<name>/clone:<root>`, `repo:<name>/clone:<root>/<kind>`, `repo:<name>/features`,
  `repo:<name>/features/<slug>`, `repo:<name>/features/<kind>`; a leaf is `entry:<entry id>`.
- A group's `folder` is `commonFolder` of every descendant entry's `path`: the path box's start folder (task 08).
- A follow-up item is a leaf like any entry; opening it at its `line` is the view's (task 07).

**frontmatter.ts** (plan.md Decisions, Rendered doc; README: a frontmatter value on several lines is read whole).

- Frontmatter exists only when line 1 is exactly `---` (trailing spaces and `\r` ignored) and a later line is exactly
  `---`; the lines between are the block. Otherwise `fields` is `[]`, `body` is the whole text, `bodyStartLine` 1.
- `body` is the text after the closing line's newline; `bodyStartLine` is the closing line's number + 1.
- In the block, a field starts at a line `key: value` at column 0 (`key` matches `/^[^\s#:][^:]*$/`), value trimmed;
  one matching pair of surrounding `'` or `"` is stripped. A value of `>`, `>-`, `|`, `|-` or empty takes the
  indented lines after it (each trimmed, blank ones kept as empty): `|` and `|-` join them with `\n`; `>`, `>-` and
  empty join the non-empty ones with a space. An indented line under a non-empty value continues it, joined with a
  space. A `- item` line under an empty value is kept as written (`- a` then `- b` read `- a - b`). A line starting
  `#` and any other line is skipped.

**kinds.ts** (plan.md Decisions, Create by kind; design.md § Docs browser, Create).

- `CREATE_KINDS` = `instructions, rule, skill, subagent, command, learning, reference, feature-doc, followup`.
- `placesFor`: every entry of that kind (for `followup`, of kind `followup`) whose `source` is not `plugin` gives a
  place folder by the kind's rule below; places with the same folder are one. Title: `Global · <tilde folder>` for
  `source: global`, `<repo> · <tilde folder>` for `repo`, `<repo> features · <tilde folder>` for `features`.
  Order: global places first, then by title (case-insensitive). A kind no entry has offers no place.
- Per kind — place folder from an entry, target from place and name, template text (`<name>` is the name as typed),
  and the line the editor opens at:

  | Kind | Place folder from an entry | Target | Template | Line |
  |---|---|---|---|---|
  | instructions | `parentFolder(path)`, a trailing `/.claude` dropped for a non-global entry; a global entry gives a place only when that folder's base name starts with neither `.claude` nor `.codex` (a new file in a Claude or Codex config folder is never loaded) | global place: `<folder>/<name>.md`; other: `<folder>/<name>/AGENTS.md` | `# <name>\n\n` | 3 |
  | rule | `parentFolder(path)` | `<folder>/<name>.md` | `# <name>\n\n` | 3 |
  | skill | `parentFolder(parentFolder(path))` (the skills folder) | `<folder>/<name>/SKILL.md` | `---\nname: <name>\ndescription: \n---\n\n# <name>\n\n` | 3 |
  | subagent | `parentFolder(path)` | `<folder>/<name>.md` | `---\nname: <name>\ndescription: \n---\n\n` | 3 |
  | command | `parentFolder(path)` | `<folder>/<name>.md` | `---\ndescription: \n---\n\n` | 2 |
  | learning | `parentFolder(path)` | `<folder>/<name>.md` | `# <name>\n\n` | 3 |
  | reference | `parentFolder(path)` | `<folder>/<name>.md` | `# <name>\n\n` | 3 |
  | feature-doc | `parentFolder(path)` | `<folder>/<name>.md` | `# <name>\n\n` | 3 |
  | followup | `parentFolder(path)` of an entry whose `baseName(path)` is `followups.md` (items of `followups/*.md` files give no place) | `<folder>/followups.md`, appended | see below | the appended line |

  Line 3 of the skill and subagent templates is `description: `, so the user writes the description first.
- A follow-up appends `- **<name>** — ` (an em dash, U+2014, then one space) as a new last line:
  `contents(existing).text` is `existing` + (`\n` when `existing` is non-empty and does not end in `\n`) +
  `- **<name>** — \n`; with `existing` null or `''` it is `- **<name>** — \n`. `line` is the appended item's 1-based
  line. Every other kind's `contents` ignores `existing` and returns the template and the table's line.
- `nameProblem`, checked on the trimmed name, first match wins, messages verbatim:
  - empty → `A name is required`
  - skill or subagent not matching `/^[a-z0-9]+(-[a-z0-9]+)*$/` → `A <kind> name is lowercase letters, digits and hyphens`
  - followup holding a line break → `A follow-up title is one line`
  - any other kind holding `/`, or starting with `.` → `A name holds no / and does not start with .`
  - else null.

**links.ts** (plan.md Decisions, Links).

- Checked in order; `<…>` filled:
  1. a scheme `http:`, `https:` or `mailto:` (case-insensitive) → `external`, `url` the href unchanged.
  2. `file://` → the rest decoded, then as an absolute path (step 5).
  3. any other `/^[a-z][a-z0-9+.-]*:/i` → `unsupported`.
  4. starting with `#`: `#L<n>` → `file` with `path` = `fromFile`, `line` n; any other → `heading`, `fragment` the
     decoded text after `#`.
  5. a path: a `?query` is dropped; the part after the first `#` is `L<n>` → `line` n, else `fragment` (decoded);
     with no `#L<n>`, a trailing `:<n>` on the path is `line` n. The path is decoded with `decodeURIComponent` (a
     malformed escape keeps the raw text), `expandTilde`d, joined to `parentFolder(fromFile)` when relative, and
     `normalizePath`d.
- Whether a resolved file opens is `isIndexedPath`'s (path-guard.ts); the toast is the view's (task 07).

**path-completion.ts** (plan.md Decisions, Path box completion).

- `completionQuery`: the text up to and including the last `/` is the folder part, `expandTilde`d (`folder` keeps
  no trailing `/` except `/`); the rest is `prefix`. A typed text with no `/` has folder `homeDir` and the whole text
  as `prefix`.
- `completions`: entries whose `name` starts with `prefix` (case-sensitive, as zsh by default), names starting with
  `.` only when `prefix` starts with `.`; folders first, each part by name in code-unit order; every match is
  returned — the view shows the first `COMPLETION_LIMIT` (12).
- `completeTyped`: no match → `typed` unchanged; one match → the typed folder part (as typed, `~` kept) + its `text`;
  several → the typed folder part + the longest common prefix of their names when it is longer than `prefix`, else
  `typed` unchanged.

**path-guard.ts** (plan.md Decisions: main refuses every write, create, rename and trash outside the guard).

- `isIndexedPath(path, entries)` — what a link may open: `path` equals an entry's `path`, or `isInside` an entry's
  `root` (any source, plugin included), or `isInside` `parentFolder` of a `source: global` entry's `path`.
- `changeRefusal(realTarget, entries, claudeConfigDirs)` — null when allowed. Checked in order:
  1. `isInside` the `root` of a `source: plugin` entry → `Refused: <realTarget> is inside the plugin cache of <plugin>`
  2. equals an entry's `path`, `isInside` any non-plugin entry's `root`, `isInside` `parentFolder` of a
     `source: global` entry's `path`, or `isInside` one of `claudeConfigDirs` (already expanded, real paths) → null
  3. else → `Refused: <realTarget> is outside the indexed folders`
  `realTarget` is resolved by main (task 06); this module compares strings only.

## GIVEN / WHEN / THEN

- GIVEN index text with `"schemaVersion": 2` WHEN parsed THEN `{ ok: false, message: 'Unsupported docs index schema 2; this app reads 1' }`.
- GIVEN global, plugin and two repos' entries WHEN the tree builds THEN roots read `Global`, `Plugins`, then the repos by name.
- GIVEN a repo with entries in two clones WHEN the tree builds THEN the repo node holds one node per clone titled with `~`.
- GIVEN a text with a `---` block WHEN split THEN the fields come out in order and the body starts after the closing line.
- GIVEN the index holds a skill under `/Users/u/.claude/skills/a/SKILL.md` WHEN places for `skill` are read THEN one place `Global · ~/.claude/skills` with folder `/Users/u/.claude/skills`.
- GIVEN a relative link `../b.md#L4` from `/r/docs/a.md` WHEN resolved THEN `{ type: 'file', path: '/r/b.md', line: 4, fragment: null }`.
- GIVEN entries `ab/`, `abc.md`, `b.md` WHEN completing `ab` THEN `ab/` then `abc.md`; Tab gives `ab`.
- GIVEN a target inside a plugin install folder WHEN guarded THEN the refusal names the path and the plugin.

## Tests

Data is built in each test with home `/Users/u`; an `entry(overrides)` helper in each test file fills the other fields
(`source: 'global'`, `repo`/`root`/`plugin` null, `line` null, `meta {}`, `title` = `baseName(path)`, `id` = `path`).

`doc-paths.test.ts`
- `normalizePath_DotsAndDoubleSlashes_Folded` — `/a//b/./c/../d.md` → `/a/b/d.md`; `/..` → `/`; `/a/b/` → `/a/b`.
- `parentFolder_TopLevel_IsRoot` — `/a` → `/`; `/a/b/c.md` → `/a/b`.
- `joinPath_RelativeUp_Normalized` — `joinPath('/r/docs', '../b.md')` → `/r/b.md`.
- `isInside_SamePrefixOtherFolder_False` — `isInside('/a/bc', '/a/b')` false; `isInside('/a/b', '/a/b')` true; `isInside('/a/b/c', '/a/b')` true.
- `tildePath_HomeAndBelow_UseTilde` — `/Users/u` → `~`; `/Users/u/x` → `~/x`; `/Users/uv/x` unchanged.
- `expandTilde_OtherUser_Unchanged` — `~` → `/Users/u`; `~/x` → `/Users/u/x`; `~bob/x` unchanged; `x~` unchanged.
- `commonFolder_SegmentPrefixOnly_TakesWholeSegments` — `['/a/bc/x.md', '/a/b/y.md']` → `/a`; `['/a/b/x.md']` → `/a/b`.

`index-document.test.ts`
- `parse_ValidDocument_ReturnsEntriesAndContexts` — a one-entry, one-context document → `ok: true`, entry `kind` `skill`, context `folder` `/Users/u`, its `states['/x'].claude.state` `launch`.
- `parse_NotJson_NamesTheJsonError` — `'{'` → message starts with `Docs index is not valid JSON: `.
- `parse_NoSchemaVersion_SaysSo` — `'{}'` and `'[]'` → `Docs index has no schemaVersion`.
- `parse_SchemaTwo_RefusesWithPinnedMessage` — `Unsupported docs index schema 2; this app reads 1`.
- `parse_EntriesNotList_SaysSo` — `Docs index has no entries list`.
- `parse_UnknownKind_NamesEntryAndField` — entry 1 with `kind: 'widget'` → `Docs index entry 1 is malformed: kind`.
- `parse_RepoEntryWithoutRoot_NamesRoot` — `source: 'repo'`, `repo: 'r'`, `root: null` → `Docs index entry 0 is malformed: root`.
- `parse_ContextWithoutFolder_NamesFolder` — `Docs index context 0 is malformed: folder`.
- `metaString_NonString_Null` — meta `{ slug: 'a', checked: 2 }` → `metaString(e, 'slug')` `a`; `'checked'` null; `'none'` null.

`tree.test.ts`
- `buildTree_AllSources_RootsInOrder` — entries: a global rule, a plugin skill (`plugin: 'p@m'`, `root: '/Users/u/.claude/plugins/cache/m/p/1'`), repo `zeta` and repo `Alpha` (one clone each) → root titles `['Global', 'Plugins', 'Alpha', 'zeta']`.
- `buildTree_NoGlobalEntries_LeavesGlobalOut` — only a repo entry → root titles `['r']`.
- `buildTree_KindGroups_InKindsOrder` — global skill, rule, instructions → Global's children titles `['Instructions', 'Rules', 'Skills']`.
- `buildTree_TwoClones_SplitsByClone` — repo `r` entries with roots `/Users/u/dev/r` and `/Users/u/work/r` → repo node children titles `['~/dev/r', '~/work/r']`, ids `repo:r/clone:/Users/u/dev/r`, `repo:r/clone:/Users/u/work/r`.
- `buildTree_OneClone_NoCloneNode` — repo `r`, one root → repo children are kind groups, first id `repo:r/instructions`.
- `buildTree_Features_GroupedBySlugThenKinds` — repo `r`, `source: features`, root `/Users/u/wigley-features/r`: a task with `meta.feature: 'b-feat'`, a feature with `meta.slug: 'a-feat'`, a feature-doc at `/Users/u/wigley-features/r/a-feat/design.md`, a followup at `/Users/u/wigley-features/r/followups.md` → `Features` children titles `['a-feat', 'b-feat', 'Follow-ups']`; `a-feat` leaves in order: the feature, then the feature-doc.
- `buildTree_GroupEntries_SortByTitleCaseInsensitive` — global rules titled `beta`, `Alpha`, `gamma` → leaf titles `['Alpha', 'beta', 'gamma']`.
- `buildTree_GroupFolder_IsCommonFolder` — global rules at `/Users/u/.claude/rules/a.md` and `/Users/u/.claude/rules/x/b.md` → the Rules group's `folder` `/Users/u/.claude/rules`.
- `buildTree_LeafIds_PrefixEntryId` — a leaf for entry id `/x.md#L3` has id `entry:/x.md#L3`, `entryId` `/x.md#L3`.

`frontmatter.test.ts`
- `split_NoOpeningFence_WholeTextIsBody` — `# Hi\n` → fields `[]`, body `# Hi\n`, bodyStartLine 1.
- `split_UnclosedFence_WholeTextIsBody` — `---\na: b\n# Hi\n` → fields `[]`, bodyStartLine 1.
- `split_Fields_InOrderQuotesStripped` — `---\nname: x\ndescription: "Use it"\n---\n# Body\n` → fields `[['name','x'],['description','Use it']]`, body `# Body\n`, bodyStartLine 5.
- `split_FoldedValue_JoinedWithSpaces` — `description: >-` then `  one` / `  two` → `one two`.
- `split_LiteralValue_JoinedWithNewlines` — `body: |` then `  one` / `  two` → `one\ntwo`.
- `split_ListUnderEmptyValue_KeptAsWritten` — `paths:` then `  - a` / `  - b` → `- a - b`.
- `split_CrlfFences_Recognized` — `---\r\na: b\r\n---\r\nx` → fields `[['a','b']]`, body `x`.

`kinds.test.ts`
- `placesFor_Skill_SkillsFolderOfEachEntry` — global skills `/Users/u/.claude/skills/a/SKILL.md`, `/Users/u/.claude/skills/b/SKILL.md`, repo `r` skill `/Users/u/dev/r/.claude/skills/c/SKILL.md` (root `/Users/u/dev/r`) → `[{ title: 'Global · ~/.claude/skills', folder: '/Users/u/.claude/skills' }, { title: 'r · ~/dev/r/.claude/skills', folder: '/Users/u/dev/r/.claude/skills' }]` (sources `global`, `repo`).
- `placesFor_GlobalInstructions_SkipsConfigFolders` — global instructions `/Users/u/.claude/CLAUDE.md`, `/Users/u/.claude-personal/CLAUDE.md`, `/Users/u/.codex/AGENTS.md`, `/Users/u/wigley-agents/AGENTS.md` → one place `{ title: 'Global · ~/wigley-agents', folder: '/Users/u/wigley-agents', source: 'global' }`.
- `skillFolder_SkillMdUnderSkills_Folder` — `/r/.claude/skills/tidy/SKILL.md` → `/r/.claude/skills/tidy`; `/r/skills/x/README.md` → null; `/r/docs/x/SKILL.md` → null.
- `placesFor_PluginEntries_NoPlace` — only a `source: plugin` skill → `[]`.
- `placesFor_InstructionsInDotClaude_DropsDotClaude` — repo instructions `/Users/u/dev/r/.claude/CLAUDE.md` → folder `/Users/u/dev/r`.
- `placesFor_Followup_OnlyFollowupsMdFiles` — followups at `/Users/u/wigley-features/r/followups.md#L3` (path `/Users/u/wigley-features/r/followups.md`) and `/Users/u/wigley-features/r/followups/ui.md` → one place, folder `/Users/u/wigley-features/r`, title `r features · ~/wigley-features/r`.
- `createTarget_Skill_FolderAndFrontmatter` — place folder `/Users/u/.claude/skills`, name `tidy` → path `/Users/u/.claude/skills/tidy/SKILL.md`, `contents(null)` `{ text: '---\nname: tidy\ndescription: \n---\n\n# tidy\n\n', line: 3 }`, `appends` false.
- `createTarget_InstructionsGlobal_FileInFolder` — global place `/Users/u/wigley-agents`, name `Unity` → `/Users/u/wigley-agents/Unity.md`; repo place `/Users/u/dev/r`, name `web` → `/Users/u/dev/r/web/AGENTS.md`.
- `createTarget_Followup_AppendsItem` — name `new`: `contents('# F\n- **a** — x')` → `{ text: '# F\n- **a** — x\n- **new** — \n', line: 3 }`; `contents('')` and `contents(null)` → `{ text: '- **new** — \n', line: 1 }`; `appends` true.
- `nameProblem_Rules_PinnedMessages` — `('skill', ' ')` → `A name is required`; `('skill', 'My Skill')` → `A skill name is lowercase letters, digits and hyphens`; `('rule', 'a/b')` and `('rule', '.x')` → `A name holds no / and does not start with .`; `('followup', 'a\nb')` → `A follow-up title is one line`; `('rule', 'style')` → null.

`links.test.ts` (fromFile `/r/docs/a.md`)
- `resolve_Http_External` — `https://x.dev/a` → `{ type: 'external', url: 'https://x.dev/a' }`; `MAILTO:a@b.c` → external.
- `resolve_OtherScheme_Unsupported` — `vscode://x` → `{ type: 'unsupported', href: 'vscode://x' }`.
- `resolve_Hash_Heading` — `#core-services` → `{ type: 'heading', fragment: 'core-services' }`; `#a%20b` → fragment `a b`.
- `resolve_HashLine_SameFileLine` — `#L7` → `{ type: 'file', path: '/r/docs/a.md', line: 7, fragment: null }`.
- `resolve_RelativeWithLine_Resolved` — `../b.md#L4` → `{ type: 'file', path: '/r/b.md', line: 4, fragment: null }`.
- `resolve_ColonLine_Resolved` — `b.md:12` → path `/r/docs/b.md`, line 12.
- `resolve_FileFragment_Kept` — `b.md#setup` → path `/r/docs/b.md`, line null, fragment `setup`.
- `resolve_TildeAndEncoded_Expanded` — `~/x/my%20doc.md` → path `/Users/u/x/my doc.md`.
- `resolve_FileUrl_AsAbsolute` — `file:///r/c.md` → path `/r/c.md`.

`path-completion.test.ts`
- `completionQuery_TildeFolder_Expanded` — `~/dev/wi` → `{ folder: '/Users/u/dev', prefix: 'wi' }`; `/` → `{ folder: '/', prefix: '' }`; `abc` → `{ folder: '/Users/u', prefix: 'abc' }`.
- `completions_FoldersFirstThenFiles_ByName` — entries `b.md`, `ab` (folder), `abc.md`, `aa` (folder), prefix `a` → texts `['aa/', 'ab/', 'abc.md']`.
- `completions_HiddenOnlyForDotPrefix` — entries `.claude` (folder), `a.md`: prefix `` → `['a.md']`; prefix `.` → `['.claude/']`.
- `completions_CaseSensitive` — entry `Readme.md`, prefix `r` → `[]`.
- `completeTyped_SingleMatch_CompletesWithSlash` — typed `~/dev/wi`, one folder match `wigley-ai-gui` → `~/dev/wigley-ai-gui/`.
- `completeTyped_SeveralMatches_LongestCommonPrefix` — typed `~/a`, matches `abc.md`, `abd.md` → `~/ab`.
- `completeTyped_NoLongerPrefix_Unchanged` — typed `~/ab`, matches `abc.md`, `abd.md` → `~/ab`; no matches → typed unchanged.

`path-guard.test.ts` (entries: repo `r` root `/Users/u/dev/r`; global `/Users/u/.claude/CLAUDE.md`; plugin `p@m` root `/Users/u/.claude/plugins/cache/m/p/1` path `/Users/u/.claude/plugins/cache/m/p/1/skills/s/SKILL.md`; claudeConfigDirs `['/Users/u/.claude-personal']`)
- `changeRefusal_InsideRepoRoot_Allowed` — `/Users/u/dev/r/new/AGENTS.md` → null.
- `changeRefusal_InsideGlobalEntryFolder_Allowed` — `/Users/u/.claude/rules/x.md` → null.
- `changeRefusal_InsideConfigDir_Allowed` — `/Users/u/.claude-personal/CLAUDE.md` → null.
- `changeRefusal_InsidePluginCache_RefusedNamingPlugin` — `/Users/u/.claude/plugins/cache/m/p/1/skills/s/SKILL.md` → `Refused: /Users/u/.claude/plugins/cache/m/p/1/skills/s/SKILL.md is inside the plugin cache of p@m` (the plugin rule wins over the global-folder rule).
- `changeRefusal_Outside_RefusedNamingPath` — `/Users/u/Desktop/x.md` → `Refused: /Users/u/Desktop/x.md is outside the indexed folders`.
- `isIndexedPath_PluginFile_Openable` — the plugin's `SKILL.md` → true; `/Users/u/Desktop/x.md` → false.

## Done when

`npm run typecheck`, `npm run lint` pass; the test gate runs the tests above.

## Commit

One commit for the group: "Docs plugin pure modules: index document, tree, frontmatter, kinds, links, path completion, change guard".

## Proof

wigley-ai-gui `03b19ed` · diff read, all Produces exported, typecheck, 65 tests and lint pass. Concerns and rulings in plan.md's Run log.
