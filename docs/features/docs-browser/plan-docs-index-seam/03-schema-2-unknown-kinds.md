# 03 — Schema 2 and unknown kinds and sources in the app

Status: in progress
Type: Task
Wave: 2 · Depends on: 01 (shares `doc-files.test.ts`)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/contract.ts` · `src/plugins/docs/index-document.ts` · `src/plugins/docs/tree.ts` ·
           `src/plugins/docs/kinds.ts` · `src/plugins/docs/path-guard.ts` · `src/plugins/docs/page/docs-state.ts` ·
           `src/plugins/docs/main/selftest-fixture.ts`
           test `src/plugins/docs/index-document.test.ts` · `src/plugins/docs/tree.test.ts` ·
           `src/plugins/docs/kinds.test.ts` · `src/plugins/docs/path-guard.test.ts` ·
           `src/plugins/docs/page/docs-state.test.ts` · `src/plugins/docs/main/selftest-fixture.test.ts` ·
           `src/plugins/docs/main/index-sources.test.ts` (entry builders and `machineIndex_SchemaTwo_PinnedMessage`, which
           moves to a version other than 2) · `src/plugins/docs/main/doc-files.test.ts` (entry builders only)
Consumes:  none
Produces:  in `src/plugins/docs/contract.ts`: `IndexEntry.kind: string`, `IndexEntry.source: string`,
           `IndexEntry.walked: string[]` (after `meta`), `IndexDocument.schemaVersion: 2`
           in `src/plugins/docs/index-document.ts`: `INDEX_SCHEMA_VERSION = 2`, `export const DOC_SOURCES`,
           `export function isKnownKind(kind: string): kind is DocKind`,
           `export function isKnownSource(source: string): source is DocSource`
           in `src/plugins/docs/tree.ts`: `export function titleFromId(id: string): string`
Decisions: schema 2, `walked` required (round 2) · unknown kinds and sources load, titled from the id, after the known
           ones; an unknown source is never a create place, and its root grants no writes (round 1 notice) ·
           `DocKind` and `DocSource` stay the closed unions of known values, so `KIND_TITLES`, `KIND_RULES` and the
           owner titles keep their exhaustive records

## Behaviour

- **Parsing** (`parseIndexDocument`): accepts `schemaVersion` 2 only (the unsupported-schema message keeps its
  wording, now naming 2). An entry's `kind` and `source` need only be strings. `walked` must be an array of strings;
  otherwise the entry is malformed with field `walked`. The source-specific checks (`repo`, `root`, `plugin`) keep
  applying to the known sources they name; an unknown source's `repo`, `root` and `plugin` are each a string or null.
- **Tree** (`buildTree`): after the repo nodes, one root node per unknown source, ordered by `compareTitles` on the
  source id, id `source:<source>`, title `titleFromId(source)`, its children `kindGroups` of its entries.
  `kindGroups` adds, after the `DOC_KINDS` groups, one group per unknown kind present, ordered by `compareTitles`,
  id `<parentId>/kind:<kind>` (the prefix keeps an unknown kind spelled `features` or `clone:…` off an existing
  node's id), title `titleFromId(kind)`. `byKindThenTitle` ranks unknown kinds after every known kind,
  then by kind id.
- `titleFromId`: every `-` and `_` becomes a space, then the first character is upper-cased:
  `my-kind` → `My kind`, `scratch_notes` → `Scratch notes`.
- **Create places** (`placesFor`): an entry whose source is not known is skipped, like a plugin entry.
- **Write guard** (`changeRefusal`): an entry's root allows changes inside it only for source `repo` or `features`;
  an unknown source's entries allow only their own path. `isIndexedPath` (link opening) is unchanged.
- **Provisional entry** (`provisionalEntry`): the owning root is a `repo` or `features` entry's root only; the new
  entry carries `walked: []`.
- **Fixture**: `selftest-fixture.ts` writes `schemaVersion: 2` and `walked: []` on every entry of its TS index
  document, and the stand-in `docs_index.py` it writes (`standInScript`) adds `"walked": []` to the entry dict it
  appends for a new rule file in `built_index()`, so a rebuild after `fresh.md` still parses. Its entry counts stay
  as they are, so the self-test's lines do not move.
- Every test that builds an `IndexEntry` or index document adds `walked: []` (and `schemaVersion: 2`); the
  unsupported-schema tests now use a version other than 2.

GIVEN an index whose one entry has kind `experiment` WHEN parsed THEN it loads, and the tree shows an `Experiment`
group after every known kind group
GIVEN an entry of source `scratch` with a root WHEN the tree builds THEN a root node `Scratch` follows the repo nodes;
WHEN a write targets a file inside that root that is not the entry's own path THEN it is refused; WHEN it targets the
entry's own path THEN it is allowed
GIVEN an entry with no `walked` WHEN parsed THEN the message names field `walked`
GIVEN a document with `schemaVersion: 1` WHEN parsed THEN `Unsupported docs index schema 1; this app reads 2`

Tests:     `index-document.test.ts`: `parse_UnknownKind_Loads`, `parse_UnknownSource_Loads`,
           `parse_MissingWalked_NamesWalked`, `parse_WalkedNotStrings_NamesWalked`, `parse_Schema1_Unsupported`
           (message above, verbatim) · `tree.test.ts`: `buildTree_UnknownKind_GroupAfterKnownKinds`,
           `buildTree_UnknownSource_RootAfterRepos`, `buildTree_UnknownKindNamedFeatures_IdUnique`, `titleFromId_HyphensAndUnderscores_BecomeSpaces`
           (`my-kind` → `My kind`, `scratch_notes` → `Scratch notes`) · `kinds.test.ts`:
           `placesFor_UnknownSource_NoPlace` · `path-guard.test.ts`:
           `changeRefusal_InsideUnknownSourceRoot_Refused`, `changeRefusal_UnknownSourceEntryPath_Allowed` ·
           `docs-state.test.ts`: `provisionalEntry_InsideUnknownSourceRoot_OwnedGlobal`
Done when: `npm run typecheck`, `npm run lint` and the tests above pass
Commit:    one commit for the group

## Proof
