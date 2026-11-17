# 05 — Style-only layout reload

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/layouts.ts` · modify `src/shared/layouts/layout-registry.ts` ·
           modify `src/shared/page/layout-host/layout-loader.ts` · modify `src/shared/page/layout-host/show-layouts.ts` ·
           test `src/shared/layouts/layout-registry.test.ts` · test `src/shared/page/layout-host/layout-loader.test.ts` ·
           test `src/shared/page/layout-host/show-layouts.test.ts` · test `src/main/layouts/layout-service.test.ts`
Consumes:  `layoutUrl(owner, name, revision, path)` (tree, `src/shared/layout-url.ts`; the `~<n>` segment only breaks
           the cache: `layoutFilePath` drops it, so any counter can fill it)
Produces:  in `src/contracts/layouts.ts`: `LayoutEntry.styleRevision: number`; `LayoutSet` becomes
           `{ layouts: LayoutEntry[] }` (`changed` removed)
           in `src/shared/page/layout-host/layout-loader.ts`: `LayoutLoad<L>.restyled: LayoutEntry[]`
Decisions: the registry raises a separate `styleRevision` when only a layout's style changed; the loader keys the
           stylesheet by it and the module by `revision` (headless pick) · a stylesheet a layout's JS loads itself follows
           `revision`, not `styleRevision`; `docs/features/layouts/design.md` § Reload says so, written ahead by the lead · `LayoutSet.changed` is removed (headless
           pick) · the missed-watch rescan tells a style-only change apart, as a reported save does (this task: see
           Approach) · a style-only load logs `layout <name> restyled (style revision <n>)`, so the drive and task 15
           can see the re-link (this task)
GIVEN a listed user layout WHEN its `layout.css` is saved THEN the sent set raises its `styleRevision` and keeps its
      `revision`
GIVEN a listed user layout WHEN a `.js`, `.mjs` or `.json` file in its folder is saved THEN the sent set raises its
      `revision` and keeps its `styleRevision`
GIVEN the live default WHEN its `layout.css` is saved THEN the sent set raises the default's `styleRevision` alone
GIVEN a shown layout WHEN a set arrives that raised only its `styleRevision` THEN the loader imports nothing, returns
      the same layout object, moves the layout's stylesheet link to the new URL, and the owner's `setLayouts` does not run
GIVEN a watch that missed changes WHEN the rescan finds only a layout's `.css` files changed THEN it raises that
      layout's `styleRevision` alone
Tests:     see § Tests below.
Done when: `npm run lint` and the typecheck pass; `command grep -rnw 'changed' src/contracts/layouts.ts
           src/shared/layouts src/shared/page/layout-host src/main/layouts` prints no line about a `LayoutSet` (the lines
           left name the `changed` path parameter of the registry's watch callbacks); the test gate runs the four test
           files above. Live check: task 15.
Commit:    one commit for the group: `src/contracts/layouts.ts` `src/shared/layouts/layout-registry.ts`
           `src/shared/layouts/layout-registry.test.ts` `src/shared/page/layout-host/layout-loader.ts`
           `src/shared/page/layout-host/layout-loader.test.ts` `src/shared/page/layout-host/show-layouts.ts`
           `src/shared/page/layout-host/show-layouts.test.ts` `src/main/layouts/layout-service.test.ts`

## Approach

### Contract (`src/contracts/layouts.ts`)

- `LayoutEntry` gains `styleRevision: number`. Comment: it grows on every change of the layout's style files and never
  resets, so the stylesheet URL holding it loads fresh CSS; `revision` grows on every other change.
- `LayoutSet` drops `changed`. Its comment keeps "Every layout in an owner's layouts folder, `default` first" and drops
  the `changed` sentence.
- `changed` is read nowhere outside tests. Checked at plan time with
  `command grep -rnw 'changed' src/shared/layouts src/shared/page/layout-host src/main/layouts src/contracts/layouts.ts src/contracts/bridge.ts src/preload/preload.ts`:
  the only hits are the writer (`setOf` in `layout-registry.ts`), the contract, and test fixtures and assertions in
  `layout-registry.test.ts`, `layout-loader.test.ts`, `show-layouts.test.ts` and `layout-service.test.ts`. The
  `LayoutEntry` literals outside tests are only in `layout-registry.ts` (`command grep -rn 'builtIn:' src --include='*.ts'`).

### Which revision a change raises (`src/shared/layouts/layout-registry.ts`)

A change has one of three kinds, by the file it touches:

| Change | Kind | Raises |
| --- | --- | --- |
| a `.css` file in a user layout's folder, at any depth | style | `styleRevision` |
| a `.js`, `.mjs` or `.json` file in a user layout's folder | code | `revision` |
| an image or font file (`svg png jpg jpeg gif webp woff woff2 ttf otf`) in a user layout's folder | both | both |
| a whole folder renamed, moved or deleted; a layout joining or leaving; a rescan that finds mixed kinds; an image or font | both | both |
| a layout that joins or leaves the set, whatever the file | both | both |
| the default folder's `layout.css` | style | the default's `styleRevision` |
| the default folder's `layout.js` | code | the default's `revision` |
| the default going live or built in (its `layout.js` appears or goes) | both | both |

Why: a `.css` file reaches the page through the `layout.css` link, whose URL holds `styleRevision`, and a nested
stylesheet that link imports resolves under that same URL. A `.js`, `.mjs` or `.json` file reaches it through the
module URL, which holds `revision`. An image or font can be reached from either, so it raises both. A stylesheet the
layout's own JS loads itself (`new URL('x.css', import.meta.url)`, a `<link>` the JS adds) resolves under the module's
`~revision`, so it follows `revision`, not `styleRevision`: a style-only save to it does not refresh it, and the layout
author saves `layout.js` too. A layout that joins or leaves
may hold any new file, so it raises both.

Members to change:

- Keep a `styleRevisions` map beside `revisions`, for the life of the process, and a `defaultStyleRevision` counter
  beside `defaultRevision`; each starts at 1. `BUILT_IN_DEFAULT` gets `styleRevision: 1`. `entry(...)` and
  `defaultEntryOf(...)` fill `styleRevision` from them.
- `onChange(changed)` passes the change's kind to `relistInTurn(name, kind)`, by the table above. The fixed kinds are
  `'code'`, `'style'` and `'both'`; derive the file's kind from its extension in one helper beside `isLayoutFileName`.
- `relist(name, kind)` does what it does now, then raises `revision` for `code` and `both`, and `styleRevision` for
  `style` and `both`. When `wasListed !== isListed`, it uses `both`. A first-seen counter starts at 1, as `revisions`
  does today.
- `relistDefault(watched, kind)` raises `defaultRevision` for `code` and `both`, `defaultStyleRevision` for `style` and
  `both`; when the default's liveness changes (`defaultEntry.builtIn` differs from `!files.hasCode`), it uses `both`.
  The rule "a change while it stays built in sends nothing" stays.
- `setOf()` takes no argument and returns `{ layouts: [defaultEntry, ...listed.map(entry)] }`; `current()` returns it.
- Rewrite the `LayoutRegistry` comment's sentences about `changed` ("naming that layout as changed", "sends the set
  naming `default`") to say which revision each save raises.

### The missed-watch rescan tells a style-only change apart

Decision: tell it apart; do not raise both. `readStamps` already reads one stamp line per layout file
(`<path>\t<modified time>`), so the rescan can see which paths changed. Raising both on every rescan would redraw every
owner's open view after a sleep or a burst of saves, which this plan exists to stop for a CSS-only save.

- `readStamps` keeps each folder's stamps by path (`Map<name, Map<path, string>>`), not joined into one string.
- `relistChanged` compares each folder's stamps with the last ones: the paths added, removed or with another time are
  the changed paths. It folds their kinds by the table above (all `style` → `style`, all `code` → `code`, else `both`)
  and calls `relist(name, kind)`. A folder that is in only one of the two maps is `both`.
- `defaultStampOf` returns the two lines apart (`{ code: string | null; style: string | null }`, null for a missing
  file), and `null` when either cannot be read, as today. The default watch's `onMissed` compares them with the last
  ones: only `style` differs → `style`; only `code` → `code`; both → `both`; neither → nothing. A read that failed (`null`) sends
  `both` only when the last stamp was readable; `null` against `null` sends nothing, as today, so a default that stays
  unreadable does not redraw every owner's view after each rescan.
- `relist` stores the new stamps for `name` as it does today.

### Loader (`src/shared/page/layout-host/layout-loader.ts`)

- `layoutUrls(entry, layoutUrl)` builds the script URL from `entry.revision` and the style URL from
  `entry.styleRevision` (`layoutUrl(entry.name, entry.styleRevision, 'layout.css')`, null without `hasCss`).
- Import rule: unchanged. A name is imported only when its set entry's `revision` differs from its good version's and
  from its failed revision. A `styleRevision` change imports nothing.
- In `load`, for each set entry whose good version's `entry.revision` equals the set entry's `revision`, store the set
  entry on the good version (`good.set(name, { layout, entry: setEntry })`), so its link follows `styleRevision` and
  `hasCss`. A good version at an older revision (its newer revision failed) keeps its stored entry, so a failed reload
  keeps the last good look whole, as today.
- The loader keeps the href string it last set for each link (per link, beside it) and compares the new href string
  against that, never against `link.href`, which a browser resolves to an absolute URL.
- `LayoutLoad.restyled` lists each set entry whose stylesheet href this load changed while its script was not imported
  in this load: a user layout's link href moved, was added or was removed, or the default link's href moved, was added
  or was removed. A default that went built in (not imported, `builtIn`) is left out of `restyled`, and so is logged as nothing; its link
  still moves to `defaultStylesheet`. Entries come in the set's order. Comment it on `LayoutLoad`.
- Rewrite the comment above `createLayoutLoader`: modules are cached by name and `revision`; each stylesheet link's URL
  holds the version's `styleRevision`.

### Show (`src/shared/page/layout-host/show-layouts.ts`)

- In `loadAndShow`, after the `loaded` log lines, log `layout <name> restyled (style revision <styleRevision>)` for each
  entry of `result.restyled`.
- `shownChanged` does not change: a style-only set returns the same layout objects, so `setLayouts` does not run.

## Tests

Every fixture that builds a `LayoutEntry` gains `styleRevision`, and every `LayoutSet` literal drops `changed`. In the
loader and show tests the helper becomes `entry(name, revision, hasCss = false, styleRevision = revision)`, so the
existing link hrefs (`url:a/layout.css@5`) stay true; the registry and service literals get `styleRevision: 1`.

Registry (`layout-registry.test.ts`). Add a helper `changesIn(previous: LayoutSet, next: LayoutSet): string[]` that
lists, sorted, `<name> revision` for each entry whose `revision` rose, `<name> style` for each whose `styleRevision`
rose, `<name> joined` and `<name> left`, and `default built-in` when the default's `builtIn` went from false to true and
`default live` when it went from true to false. `BUILT_IN_DEFAULT` stays a constant (revision 1, style 1; the loader never
imports it), so going built in raises neither number: only the `builtIn` flip shows it.

- Each `expect(sent[i].changed).toBe(X)` becomes an assertion on `changesIn(<the set before>, sent[i])`, the set
  before being `registry.current()` read before the save or the previous sent set. For example in
  `watch_SaveInAnyUserFolder_BumpsOnlyThatLayout`: `['beta revision']`; in `watch_LayoutJsRemoved_SendsSetWithoutIt`:
  `['alpha left']`; in `watch_NewFolder_JoinsTheSet`: `['gamma joined']`. Each `sent.map((set) => set.changed)`
  becomes `sent.map(...)` over `changesIn` of consecutive sets.
- `start_ListsDefaultFirstThenUsersByName`: every entry gains `styleRevision: 1`; the set has no `changed`.
- `watch_SaveOf_%s_SendsTheChange` becomes an object table `watch_SaveOf_RaisesTheRevisionItsKindKeys ($saved)`:
  `alpha/layout.css` → `['alpha style']`; `alpha/theme/extra.css` → `['alpha style']`; `alpha/layout.js` →
  `['alpha revision']`; `alpha/parts/card.mjs` → `['alpha revision']`; `alpha/strings.json` → `['alpha revision']`;
  `alpha/icons/check.svg` → `['alpha revision', 'alpha style']`; `alpha/fonts/body.woff2` →
  `['alpha revision', 'alpha style']`.
- Tests that assert `sent[0].changed` only as "this was alpha's set" (`watch_SaveInFolderThatIsNoLayout_SendsNothing`,
  `watch_SaveInDefaultFolder_SendsNothing`, `watch_EditorSideFile_%s`, `watch_FolderNameReportFor_%s`,
  `watch_OtherFileInDefaultFolder_SendsNothing`, `watch_UnreadableFileTime_StillListsSaves`,
  `watch_ReportedSaveThenMissed_SendsOnce`) hold the registry that `await start()` returns, read `registry.current()`
  right after the start as `before`, and assert `changesIn(before, sent[0])` equals `['alpha revision']`; where such a
  test sends nothing it asserts `sent` is empty as today.
- `watch_LayoutRemovedThenWrittenAgain_TakesAHigherRevision`: asserts the `styleRevision` and the `revision` are both 2 after
  the leave and both 3 after the join again.
- `watch_SaveInDefaultFolder_RaisesTheDefaultRevision` becomes `watch_SaveInDefaultFolder_RaisesTheRevisionItsFileKeys
  ($saved, from $started)`, each row gaining `changes`: `layout.js` from `[layout.js, layout.css]` →
  `['default revision']`; `layout.css` from `[layout.js, layout.css]` → `['default style']`; `layout.css` from
  `[layout.js]` → `['default style']`; `layout.js` from `[layout.test.ts]` (the default goes live) →
  `['default live', 'default revision', 'default style']`. `hasCss` per row as today.
- `watch_DefaultLayoutJsRemovedThenWritten_BuiltInThenHigherRevision` (today asserts `['default','default']`): the two sent
  sets give `[['default built-in'], ['default live', 'default revision', 'default style']]`.
- `watch_DefaultLayoutCssRemoved_SendsDefaultWithoutCss`: changes `['default style']`, `hasCss: false`.
- `watch_MissedChange_ListsAgainOnlyWhatChanged` rows' `changed` becomes `changes`, a list per sent set:
  `a save in beta` (`beta/layout.js`) → `[['beta revision']]`; `nothing` → `[]`; `a new layout` →
  `[['gamma joined']]`; `a save in the default folder` (`layout.css`) → `[['default style']]`. Add rows:
  `a css save in beta` (`beta/layout.css`) → `[['beta style']]`; `a js and a css save in beta` →
  `[['beta revision', 'beta style']]`; `a js save in the default folder` → `[['default revision']]`.
- `hasCss_TrueWhenLayoutCssPresent`: also asserts `alpha`'s `revision` is 1 and its `styleRevision` 2.

Service (`layout-service.test.ts`). `save_SendsOnlyThatOwnersSet` drops `expect(set.changed).toBe('x')`; it asserts
`x` is listed at revision 1 as today. The two set literals (about lines 99 and 170) drop `changed` and gain
`styleRevision: 1` on each entry.

Loader (`layout-loader.test.ts`). New `it.each`: `load_StyleOnlyChange_RelinksWithNoImport ($row)`. Each row loads a
first set, then a second set, and asserts the second load's imports (none, except in the last two rows), that `result.layouts.get(name)` is the
same object as after the first load (`toBe`; the last row asserts a new object), the link hrefs in `head`, and `restyled` names:

- `a user layout's css saved` — `mine` at revision 2, `hasCss`, style 1 → style 2: the `mine` link's href is the style
  URL at 2; `restyled` `['mine']`.
