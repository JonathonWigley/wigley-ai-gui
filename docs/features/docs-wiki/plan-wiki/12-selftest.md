# 12 — Self-test groups for the wiki

Status: in progress
Type: Task
Wave: 8 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/selftest-script.ts` · modify `src/plugins/docs/main/selftest-fixture.ts` · modify `src/plugins/docs/page/doc-view.ts` (three log lines, see § Log lines) · test `src/plugins/docs/main/selftest-fixture.test.ts` · test `src/plugins/docs/page/tree-view.test.ts`

Consumes (every name is used through the running app, so this task reads no type from them):
- Log lines and keys of 08, 09, 10 and 11. § Log lines names each line and its owner.
- `<CR>` in `docs.doc` ← 11. On a doc, Enter must still activate a focused link. The step `['Tab', 'Enter']` in `links and disk changes` and the new link steps need this. See § Enter on a link.
- `schemaVersion: 5`, and `headings: []` and `links: []` in `entry()` and in the stand-in script's dict ← 02. This task does not change them. It sets both fields on its new entries.
- The Backlog fixture repo `dev/backlog-repo` (exists). Its start fixture commits `docs/features/backlog-x/plan-x/plan.md` once.

Produces, in `src/plugins/docs/main/selftest-fixture.ts`:
- `export const WIKI_MAIN_FILE = 'wigley-agents/wiki/Main.md'`
- `export const WIKI_MAIN_TEXT: string`
- `export const WIKI_GUIDE_FILE = 'wigley-features/selftest-repo/wiki-fixture/guide.md'`
- `export const WIKI_GUIDE_TEXT: string`

Produces, in `src/plugins/docs/main/selftest-script.ts`: eight new groups, first in the list that `docsGroups` returns, in this order: `wiki start`, `wiki sidebar`, `wiki section editor`, `wiki links and history`, `wiki list pages`, `wiki from a session tab`, `wiki narrow window`, `wiki with no Main.md`.

## Decisions: the fixture

**The data is test-owned.** Per `wigley:writing-tests` § Build the data you assert against, `Main.md` holds only the shelves below. It names no real shelf. A reader of `~/wigley-agents/wiki/Main.md` learns nothing that this task needs.

**`WIKI_MAIN_TEXT`**, exact. The numbers are file lines, and they are not part of the text:

```
 1  Start at [Fixture guides](wiki:kind/feature-doc) or [Every page](wiki:all).
 2
 3  ## Shelf one
 4
 5  ### Label one
 6
 7  - [Guide page](../../wigley-features/selftest-repo/wiki-fixture/guide.md)
 8  - [Commit page](../../dev/backlog-repo/docs/features/backlog-x/plan-x/plan.md)
 9  - [Gone page](gone.md)
10  - [Fixture guides](wiki:kind/feature-doc)
11
12  ## Shelf two
13
14  - [Every page](wiki:all)
15  - [Vendor docs](wiki:owner/third-party)
```

Reasons:
- Line 1 sits before the first shelf, so `parseWikiMain` ignores its links (task 03), and the sidebar has no extra rows. It sits before the first heading, so a heading's `edit` button is not before these links in the Tab order. So `Tab` reaches the first link and `Tab Tab` reaches the second.
- The paths are relative, not `~/`. `mainFolder` is a real path, and the fixture's entries hold real paths. A temp home can sit under a link, and a `~/` path then needs `walked`.

The wiki sidebar's rows, top to bottom. The steps below count these rows:

| Row | Text | Type |
|---|---|---|
| 0 | `Shelf one` | group, expanded |
| 1 | `Label one` | label |
| 2 | `Guide page` | leaf |
| 3 | `Commit page` | leaf |
| 4 | `Gone page` | dangling link |
| 5 | `Fixture guides` | link, count 2 |
| 6 | `Shelf two` | group, expanded |
| 7 | `Every page` | link |
| 8 | `Vendor docs` | link, count 2 |

**`WIKI_GUIDE_TEXT`**, exact, ending with one line break. The doc has no `#` heading, so the links on line 1 come before every heading's `edit` button:

