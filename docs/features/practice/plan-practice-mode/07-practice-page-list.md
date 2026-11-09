# 07 — Practice page: mode, list and layout

Status: not started
Type: Task
Wave: 4 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     create `src/plugins/practice/page/start.ts` · create `src/plugins/practice/page/practice-state.ts` · create
           `src/plugins/practice/page/practice-view.ts` · create `src/plugins/practice/page/practice.css` · create
           `src/plugins/practice/layouts/layout.d.ts` · create `src/plugins/practice/layouts/default/layout.js` · create
           `src/plugins/practice/layouts/default/layout.css` · create `src/plugins/practice/page/layout/read-layout.ts` ·
           create `src/plugins/practice/page/layout/practice-kit.ts` · modify `src/plugins/practice/manifest.ts` · modify
           `src/plugins/practice/contract.ts` · modify `src/plugins/practice/main/start.ts` · modify `src/plugins/page.ts` ·
           modify `src/plugins/keymap.ts` · modify `docs/keymap.md` · test `src/plugins/practice/page/practice-state.test.ts`
           · test `src/plugins/practice/page/layout/read-layout.test.ts` · test `src/plugins/practice/page/start.test.ts`
Consumes:  `PracticeChannel` invoke `list(): ProblemSummary[]`, `open(slug): OpenedProblem`, message `changed` ← 05;
           `ProblemSummary { slug; title; difficulty: Difficulty; tags: string[]; lists: string[]; status: ProblemStatus;
           due: boolean }`, `ProblemStatus`, `OpenedProblem` ← 05 (`contract.ts`); `Difficulty` ← 04 (`problem.ts`);
           `practiceManifest` ← 05 (`manifest.ts`), its scopes `list`, `problem`, `editor`, `console` (07 adds `box`, 08 `confirm`, 09 `ask` and `import`).
           From the tree: `createReducerStore` (`src/shared/page/reducer-store.ts`), `createLayoutParts`
           (`src/shared/page/layout-host/layout-parts.ts`), `appSlot` (`.../layout-host/app-slot.ts`),
           `createBaseKit`/`ownerBaseKitDeps`/`kitCommandsOf`/`keyRunner` (`.../layout-host/base-kit.ts`),
           `readLayoutParts` (`.../layout-host/read-layout-module.ts`), `placeWrites` (`src/shared/page/place-slot.ts`),
           `textBoxInput` (`src/shared/page/text-box.ts`), `inputFrame`, `rowAction`, `sheet`
           (`src/shared/page/ui/`), `FuzzyMatcher.matches(query, text)` (`src/contracts/fuzzy.ts`).
Produces:  in `page/practice-state.ts`: `type PracticeFocus = 'list' | 'main' | 'interviewer'` (07 never sets
           `interviewer`; 09 sets it through `PracticeView.setFocus`); `interface PracticeState { problems:
           ProblemSummary[]; isLoaded: boolean; message: string | null; selectedSlug: string | null; openSlug: string |
           null; filter: string; focus: PracticeFocus }`; `type PracticeAction`; `initialPracticeState(): PracticeState`;
           `sortedProblems(problems: readonly ProblemSummary[]): ProblemSummary[]`; `visibleProblems(state: PracticeState,
           matcher: FuzzyMatcher): ProblemSummary[]`; `difficultyCounts(problems: readonly ProblemSummary[]): { difficulty:
           Difficulty; solved: number; total: number }[]`; `practiceReducer(state: PracticeState, action: PracticeAction,
           matcher: FuzzyMatcher): PracticeState`; `placeOf(state: PracticeState): PracticePlace`.
           In `page/practice-view.ts`: `createPracticeView(deps: PracticeViewDeps): PracticeView` with `PracticeView {
           sideBar; sheet; main: HTMLElement; load(); reload(); shown(); sideBarHidden(); sideBarOpenedOver();
           focusSideBar(); focusMain(); setFocus(focus: PracticeFocus): void; setLayouts(shown); dispose(); commands;
           openProblemRow(slug) }`. `setFocus` is the one place `PracticeState.focus` changes.
           In `contract.ts`: `interface PracticePlace { selectedSlug: string | null; openSlug: string | null; filter:
           string }`, `practicePlaceSlot: SlotKey<PracticePlace, 'page', 'practice'>` (id `practice.place`),
           `practiceOpenProblemRowCommand: CommandKey<string, 'practice.openProblemRow'>`.
           In `layouts/layout.d.ts`: `PracticeLayout`, `CompletePracticeLayout`, `PracticeKit`, `ListKit`, `PracticePane`,
           `ListHeaderInput`, `ProblemRowInput`, `EmptyInput`, `EmptyReason` (members below); 08 and 09 add parts.
           In `page/layout/practice-kit.ts`: `type PracticeBaseScope = 'list' | 'problem'` widened by 08, `createPracticeKit(
           services, scope, rollback): PracticeKit`.

