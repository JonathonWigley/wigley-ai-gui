# 02 — Entry fields and Linked from

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/docs/contract.ts`
- modify `src/plugins/docs/index-document.ts`
- create `src/plugins/docs/linked-from.ts`
- modify `src/plugins/docs/page/docs-state.ts` (`provisionalEntry` only)
- modify `src/plugins/docs/main/selftest-fixture.ts`
- test: create `src/plugins/docs/linked-from.test.ts`
- test: modify `src/plugins/docs/index-document.test.ts`
- test: modify every fixture in the table under Decisions

Consumes: none. The schema 5 fields in plan.md § File Structure are the shape that task 01 writes. This task reads only the shape, so it does not wait for task 01.

Produces:
- in `src/plugins/docs/contract.ts`:
  - `export interface IndexHeading { level: number; text: string; line: number }`
  - `export interface IndexLink { form: 'markdown' | 'section'; raw: string; target: string; line: number; targetLine: number | null }`
  - `IndexEntry.headings: IndexHeading[]`
  - `IndexEntry.links: IndexLink[]`
  - `IndexDocument.schemaVersion: 5`
- in `src/plugins/docs/index-document.ts`: `export const INDEX_SCHEMA_VERSION = 5`
- in `src/plugins/docs/linked-from.ts`:
  - `export function linkedFrom(entries: readonly IndexEntry[], targetPath: string): LinkedFromRow[]`
  - `export interface LinkedFromRow { entryId: string; title: string; path: string; line: number }`

## Decisions

**Contract.** Add the two fields to `IndexEntry` after `walked`. Comment `line` and `targetLine` as 1-based in the file. Comment `target` as the real path of the target file. Change the comment on the first line of `contract.ts` to `(schema 5)`.

**Parsing.** `malformedEntryField` gains two checks, after `walked` and in this order:
- `headings`: an array. Each element is an object with `level` a number, `text` a string and `line` a number.
- `links`: an array. Each element is an object with `form` either `'markdown'` or `'section'`, `raw` a string, `target` a string, `line` a number, and `targetLine` null or a number.

One bad element fails the whole entry, as `walked` does. The message is `entry <n> is malformed: headings` or `entry <n> is malformed: links`. There is no fallback for schema 4 (plan.md § Architecture).

**`linkedFrom` matches a link as follows.**
1. Find the target entries: every entry whose `path` equals `targetPath` or whose `walked` holds `targetPath`.
2. Make the target set: `targetPath`, plus each target entry's `path` and each string in its `walked`.
3. A link matches when its `target` is in the target set.

The compare is exact string equality, because the index writes real paths. A caller passes `entry.path`. A `targetPath` that no entry lists still works, with a target set of one path.

A link in clone B to clone B's copy of the doc does not match the page in clone A. Only an exact target counts, because no link is a guess (`../design.md` § Links).

**A source is an entry that passes every check below.**
- `owner` is `'mine'`. Third-party entries are never sources.
- `line` is null. A follow-up `#L<n>` entry is never a source, whatever it holds. The check is explicit, so a future index change cannot add one row per item.
- It is not the target. Exclude the entry when its `path` is in the target set. Also exclude it when its clone key (below) equals the clone key of a target entry: that is the same doc in another clone.
- At least one of its `links` matches.

**Rows.** One row per source doc, however many links it holds to the target. `line` is the lowest `line` of its matching links. `entryId` is the entry's `id`. `title` and `path` are the entry's own. Sort by `compareTitles` from `./tree` on the title, then by `path` in code-unit order.

**Clones of one repo show once.**
- The clone key of an entry is `<owner key>\0<relative path>`, where the owner key is `repo`, else `plugin`.
- The relative path is `path` without its leading `root`.
- An entry with no owner key, or with a null `root`, or whose `path` does not start with its `root`, has its `path` as the clone key.
- The `plugin` fallback goes beyond the brief for this task. Two installed versions of one installed-only file have a null `repo`, and without the fallback they show twice.

`linkedFrom` takes no `Paths` by plan.md's signature, so the relative path is a string slice. The index writes `path` and `root` in one form.

