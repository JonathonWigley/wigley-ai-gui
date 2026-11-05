# Docs wiki — plan

Feature: Docs wiki · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui and wigley-ai-marketplace · Written: 2026-11-05

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Docs mode opens on a wiki over the user's own agent docs. `~/wigley-agents/wiki/Main.md` gives the Main page and the sidebar. A page shows its title first, edits one section in place, and lists On this page and Linked from. `§` references become links. `../design.md` holds every settled decision.

## Architecture

Systems touched:

- **Docs index** (wigley-ai-marketplace, `plugins/wigley/scripts/docs-index/`): schema 5 adds each entry's headings and outgoing links, and walks `~/wigley-agents/wiki/`.
- **Docs plugin** (wigley-ai-gui, `src/plugins/docs/`): pure modules, the sidebar, the page, section editing, links, history, the Main page and list pages.
- **Git adapter** (wigley-ai-gui, `src/contracts/git.ts`, `src/main/git/`): a log call.
- **Keys** (wigley-ai-gui, `src/plugins/keymap.ts`, the docs manifest).

The index holds the only link parser. The page reads its result. Schema 5 replaces schema 4 with no fallback, per `AGENTS.md` § Intent. Both repos land together.

## Preconditions

Each check ran at plan time on 2026-11-05. `wigley:make` re-runs each one before the first dispatch.

- The index is schema 4 on both sides: `grep -n 'SCHEMA_VERSION =' plugins/wigley/scripts/docs-index/model.py` in wigley-ai-marketplace shows `4`, and `grep -n 'INDEX_SCHEMA_VERSION =' src/plugins/docs/index-document.ts` in wigley-ai-gui shows `4`.
- The new keys are free: `grep -c -E "<Leader>vw|'<C-o>'|'<C-i>'|'gh'" src/plugins/keymap.ts` shows `0`, and `grep -n -E "keys: '<C-[hl]>'" src/plugins/keymap.ts` shows no `docs.` scope.
- `Git` has no log member: `grep -n 'log' src/contracts/git.ts` shows no method.
- No user docs layout exists: `test -f ~/.config/wigley-ai-gui/layouts/docs/layout.js` fails. So a layout contract change orphans no user layout.
- `~/wigley-agents/wiki/Main.md` is on `main` of wigley-agents: `git -C ~/wigley-agents ls-files wiki/Main.md` prints the path.
- `l` and `<CR>` are free in `docs.doc`: `grep -n -E "keys: '(l|<CR>)', scope: 'docs.doc'" src/plugins/keymap.ts` shows nothing.

## Docs written ahead

wigley-ai-gui commit `4b3aea5c`:

- `docs/features/docs-wiki/design.md` (new)
- `docs/features/docs-browser/design.md` (pointer)
- `AGENTS.md` (the docs plugin entry)
- `docs/keymap.md` (the `v` group)

wigley-agents commit `43a7f2c`:

- `wiki/Main.md` (new)

The docs index `README.md` states the schema that the script writes, so task 01 changes it with the code. The file then never states a schema that no script writes.

## Mandatory Reads

- wigley-ai-gui: `AGENTS.md` (§ Intent, § Architecture: a plugin, a registration, a key, an event, a layout; § Running and testing), `DESIGN.md` (UI tasks), `docs/keymap.md` (key tasks), `docs/features/docs-wiki/design.md`, `docs/features/docs-browser/design.md`, `docs/features/layouts/design.md` (layout tasks).
- wigley-ai-marketplace (task 01): root `AGENTS.md`, `plugins/wigley/scripts/docs-index/README.md`.

## Design Overview