Decisions:
- **The page commands are declared by the page task that handles them** (the compiler requires a handler for every
  declared page command: `PageStart.commands` in `src/contracts/plugin.ts` 801-806, keyed by every command that runs
  in `page`). 07 adds to `practiceManifest.commands`, all `runsIn: 'page'`: `showMode` (label `practice (again: toggle
  the side bar)`, group `modes`), `listDown`/`listUp`/`listTop`/`listBottom` (`next row`, `previous row`, `first
  row`, `last row`, group `list`), `openProblem` (`open the problem`, `list`), `openKeepingFocus` (`open the problem,
  staying in the list`, `list`), `filter` (`filter by difficulty, status, tag, list or title`, `list`), `boxAccept`
  (`accept`, `box`), `boxCancel` (`cancel`, `box`), `openProblemRow` (`open this problem`, `list`, `arg: 'string'`, the
  row click). It adds scope `box: 'In the practice filter box'`, and setting `layout: 'default'` with settingInfo
  `{ label: 'Layout', description: "The Practice layout: a folder name in practice's layouts folder, or default." }`.
  05 declares no page command. 08 declares `run`, `submit`, `nextTab`, `prevTab` and its other commands; 09 declares
  `toggleInterviewer`, `importStart` and its other commands.
- **Main registers the contract** (AGENTS.md § A layout): `main/start.ts` imports `layoutTypes from
  '../layouts/layout.d.ts?raw'` and calls `api.layouts.register({ layoutTypes })` in `start`, as
  `src/plugins/backlog/main/start.ts` 48 and 1128 do.
