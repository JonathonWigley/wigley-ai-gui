# 02 — The `wigley-layout:` scheme serves `<owner>/default/` from the owner's default folder

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/layout-url.ts` · modify `src/main/data-protocol/data-protocol.ts` · modify `src/main/main.ts` (the `serveLayoutScheme` call only) · test `src/shared/layout-url.test.ts`
Consumes:  `LayoutOwner` (`src/contracts/layouts.ts`), `Paths` (`src/contracts/paths.ts`) — both in the tree
Produces:  `export function layoutFilePath(url: string, layoutsRoot: string, paths: Paths, defaultFolderOf: (owner: LayoutOwner) => string | null): string | null` in `src/shared/layout-url.ts`
           `export function serveLayoutScheme(layoutsRoot: string, paths: Paths, defaultFolderOf: (owner: LayoutOwner) => string | null): void` in `src/main/data-protocol/data-protocol.ts`

Decisions:
- The scheme stays one handler. It looks up the owner's default folder by owner (plan.md § Decisions, design
  review). `defaultFolderOf(owner)` returns the absolute default folder of a registered owner in the clone. It
  returns null when the owner is not registered or there is no clone.
- `layoutFilePath` with the name `default`: it joins `defaultFolderOf(owner)` with the path segments, and drops the
  revision. It returns null when `defaultFolderOf` returns null, so the handler answers 404. Every other name joins
  `<layoutsRoot>/<owner>/<name>/<path>`, as today.
- Keep every check `layoutFilePath` makes today for every name, `default` included: the URL must have a revision
  segment, the owner must be one plain segment, and `decodedPathSegments` must accept the path. A `..` in the path
  never leaves the default folder.
- `serveLayoutScheme` passes `defaultFolderOf` through to `layoutFilePath`. `serveFiles` does not change.
- `src/main/main.ts` line 959: pass `() => null` as `defaultFolderOf`, so the tree compiles and the scheme serves no
  default yet. Task 04 replaces it with the service's lookup.
- Update the doc comments of `layoutFilePath` (lines 26–29 of `layout-url.ts`) and `serveLayoutScheme` (lines 70–72
  of `data-protocol.ts`) to name the `default` case.

GIVEN `defaultFolderOf('forms')` is `/clone/src/plugins/forms/layouts/default` WHEN the page asks for
`wigley-layout://forms/default/~4/layout.css` THEN `layoutFilePath` returns
`/clone/src/plugins/forms/layouts/default/layout.css`
GIVEN `defaultFolderOf` returns null WHEN the page asks for `wigley-layout://forms/default/~1/layout.js` THEN
`layoutFilePath` returns null
GIVEN any owner WHEN the page asks for a user layout `mine` THEN the file is under `layoutsRoot`, and
`defaultFolderOf` is not used

Tests:     all in `src/shared/layout-url.test.ts`. Every existing call gains a `defaultFolderOf` argument. Give it a
           lookup that returns a folder for every owner, so the existing rows also prove that a user name ignores it.
- `layoutFilePath_Default_JoinsTheOwnersDefaultFolder` — new: the round trip of
  `layoutUrl('forms', 'default', 4, 'parts/a b.css')` with `defaultFolderOf` returning
  `/clone/src/plugins/forms/layouts/default` gives `/clone/src/plugins/forms/layouts/default/parts/a b.css`; the
  lookup receives `forms`.
- `layoutFilePath_Refused_ReturnsNull` — add rows: `default` while `defaultFolderOf` returns null; `default` with a
  path that `..` folds past the revision (`wigley-layout://forms/default/~1/../../y.js`). The table gains a
  per-row `defaultFolderOf`, or a second table for the `default` rows holds them.
- `layoutFilePath_RoundTripsLayoutUrl` stays: with the lookup in place it pins that a user name joins under
  `layoutsRoot`.

Done when: `npm run typecheck` passes; the test gate runs the tests above.
Commit:    one commit for the group.

## Decisions from the cold plan read

These close gaps a cold reader found. Each binds as the Decisions above do.

- **The `..` row.** Replace the new refused row `forms/default/~1/../../y.js` (the revision check refuses it, so it
  cannot fail on the default branch) with rows that reach the default join while the lookup returns a folder:
  `wigley-layout://forms/default/~1/..%5C..%5Cy` and `wigley-layout://forms/default/~1/a%2Fb.js`, each refused.

## Proof

Commit 10b8f622 · proof: diff read: both Produces signatures present; layout-url tests 17/17; typecheck clean on its files (worker, and the only tree error is task 03 WIP in draw-part.ts); oxfmt clean · concerns: npm run lint stops at check-styles on agent-strip.css:17 raw 2px, pre-existing at the review base
