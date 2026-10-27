# 05 — Primer layout and preview

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

**Contents**

- **Files, Consumes, Produces** — what the task touches and the names it lands.
- **Decisions** — the contract, the parts, the kits, the view, main, the preview, the keys.
- **Behaviour** — GIVEN / WHEN / THEN.
- **Tests** — each test and the break it catches.
- **Self-test** — the preview group.
- **Done when, Commit.**

The primer draws through the layout host task 02 lands, in the look task 01 lands. Read `docs/features/layouts/design.md`
and AGENTS.md § A layout and § A forms layout first. Forms (`src/plugins/forms/layouts/`, `src/plugins/forms/page/layout/`)
is the model for a contract, a reader and a kit; read it for the pattern only. Primer code never imports forms code
(`scripts/check-layers.mts` forbids it).

Files:     create `src/plugins/primer/layouts/layout.d.ts` · create `src/plugins/primer/layouts/default/layout.js` ·
           create `src/plugins/primer/page/layout/read-primer-layout.ts` · create `src/plugins/primer/page/layout/primer-kit.ts` ·
           create `src/plugins/primer/main/preview/primer-preview.ts` · create `src/plugins/primer/main/preview/preview-primer.ts` ·
           modify `src/plugins/primer/ids.ts` · modify `src/plugins/primer/manifest.ts` · modify `src/plugins/primer/contract.ts` ·
           modify `src/plugins/primer/main/start.ts` · modify `src/plugins/primer/main/selftest-script.ts` ·
           modify `src/plugins/primer/page/start.ts` · modify `src/plugins/primer/page/primer-view.ts` ·
           modify `src/plugins/primer/page/primer-review.ts` · modify `src/plugins/primer/page/primer-commands.ts` ·
           modify `src/plugins/primer/page/primer.css` · modify `src/plugins/keymap.ts` · modify `docs/keymap.md` ·
           test `src/plugins/primer/page/layout/read-primer-layout.test.ts` · test `src/plugins/primer/page/primer-view.test.ts` ·
           test `src/plugins/primer/page/primer-commands.test.ts` · test `src/plugins/primer/main/preview/primer-preview.test.ts` ·
           test `src/plugins/primer/main/preview/preview-primer.test.ts`