- **Page part** (`page/start.ts`) copies `src/plugins/backlog/page/start.ts`: imports
  `'../../../shared/page/markdown.css'` and `'./practice.css'`; `PracticeApi = PageApi<typeof practiceManifest,
  PracticeChannel>`; publishes `practicePlaceSlot` through `placeWrites`; `api.modes.add({ id: 'main', title:
  'Practice', icon: 'beaker', element: view.sheet, sideBar: view.sideBar, shown() { isShown = true; view.shown() },
  hidden() { isShown = false }, sideBarHidden, sideBarOpenedOver, focusSideBar, focusMain })` (the Mode members,
  `src/contracts/plugin.ts` 465-476); `api.layouts.show<PracticeLayout>({ defaultLayout, defaultStylesheet, read:
  readPracticeLayout, userLayout: () => api.settings().layout, setLayouts: (shown) => view.setLayouts(shown) })`;
  `api.channel.on('changed', () => view.reload())`; `view.load()`; `showMode` shows the mode, or toggles its side bar
  while it shows. The view's `opened(problem)` dep sets `mode.setContext({ title: 'Practice', detail: problem.summary
  .title })` and calls `mode.picked()`. `src/plugins/page.ts` imports `practicePagePart` and lists it after
  `backlogPagePart`.
- **The side bar is the list; the sheet is main** (design.md § The mode). The side bar element is one pane,
  `div.practice-list` (tabIndex -1), into which the layout's `list` part draws, placing the slots `header`
  (`div.practice-list-header-slot`, the app draws `listHeader` into it on each render), `filterBox` (the app's
  `ui-input practice-filter` frame holding `textBoxInput('practice-filter-input')`, hidden while no filter is open
  and the filter text is empty) and `rows` (`ol.practice-rows`). The sheet holds `div.practice-main` (tabIndex -1),
  exported as `PracticeView.main`; with no problem open it holds the `noProblem` part. 08 mounts the workspace there.
- **Sort** (design.md § The mode): status `attempted`, `new`, `solved`; then difficulty `easy`, `medium`, `hard`; then
  title by `localeCompare` (base sensitivity). Rows show in that order; no grouping, no Due section.
- **Filter words** (design.md § The mode): the filter text splits on whitespace into words, lowercased; a problem
  shows when every word keeps it. Per word, first match wins:
  1. `easy`, `medium`, `hard` keep that difficulty.
  2. `new`, `attempted`, `solved` keep that status; `unsolved` keeps `new` and `attempted`; `due` keeps `due: true`.
  3. A tag-or-list word: the word equals, case-insensitively, a whole whitespace-separated word of any tag or list
     of any loaded problem (`blind` and `75` are words of the list `Blind 75`). It keeps the problems with a tag or
     list holding that whole word.
  4. Any other word keeps the problems whose title `matcher.matches(word, title)`.
  Rule 3 reads the vocabulary of every loaded problem, so a tag word never falls to title matching on a problem that
  lacks the tag. Settled here from design.md's "a word naming one of the problem's tags or lists … any other word
  matches the title": a word is a tag word for the whole list or for none.
- **Selection**: `loaded` keeps `selectedSlug` when a visible row still holds it, else selects the first visible row,
  else null; `move` steps the cursor one row (`down`/`up`, held at the ends) or to the first/last visible row;
  `setFilter` keeps the selection while visible, else moves it to the first visible row; `select` sets it when a
  visible row holds the slug, else changes nothing; `opened` sets `openSlug` and `selectedSlug`. `placeRestored`
  sets `selectedSlug`, `openSlug` and `filter` from the place, then applies the `loaded` selection rule.
- **Opening** (`openProblem`, Enter): invokes `open(selectedSlug)`; on success dispatches `opened`, logs `opened
  <slug>`, calls `setFocus('main')` and calls `deps.opened(problem)`. 08 focuses the problem pane on each open, so
  the statement reads first. `openKeepingFocus` (`l`, docs/keymap.md "A side-bar list")
  does the same and keeps the list's focus and scope. A click on a row runs `practiceOpenProblemRowCommand` with the
  slug through `runKey` (as backlog's `rowAction` at backlog-view.ts 756), which selects, opens and focuses main. A
  failed open logs `not opened <slug>: <error>` and toasts the error. Main decides a fresh attempt in `open` (design.md
  § Progress), not the page. The first load with a place whose `openSlug` is set opens it again, keeping the list's
  focus.
- **Focus**: `PracticeFocus` is `list` (the side bar), `main` (the problem column) or `interviewer` (09's pane).
  `initialPracticeState().focus` is `list`, so the list holds the keys when Practice first shows. Later shows keep
  the last focus.
  - `PracticeView.setFocus(focus)` is the one setter: it dispatches the focus change, logs `list focused` or `main
    focused` when the focus changes to `list` or `main`, and renders. It logs nothing for `interviewer`: 09 logs
    `interviewer focused`. 09 adds a call there to give up the pane's keys when focus leaves `interviewer`.
  - Each render while shown applies the base scope from focus, then `setResizeTarget`, then `setFocusTarget`, as
    backlog-view.ts 990-998 does. `scopeOf`: `list` → `list`; `main` → `problem` (05's declared scope; with no
    problem open its keys find nothing to act on), which 08 replaces with the focused pane's scope (`problem`,
    `editor`, `console`). Focus `main` focuses `div.practice-main`.
  - While focus is `interviewer`, the render sets no scope, no resize target and no focus target. The pane (09)
    owns them then: it sets `practice.ask`, or calls the mount's `shown()`, which sets chat's scope.
  - The focus target 07 hands over returns false for every direction (no panes of its own yet), so Alt+h from main
    reaches `focusSideBar`. Resize target: null while the list has focus.
  - `sideBarHidden` calls `setFocus('main')` when focus is `list`; `sideBarOpenedOver` and `focusSideBar` call
    `setFocus('list')`; `focusMain` calls `setFocus('main')` and `deps.picked()`.
- **Filter box** copies backlog-view.ts 1167-1194: `/` calls `setFocus('list')`, pushes scope `box`, focuses and
  selects the input; `input` events dispatch `setFilter`; Enter (`boxAccept`) pops the scope keeping the text; Esc
  (`boxCancel`) clears the text then pops; a base scope change under the box closes it. Each close logs `filter
  <text>`.
- **Layout contract** (`layouts/layout.d.ts`), in backlog's shape (`src/plugins/backlog/layouts/layout.d.ts`):
  - `PracticePane { element: HTMLElement }`.
  - `ListHeaderInput { counts: { difficulty: 'easy' | 'medium' | 'hard'; label: 'Easy' | 'Medium' | 'Hard'; solved:
    number; total: number }[] }`, one entry per difficulty in that order, counted over every loaded problem (not the
    filtered rows).
  - `ProblemRowInput { slug: string; title: string; difficulty: 'easy' | 'medium' | 'hard'; status: 'new' |
    'attempted' | 'solved'; isDue: boolean; isOpen: boolean }`.
  - `EmptyReason = 'loading' | 'noProblems' | 'filter'`; `EmptyInput { reason: EmptyReason; filter: string }`.
  - `PracticeKit extends BaseKit {}`; `ListKit extends PracticeKit { header(parent): HTMLElement; filterBox(parent):
    HTMLElement; rows(parent): HTMLElement; importHint(parent): HTMLElement }`. `importHint` places
    `span.practice-import-hint`, which 07 leaves empty; 09 fills it with the anchor for `practice.importStart`.
  - `PracticeLayout { list?(parent, kit: ListKit): PracticePane; listHeader?(parent, input: ListHeaderInput, kit:
    PracticeKit): HTMLElement; problemRow?(parent, input: ProblemRowInput, kit: PracticeKit): HTMLElement; empty?(
    parent, input: EmptyInput, kit: PracticeKit): HTMLElement; noProblem?(parent, kit: PracticeKit): HTMLElement }`;
    `CompletePracticeLayout extends Required<PracticeLayout> {}`; `export type { KitRowOptions }`.
  - Kit scopes: `list`, `listHeader`, `problemRow` and `empty` in `practice.list`; `noProblem` in `practice.problem`.
  - The comment block states each slot, what the app appends when a part leaves one out (the slot at the end of the
    part's root), that the app sets the click and toggles `is-selected` (the selected row), `is-cursor` (selected
    while the list has focus and no filter box is open) and `is-open` (the open problem) on each row root, and that a
    slot placed twice throws `<slot> placed twice`.
  - `read-layout.ts` lists every part in a `Record<keyof PracticeLayout, true>` (backlog's read-layout.ts shape).
- **Default layout** (`layouts/default/layout.js`, `// @ts-check`, typed with `CompletePracticeLayout`):
  - `list`: root `div.practice-pane`; a header `div.practice-list-header` holding `kit.header`, then a key strip
    `span.practice-list-keys` with `kit.keyHint(keys, 'filter', { label: 'filter', className: 'practice-hint' })`
    then `kit.importHint(keys)`; then `kit.filterBox`, `kit.rows`. Rows draw inside the side bar's
    `div.practice-list`, so `.practice-list .ui-row-label` selects every row title (task 10 reads it).
  - `listHeader`: `div.practice-counts`, one `span.practice-count practice-count--<difficulty>` per entry reading
    `<label> <solved>/<total>`.
  - `problemRow`: `kit.row(parent, { density: 'list', tag: 'li', label: input.title, leading: <status icon>, trailing:
    <span.practice-row-marks> })`. Status icon by `kit.icon`: `solved` → `pass-filled`, `attempted` →
    `circle-large-outline`, `new` → `circle-small` (class `practice-status practice-status--<status>`). The marks
    span holds `kit.tag(marks, 'due', 'attention')` when `isDue`, then `kit.tag(marks, <Easy|Medium|Hard>,
    <success|warning|error>)`.
  - `empty`: `kit.emptyState(parent, text)`: `loading` → `Loading problems…`; `noProblems` → `No problems yet. Ask an
    agent to add some.`; `filter` → `No problems match "<filter>".`
  - `noProblem`: `kit.emptyState(parent, 'Open a problem from the list.')`.
  - `layout.css` restyles under `[data-layout-owner="practice"]` only: the counts line, the difficulty tones of the
    count spans, the status icon colours (`solved` the success token, `attempted` the warning token, `new` the
    muted text token), `is-open` rows' label weight. Token names come from `src/themes` as backlog's layout.css uses
    them; no raw colours (`scripts/check-styles.mts` runs in `npm run lint`).