```
 1  Read `target.md` § Target part for the target, and § Closing notes for the end.
 2
 3  ## Opening notes
 4
 5  Opening text.
 6
 7  ## Middle notes
 8
 9  Middle text.
10
11  ## Closing notes
12
13  Closing text.
```

**`target.md`**, beside the guide, with no exported name:

```
1  # Fixture target
2
3  Text above.
4
5  ## Target part
6
7  Text below.
```

**The writes.** `fixturePaths` gains `wikiMain`, `wikiGuide` and `wikiTarget`, from `WIKI_MAIN_FILE`, `WIKI_GUIDE_FILE` and `wigley-features/selftest-repo/wiki-fixture/target.md`. `writeDocsFixture` writes the three texts in its `writes` list. So each script run restores a `Main.md` that an earlier run's steps moved to the Trash.

**The entries.** Add three entries directly after `...backlogEntries(fixture, paths)`. Do not add them above it. `sessionDocument` reads positions 0, 1, 4 and 5, and the session index stays at 4 entries.

| Path | `kind` | `source` | `repo` | `root` | `title` | `meta` |
|---|---|---|---|---|---|---|
| `wikiMain` | `reference` | `global` | null | null | `Fixture main page` | `{}` |
| `wikiGuide` | `feature-doc` | `features` | `selftest-repo` | `fixture.featuresHome` | `Fixture guide` | `{ feature: 'wiki-fixture' }` |
| `wikiTarget` | `feature-doc` | `features` | `selftest-repo` | `fixture.featuresHome` | `Fixture target` | `{ feature: 'wiki-fixture' }` |

`headings`:
- `wikiMain`: `{ level: 2, text: 'Shelf one', line: 3 }`, `{ level: 3, text: 'Label one', line: 5 }`, `{ level: 2, text: 'Shelf two', line: 12 }`
- `wikiGuide`: `{ level: 2, text: 'Opening notes', line: 3 }`, `{ level: 2, text: 'Middle notes', line: 7 }`, `{ level: 2, text: 'Closing notes', line: 11 }`
- `wikiTarget`: `{ level: 1, text: 'Fixture target', line: 1 }`, `{ level: 2, text: 'Target part', line: 5 }`

`links`:
- `wikiMain`: `{ form: 'markdown', raw: '[Guide page](../../wigley-features/selftest-repo/wiki-fixture/guide.md)', target: fixture.wikiGuide, line: 7, targetLine: null }`. So the guide's right column shows Linked from.
- `wikiGuide`:
  - ``{ form: 'section', raw: '`target.md` § Target part', target: fixture.wikiTarget, line: 1, targetLine: 5 }``
  - `{ form: 'section', raw: '§ Closing notes', target: fixture.wikiGuide, line: 1, targetLine: 11 }`
- `wikiTarget`: `[]`

These are the shapes that task 01's index writes. The stand-in script copies them from `index.fixture.json`, so `build` keeps them. It drops an entry whose file is gone, and it lists it again once the file returns. The stand-in script needs no change.

**The filters of the existing groups.** No new path, title or heading holds `neat.md`, `style`, `style.md` or `zqzq`. So those filters show the rows they show today.

## Decisions: Recent changes and git

The fixture adds no git repo and no commit. `Commit page` links `plan.md` in `dev/backlog-repo`, which is a real repo with one commit of that file. Docs' fixture already lists this file. So `recentChanges` reaches real `git log`, and `Guide page` gives no root and is left out.

- The Backlog plugin's `startFixture` writes this repo at start in every self-test run. `--plugin docs` runs this too, since a filter selects scripts, not main parts.
- `docsMainPart` starts before `backlogMainPart`, so Docs' script runs before Backlog's script rewrites the repo. A reload after Backlog's script finds a new repo, with one commit of `plan.md`. Backlog's `C` step commits only `followups.md`.
- So every Main page refresh logs `[docs] recent changes: 1 commits`. The text is task 11's `<n> commits`.
- `DocsSelfTestDeps` does not gain `processes`, and the `git/` line of `AGENTS.md` does not change.

## Decisions: order, and what a filtered run reaches