Consumes:  ← 02, exact signatures in `02-layout-core.md` § Produces:
           `MainApi.layouts.register(options: { layoutTypes: string }): Disposable`
           `PageApi.layouts.show<L>(options: ShowLayoutOptions<L>): LayoutShow`, with `ShowLayoutOptions<L>`,
           `ShownLayouts<L>`, `LayoutShow`; the show refreshes on a change of the primer's settings by itself
           `readLayoutModule(module: unknown, name: string): Record<string, unknown>`, `isRecord(value: unknown)`
           (`src/shared/page/layout-host/read-layout-module.ts`)
           `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>):
           { built: R; layoutName: string; dispose(): void }`, with `build(builder: B, parent: HTMLElement, rollback: RollbackDeps): R`;
           `PartPick<L>`, `RollbackDeps`, `requireElementIn` (`draw-part.ts`)
           `pickLayout<L>(chain, layouts, defines): PartPick<L>` (`pick.ts`)
           `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps` (`keys.keysFor` returns `string | null`; `scope`
           may be `null`), `KitCommands { exists(id: CommandId): boolean; run(id: CommandId): void }`,
           `commandRunner(qualifiedId: CommandId, commands: KitCommands): () => void` (`base-kit.ts`)
           `BaseKit` (with `keyHint(parent, command, options?: KeyHintOptions)`, `statusDot`, `setDotStatus`, `row`,
           `emptyState`, `keyPrompt`), `TagTone`, `ButtonVariant`, `KitButtonOptions` from the core's `kit.d.ts`,
           imported in the repo's contract as `import type { BaseKit } from '../../../shared/page/layout-host/kit';`
           (the registry rewrites the specifier to `'../kit'` in the user's copy)
           the `LAYERS` entry for `src/plugins/primer/layouts` in `scripts/check-layers.mts` (02 adds it; this task does
           not edit that file)
           ← 01: `RailRow`, `OpenPrimer.selected`, `railRows`, `railPosition`, `selectedRow`, `selectedEntry`,
           `selectedItem`, `RowPrompt`, `rowPrompt`, `rowName`, `shownBoxes`
           tree: `SAMPLE_PRIMER_ARGS`, `parsePrimer`, `createAgentFormService`, `createMemoryFormStore`,
           `AgentFormChannelPresenter.quiet`
Produces:  `export function primerCommandNamed(short: string): CommandId | null` in `src/plugins/primer/ids.ts`
           `export function readPrimerLayout(module: unknown, name: string): PrimerLayout` in `read-primer-layout.ts`
           `PrimerLayout`, `CompletePrimerLayout` and the input and kit types below in `src/plugins/primer/layouts/layout.d.ts`
           `primerManifest.settings.layout: 'default'` and `settingInfo.layout`; command `openPreview` in `manifest.ts`
           `PrimerChannel` with `invoke.openPreview(): void` in `contract.ts`
           `export function createPrimerPreview(deps: PrimerPreviewDeps): { open(): void }` in `primer-preview.ts`
           `export const PREVIEW_PRIMER_ARGS: { feature: Record<string, string>; entries: Record<string, unknown>[] }`
           in `preview-primer.ts`
           the bind `{ keys: '<Leader>zlp', scope: 'any', command: 'primer.openPreview', where: 'page' }` and the group
           name `'<Leader>zl': 'layout previews'` in `src/plugins/keymap.ts`. Tasks 10 and 15 consume the group name and
           add their binds beside this one.
Commit:    one commit for the group

## Decisions

### The contract (`src/plugins/primer/layouts/layout.d.ts`)

It opens with `import type { BaseKit } from '../../../shared/page/layout-host/kit';` and restates no shared kit type.
The registry rewrites that specifier to `'../kit'` in the copy it writes to `layouts/primer/layout.d.ts`. It declares:

- `PrimerNeed = 'yes' | 'no' | 'unclear'`, `PrimerGroup = 'primer' | 'standing' | 'extra'`.
- Card inputs, each a plain record the app builds from the primer as the user edited it:
  - `FeatureCardInput { name; slug; spec; summary; notes }` (strings).
  - `TaskCardInput { id; group: PrimerGroup; number: number | null; area; name; need: PrimerNeed; question; evidence;
    probes; pointer; itemCount: number; canAddItem: boolean }`. `name` is `taskName(entry)`.
  - `ItemCardInput { entryId; taskName; number; count; text; include: boolean; added: boolean }`. `number` is 1-based;
    `count` is the task's item count.
- `PrimerLayoutCard { element: HTMLElement; update?(input): void }`, generic over the card's input. `element` is the
  card's own node, appended to `parent` before the card mounts a box. `update` runs with the current input on each
  primer change while the card shows.
- `PrimerLayoutCards { feature(parent, input: FeatureCardInput, kit: FeatureKit); task(parent, input: TaskCardInput,
  kit: TaskKit); item(parent, input: ItemCardInput, kit: ItemKit) }`, each returning its `PrimerLayoutCard`.
- Rail input: `RailRowInput`, one of `{ position; kind: 'feature'; name }`, `{ position; kind: 'task'; entryId; group;
  name; need; included; total; expanded: boolean }`, `{ position; kind: 'item'; entryId; number; text; include;
  added }`. `position` is the row's place in `railRows`. `RailGroupInput { group: PrimerGroup; header: string; rows:
  RailRowInput[] }` (a task row, then its item rows when it is expanded). `RailInput { feature: RailRowInput; groups:
  RailGroupInput[] }`. `groups` holds Primer and Every feature only when they hold a task, and Extra tasks always,
  as the rail draws them today.
- Review input: `ReviewInput { tallies: { yes; no; unclear; included; items }; problems: string[]; feature: { label;
  value }[]; tasks: ReviewTaskInput[] }`, `ReviewTaskInput { id; name; need; comment; items: { text; include;
  comment }[] }`. `tasks` is in rail order; `feature` in `FEATURE_FIELDS` order.
- `PrimerLayoutPane { element: HTMLElement }`.
- Kits. Every part appends itself to `parent` and returns what it appended:
  - `PrimerKit extends BaseKit`: `needTag(parent, need: PrimerNeed): HTMLElement` (the Tag in the need's tone:
    yes `success`, no `neutral`, unclear `warning`, text Yes / No / Unclear).
  - `FeatureKit extends PrimerKit`: `textBox(parent, field: 'name' | 'slug' | 'spec' | 'summary' | 'notes')`.
  - `TaskKit extends PrimerKit`: `textBox(parent, field: 'name' | 'newItem' | 'comment')`. `name` exists only on an
    extra task and `newItem` only while `canAddItem`; asking for a box the card does not have throws, so the card
    falls back to `default`.
  - `ItemKit extends PrimerKit`: `textBox(parent, field: 'comment')` and `includeMark(parent)`: the item's ToggleMark,
    a click toggles the item, and it sets itself on each change while the card shows.
  - For every `textBox`: it mounts the box in a labelled field (the label as the default draws it), with its `⌃P ⌃N`
    box keys and its key hint. Each box mounts once per card. The app appends every box the card leaves out at the
    card's end, in its field, so the box keys always reach it (forms' `appendUnmountedBoxes` pattern). The Ctrl+n
    order stays `shownBoxes`, not DOM order.
  - `RailKit extends PrimerKit`: `railRow(parent, position: number): HTMLElement`, the list row for rail `position` as
    task 01 draws it (Feature row; task row with need tag and count; item row with mark and number). The app keeps on
    it the click that selects it, `is-selected`, the row prompt under the selected row, and an item row's mark click.
    The app tracks rows only by the elements `railRow` returns. A row the rail draws without `railRow` gets no click
    and no selection class. When the rail never calls `railRow` for the selected position, the app appends the row
    prompt at the end of the rail pane's root, as docs, backlog and settings append a slot the layout leaves out, so
    the need, include and remove anchors stay on the page. The `layout.d.ts` comment on `railRow` states this rule.
    `addPrompt(parent): HTMLElement`: the `A add` anchor for `addExtraTask` in the rail scope. The name is `railRow`,
    not `row`, since `BaseKit.row(parent, options: KitRowOptions)` draws a plain Row and a second `row` would not
    type-check.
  - `statusDot`, `setDotStatus`, `row`, `emptyState` and `keyPrompt` are `BaseKit`'s; no primer kit declares its own.
  - `ReviewKit extends PrimerKit` adds nothing.
  - The scope of `keyHint`, `keys` and `keysFor`: `primer.card` for the cards, `primer.rail` for the rail,
    `primer.review` for the review.
- `PrimerLayout { cards?: Partial<PrimerLayoutCards>; rail?(parent, input: RailInput, kit: RailKit):
  PrimerLayoutPane; review?(parent, input: ReviewInput, kit: ReviewKit): PrimerLayoutPane }`.
- `CompletePrimerLayout extends PrimerLayout` with every card, `rail` and `review` required.
- Each declaration carries a comment that says what the app keeps and what happens when a part throws, as forms'
  contract does. The file is the text main registers, so it is the user's reference.

### What the layout draws and what the app keeps

- The layout draws: the feature, task and item cards; the rail pane's body (the rows and group headers); the review
  pane's body (tallies, problems, the feature block, a block per task).
- The app keeps: the split and its width; the rail header (save status, `⌃H ▲ ▼ ⌃L`, `⌥L card ›`); the rail foot's
  Review button; the card edge strip (`‹ rail ⌥H`); the review footer (Back, Cancel primer, Send and their anchors);
  the cancel prompt; selection classes; the row prompt; boxes; scrolling; when a card rebuilds (`cardKeyOf`, task 01).
  The review footer stays app-owned: the design keeps the review pane as it is, and only its body is a layout part.
- Pick chain per part: `[<primer.layout setting>, 'default']` through `pickLayout`, with `defines` testing the part.
  The primer has no per-form layout field, so `namesInUse` is left out.
- Every part draws through `drawPart`, with `owner: 'primer'`, `logSource: 'primer'` and `partName` `feature card`, `task card`,
  `item card`, `rail` or `review`. `drawPart` sets `data-layout` and `data-layout-owner="primer"` on the part's root and rolls back a throw to
  `default`. A layout's `layout.css` selects under `[data-layout-owner="primer"][data-layout="<name>"]`. A card's `build` returns `{ element: card.element, card }`, and the view keeps `built.card` from the
  call's `{ built, layoutName, dispose }`: after a fallback it is the default card, so its `update` is the default's.
  An `update` that throws logs `layout <name> <part> update failed: <error>` under source `primer`, with part
  `feature card`, `task card` or `item card`, once per layout object and part (the once rule of `drawPart`, in a
  `WeakMap` of its own), and the card stays.
- Disposal: the view keeps the `dispose` of each part it drew. It calls it before it draws that part again (a rail
  redraw, a card rebuild, a review redraw, a new pick) and when the view goes. This disposes the part's anchors and
  destroys the boxes it recorded, and it replaces the card's own anchor list (`card.dispose()` today). The anchors
  of the app-owned rail header, card edge strip and review footer keep the view's own list, as today.
  `keepFocusedBox` still wraps a card rebuild.
- Redraws: the rail pane on each primer change (as `drawRail` today); the review pane on each primer change while the
  review shows; a card when `cardKeyOf` changes or the picked layout for its part changes. `setLayouts` rebuilds every
  shown part of each primer view whose pick changed, inside `keepFocusedBox`.

### The default layout (`src/plugins/primer/layouts/default/layout.js`)

Plain JS under `// @ts-check`, typed against `../layout`, exporting a `CompletePrimerLayout` as `default`. It draws
the markup and class names task 01 lands (`primer-card-heading`, `primer-card-tags`, `primer-card-section`,
`primer-field`, `primer-item-step`, `primer-item-include`, `primer-rail-list`, `primer-review*`), so `primer.css`
styles it unchanged. The item card header's keys are `kit.keyHint(parent, 'prevRow')` and
`kit.keyHint(parent, 'nextRow')`. The rail's empty Extra tasks line is `kit.emptyState(parent, 'No extra tasks.')`,
the EmptyState primitive (`p.ui-empty`). Its head comment lists what a user layout may leave out and what the
app does then, as forms' default does. `renderReview` and its helpers leave `primer-review.ts` for the default's
`review`; `needTag`, `taskName`, `reviewTallies`, `talliesText` and `reviewFooter` stay there.