When several sources share a clone key, one row stays:
1. the source whose `root` holds the target: `targetPath` equals `root` followed by a separator, then more text
2. else the source with the lowest `root` in code-unit order

So a page in clone Z shows clone Z's row, and the choice never depends on input order.

**Rename and trash.** `applyChange` and `renamedDocument` keep `headings` and `links` as they are. A target renamed since the last build goes stale until the next build, as `../design.md` § Links accepts. A renamed doc keeps its own links, whose `target` is its old path. So the renamed doc may list itself in its own Linked from until the next index build. This is accepted, and `linkedFrom` adds no rule for it.

**Fixtures that build an `IndexEntry` or an `IndexDocument`.** Each entry gains `headings: []` and `links: []`. Each document gains `schemaVersion: 5`. The list comes from `grep -rn -E "walked: \[\]|\"walked\": \[\]|schemaVersion: 4" src`, run at plan time.

| File | Line at plan time | Change |
|---|---|---|
| `src/plugins/backlog/main/homes.test.ts` | 27 | entry fields |
| `src/plugins/backlog/main/start.test.ts` | 106, 114 | entry fields, schema |
| `src/plugins/docs/index-document.test.ts` | 22, 36 | entry fields, schema |
| `src/plugins/docs/kinds.test.ts` | 22 | entry fields |
| `src/plugins/docs/path-guard.test.ts` | 19 | entry fields |
| `src/plugins/docs/tree.test.ts` | the `entry` helper at 16 | entry fields |
| `src/plugins/docs/page/docs-state.test.ts` | 466, 537, 548, 1377 | schema, entry fields, schema, entry fields |
| `src/plugins/docs/main/plugin-status.test.ts` | 30 | entry fields |
| `src/plugins/docs/main/doc-files.test.ts` | 32 | entry fields |
| `src/plugins/docs/main/start.test.ts` | 206, 298 | schema, entry fields |
| `src/plugins/docs/main/index-sources.test.ts` | 36, 42 | entry fields, schema |
| `src/plugins/docs/main/selftest-fixture.ts` | 188, 405 | entry fields, schema |
| `src/plugins/docs/main/selftest-fixture.ts` | 464, in the stand-in Python script | add `"headings": [], "links": []` to the dict |
| `src/plugins/docs/page/docs-state.ts` | 660 in `provisionalEntry` | entry fields. A new file has no headings until a build lists it |

Two tests pin a schema number that changes meaning:
- `src/plugins/docs/main/index-sources.test.ts:91`, `load_SchemaFive_PinnedMessage`, uses schema 5 as the unsupported value. Rename it `load_SchemaSix_PinnedMessage`. Write `{"schemaVersion":6}` and expect the message to contain `6`.
- `src/plugins/docs/index-document.test.ts:87`, `parse_Schema%i_Unsupported`, has rows `[1, 2, 3]`. Make the rows `[1, 2, 3, 4]`.

`src/plugins/docs/page/docs-dialogs.ts` `followupEntry` spreads `provisionalEntry`, so it needs no change. Re-run the grep before the first edit. A hit this table does not name is a fixture to change too.

## Behaviour

GIVEN docs in clones A and B that each link to one global doc WHEN `linkedFrom` runs on that doc THEN one row shows, from the lower root.
GIVEN a target with a symlinked path in `walked` WHEN the caller passes the symlinked path THEN links to the real path match.
GIVEN an index of schema 4 WHEN it is parsed THEN the result is `ok: false` and the message names schema 4.

## Tests

`src/plugins/docs/index-document.test.ts`, as rows added to the existing malformed-entry table. The break is a dropped or weakened check, which lets a bad field reach the page.

| given | fields on the entry | problem |
|---|---|---|
| no headings | `headings` left out | `entry 0 is malformed: headings` |
| heading without line | `headings: [{ level: 2, text: 'A' }]` | `entry 0 is malformed: headings` |
| no links | `links` left out | `entry 0 is malformed: links` |
| link of unknown form | one link with `form: 'wiki'` | `entry 0 is malformed: links` |
| link targetLine a string | one link with `targetLine: '3'` | `entry 0 is malformed: links` |