**The new groups come first.** There are two reasons:
- Docs mode opens on the wiki view, and the existing groups need All pages. `wiki with no Main.md` ends on All pages.
- `--group` runs the groups before the named group. With the new groups first, `npm run selftest -- --plugin docs --group 'docs: wiki links and history'` runs five groups, and none of the existing groups' changes.

**One first show.** A view's first show runs once per page load. So one script run has one Main page at start. The script reaches the state with no `Main.md` later, with the app's own trash keys. It does not add a field to `SelfTestStep`. `writeFile` then restores the file.

**The run.** Prove this task with `npm run selftest -- --plugin docs`. A whole self-test runs only when the user asks for that run in the current turn.

| State | Group | Reached in `--plugin docs`? | Needs |
|---|---|---|---|
| `gh` shows Main.md | `wiki start` | yes | step 3 waits for `Main page ready`, which both orders log |
| No `Main.md` | `wiki with no Main.md` | yes | the seven groups before it |
| Commits for Recent changes | `wiki links and history` | yes | Backlog's start fixture |
| Session tab | `wiki from a session tab` | yes | the session `open` starts |
| Narrow width | `wiki narrow window` | yes | a doc with headings |

## Decisions: Enter on a link

`src/renderer/page-keys.ts` calls `preventDefault` on each key that a bind consumes. Task 11 binds `<CR>` in `docs.doc` with no `where`. So Enter on a focused `a.md-link` runs `docs.listOpen` and the link does not activate. The existing step in `links and disk changes` then fails, and so do the new link steps. The self-test presses keys only, so it reaches a link through Tab and Enter.

Task 11's `view.listOpen()`, with no list shown, clicks the focused link or button in the pane. This task consumes that behaviour.

## Decisions: the existing groups

Change exactly these:

| Group | Step | Change | Reason |
|---|---|---|---|
| `doc editor` | first two steps (`Space k d`, `R`) | Remove. They move to `wiki start` | `wiki start` is now the script's first group, so Docs mode already shows here |
| `doc editor` | group `why` | Begin at "The tree opens CLAUDE.md". Remove "Docs mode shows" and "from a fresh index" | Those moved |
| `links and disk changes` | `['Tab', 'Enter']` | `['Tab', 'Tab', 'Enter']`. Add a `why`: "The h1's edit button comes before the first link." | Task 09 appends a `kit.button` to each heading. A button takes Tab, also at `opacity: 0` |
| `trash and rescan` | `machine index rebuilt: 17 entries` | `20 entries` | Three new entries |
| `recency and stars` | `Array(6).fill('j')` before `s` | `Array(7)`. The `why` gains References: "Global, Instructions, CLAUDE.md, References, Rules, Style, then neat.md." | `reference` sorts between Instructions and Rules, and it starts collapsed |
| `recency and stars` | `Array(7).fill('j')` before `r` | `Array(8)`. The `why` says eight | The same |
| `recency and stars` | `['g', 'g', 'j', 'j', 'j', 'j', 'h']` | Five `j`. The `why` gains References | The same |
| `tree filter` | the `why` of the step `selected Rules` | "Global's first children hold no match, so Enter steps into Rules…" | Instructions and References hold no match |

The step in `doc editor` that expected `16 entries` moves to `wiki start` and expects `19 entries`.

Every other existing step stays. A kind group sorts by `KIND_TITLES`, the `a` picker reads the fixed `CREATE_KINDS`, and the repo and plugin rows sit below every row the existing steps count.

## Decisions: the new groups

Each table is one group. Notation: `gg` in Keys means `['g', 'g']`, and so on, one array item per key. `Space v w` means `[' ', 'v', 'w']`. `:q` means `[':', 'q', 'Enter']`. Each Expect holds the exact line. Owner is the task that emits it: `old` means it exists today.

`wiki start`, why: "gh leaves Main.md shown whichever of the first show and gh opened it, and the sidebar's shelves come from the file and follow an outside change to it. The first show's own proof is task 11's live run, since a log line it makes can come before this script's mark in a whole run."