```
~/wigley-agents/wiki/Main.md ──read by the page──► parseWikiMain ─► WikiShelf[] ─► buildWikiTree ─► TreeView (sidebar)
                                                                      │
docs_index.py ─► index.json (schema 5: headings, links per entry)     │ wiki: links
      │                                                               ▼
      ▼                                                         list page, All pages
 IndexEntry[] ──► linkedFrom ─► right column
      │      └──► sectionsOf ─► On this page, section edit (spliceSection ─► writeDoc)
      │      └──► § links in the mounted body ─► followFile(path, line)
      ▼
 Main page = Main.md rendered + Recent changes (Git.log over the linked pages)
```

Decisions: `../design.md`. Out of scope: `../design.md` § Out of scope.

Boundaries:

- The app holds no shelf name and no knowledge of a workflow. A test or a source line that names `Rules` or `Workflow` outside a test's own built data is wrong.
- `Main.md` has one parser (`wiki-main.ts`). `§` references have one parser (the index).
- All pages is the existing `buildTree`, unchanged.

## File Structure

Names below are shared across tasks. A task uses each one word for word.

Marketplace, `plugins/wigley/scripts/docs-index/`:

- Each entry in `index.json` gains two fields, both always present, both `[]` for an entry with no body:
  - `headings`: `[{ "level": int, "text": str, "line": int }]`. `line` is 1-based in the file.
  - `links`: `[{ "form": "markdown" | "section", "raw": str, "target": str, "line": int, "targetLine": int | null }]`. `raw` is the exact source text of the reference. `target` is the real path of the target file. `line` is the source line, 1-based. `targetLine` is the target heading's 1-based line, or null when the link names a file only.
- A follow-up item entry (`#L<n>` id) holds `[]` for both. No whole-file entry exists for a follow-up file, so no entry holds the fields of a follow-up file. A link in a follow-up file does not appear in Linked from. A link into a follow-up file still resolves.

wigley-ai-gui, `src/plugins/docs/`:

- `contract.ts` (modify): `IndexHeading { level: number; text: string; line: number }`, `IndexLink { form: 'markdown' | 'section'; raw: string; target: string; line: number; targetLine: number | null }`, `IndexEntry.headings: IndexHeading[]`, `IndexEntry.links: IndexLink[]`.
- `index-document.ts` (modify): `INDEX_SCHEMA_VERSION = 5`, and parses the two fields.
- `linked-from.ts` (new): `linkedFrom(entries: readonly IndexEntry[], targetPath: string): LinkedFromRow[]`, with `LinkedFromRow { entryId: string; title: string; path: string; line: number }`. Clones of one repo show once.
- `wiki-main.ts` (new): `parseWikiMain(text: string): WikiShelf[]`, with
  - `WikiShelf { title: string; items: WikiItem[] }`
  - `WikiItem = { type: 'label'; title: string } | { type: 'page'; title: string; target: WikiTarget }`
  - `WikiTarget = { type: 'path'; path: string } | { type: 'skill'; name: string } | { type: 'kind'; kind: string } | { type: 'owner'; owner: 'third-party' } | { type: 'all' }`
