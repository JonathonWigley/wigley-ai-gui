# 02 — One ownsRoot helper

Status: in progress
Type: Task
Rung: standard · a pure helper beside `isKnownSource` in `src/plugins/docs/index-document.ts`, swapped in at four call sites
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up **ownsRoot helper** (L534, `followups.md` on main at 9b671bd16): "a `repo` or `features` entry owns its
root" is spelled inline in four places; one `ownsRoot(entry)` beside `isKnownSource` gives it one home.

Files:
- modify `src/plugins/docs/index-document.ts` (adds `ownsRoot`; `malformedEntryField`'s `ownedByRepo`)
- modify `src/plugins/docs/tree.ts` (`buildTree`'s `repoOwned` filter)
- modify `src/plugins/docs/path-guard.ts` (`changeRefusal`'s `isEntryOrInsideRoot`)
- modify `src/plugins/docs/page/docs-state.ts` (`owningEntry`'s `ownsFolder`)

Preconditions (run from the `wigley-ai-gui/` folder of the merged tree; checked 2026-11-17 on the Lane H branch):

| Claim | Command | Expected |
|---|---|---|
| The four inline checks | `grep -n -E "source === 'repo' \|\| (entry\.)?source === 'features'" src/plugins/docs/index-document.ts src/plugins/docs/tree.ts src/plugins/docs/path-guard.ts src/plugins/docs/page/docs-state.ts` | four lines: `index-document.ts` (`ownedByRepo`), `tree.ts` (`repoOwned`), `path-guard.ts` (`changeRefusal`), `docs-state.ts` (`ownsFolder`) |
| No helper yet | `grep -rn "ownsRoot" src` | nothing |
| `isKnownSource` is the neighbour | `grep -n "export function isKnownSource" src/plugins/docs/index-document.ts` | one line |

Consumes: nothing.

Produces: `export function ownsRoot(entry: { source: unknown }): boolean` in `src/plugins/docs/index-document.ts`,
directly after `isKnownSource`, with a one-line comment: a `repo` or `features` entry owns its root folder.

Decisions:
- **The parameter type.** `{ source: unknown }` takes both an `IndexEntry` and the raw `JsonObject` that
  `malformedEntryField` checks before the entry is typed, so all four sites call `ownsRoot(entry)` with no cast.
- **The root's null check stays at the sites.** `path-guard.ts` and `docs-state.ts` go on to read `entry.root`, and
  the narrowing to a string belongs where it is read: each keeps `entry.root !== null` beside its `ownsRoot(entry)`.
- **The repo-only checks stay.** `tree.ts`'s `source === 'repo' && entry.plugin !== null` filter, its
  `cloneEntries` / `featureEntries` split, its `owner === 'mine'` ordering, and `docs-state.ts`'s
  `holdingPluginKey` and `source === 'features'` kind guess ask a different question (only `repo`, or one source by
  name) and are left as they are.
- `tree.ts`, `path-guard.ts` and `docs-state.ts` import `ownsRoot` from `index-document.ts` (`tree.ts` already
  imports `isKnownSource` from there; `docs-state.ts` already imports `installedCopies` and `metaString`).

GIVEN any index entry WHEN any of the four sites asks whether it owns its root THEN the answer is what the inline check gave: true for `repo` and `features`, false for `global`, `plugin` and an unknown source.

Tests: none added. This is a move of one predicate under tests that pin each site's behaviour: `index-document.test.ts`
(a `repo` or `features` entry with no `repo` or `root` is malformed), `tree.test.ts` (repo nodes), `path-guard.test.ts`
(writes inside a repo or features root allowed) and `docs-state.test.ts` (`provisionalEntry_InsideRepoRoot_…`,
`provisionalEntry_FeaturesOwner_FeatureDoc`). They pass unchanged.

Done when: compiles; `npm test` passes `index-document.test.ts`, `tree.test.ts`, `path-guard.test.ts` and
`docs-state.test.ts` unchanged; the precondition grep for the inline pair returns nothing, and
`grep -rn "ownsRoot(entry)" src/plugins/docs` returns four call sites.

Commit: one commit for the group: "Docs: one ownsRoot helper for the repo-or-features root rule (follow-up L534)".

## Proof