| # | Keys | Other fields | Expect | Owner |
|---|---|---|---|---|
| 1 | `Space k d` | `checksFit: true` | `[page] showed Docs mode` | old |
| 2 | `R` | `why`: the current text of that step | `[docs] machine index rebuilt: 19 entries` | old |
| 3 | `gh` | `why`: "gh in docs.tree. Main.md shows after this line, whether the first show landed first (the page already shows) or gh opened it." | `[docs] Main page ready` | 11 |
| 4 | `<C-k>` | `why`: "The scroll key opens nothing. Step 3 made Main.md the shown doc, so its name is in the line." | `[docs] Main.md did not scroll up` | old |
| 5 | `G` | | `[docs] selected Vendor docs` | old |
| 6 | `gg` | `checksFit: true`, `screenshot: 'wiki-main'`, `why`: "The screenshot shows the title first, Recent changes under the body and the shelves." | `[docs] selected Shelf one` | old |
| 7 | none | `writeFile: { path: WIKI_MAIN_FILE, text: WIKI_MAIN_TEXT + '\n## Shelf three\n\n- [Late page](late.md)\n' }`, `alsoExpect: [/^\[docs\] reloaded Main\.md$/]` | `[docs] read Main.md: 3 shelves` | 08 |
| 8 | `G` | | `[docs] selected Late page` | old |
| 9 | none | `writeFile: { path: WIKI_MAIN_FILE, text: WIKI_MAIN_TEXT }`, `alsoExpect` as in 7, `why`: "The selected row went, so the first row is selected." | `[docs] read Main.md: 2 shelves` | 08 |

Steps 3 and 4 hold in both orders. Before the first show lands, `gh` opens Main.md itself and logs `opened the Main page`. After it, `gh` logs `Main page already shows`. Task 11's `showMain` logs `Main page ready` after either, so step 3 waits for one line. Step 4 then reads Main.md's name, and it needs no repeat or race. This group does not prove the first show with no open asked: a `--plugin docs` run races it, and a whole run logs its line before the mark. Task 11's live run step 1 and `showFirstTime`'s guard `askedOpens === 0 && doc.isBlank()` carry that proof.

`wiki sidebar`, why: "Space v w switches between the wiki and All pages, each keeping its own cursor; a page row opens its doc, a dangling row refuses with its toast, a wiki:all row switches the view, and stars stay in All pages."

| # | Keys | Other fields | Expect | Owner |
|---|---|---|---|---|
| 1 | `Space v w` | | `[docs] sidebar shows All pages` | 08 |
| 2 | `gg` | | `[docs] selected Mine` | old |
| 3 | `Space v w` | | `[docs] sidebar shows the wiki` | 08 |
| 4 | `gg` | | `[docs] selected Shelf one` | old |
| 5 | `l` | | `[docs] selected Label one` | old |
| 6 | `j`, `s` | | `[docs] stars stay in All pages` | 08 |
| 7 | `l` | | `[docs] opened guide.md` | old |
| 8 | `j`, `j`, `l` | `why`: "Guide page, Commit page, then Gone page." | `[docs] refused Gone page: not in the index` | 08 |
| 9 | `G`, `k`, `l` | `why`: "wiki:all switches the view." | `[docs] sidebar shows All pages` | 08 |
| 10 | `Space v w` | | `[docs] sidebar shows the wiki` | 08 |

`wiki section editor`, why: "Ctrl+l and Ctrl+h move by section and stop at the end; e opens the section in place, the moves refuse while it is open, and :w writes only that section's change, which the result checks on disk."

| # | Keys | Other fields | Expect | Owner |
|---|---|---|---|---|
| 1 | `<A-l>` | | `[docs] doc focused` | old |
| 2 | `<C-l>` | | `[docs] section Opening notes` | 09 |
| 3 | `<C-l>` | | `[docs] section Middle notes` | 09 |
| 4 | `<C-l>` | | `[docs] section Closing notes` | 09 |
| 5 | `<C-l>` | | `[docs] no next section` | 09 |
| 6 | `<C-h>` | | `[docs] section Middle notes` | 09 |
| 7 | `e` | `checksFit: true`, `screenshot: 'section-editor'` | `[docs] editing section Middle notes in guide.md` | 12 |
| 8 | `<C-l>` | | `[docs] not moved: the editor is open` | 09 |
| 9 | `o`, `...'added'`, `Escape`, `:`, `w`, `Enter` | `why`: "The result checks the file." | `[docs] wrote guide.md` | old |
| 10 | `:q` | | `[docs] closed the editor on guide.md` | old |