### The reader (`read-primer-layout.ts`)

`readPrimerLayout(module, name)` calls `readLayoutModule(module, name)`, then throws naming the first key that is no
part (`cards`, `rail`, `review`), the first `cards` key that is no card (`feature`, `task`, `item`), or the first part
that is not a function. Messages follow forms' shape: `layout <name>: <key> is not a layout part`.

### The kits (`primer-kit.ts`)

- One base kit per part draw, made inside `build`, from `createBaseKit` with: `markdown` from services; `keys.anchor`
  the keys plugin's `anchor` wrapped by `recordingAnchor` into the `rollback` that `build` receives; `keys.keysFor` the
  keys plugin's `keysFor`; `commands` the view's `KitCommands`; `scope` `primerScope('card' | 'rail' | 'review')`;
  `commandNamed: primerCommandNamed`; `platform: api.platform`. `page/start.ts` builds the `KitCommands` as
  `{ exists: (id) => api.keys.command(id) !== undefined, run: (id) => api.commands.run(id) }`, as forms does.
- `primerCommandNamed(short)`: the qualified id when `primerManifest.commands` has `short`, else null, as
  `formsCommandNamed` does.
- `textBox` mounts through `deps.boxes.mount` and records the box in the attempt's `rollback.recordBox`, so a card that throws
  after mounting a box leaves no box mounted.