- `a user layout gains css` — `mine` revision 2, no css → `hasCss` at style 2: a `mine` link appears; `restyled`
  `['mine']`.
- `a user layout loses css` — `hasCss` at style 3 → no css at style 4: the `mine` link is gone; `restyled` `['mine']`.
- `the live default's css saved` — live default at revision 3, `hasCss`, style 1 → style 2: the default link's href is
  the default's style URL at 2; `restyled` `['default']`.
- `a newer revision failed` — `mine` loaded at revision 2 style 1; the second set holds revision 3 style 2 and the
  import of revision 3 throws: the `mine` link keeps the style URL at 1, `layouts.get('mine')` is the revision 2 object,
  `restyled` `[]`, and the second load imported `url:mine/layout.js@3` only.
- `a code and css save` — `mine` loaded at revision 2 style 1 with `hasCss`; the second set holds revision 3 style 2: the
  second load imports `url:mine/layout.js@3` (so `layouts.get('mine')` is a new object, not the first), the `mine` link's
  href is the style URL at 2, and `restyled` is `[]` because the script was imported.

`load_NewRevision_ImportsAgainAndMovesLink` becomes `load_NewRevision_ImportsAgainAndKeepsTheLink`: both entries
pass `styleRevision` 1 (`entry('a', 4, true, 1)`, `entry('a', 5, true, 1)`), so the imports stay `['url:a/layout.js@4', 'url:a/layout.js@5']` and the link stays
`{ layout: 'a', href: 'url:a/layout.css@1' }`. A code save no longer moves the stylesheet.

Show (`show-layouts.test.ts`). New `showLayouts_StyleOnlySet_LogsRestyledAndCallsNoSetLayouts`: the setting names
`mine`; a first set loads `mine` (revision 1, `hasCss`, style 1) and `setLayouts` runs once; a second set raises only
`mine`'s `styleRevision` to 2: `setLayouts` still ran once, nothing was imported again, and the log holds
`layout mine restyled (style revision 2)`.

## Proof

Commit 4cc9e04a1 · proof: diff read + wave 1 compile · concerns: restyled narrowed to entries still in layouts; the leave-and-rejoin test is weaker