Step 2 gives `Opening notes` since the doc has no `#` heading, and that heading's top is below the scroll position 0. The doc is short, so `pane.scrollTop` stays 0 and `heldSection` holds through steps 3 to 7. `e` then opens `Middle notes` with the cursor on its heading, and `o` adds line 8 of the file.

`wiki links and history`, why: "A § link with backticks and a bare § link each draw as one link in the mounted body, which only this group's steps reach; one opens its target, the other moves in the doc; Ctrl+o and Ctrl+i go back and forward; gh from the doc opens Main with Recent changes; and a wiki: link in the body opens its list."

| # | Keys | Other fields | Expect | Owner |
|---|---|---|---|---|
| 1 | `<A-h>`, `<A-l>` | `screenshot: 'section-links'`, `why`: "Focus on the pane starts Tab at the doc's first link." | `[docs] doc focused` | old |
| 2 | `Tab`, `Enter` | `why`: "The backticks split the reference across a code element and a text node, so this fails if the DOM walk or the wrap fails." | `[docs] opened target.md` | old |
| 3 | `<C-o>` | | `[docs] opened guide.md` | old |
| 4 | `<C-i>` | | `[docs] opened target.md` | old |
| 5 | `<C-o>` | | `[docs] opened guide.md` | old |
| 6 | `<A-h>`, `<A-l>` | | `[docs] doc focused` | old |
| 7 | `Tab`, `Tab`, `Enter` | `why`: "A same-file § link moves and reads nothing." | `[docs] moved within guide.md to line 11` | 12 |
| 8 | `<C-i>` | `why`: "The move dropped the forward places." | `[docs] no later place` | 10 |
| 9 | `gh` | `alsoExpect: [/^\[docs\] recent changes: 1 commits$/]`, `why`: "gh in docs.doc; the count is the fixture's one commit of plan.md." | `[docs] opened the Main page` | 11 |
| 10 | `<A-h>`, `<A-l>` | | `[docs] doc focused` | old |
| 11 | `Tab`, `Enter` | `why`: "Enter on a focused link is the link's click." | `[docs] listed Fixture guides: 2 docs` | 11 |

`wiki list pages`, why: "A list page lists the docs of its link's kind, grouped by repo; j moves its cursor and l or Enter opens the row, Ctrl+o returns with the same row as the cursor, and a third-party list's row opens read-only."

| # | Keys | Other fields | Expect | Owner |
|---|---|---|---|---|
| 1 | `j`, `l` | `why`: "Fixture target is the second row." | `[docs] opened target.md` | old |
| 2 | `<C-o>` | `checksFit: true`, `screenshot: 'list-page'` | `[docs] listed Fixture guides: 2 docs` | 11 |
| 3 | `Enter` | `why`: "The cursor stayed on the row opened." | `[docs] opened target.md` | old |
| 4 | `<C-o>` | | `[docs] listed Fixture guides: 2 docs` | 11 |
| 5 | `<A-h>` | | `[docs] tree focused` | old |
| 6 | `gg`, `j`, `j`, `j`, `j`, `j`, `l` | `why`: "l on the sidebar's row lists it and stays in the tree." | `[docs] listed Fixture guides: 2 docs` | 11 |
| 7 | `G`, `Enter` | `alsoExpect: [/^\[docs\] doc focused$/]` | `[docs] listed Vendor docs: 2 docs` | 11 |
| 8 | `l` | `why`: "synced-demo is the first row." | `[docs] opened SKILL.md` | old |
| 9 | `i` | | `[docs] refused to edit SKILL.md, a downloaded copy` | old |

`wiki from a session tab`, why: "gh on a session's Docs tab shows Docs mode and opens Main there, and leaves the session's tab as it was."