- `PrimerViewDeps` gains `keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>`, `platform: Platform` and
  `commands: KitCommands`. `PrimerTab` gains `setLayouts(shown: ShownLayouts<PrimerLayout>): void`.

### Main (`main/start.ts`, `contract.ts`, `manifest.ts`)

- `import layoutTypes from '../layouts/layout.d.ts?raw';` and `api.layouts.register({ layoutTypes })`; the returned
  `Disposable` is disposed in the part's `dispose`.
- Manifest: `settings: { autosaveDelayMs: 400, deadlineSeconds: 240, layout: 'default' }`; `settingInfo.layout`:
  label `Layout`, description `The primer layout that draws the Primer tab: a folder name in the primer's layouts
  folder, or default.` Command `openPreview: { label: 'open the primer layout preview', group: 'debug', runsIn:
  'page' }`.
- `PrimerChannel` becomes an interface extending `ChannelShape` with `invoke: AgentFormInvoke<Primer, PrimerBody> &
  { openPreview(): void }` and `messages: AgentFormMessages<Primer, PrimerBody>`. `api.channel.handle('openPreview',
  () => preview.open())`.

### Page start (`page/start.ts`)

`api.layouts.show<PrimerLayout>({ defaultLayout, read: readPrimerLayout, userLayout: () => api.settings().layout,
setLayouts: (shown) => view.setLayouts(shown) })`, with `defaultLayout` imported from `../layouts/default/layout.js`.
`api.layouts.show` refreshes the show on each change of the primer's settings, so a changed `primer.layout` redraws at
once; the page calls no `refresh` for it.