- **Keys** (design.md § The mode keys; docs/keymap.md § Adding a bind), in `src/plugins/keymap.ts`:
  - after `{ keys: '<Leader>kb', … 'backlog.showMode' }` (line 272): `{ keys: '<Leader>kp', scope: 'any', command:
    'practice.showMode' }`.
  - a `// ── Practice ──` block after backlog's (ending line 781): in `practice.list` `j` → `listDown`, `k` → `listUp`,
    `gg` → `listTop`, `G` → `listBottom`, `<CR>` → `openProblem`, `l` → `openKeepingFocus`, `/` → `filter`; in
    `practice.box` `<CR>` → `boxAccept`, `<Esc>` → `boxCancel`.
  - the `<C-n>` scope list (lines ~238-262, the array ending `'notes.title'`) gains `'practice.list'`,
    `'practice.problem'`, `'practice.editor'`, `'practice.console'` (09 adds `'practice.ask'`), so Ctrl+n opens the
    new-session prompt from every Practice main view (docs/keymap.md "Ctrl+n").
  - Anchors: `/` is the only non-vim, non-leader key here; the default `list` part anchors it in `practice.list`.
- **docs/keymap.md**: the `k` row of the leader table (line 146) adds `` `kp` Practice ``; the Ctrl+n paragraph's view
  list adds "the Practice list"; the side-bar list paragraph adds "the Practice list" to its examples.