| # | Keys | Other fields | Expect | Owner |
|---|---|---|---|---|
| 1 | `Space k s` | | `[docs] Docs tab shown` | old |
| 2 | `gh` | `alsoExpect: [/^\[page\] (showed Docs mode\|marked Docs in the activity bar)$/, /^\[docs\] recent changes: 1 commits$/]` | `[docs] opened the Main page` | 11 |

In the regular expression above, the `|` has no backslash in the code. The backslash is only for this table.

`wiki narrow window`, why: "The doc's right column shows at a wide width and hides at a narrow one, with the tree still shown, so the article keeps its width."

| # | Width | Keys | Other fields | Expect | Owner |
|---|---|---|---|---|---|
| 1 | | `<A-h>` | | `[docs] tree focused` | old |
| 2 | | `gg`, `j`, `j`, `l` | | `[docs] opened guide.md` | old |
| 3 | `1600` | `<A-l>` | | `[docs] doc focused` | old |
| 4 | `800` | none | `checksFit: 'held'`, `screenshot: 'aside-narrow'`, `why`: "800 is above the side bar's 680 and leaves .docs-doc under 920." | `[docs] right column out of sight` | 12 |
| 5 | `1600` | none | `screenshot: 'aside-wide'` | `[docs] right column in sight` | 12 |
| 6 | `'start'` | `<A-h>` | | `[docs] tree focused` | old |

`wiki with no Main.md`, why: "With Main.md gone the sidebar empties and gh shows the empty Main page, i creates the file from the starter text and edits it, and an outside write brings the shelves back. The group leaves All pages shown, with References collapsed, for the groups after it."

| # | Keys | Other fields | Expect | Owner |
|---|---|---|---|---|
| 1 | `Space v w` | | `[docs] sidebar shows All pages` | 08 |
| 2 | `/`, `...'Main.md'`, `Enter` | | `[docs] filtered the tree: Main.md` | old |
| 3 | `gg`, `Enter`, `Enter`, `Enter` | `why`: "Mine, Global, References, then the page." | `[docs] selected Fixture main page` | old |
| 4 | `d` | | `[docs] asked to move Main.md to the Trash` | old |
| 5 | `y` | `alsoExpect: [/^\[docs\] no Main\.md: /]` | `[docs] moved Main.md to the Trash` | old, 08 |
| 6 | `/`, `Escape` | | `[docs] cleared the filter` | old |
| 7 | `Space v w` | | `[docs] sidebar shows the wiki` | 08 |
| 8 | `gh` | `checksFit: true`, `screenshot: 'main-empty'`, `why`: "The doc pane showed guide.md, so the step also proves the empty page replaces a doc. The screenshot shows the ~ path and No pages in Main.md." | `[docs] showed the empty Main page` | 11 |
| 9 | `<A-l>` | | `[docs] doc focused` | old |
| 10 | `i` | `alsoExpect: [/^\[docs\] read Main\.md: 0 shelves$/, /^\[docs\] editing Main\.md$/]` | `[docs] created Main.md` | 08, 11, old |
| 11 | `:q` | | `[docs] closed the editor on Main.md` | old |
| 12 | none | `writeFile: { path: WIKI_MAIN_FILE, text: WIKI_MAIN_TEXT }`, `alsoExpect: [/^\[docs\] reloaded Main\.md$/]` | `[docs] read Main.md: 2 shelves` | 08 |
| 13 | `<A-h>` | | `[docs] tree focused` | old |
| 14 | `R` | `why`: "The stand-in lists the fixture's entry again, with its title." | `[docs] machine index rebuilt: 19 entries` | old |
| 15 | `Space v w` | | `[docs] sidebar shows All pages` | 08 |
| 16 | `/`, `...'Main.md'`, `Enter` | | `[docs] filtered the tree: Main.md` | old |
| 17 | `gg`, `Enter`, `Enter`, `Enter` | | `[docs] selected Fixture main page` | old |
| 18 | `/`, `Escape` | | `[docs] cleared the filter` | old |
| 19 | `h`, `h` | `why`: "The filter's end expanded References. The later groups count rows with it collapsed, as tree filter's end does for Rules." | `[docs] collapsed References` | old |

## Decisions: the result

