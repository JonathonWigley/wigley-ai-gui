# 03 — Page loader and layout resolver

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/layout-loader.ts` · test `src/shared/page/layout-loader.test.ts`
           modify `src/plugins/forms/layouts/layout.d.ts` · modify `src/plugins/forms/layouts/default/layout.js`
           modify `src/plugins/forms/page/layout/read-layout.ts` · test `src/plugins/forms/page/layout/read-layout.test.ts`
           create `src/plugins/forms/page/layout/layout-resolver.ts` · test `src/plugins/forms/page/layout/layout-resolver.test.ts`
           modify `src/plugins/forms/page/layout/layout-cards.ts` · modify `src/plugins/forms/page/kinds/item-format.ts`
           modify `src/plugins/forms/page/round-view.ts` · modify `src/plugins/forms/page/forms-view.ts`
           modify `src/plugins/forms/page/start.ts` · modify `src/plugins/chat/page/start.ts`

Consumes:  `interface LayoutEntry { name: string; revision: number; hasCss: boolean; builtIn: boolean }` ← 01 (`src/contracts/layouts.ts`)
           `interface LayoutSet { layouts: LayoutEntry[]; changed: string | null }` ← 01 (`src/contracts/layouts.ts`)
           the forms and chat channels' `layout` request returning `LayoutSet` and `layoutChanged` message carrying `LayoutSet` ← 01
           forms' manifest `settings.layout` (read as `api.settings().layout`) and chat's `settings.layout` ← 01
           `Round.layout: string | null`; `Question.layout`, `Notice.layout`, `FindingFields.layout`: `string | null` ← 02 (`src/plugins/forms/contract.ts`)
           `api.onSettingsChanged(listener): Disposable` (tree, `src/contracts/plugin.ts`)

Produces:  in `src/shared/page/layout-loader.ts`:
           - `function layoutUrls(entry: LayoutEntry, dataUrl: (path: string, revision: number) => string): { script: string; style: string | null }`
           - `interface LayoutLoad<L> { layouts: ReadonlyMap<string, L>; loaded: LayoutEntry[]; failed: { entry: LayoutEntry; error: unknown }[] }`
           - `interface LayoutLoader<L> { load(set: LayoutSet, names: readonly string[]): Promise<LayoutLoad<L>> }`
           - `function createLayoutLoader<L>(deps: LayoutLoaderDeps<L>): LayoutLoader<L>` (`LayoutLoaderDeps` unchanged)
           - `interface LayoutChannel { onLayoutChanged(listener: (set: LayoutSet) => void): void; readLayout(): Promise<LayoutSet> }`
           - `interface ShownLayouts<L> { layouts: ReadonlyMap<string, L>; user: string }`
           - `interface ShowLayoutsDeps<L> { channel: LayoutChannel; loader: LayoutLoader<L>; userLayout(): string; namesInUse(): readonly string[]; setLayouts(shown: ShownLayouts<L>): void; log: Log; logSource: string; toast(text: string, tone: ToastTone): void }`
           - `interface LayoutShow { refresh(): void }`
           - `function showLayouts<L>(deps: ShowLayoutsDeps<L>): LayoutShow`
           in `src/plugins/forms/layouts/layout.d.ts`:
           - `interface LayoutCards { question(...); finding(...); notice(...) }` — today's three builders, moved out of `Layout`
           - `interface Layout { cards?: Partial<LayoutCards>; head?(parent: HTMLElement, round: RoundInfo, kit: HeadKit): void }`
           - `interface CompleteLayout extends Layout { cards: LayoutCards }`
           in `src/plugins/forms/page/layout/read-layout.ts`:
           - `function readLayout(module: unknown, name: string): Layout` (same signature, partial layouts accepted)
           in `src/plugins/forms/page/layout/layout-resolver.ts`:
           - `type LayoutPart = 'question' | 'finding' | 'notice' | 'head' | 'rail' | 'review'`
           - `interface LayoutPick { name: string; layout: Layout }`
           - `function layoutChain(itemLayout: string | null, roundLayout: string | null, userLayout: string): string[]`
           - `function pickLayout(part: LayoutPart, chain: readonly string[], loaded: ReadonlyMap<string, Layout>): LayoutPick`
           - `function itemLayout(round: Round, item: RailItem): string | null`
           - `function roundLayoutNames(round: Round): string[]`
           - `interface RoundPicks { cards: LayoutPick[]; panes: Record<'head' | 'rail' | 'review', LayoutPick> }`
           - `function pickRoundLayouts(round: Round, userLayout: string, loaded: ReadonlyMap<string, Layout>): RoundPicks`
           - `function picksEqual(a: RoundPicks, b: RoundPicks): boolean`
           in `src/plugins/forms/page/layout/layout-cards.ts`:
           - `function buildLayoutCard(pick: LayoutPick, parent: HTMLElement, round: RoundState, item: RailItem, position: number, deps: CardDeps): ItemCard`
           in `src/plugins/forms/page/round-view.ts`:
           - `function createRoundView(attach: (root: HTMLElement) => void, round: RoundState, shown: ShownLayouts<Layout>, deps: RoundViewDeps): RoundView`
           - `RoundView.setLayouts(shown: ShownLayouts<Layout>, round: RoundState): void` (replaces `setLayout`)
           in `src/plugins/forms/page/forms-view.ts`:
           - `FormsView.setLayouts(shown: ShownLayouts<Layout>): void` (replaces `setLayout`)

Decisions:
- Precedence, per card kind and pane (interview): item's `layout`, then the round's `layout`, then the `forms.layout`
  setting, then `default`. `layoutChain` drops nulls and repeats and always ends with `'default'`:
  `layoutChain('a', null, 'a')` is `['a', 'default']`.
- `pickLayout` returns the first name in `chain` that `loaded` holds and that defines `part`; it ends at `default`
  whatever `default` defines (so a part `default` lacks, such as `head`, resolves to `default` and draws nothing). It
  throws `layout default is not loaded` when `loaded` lacks `default`: the loader always holds it, so the throw
  names a broken caller. A name the set lacks or that never loaded is skipped in silence: `ask_round` checked the
  name when the round opened (02), and only a deleted folder removes it later.
- A part is defined when `layout.cards?.[kind]` (card kinds) or `layout.head` is a function. The resolver reads
  each part through one table typed `{ [P in LayoutPart]: (layout: Layout) => unknown }`, so a new part fails to
  compile until it has a row. Until 05 adds `Layout.rail` and `Layout.review`, their rows return `undefined`, so both
  resolve to `default`; 05 replaces those two rows. Nothing builds a rail or review pane from a pick before 05.
- `pickRoundLayouts` resolves every card in `railItems(round)` order (chain from `itemLayout(round, item)`) and each
  pane with no item layout (`layoutChain(null, round.layout, userLayout)`). `picksEqual` is true when every card
  and pane has the same name and the same layout object, so a round view rebuilds only when a layout it draws with
  changed. `round-view.ts` names no layout: it reads only `RoundPicks`.
- `readLayout` (interview: "requires every card and pane only of `default`"): a user layout defines only the parts it
  changes. It throws, in this order, with these exact messages:
  - default export not an object: `layout <name>: the default export is missing or not an object` (unchanged)
  - a top-level key other than `cards` and `head`: `layout <name>: <key> is not a layout part` (05 adds `rail`,
    `review` to the known keys)
  - `cards` present and not an object: `layout <name>: cards is not an object`
  - a key in `cards` other than `question`, `finding`, `notice`: `layout <name>: cards.<key> is not a card kind`
  - a card present and not a function: `layout <name>: cards.<kind> is not a function`
  - `head` present and not a function: `layout <name>: head is not a function` (unchanged)
  The built-in `default` never passes through `readLayout`; its completeness is the type `CompleteLayout`, which
  `layouts/default/layout.js` declares with `/** @type {import('../layout').CompleteLayout} */`.
- `CardBuilders` in `kinds/item-format.ts` becomes `LayoutCards` (`Layout['cards']` is now optional and partial).
- Loader (interview: several layouts at once, each with its own revision and stylesheet):
  - `load(set, names)` loads each name in `names` that `set.layouts` lists; a name the set lacks is skipped.
    `layouts` always holds `default` as `deps.defaultLayout`; a `builtIn` entry imports nothing and gets no link.
  - Cache by name and revision: a name already loaded at the entry's revision is not imported again. A name whose
    import or `read` failed at a revision is not imported again at that revision, and is not reported again in
    `failed`. A failed name keeps its last good version in `layouts`; a name with no good version is absent.
  - `loaded` lists each entry this call imported and read; `failed` each entry that failed this call.
  - Stylesheets: after each load, `deps.head` holds exactly one `<link rel="stylesheet" data-layout="<name>">` per
    name in `names` with a good version whose entry had `hasCss`, its `href` at that good version's revision. A
    link's `href` changes only after that name's script loaded and read (today's rule: a failed reload keeps the
    last good look whole). A name no longer in `names` loses its link; its module stays cached.
  - Imports of one call run in parallel; `load` settles once all of them settle.
- `showLayouts` (shared by forms and chat):
  - It does nothing until the first set arrives. A `layoutChanged` heard before the `layout` answer drops the answer
    (unchanged). Every set and every `refresh()` queue one `load`, run one at a time in order; a `refresh()` whose
    set and names equal the last queued load's queues nothing.
  - Names loaded: the setting's name (`userLayout()`) when the set lists it, then `namesInUse()`, without repeats.
  - `ShownLayouts.user` is the setting's name when `layouts` holds it, else `'default'`.
  - When the setting names a layout the set does not list, the page logs, verbatim,
    `layout <name> not found, drawing default`. It logs it once: again only after the setting changes or a set lists
    that name and a later set drops it. The not-found check runs on every set and every `refresh()`, before the
    "queues nothing" short-cut above and apart from the load queue, because the log follows the setting, not the
    load: a setting that moves from `gone1` to `gone2` while the names in use stay the same queues no load and still
    logs `layout gone2 not found, drawing default`.
  - Each `loaded` entry logs `layout <name> shown (revision <n>)`. Each `failed` entry logs
    `layout <name> failed: <error>` and toasts `Layout <name> failed: <error>` with tone `error` (both unchanged).
  - `setLayouts` runs only when `layouts` holds a different object at some name, or a different name set, or `user`
    changed, since the last call. A throw from it logs `layouts not shown: <error>` and later loads still run.
  - `layout not read: <error>` stays for a rejected `layout` answer. The `cycled` and `copied` toasts, the
    `reason` in the log line and the `dataFolderLabel` dep are removed (01 removed cycle and copy).
- Forms page (`start.ts`): `userLayout` reads `api.settings().layout`; `namesInUse` is
  `roundLayoutNames(round.round)` of every round in `store.get().rounds`; `setLayouts` calls `view.setLayouts`.
  `api.onSettingsChanged` and `store.subscribe` each call `refresh()`.
- Chat page (`chat/page/start.ts`): `userLayout` reads `api.settings().layout`; `namesInUse` returns `[]`;
  `setLayouts` calls `view.setLayout(shown.layouts.get(shown.user) ?? defaultLayout, shown.user)`;
  `api.onSettingsChanged` calls `refresh()`. Partial chat layouts stay out of scope (plan).
- Forms view: starts on `{ layouts: new Map([['default', defaultLayout]]), user: 'default' }`, keeps the last
  `ShownLayouts`, builds each new round view with it, and on `setLayouts` hands it to every open round view. A round
  view computes `pickRoundLayouts` and rebuilds both panes (today's `setLayout` body: destroy the round's boxes, empty
  both panes, build, update) only when `picksEqual` is false against the picks it built with. This picks check gates
  only `setLayouts`; 07 adds a `rebuild()` that runs the same rebuild body with no picks check, for a redraw that
  changes no pick.
- A round view built before its round's layout loaded draws with the next layout down the chain, and rebuilds when
  `setLayouts` brings it; the answers live in the store, so the rebuild keeps them.
- `data-layout` (interview: it scopes CSS): the host sets `data-layout="<name>"` on the root element of each card it
  hosts and on the head slot, `<name>` being the layout that drew it (`default` after a fallback). Layout roots never
  nest, since the app owns every container between them, so `[data-layout="<name>"] …` in a layout's CSS selects only
  what that layout drew.
- The throwing-card fallback stays in `buildLayoutCard`: a pick's card that throws, or returns no element appended to
  `parent`, is cleaned up as today, logs `layout <name> <kind> card failed: <error>` (`<name>` the pick's name) and
  builds with `defaultLayout.cards`. A pick whose layout lacks the card's kind (only `default` can reach this, and it
  cannot) builds with `defaultLayout.cards`. The head keeps today's rule: a throw logs `layout <name> head failed:
  <error>` and leaves the slot empty.

GIVEN layouts `mine` (defines only `cards.finding`) and `default` loaded, a round with `layout: 'mine'`
WHEN its round view builds
THEN its finding cards come from `mine` with `data-layout="mine"`, and its question and notice cards from `default`

GIVEN the setting `forms.layout` is `gone` and the set does not list `gone`
WHEN the page reads the set
THEN every round draws with `default` and the log holds `layout gone not found, drawing default` once

GIVEN layouts `a` and `b` in use, each with a `layout.css`
WHEN both load
THEN `document.head` holds two links, `data-layout="a"` and `data-layout="b"`, and saving `a` moves only `a`'s link

Tests:
- `layout-resolver.test.ts`:
  - `layoutChain_DropsNullsAndRepeats_EndsAtDefault` — `layoutChain('a', null, 'a')` is `['a', 'default']`;
    `layoutChain(null, null, 'default')` is `['default']`; `layoutChain('i', 'r', 'u')` is `['i', 'r', 'u', 'default']`
  - `pickLayout_ItemLayoutDefinesKind_PicksIt` — chain `['mine', 'default']`, `mine` with `cards.finding`: part
    `finding` picks `{ name: 'mine', layout: mine }`
  - `pickLayout_PartialLayout_FallsToNextInChain` — `mine` with only `cards.finding`, part `question` with chain
    `['mine', 'theirs', 'default']` and `theirs` defining `cards.question` picks `theirs`
  - `pickLayout_NameNotLoaded_Skipped` — chain `['missing', 'default']` picks `default`
  - `pickLayout_NoLayoutDefinesHead_PicksDefault` — part `head`, nothing defines it: picks `default`
  - `pickLayout_RailAndReview_PickDefault` — parts `rail` and `review` pick `default` even when `mine` is first
    (05 replaces this test)
  - `pickLayout_DefaultNotLoaded_Throws` — throws `layout default is not loaded`
  - `itemLayout_ReadsEachKindsItem` — a round whose second finding has `layout: 'f'` and first notice
    `layout: 'n'`: `{ kind: 'finding', index: 2 }` gives `'f'`, `{ kind: 'notice', index: 1 }` gives `'n'`, a
    question with `layout: null` gives `null`
  - `roundLayoutNames_RoundAndItems_UniqueWithoutNulls` — round `layout: 'r'`, items `'r'`, `'q'`, null: `['r', 'q']`
  - `pickRoundLayouts_CardsInRailOrder_PanesWithoutItem` — a round with a notice, a finding (`layout: 'f'`) and a
    question; user `u`; loaded `f` (all cards), `u` (all cards and head): cards picks are `u`, `f`, `u` by rail
    position; `panes.head` is `u`
  - `picksEqual_SameNamesSameObjects_True_NewObject_False` — two `pickRoundLayouts` calls over the same map are
    equal; a map with a new object under one name used by a card is not
- `read-layout.test.ts` (replaces `readLayout_MissingNoticeCard_ThrowsNamingIt`):
  - `readLayout_OnlyFindingCard_ReturnsIt` — `{ cards: { finding } }` returns the module's default
  - `readLayout_EmptyLayout_ReturnsIt` — `{}` returns the module's default
  - `readLayout_CardNotFunction_Throws` — `layout mine: cards.notice is not a function`
  - `readLayout_UnknownCardKind_Throws` — `cards.findng` throws `layout mine: cards.findng is not a card kind`
  - `readLayout_UnknownPart_Throws` — `{ rails: … }` throws `layout mine: rails is not a layout part`
  - `readLayout_CardsNotObject_Throws` — `layout mine: cards is not an object`
  - `readLayout_NoDefaultExport_Throws`, `readLayout_HeadNotFunction_Throws` — unchanged messages
- `layout-loader.test.ts` (replaces the `LayoutChoice` tests; same fake head, its links now carrying `dataset`):
  - `layoutUrls_WithCss_BuildsBothWithRevision`, `layoutUrls_WithoutCss_StyleNull` — over a `LayoutEntry`
  - `load_TwoUserLayoutsWithCss_OneLinkEach` — names `['a', 'b']`: two links, `data-layout` `a` and `b`, each href
    at its own revision
  - `load_WithCss_AddsStylesheetOnlyAfterScriptLoads` — no link before the script resolves
  - `load_SameRevision_ImportsOnce` — two loads of `a` at revision 4 import one URL once and return the same object
  - `load_NewRevision_ImportsAgainAndMovesLink` — `a` at 4 then 5: two imports, the link's href at 5
  - `load_ScriptFails_KeepsLastGoodAndItsLink` — `a` at 4 good, at 5 throws: `layouts.get('a')` is the revision-4
    object, `failed` names `a` at 5, the link's href stays at 4
  - `load_FailedRevision_NotImportedAgain` — a second load of the failed `a` at 5 imports nothing and `failed` is empty
  - `load_NameLeavesNames_RemovesItsLink` — load `['a']` then `[]`: the link is removed
  - `load_NameNotInSet_Skipped` — names `['ghost']` imports nothing; `layouts` holds only `default`
  - `load_AlwaysHoldsDefault_NoLinkForBuiltIn` — `layouts.get('default')` is `deps.defaultLayout`; no link for it
  - `load_UserLayout_HandsReadTheModuleAndName` — unchanged claim
- `layout-loader.test.ts`, `showLayouts` (fake loader recording `(set, names)`):
  - `showLayouts_Answer_LoadsSettingAndNamesInUse` — setting `mine`, names in use `['r']`, set lists both: the
    loader gets `['mine', 'r']`; `setLayouts` gets `user: 'mine'`
  - `showLayouts_SettingMissing_DrawsDefaultAndLogsOnce` — setting `gone`: `user` is `default`; two refreshes log
    `[demo] layout gone not found, drawing default` once
  - `showLayouts_SettingMovesToAnotherMissingName_LogsItWithNoLoad` — setting `gone1`, then `gone2` and a refresh,
    names in use unchanged: the log holds `[demo] layout gone2 not found, drawing default`, and the loader got no
    second call
  - `showLayouts_Loaded_LogsShownWithRevision` — `[demo] layout mine shown (revision 3)`
  - `showLayouts_ChangeHeardBeforeAnswer_DropsAnswer` — unchanged claim over sets
  - `showLayouts_LoadFails_LogsAndToasts` — `[demo] layout mine failed: broken` and `error: Layout mine failed: broken`
  - `showLayouts_RefreshUnchanged_QueuesNothing` — a refresh with the same set and names makes no second load and no
    second `setLayouts`
  - `showLayouts_SetLayoutsThrows_LaterSetsStillShown` — logs `[demo] layouts not shown: rebuild failed`; the next
    set reaches `setLayouts`
  - `showLayouts_AnswerRejects_LogsNotRead` — unchanged

Approach: the DOM building in `round-view.ts`, `forms-view.ts` and `layout-cards.ts` has no unit test (Vitest runs
in `node`); the self-test (08) and the final verification (10) check it live.

Done when: `npm run typecheck`, `npm run lint` and `npm test` pass (`round-view.ts`, `forms-view.ts`,
`layout-cards.ts` and the chat page have no unit test, so only the compiler checks them against the new
`showLayouts` and `Layout` shapes); the tests above exist and pass; `grep -n "LayoutChoice\|setLayout("
src/plugins/forms/page src/shared/page` finds nothing; the chat page builds against the new `showLayouts`.
Commit:    one commit for the group

## Proof

