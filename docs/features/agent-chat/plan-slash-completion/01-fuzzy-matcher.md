# 01 — Fuzzy matcher contract and fzf adapter

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/contracts/fuzzy.ts` · create `src/renderer/fzf/fzf-matcher.ts` · test `src/renderer/fzf/fzf-matcher.test.ts` · modify `package.json`, `package-lock.json` (`npm install fzf@0.5.2`) · modify `scripts/check-layers.mts` · modify `src/contracts/plugin.ts` · modify `src/renderer/renderer.ts` · modify each test fake that builds a whole `PageServices` (`npm run typecheck` names them)
Consumes:  none
Produces:  in `src/contracts/fuzzy.ts`:
           `export type FuzzyTiers = readonly (readonly string[])[];`
           `export interface FuzzyMatcher {`
           `  rank<T>(items: readonly T[], query: string, tiersOf: (item: T) => FuzzyTiers): T[];`
           `  matches(query: string, text: string): boolean;`
           `}`
           in `src/renderer/fzf/fzf-matcher.ts`: `export function createFzfMatcher(): FuzzyMatcher`
           in `src/contracts/plugin.ts`: `PageServices.fuzzy: FuzzyMatcher`
           in `src/renderer/renderer.ts`: one `const fuzzy = createFzfMatcher()` in the `services` object typed `Omit<PageServices, 'uiState'>` (task 03 also hands it to the editor host, so build it ahead of `createCodeMirrorVimHost`)
Decisions: the `fzf` npm package, version 0.5.2 exactly, approved by the user in round 4 — install nothing else · one adapter folder, the only `fzf` import (`AGENTS.md` third-party tool rule) · ranking by fzf's score (its default `v2` algorithm, `casing: 'case-insensitive'`, `normalize: true`), the input order breaking ties · a match in an earlier tier always outranks a match in a later tier, whatever the scores; inside a tier an item takes its best text's score; an item appears once (the user, 2026-11-04: a row's name outranks its path)
Pinned:    `rank` and `matches` trim the query before matching (keeps the trim in `visibleIndexes`, one rule for every caller) · `rank` with a query that is empty after trimming returns every item in input order · `matches` with an empty (trimmed) query returns `true` · a query is matched as one fuzzy term: no fzf extended-search syntax (`'`, `^`, `!`, `|`) · a space inside the query is a literal character: it must match a space in the text, and the query does not split
GIVEN items `['wigley:feature', 'wigley:feature-primer', 'make']` WHEN rank runs with query `feature` THEN `make` is left out and both `wigley:` items are returned
GIVEN items each with one tier `[name, ...aliases]` and query `cost` WHEN an item `usage` has alias `cost` THEN `usage` is returned
GIVEN two items whose best texts score the same WHEN rank runs THEN they keep their input order
GIVEN `backlog-repo` with tiers `[['backlog-repo'], ['backlog-repo — ~/dev/wigley-ai-gui/backlog']]` ahead of `wigley-ai-gui` with tiers `[['wigley-ai-gui'], ['wigley-ai-gui — ~/dev/wigley-ai-gui']]` WHEN rank runs with query `gui` THEN `wigley-ai-gui` comes first, and `backlog-repo` is still returned
Tests:     in `fzf-matcher.test.ts`, with data built in the test:
           `rank_EmptyQuery_ReturnsAllInInputOrder`
           `rank_NoMatch_LeavesItemOut` — `make` absent for `feature`
           `rank_MatchesAnAlias` — `{ name: 'usage', aliases: ['cost'] }` returned for `cost`
           `rank_ItemWithTwoMatchingTexts_AppearsOnce`
           `rank_EqualScores_KeepInputOrder` — two items with identical text
           `rank_BetterMatchFirst` — query `feat`: `feature` ranks ahead of `fix-each-attribute` (contiguous over scattered)
           `rank_EarlierTierOutranksLaterTier` — the `gui` case above
           `matches_Subsequence_True` (`wf` in `wigley:feature`) · `matches_OutOfOrder_False` (`ew` in `wigley:feature`) · `matches_EmptyQuery_True` · `matches_InteriorSpace_IsLiteral` (`foo bar` in `foo-bar` is false, in `foo bar` true)
Approach:  `fzf`'s `Fzf` class builds its index from a list and a `selector`. Build one `Fzf` per tier over flattened `(item, text)` pairs with a selector over the text, and keep each item's first matching tier and its best score there. Verify fzf's tie order against its docs (https://fzf.netlify.app, the repo `ajitid/fzf-for-js` `src/lib/`), or let `rank_EqualScores_KeepInputOrder` decide, and add an index tiebreaker if its sort is not stable. A fresh `Fzf` per `rank` call is fine: lists are under a few thousand short labels, and filtering runs per keystroke on cold UI.
Layer:     add `'src/renderer/fzf': { layers: ['src/contracts'], packages: ['fzf'] }` in `scripts/check-layers.mts`, and add `src/renderer/fzf` to the layers of `'src/renderer/renderer.ts'`, matching the `src/renderer/markdown-it` entries. Commit this file by pathspec only with this task's hunks: the working tree may hold a peer's edits
Done when: `npm run typecheck`, `npm run lint` and the tests above pass; `npm list fzf` shows `fzf@0.5.2`
Commit:    one commit for the group

## Proof