- `sections.ts` (new): `sectionsOf(text: string): DocSection[]`, `spliceSection(text: string, section: DocSection, next: string): string`, with `DocSection { title: string; level: number; startLine: number; endLine: number }`. Lines are 1-based and inclusive, and count from the file's first line, frontmatter included.
- `page/doc-history.ts` (new): `createDocHistory(): DocHistory`, with `DocHistory { push(place: DocPlace): void; back(): DocPlace | null; forward(): DocPlace | null; canBack(): boolean; canForward(): boolean }` and `DocPlace { path: string; line: number | null }`.
- `tree.ts` (modify): `buildWikiTree(shelves: readonly WikiShelf[], entries: readonly IndexEntry[], mainFolder: string, homeDir: string, paths: Paths): TreeNode[]`. `TreeNode` gains `TreeWikiLink { type: 'wikiLink'; id: string; title: string; target: WikiTarget; count: number | null; isDangling: boolean }`, `TreeWikiLabel { type: 'wikiLabel'; id: string; title: string }` and `TreeHeadingMatch { type: 'headingMatch'; id: string; title: string; entryId: string; line: number; docTitle: string; leafId: string }`. Path and skill pages are `TreeLeaf` rows. Also `buildWikiFilterTree(entries, homeDir, paths)` and `wikiListEntries(target, entries)`.
- `page/section-edit.ts`, `page/section-links.ts`, `page/wiki-main-source.ts`, `page/list-page.ts`, `page/main-page.ts`, `main/recent-changes.ts` (new). Each owner task gives the signatures.
- `DocPlace.path` also holds a list page's `wiki:` place (task 11).
- The channel call `wikiMainPath()`, and `TreeView.setWikiTree(tree, filterTree, hasIndex)` (task 08).
- `contract.ts` (modify, task 04): the channel call `recentChanges(paths: string[]): Promise<RecentChange[]>`, with `RecentChange { sha: string; subject: string; at: string; paths: string[] }`.
- `manifest.ts`, `../keymap.ts` (modify): commands `docs.editSection`, `docs.prevSection`, `docs.nextSection`, `docs.historyBack`, `docs.historyForward`, `docs.openMain`, `docs.toggleWikiView`, `docs.listOpen`.
- `layouts/layout.d.ts`, `layouts/default/layout.js`, `layouts/default/layout.css`, `page/layout/docs-parts.ts`, `page/layout/read-layout.ts`, `page/docs.css`, `manifest.ts` (themeTokens) and `DESIGN.md` (modify): new parts `pageFrame`, `pageAside`, `asideHeading`, `asideLink`, `sectionEditControl`, `recentChanges`, `listPage`, `listRow`, `sidebarSwitch`, `mainEmpty`.

wigley-ai-gui, git:

- `src/contracts/git.ts`, `src/main/git/process-git.ts` (modify): `log(root: string, paths: string[], limit: number): Promise<GitCommit[]>`, with `GitCommit { sha: string; subject: string; at: string; paths: string[] }`, newest first. `paths` holds the repo-relative paths the commit touched, from those asked for.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Index schema 5](01-index-schema-5.md)
- [x] [Entry fields and Linked from](02-entry-fields-linked-from.md)
- [x] [Main parser, sections, history](03-pure-modules.md)

### Wave 2
- [x] [Git log and Recent changes call](04-git-log.md) — after 02
- [x] [Wiki tree and search rows](06-wiki-tree.md) — after 02, 03

### Wave 3
- [x] [Layout parts](05-layout-parts.md) — after 02, 04, 06

### Wave 4
- [x] [Article page and right column](07-article-page.md) — after 03, 05
- [x] [Wiki sidebar and All pages](08-wiki-sidebar.md) — after 03, 04, 05, 06

### Wave 5
- [x] [Section editing](09-section-editing.md) — after 03, 07, 08

### Wave 6
- [x] [Section links and history](10-links-history.md) — after 03, 09

### Wave 7
- [x] [Main page and list pages](11-main-list-pages.md) — after 03 to 10

### Wave 8
- [x] [Self-test groups](12-selftest.md) — after 11

### Wave 9
- [x] [Doc re-read](13-doc-re-read.md) — after 12

### Wave 10
- [ ] [Final verification](14-final-verification.md) — after 13

## Run log

Review base: 89f67d088a3297567805dfe5fa9c84afa7d9f72f