### The preview (`main/preview/`)

- `createPrimerPreview(deps: { sessions: Pick<SessionsMainExports, 'connect' | 'activate'>; primer:
  AgentFormService<…>; log: Log }): { open(): void }`. `start.ts` builds its service with `createAgentFormService({
  type: primerType, presenter: presenter.quiet, store: createMemoryFormStore(clock, randomHex, paths),
  defaultDeadlineSeconds })`, so the sample raises no notification and no badge and writes no file.
- `open()` with no preview open: connect the session `{ sessionId: 'primer-preview', projectDir: 'Primer preview',
  deadlineSeconds: null, harness: null }`, activate its row, and open `PREVIEW_PRIMER_ARGS` in it.
- `open()` with the preview open: activate its row only. The sample keeps its edits (open question 3 in the report;
  recommended answer). Forms cycles saved rounds; the primer design names only the sample.
- A `submitted` or `cancelled` outcome ends the preview's form session and its connected session. A `draft` outcome
  (the deadline passed) waits again with `collect`, as forms' preview does. A rejection logs
  `preview primer failed: <error>` under `primer` and ends the session.
- `PREVIEW_PRIMER_ARGS`: a valid `open_primer` call, feature name `Layout preview`, slug `layout-preview`, a spec and
  summary that say nothing reaches an agent. Its entries hold each need, both agent groups (`primer`, `standing`),
  every card section (question, evidence, probes and pointer, with markdown: a list, inline code, a link), an entry
  with a task name long enough to wrap, and an entry with six items, one long enough to wrap. `SAMPLE_PRIMER_ARGS`
  has no section text, so it cannot show the task card; it stays the self-test's and the drive's fixture. Extra tasks
  and Added items come only from the user (`parsePrimer` takes neither), so the user adds them in the preview with
  `A` and `a`.
- Page: the `openPreview` handler invokes `api.channel.invoke('openPreview')`; a rejection logs
  `layout preview failed: <error>` under `primer` and toasts `Layout preview failed: <error>` as `error`. It acts in
  any view and needs no open primer.

### Keys and docs

- `src/plugins/keymap.ts`: add `{ keys: '<Leader>zlp', scope: 'any', command: 'primer.openPreview', where: 'page' }`
  beside `<Leader>zlo` under Debug and testing; rename the group `'<Leader>zl': 'forms layouts'` to
  `'<Leader>zl': 'layout previews'`.
- `docs/keymap.md` § Leader groups: the `zl` row reads which-key name `layout previews` and binds `zlo` forms preview,
  `zlp` primer preview. Tasks 10 and 15 add theirs to the same row.

## Behaviour

GIVEN `primer.layout` unset WHEN a primer shows THEN every card, the rail body and the review body carry
`data-layout="default"` and look as task 01 left them.
GIVEN a user layout `wide` defining only `cards.task`, and `primer.layout` `wide` WHEN a task row is selected THEN the
task card carries `data-layout="wide"` and the item card, rail and review carry `data-layout="default"`.
GIVEN a user task card that mounts a box and then throws WHEN it draws THEN the default task card shows, the log names
the failure, and each box is mounted once.
GIVEN a user task card that mounts no box WHEN it draws THEN the add-item and comment boxes are appended at the card's
end and Ctrl+n reaches them in `shownBoxes` order.
GIVEN a focused box WHEN the user saves the picked layout's `layout.js` THEN the card redraws and the same box keeps
focus.
GIVEN no preview open WHEN `Space z l p` runs THEN a session `Primer preview` opens holding the sample, its row is
selected, and no notification, badge or saved primer file appears.
GIVEN the preview open WHEN `Space z l p` runs again THEN its row is selected and its edits stay.
GIVEN the preview open WHEN the user sends or cancels it THEN its session closes.

## Tests