`:w` writes a whole file, and no log line shows its text. So the script's result checks it, in the pattern of Backlog's `followWrites`.

- `open`'s `result` keeps its fixture step. On a fixture failure it resolves to `['fixture not ready: <error text>']`.
- Otherwise it runs a private `followSectionWrite(files, homeDir, paths): Promise<string[]>`. It reads `WIKI_GUIDE_FILE` under the real home every 100 ms, until the text differs from `WIKI_GUIDE_TEXT` or 120 seconds pass. The loop follows Backlog's `holdsWithin`. A plugin does not import another plugin's internals, so this script holds its own loop.
- It compares the text with `WIKI_GUIDE_TEXT.replace('## Middle notes\n', '## Middle notes\nadded\n')`. A difference gives one problem: `guide.md after the section write: <text>`. No difference gives `[]`. The wait ending gives `guide.md never changed`.
- `problems` becomes `(result) => result as string[]`.

A filter that cuts the script short does not check the result, and the runner prints its skip line. The result does not reject, so a cut run stays green.

## Log lines

Every Expect above and each `alsoExpect` pattern has an owner:

| Owner | Lines |
|---|---|
| 08 | `sidebar shows the wiki`, `sidebar shows All pages`, `read Main.md: <n> shelves`, `stars stay in All pages`, `refused <title>: not in the index`, `no Main.md: <error text>` |
| 09 | `section <title>`, `no next section`, `not moved: the editor is open` |
| 10 | `no later place` |
| 11 | `opened the Main page`, `Main page already shows`, `Main page ready`, `showed the empty Main page`, `created Main.md`, `listed <title>: <n> docs`, `recent changes: <n> commits` |
| Today's code | `[page] showed Docs mode`, `[page] marked Docs in the activity bar`, `Docs tab shown`, `machine index rebuilt: <n> entries`, `the doc pane did not scroll up`, `<name> did not scroll up`, `selected <title>`, `collapsed <title>`, `opened <name>`, `doc focused`, `tree focused`, `editing <name>`, `reloaded <name>`, `wrote <name>`, `closed the editor on <name>`, `filtered the tree: <text>`, `cleared the filter`, `asked to move <name> to the Trash`, `moved <name> to the Trash`, `refused to edit <name>, a downloaded copy` |

No task emits the next three. This task adds them to `src/plugins/docs/page/doc-view.ts`, through `deps.log`:

- `editing section <title> in <name>`, in `openSectionEditor`, after the editor opens. Task 09 names no line for this open.
- `moved within <name> to line <line>`, at the end of task 10's `moveWithinDoc`, when `line` is not null. Task 10's same-file move logs nothing.
- `right column in sight` and `right column out of sight`. The narrow rule is CSS (task 05), so no code knows of it. Add one `ResizeObserver` on `aside`, created with the view and disconnected in `dispose`. Its callback returns while `aside.hidden` is true. Otherwise it reads `aside.offsetWidth > 0`, and it logs when that value differs from the last value. `installFakeDom` holds an observer that never reports, so `doc-view.test.ts` needs no change. The whole-file editor also hides the column and so also logs. This is true and it does no harm.

These lines of 08 and 11 have no step, since no fixture state reaches them through keys: `not watching Main.md: <error text>` (the folder exists), `no Main page path` (the channel call must reject), `Main.md not created: <error text>` (the write must fail), `recent changes not read: <error text>` (task 04's handler does not reject; task 11's `refresh_CallRejects_DrawsNothing` covers it).

## Placement

`AGENTS.md` § Architecture, "Every other bind has an anchor", checks at the end of a whole self-test only. A filtered run skips it. Each new bind's scope is in force in the new groups. Each anchor below is on the page in the state named.