- **Logs** (the self-test, task 10, reads them verbatim): `loaded <n> problems` (each list load, a reload after
  `changed` included), `not loaded: <error>`, `selected <slug>` (each time `selectedSlug` changes to a slug),
  `opened <slug>`, `list focused`, `main focused`, `filter <text>` (each filter box close), `shown`, `no problem
  <slug>` (a row click naming no visible row).

GIVEN problems with mixed status, difficulty and title WHEN the list loads THEN rows run attempted, new, solved, each
by easy, medium, hard, then title.
GIVEN a loaded list WHEN `/` and `easy unsolved` are typed THEN only easy problems with status new or attempted show.
GIVEN a problem whose list is `Blind 75` WHEN the filter is `blind` THEN it shows and a problem titled `Blind Spot`
with no such tag or list does not.
GIVEN Practice shows for the first time WHEN `j` is pressed THEN the list holds the keys and the cursor moves.
GIVEN the list has focus WHEN Enter is pressed THEN `open(<selected slug>)` is invoked, the title bar reads
`Practice <title>`, and focus moves to main.
GIVEN Practice is shown WHEN main sends `changed` THEN the list is read again and the selection stays on its slug.
GIVEN any scope WHEN `Space k p` is pressed THEN Practice mode shows; pressed again while it shows THEN its side bar
toggles.
GIVEN a reload WHEN the page starts THEN the last selection, filter and open problem come back from
`practice.place`.