`read-primer-layout.test.ts`:
- `readPrimerLayout_InvalidShape_ThrowsNamingTheKey`, an `it.each` table: default export missing; not an object;
  key `head`; `cards.question`; `rail: 1`; `cards.task: 'x'`. Each row asserts the message names the layout and the
  key. Catches a dropped key check, or a check on parts but not on cards.
- `readPrimerLayout_PartialLayout_ReturnsIt`: `{ cards: { item } }` reads back. Catches a reader that demands every
  part.
- `readPrimerLayout_DefaultLayout_Reads`: the built-in default reads with no throw. Catches the default drifting from
  the reader.

`primer-view.test.ts` (one setup through the real `drawPart` and a fake keys and boxes):
- `draws every part with default and marks data-layout`. Catches a part drawn outside the host.
- `draws a part from the user layout when it defines it, the rest from default`. Catches a whole-layout pick in place
  of a per-part pick.
- `falls back to default when a user card throws after mounting a box, mounting each box once`. Catches the rollback
  missing `recordBox` (a second mount throws `already mounted`).
- `appends the boxes a user card leaves out, in shownBoxes order`. Catches a missing box Ctrl+n would throw on.
- `rebuilds the shown card on setLayouts with a new pick and keeps the focused box`. Catches a stale card after a
  reload, and a lost focus.
- `runs the item card's update on a toggle without a rebuild`. Catches `update` lost after a fallback.
- `appends the row prompt at the rail pane's end when the rail never calls railRow for the selected row`, with a user
  `rail` that draws its rows with `kit.row`. Catches need, include and remove anchors that leave the page.
- `disposes a part's anchors before it draws the part again and when the view goes`: a rail redraw and a card rebuild
  each dispose the anchors of the draw before, once each. Catches leaked anchors (stale hints, unplaced-key lines).

`primer-commands.test.ts`: `logs and toasts a failed preview open`. Catches a swallowed rejection.

`primer-preview.test.ts`, mirroring `src/plugins/forms/main/preview/layout-preview.test.ts`:
`open_First_ConnectsActivatesAndOpensSample`, `open_Again_ActivatesOnlyAndOpensNothing`,
`submitOrCancel_EndsSession`, `submit_ThenOpen_ConnectsAgain`, `draftOutcome_WaitsAgainWithCollect`,
`openRejects_LogsAndEndsSession`. Each catches the break its name says: a second session, a second open over the
user's edits, a session left behind, a preview that never reopens, a preview closed at the deadline, a lost error.

`preview-primer.test.ts`: `PREVIEW_PRIMER_ARGS parses, and holds every need, both agent groups and every card section`
(`parsePrimer`; needs contain yes, no, unclear; groups contain primer, standing; some entry has non-blank question,
evidence, probes and pointer). Catches a sample edit that drops what the preview exists to show.

No test asserts copy, CSS or the default layout's markup: those are checked live in task 17.

## Self-test (`src/plugins/primer/main/selftest-script.ts`)

Add a last group `layout preview`, why: "Space z l p opens the sample primer in a session of its own with no agent and
selects its row; cancelling it closes that session." Steps:

1. `' '`, `'z'`, `'l'`, `'p'` → `[sessions] activated Primer preview`, `checksFit`, screenshot `preview`
2. `j` → `[page] j ran primer.nextRow`
3. `<A-l>` → `[page] <A-l> ran primer.focusCard`, `checksFit`, screenshot `preview-task-card`
4. `' '`, `' '` → `[primer] review opened`, screenshot `preview-review`
5. `C` → `[page] C ran primer.askCancel`
6. `y` → `[primer] cancelled`

Step 1's expected label assumes the sessions plugin logs the row by `projectDir`'s basename, as forms' `Layout preview`
does. The group runs after `review and cancel`, so the `<D-w>` step there still activates forms' `Layout preview`.

Done when: `npm run lint` (layers and styles) and `npm test` pass; `npm run selftest` passes with the new group and the
existing primer groups unchanged, with no `[keys] unplaced` line; the screenshots `primer-preview.png`,
`primer-preview-task-card.png` and `primer-preview-review.png` exist. A user layout's live reload and the preview's
look are checked in task 17 (Final verification).
Commit:    one commit for the group: "Primer draws through its layout, with a sample primer under Space z l p"

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