`src/plugins/docs/linked-from.test.ts`, on data built in the test. Use a builder `entry(overrides)` with `owner: 'mine'`, `line: null`, `repo: null`, `root: null`, `plugin: null`, `walked: []` and `links: []`, and a builder `link(target, line)`. `id` defaults to `path`, `title` defaults to the base name of `path`, `kind` defaults to `'skill-file'` and `source` to `'repo'`. A row that expects a `title` sets it.

`linkedFrom_Match` (`it.each`). The break is a compare that ignores `walked`, or that matches a clone's copy.

| given | entries | targetPath | expected row paths |
|---|---|---|---|
| link to the real path | `/g/t.md`; `/g/s.md` links `/g/t.md` | `/g/t.md` | `/g/s.md` |
| caller passes a walked path | `/g/t.md` walked `['/l/t.md']`; `/g/s.md` links `/g/t.md` | `/l/t.md` | `/g/s.md` |
| target no entry lists | `/g/s.md` links `/g/gone.md` | `/g/gone.md` | `/g/s.md` |
| link to another clone's copy | `/c/a/t.md` and `/c/b/t.md`, repo `r`, roots `/c/a`, `/c/b`; `/c/b/s.md` links `/c/b/t.md` | `/c/a/t.md` | none |
| link to another file | `/g/t.md`; `/g/s.md` links `/g/u.md` | `/g/t.md` | none |

`linkedFrom_NotASource` (`it.each`). The target is `/g/t.md` in each row. The expected rows are `[]`. The break is a removed exclusion.

| given | source |
|---|---|
| third-party | `/g/s.md`, `owner: 'third-party'`, links the target |
| follow-up item | `id: '/g/f.md#L3'`, `path: '/g/f.md'`, `line: 3`, links the target |
| links to itself | `/g/t.md` links `/g/t.md` |
| links to itself through a walked path | target walked `['/l/t.md']`; `/g/t.md` links `/l/t.md` |

`linkedFrom_SameDocInAnotherClone_NotASource`. Target `/c/a/t.md`, repo `r`, root `/c/a`. `/c/b/t.md`, repo `r`, root `/c/b`, links `/c/a/t.md`. The rows are `[]`. The break is a clone key left out of the self-link check.

`linkedFrom_OneRowPerDoc_FirstLinkLineSortedByTitleThenPath`. Target `/g/t.md`. Source `/g/b.md`, title `beta`, links the target at lines 9 and 4. Sources `/g/z.md` and `/g/a.md`, both title `Alpha`, link it at line 2. The rows are, in order:
- `{ entryId: '/g/a.md', title: 'Alpha', path: '/g/a.md', line: 2 }`
- `{ entryId: '/g/z.md', title: 'Alpha', path: '/g/z.md', line: 2 }`
- `{ entryId: '/g/b.md', title: 'beta', path: '/g/b.md', line: 4 }`

The break is a row per link, the last link's line, or an order that follows the input.

`linkedFrom_Clones_OneRowStays` (`it.each`). The sources are `/c/z/s.md` and `/c/a/s.md`, repo `r`, roots `/c/z` and `/c/a`, listed in that order, and each links the target. The break is a kept row that follows input order.

| given | target | row kept |
|---|---|---|
| neither root holds the target | `/g/t.md` | `/c/a/s.md` |
| one root holds the target | `/c/z/t.md`, repo `r`, root `/c/z` | `/c/z/s.md` |
| plugin key, no repo | `/g/t.md`; both sources `repo: null`, `plugin: 'p@m'` | `/c/a/s.md` |

## Done when

The project compiles, with no fixture left at schema 4. `grep -rn "schemaVersion: 4" src` prints nothing. `wigley:make`'s test gate runs the tests above and the existing docs and backlog tests. Task 14 holds every runtime check.

Commit: one commit for the group. The commit message names schema 5 and states that wigley-ai-marketplace task 01 lands with it.

## Proof