Tests:
- `practiceReducer` in `practice-state.test.ts`, one `it.each` per behaviour, cases as rows, with a matcher built on a
  substring stand-in (`matches: (q, t) => t.toLowerCase().includes(q.toLowerCase())`), each summary built by a
  `summary({ slug, title, difficulty, status, due, tags, lists })` helper:
  - `sorts by status, then difficulty, then title` — input slugs in order `s-hard-b` (solved, hard), `n-easy-b` (new,
    easy, title `B`), `a-med` (attempted, medium), `n-easy-a` (new, easy, title `A`), `a-easy` (attempted, easy) →
    `['a-easy', 'a-med', 'n-easy-a', 'n-easy-b', 's-hard-b']`. Catches a wrong key order.
  - `filters by each word kind` rows (problems: `two-sum` easy solved tags `[array]` lists `[Blind 75]`; `clone-graph`
    medium attempted tags `[graph]`; `lru` medium new due tags `[design]`; `blind-spot` hard new title `Blind Spot`):
    `easy` → `[two-sum]`; `unsolved` → `[clone-graph, lru, blind-spot]` in sort order; `due` → `[lru]`; `GRAPH` →
    `[clone-graph]`; `blind` → `[two-sum]`; `75` → `[two-sum]`; `medium new` → `[lru]`; `clone` → `[clone-graph]`;
    `zzz` → `[]`. Catches each rule and that a tag word never falls back to title.
  - `keeps the selection` rows: `loaded` with the selected slug still present keeps it; `loaded` with it gone
    selects the first row; `setFilter` hiding it moves to the first visible; `setFilter` matching nothing gives null;
    `move down` at the last row stays; `move top` selects the first; `select` of a filtered-out slug changes nothing.
  - `difficultyCounts counts solved of total per difficulty` — the four problems above →
    `[{ easy, 1, 1 }, { medium, 0, 2 }, { hard, 0, 1 }]`.
- `readPracticeLayout` in `read-layout.test.ts`: backlog's four rows (`no default export`, `a key that is no part` →
  `cards is not a layout part`, `a part that is not a function` with `problemRow: 1`, `one row part` with
  `problemRow`).
- `practicePagePart` in `start.test.ts`, through `startPagePart` (`src/shared/plugin-part-harness.test-support.ts`)
  as `src/plugins/backlog/page/start.test.ts` uses it, `invoke` answering `list` with two summaries and `open` with an
  `OpenedProblem`:
  - `opens the selected problem on openProblem` — runs `listDown` then `openProblem`; `invoke` saw `open` with the
    second sorted slug, and the log holds `opened <slug>`.
  - `reads the list again on changed` — fires `changed`; `invoke('list')` ran twice and the selected slug stays.
  - `restores the place` — a published `practice.place` `{ selectedSlug: <second>, openSlug: <second>, filter: '' }`
    before start; after the load the log holds `selected <second>` and `opened <second>`.

Done when: `npm run typecheck` passes, `npm run lint` passes (layers, styles, oxlint, oxfmt), the test gate runs the
tests above and `src/shared/layouts/layout-contracts.test.ts` (it reads every plugin's `layouts/layout.d.ts`). Live
checks (the mode's look, keys, side bar toggle, placement check) defer to "12 — Final verification".
Commit:    one commit for the group

## Proof