| Bind | Scope | Anchor | State that draws it | Group |
|---|---|---|---|---|
| `gh` | `docs.tree` | the default `treePane` header's `main` hint | the machine view's tree, always | `wiki start` |
| `gh` | `docs.doc` | the default `docPane`'s `main` hint in `div.docs-history` | the doc pane, always | `wiki start` |
| `e` | `docs.doc` | `sectionHint` in the doc header | the header, placed for the view's life | `wiki start` |
| `<C-h>` | `docs.doc` | `kit.edge(root, 'prevSection', …)` in `asideHeading`, `kind: 'sections'` | a doc with headings: `Main.md`, `guide.md`, `CLAUDE.md` | `wiki start` |
| `<C-l>` | `docs.doc` | `kit.edge(root, 'nextSection', …)` in the same part | the same | `wiki start` |
| `<C-o>` | `docs.doc` | `kit.edge(history, 'historyBack', …)` | the doc pane, always | `wiki start` |
| `<C-i>` | `docs.doc` | `kit.edge(history, 'historyForward', …)` | the doc pane, always | `wiki start` |
| `l`, `<CR>` | `docs.doc` | none: vim's own keys (`src/plugins/keys/page/vim-keys.ts`) | | |
| `<Leader>vw` | `any` | none: a leader sequence | | |

The aside's `display: none` under 920px leaves the two edges connected, so a narrow start does not unplace them. `i` on `mainEmpty` is the existing `docs.edit` bind, with a second anchor from task 11, so it adds nothing to this table.

## The control

The self-test presses keys only: `SelfTestStep` has no click, and `sidebarSwitch` draws a `div` that Tab does not reach. So no step clicks the control, which `../design.md` § Keys names beside `Space v w`. This task pins its wire in `tree-view.test.ts` (below). The final verification task (14) clicks it through the `drive` skill.

## The fit check

Steps with `checksFit` run over new parts. When one reports a cut-off element, fix the layout first. Add a selector to `SCROLLS_ITSELF` only for an element that ends in an ellipsis by design, in the comment's existing terms.

GIVEN a fixture with `Main.md` WHEN `gh` fires THEN `Main.md` shows, whether the first show landed or not.
GIVEN `Main.md` changes on disk WHEN the watch fires THEN the sidebar's rows change with it.
GIVEN a dangling row WHEN `l` fires THEN the toast shows and the log holds the refusal.
GIVEN no `Main.md` WHEN `gh` fires THEN the empty Main page shows, and `i` creates the file.
GIVEN a session's Docs tab WHEN `gh` fires THEN Docs mode shows `Main.md`.
GIVEN a section editor on `Middle notes` WHEN `:w` runs THEN the file differs from the fixture's text only by the new line in that section.
GIVEN a § link with backticks WHEN Tab and Enter reach it THEN its target opens.
GIVEN a `wiki:` link in the body WHEN Enter activates it THEN its list page shows.
GIVEN a list page WHEN a row opens and `Ctrl+o` fires THEN the list shows with that row as the cursor.
GIVEN a doc with headings WHEN the window goes from 1600 to 800 THEN the right column goes out of sight, and it returns at 1600.

Tests:

- The groups above, in `selftest-script.ts`.
- `src/plugins/docs/main/selftest-fixture.test.ts`: add `GIVEN the fixture WHEN its Main.md builds the wiki tree THEN only Gone page dangles and each list row counts its docs`. It calls `parseWikiMain(WIKI_MAIN_TEXT)` and `buildWikiTree` over the index that the test reads back, with the `wiki` folder as `mainFolder`. It asserts the row list from § Decisions: the fixture in full. The break is a fixture path typed wrong, which the self-test only reports as a timeout minutes later.
- `src/plugins/docs/page/tree-view.test.ts`: add `switchControl_Click_CallsSwitchView`, with `hasWiki` true. A click on the drawn `sidebarSwitch` root calls `deps.switchView` once. The break is a missed `rowAction`, which leaves the control dead.

`linkSections`' DOM walk has no other automated cover: the fake DOM holds no text nodes (task 10). Step 2 of `wiki links and history` is that cover.

Done when: `npm run lint` passes. `npm test` runs the tests above and passes. `npm run selftest -- --plugin docs` passes, with the result line `docs result as expected`. `grep -n -E "\b(Rules|Workflow)\b" src/plugins/docs/main/selftest-fixture.ts` prints nothing. The Run log names that the placement check did not run, since a filtered run skips it and a whole run waits for the user's ask.
Commit:    one commit for the group

## Proof