### Groups
- 02 · 1c38d74c · diff read, every Produces present, tsc clean · concerns: codeUnitOrder stays private in path-completion.ts; docs-browser design says schema 4 of lastLoaded's origin, left true; cloneKey uses plain startsWith
- 03 · b83f527a · diff read, every Produces present, tsc clean · concerns: a file ending in a lone CR keeps it in ScannedLine.text; [a](<>) gives an empty path, for 06 to show dangling
- 01 · 15fbf5c · diff read, every Produces present, py compile clean, check_pointers and check_manifests pass, in wigley-ai-marketplace · concerns: MARKDOWN_LINK text can cross a blank line; raw of a wrapped reference in a CRLF file holds LF, for task 10's search; pointer errors now report in offset order; extra test rows beyond the task
- 04 · ed07573b · diff read; every Produces present by search (GitCommit, Git.log, RecentChange, recentChanges, readRecentChanges, RecentChangesDeps, recentChangesLimit); compile checked with task 06's partial edits in the tree · concerns: a negative recentChangesLimit gives all commits minus the last row (configurer's, per plan); docs-browser design.md not checked for a settings list
- 06 · 47c67279 · diff read, every Produces present, buildTree unchanged, tsc clean · concerns: preferredEntry compares ids inline as byTitleThenId does; a skill's SKILL.md leaf can show its lead heading as a heading row; visibleRows re-tests every heading per draw under a filter, unmeasured; docs-view openHeading has no unit test, left to task 14
- 05 · f2d0ccb5 · diff read; ten parts in layout.d.ts, PART_SCOPES, LAYOUT_PARTS, default builders, token, container and DESIGN.md entries present; tsc clean; oxfmt on docs/keymap.md committed as 883116bf (lead tooling) for the lint gate · concerns: eight of ten default builders run in no test until tasks 07, 08 and 11; container docs-doc / size is live in every docs view and needs its live check at 07, stacked session tab included; sectionEditControl passes kit.openSection unbound, so task 09's kit must not use this
- 07 · 061c3e1b · diff read, every Produces present, tests pass per worker, no compile error in its files with task 08 in the tree; the live run follows task 08's landing (Rulings) · concerns: aside scroll resets across the whole-file editor; empty-state centring and editor height rest on CSS only; 100cqh needs the docs-doc container; retarget does not redraw the column, so it goes stale after a move or an extension change; linkedFrom runs on every drawAside
- 08 · d7270be4 · diff read, every Produces present by search, tsc and lint clean, Done-when greps hold (one <Leader>vw line, no setEntries in docs-view.ts) · concerns: Space v w with the filter box focused leaves focus on a hidden input; an unstar elsewhere can also move the wiki cursor; with no entries a wiki filter shows No pages in Main.md; dangling and label row colours unseen on screen; wikiRowActions anchors are built in session views too; Docs mode opens on the wiki, so self-test groups expecting All pages fail until task 12
- 09 · ce659133 · diff read, every Produces present, tsc clean; worker ran the task tests (123 pass), lint and the live run: all 6 steps pass after scrollToSectionNotice; the 950px breakpoint held the body at 670px down to where the column goes; the switch click focuses the tree · concerns: self-test anchor check has not seen the three new binds; short section has about 36px spare below its text, the height using prose metrics; On this page clicks use old lines after a :w until the editor closes; scrollToSectionNotice has no unit test; section editor logs editing <name>, the same as whole-file
- 10 · 33b55c73 · diff read, every Produces present, tsc clean; worker ran the task tests (162 pass), lint and the live run, steps 1-5 pass with synthetic keys over the real schema-5 index · concerns: a link to a heading that cannot reach the top leaves one doc holding two places, so Ctrl+o can stop twice on it; focus falls to body after a link opens another doc, as every md-link already does; closest('a.md-link') is live-only under the fake DOM; a match could in theory enclose an a between its runs
- 11 · fbf589cb · Diff read; Produces found by grep (newestLoadedFirst, findSkillEntry, parseWikiTarget, createListPane, MAIN_STARTER_TEXT, createRecentReader, showPage, updateList, shownPage, isBlank, setRecentChanges, listOpen); tsc clean; worker: 7 test files 273 pass, lint, both greps, live steps 1-10 PASS on runs w11, w11b, w11c. · concerns: At first show focus stays on the tree, so i on the empty Main page does nothing and its hint hides until Alt+l. Ctrl+o/i are docs.doc scope only. A list's scroll is not remembered per place (cursor is). Main.md deleted while shown: gh logs already shows and the empty state does not draw. Header title reads Main.md with a provisional entry until rebuild. Focus after a recent link click falls to body. No layout.css rule for .docs-main-hint or .docs-recent-page. Live run's stand-in index had links: [], so section links on Main were not exercised live. Root AGENTS.md docs paragraph possibly stale.
- 12 · d2a5afb0 · Diff read: the four exports, wikiEntries, three log lines and the observer's disconnect present; tsc clean; worker: lint, typecheck, 27 tests in the two files, the Rules|Workflow grep prints nothing. npm run selftest -- --plugin docs ended PASS docs result as expected and all passed (log line checked by the lead). The placement check did not run: a filtered run skips it and a whole run waits for the user's ask. · concerns: doc-view.test.ts not run by the worker, the gate picks it. editing <name> and editing section <title> in <name> both fire on a section edit. While Main.md is gone main prints an ENOENT handler error that reads like a failure in a self-test log. .shell-side-bar-handle joins SCROLLS_ITSELF though it does not end in an ellipsis (precedent: agent-skills and agent-lines scripts). isAsideInSight starts false, so the first doc with headings logs right column in sight. Task 12 doc is stale on 920 and on heading edit buttons taking Tab.
- 13 · 38d42a0e · Diff read. Changed: AGENTS.md, docs-wiki/design.md, docs-browser/design.md. No change needed: docs/keymap.md, DESIGN.md (950), layouts/design.md, marketplace docs-index README (schema 5), wiki/Main.md. Main.md check on the user's own index, read-only (schema 4 until the plugin lands): no format fault, no dangling link across 10 path and 12 wigley: links. check_pointers.py and lint pass. · concerns: e above the first heading and gh from a session tab are written from the user's decisions, not traced to the end of the code path. The top-row placement of the history arrows comes from CSS selectors, not a screenshot.
### Contract changes
- 11: the main hint in docPane sits between back and forward inside div.docs-history (order back, main, forward), not first, because layout.css hides those by :first-child and :last-child.
### Rulings
- Moved 05 to a wave of its own and every later group one wave on — 04 and 05 share manifest.ts, 05 and 06 share layout.d.ts — none if wrong · lead
- Nested roots both holding the target: the lower root wins — order-independent — only which clone row shows · group 02 · group 02
- Added a valid-element row to index-document.test.ts — no planned row rejected a good form — one row to delete · group 02 · group 02
- HEADING and FENCE_RUN carry the s flag, so '# T\ra' titles T\ra as the index does rather than the plan's T — line pairing with the index is the Decisions aim — one flag and one row if wrong · group 03 · group 03
- An empty text gives zero lines — the plan named only a\n — none for later tasks · group 03 · group 03
- Version 1.17.0 to 1.18.0, not the plan's 1.17.0 — origin moved — none · group 01 · group 01
- parse_headings drops a heading empty after its marks — an empty text prefixes every remainder — such a heading leaves On this page · group 01 · group 01
- A wigley:skill#frag href drops the fragment and targetLine stays null — the table gives null — a skill fragment does not move the page · group 01 · group 01
- readRecentChanges de-duplicates real paths as well as asked paths, and compares paths with paths.samePath, as clonesOf does · group 04
- one extra test row: realPath rejecting with a non-ENOENT error logs one line · group 04
- one line in page/layout/docs-parts.test.ts beyond Files: TreeViewDeps.openHeading is required for the project to compile · group 06
- a shelf titled S#2 after two shelves titled S gets shelf:S#2#2, so ids stay unique · group 06
- three extra buildWikiTree_PageTarget rows: empty path dangling, walked tie order, owner before source · group 06
- openedFromTree shared by openLeaf and openHeading in docs-view.ts · group 06
- read-layout.ts beyond plan.md's File Structure: LAYOUT_PARTS is Record<keyof Layout, true> · group 05
- docs/features/layouts/design.md's docs row names the new surfaces, beyond Files · group 05
- layout.d.ts top comment: an app part left out is appended at the end unless its comment places it elsewhere · group 05
- draw_NewPart_FiresInItsScope uses a stub user layout, since fakeDocsParts keeps baseKit private · group 05
- Task 07's live run waits until task 08 lands, as both build in one tree and 08's partial edits can break the drive's build; a driving worker runs it then, with 09's Linked from check still at 09 · lead
- placeAtEnds places a left-out article first and a left-out aside last, per layout.d.ts, rather than drawPane's plain append · group 07
- setEntries guards on isDisposed, as retarget, clear and redraw do · group 07
- two tests beyond the list: the tilde tooltip and an openSections assertion; the diskChanged test uses ShrinkingScrollerFakeElement so it can fail · group 07
- reread awaits start, and concurrent connects share one in-flight promise, so no repeat watch is sent · group 08
- no Main.md logs only when the state moves to absent · group 08
- reread runs in runIndex's then, not its catch · group 08
- selectEntry always draws once · group 08
- openWikiLink takes only the link until task 11 · group 08
- permitted extra: page/layout/docs-parts.test.ts · group 08
- Task 07's live run (/tmp/claude-502/-Users-jonathonwigley-Documents-ai-dev/667dda66-db61-4226-a883-9de5428c1db2/scratchpad/reports/07-live.md): steps 1, 3, 4 pass; step 2 failed at 920px, so the breakpoint is 950px (1e87a69e), the plan's width plus 264 plus the 15px scrollbar, and the article no longer shrinks by the sum; not re-measured · lead
- A selected dangling or label row draws fg rather than fg-tertiary, because the cursor's .is-selected rules outrank them; left as is, the cursor reads the same on every row; goes to the review · lead
- Space v w inside the filter box types into it, as a leader sequence does in a box, so the worker's focus concern arose only by a click on the switch, fixed in 1e87a69e · lead
- every :w splices into openedText, the text as the editor opened, rather than growing endLine: the task's form throws on the next :w in a file with no last line ending, and spliceSection requires a section from the same text · group 09
- closeEditor empties shownSections until the body redraws, so e cannot splice stale lines · group 09
- scrollToSectionNotice brings a banner or prompt into sight in section mode, from a live-run failure · group 09
- scrollToHeading lands on the editor's frame for a heading hidden for the edit · group 09
- docs-parts.test.ts beyond Files: sectionHint wiring; .docs-section-edit gets user-select none; after also runs on closeEditor's detail path; clickSection compares dataset.anchor among body.children · group 09
- appliedLinks and the setEntries compare hold section links only · group 10
- splitText is skipped at a node's edge, else the backticks form stays text · group 10
- a block that is itself pre, .md-fence, .md-image or a yields no runs · group 10
- relink adds doc.text !== text to reread's guards · group 10
- moveWithinDoc finds through headingAt, since it must find before it scrolls · group 10
- same-file file links with no line and # links go through moveWithinDoc and no longer reopen; task 12 owns the self-test steps · group 10
- .docs-list-rows .ui-row-label gets flex: none and max-width: 60% in docs.css, a look fix for truncated titles. · group 11
- doc-view.test.ts assigns ownerDocument on the pane since the fake has none. · group 11
- Task 11's live run used a stand-in fixture index. · group 11
- switchControl_Click_CallsSwitchView not added: sidebarSwitch_DrawnForTheShownViewAndItsClickSwitches already clicks the drawn control with hasWiki true and catches the named break. · group 12
- links and disk changes keeps Tab, Enter: kit.button sets tabindex -1, so heading edit buttons take no Tab; the task's Tab, Tab step failed the group. · group 12
- wiki with no Main.md gains a step collapsing Third-party, since wiki list pages step 8 expands it through tree.selectEntry and later groups count rows with it collapsed. · group 12
- wiki narrow window step 4's why says 950, the breakpoint since 1e87a69e. · group 12
### Review rounds
### Test gate
