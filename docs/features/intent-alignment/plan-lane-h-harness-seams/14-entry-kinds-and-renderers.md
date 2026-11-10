# 14 — Open chat entry kinds and entry renderers

Status: not started
Type: Task
Wave: 11 · Depends on: 13
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/agent.ts`
- modify `src/plugins/chat/layouts/layout.d.ts` · test `src/plugins/chat/layouts/default/layout.test.ts` (compiles
  against the widened types; no new test)
- modify `src/plugins/chat/contract.ts`
- create `src/plugins/chat/page/entry-renderers.ts` · create test `src/plugins/chat/page/entry-renderers.test.ts`
- modify `src/plugins/chat/page/chat-layouts.ts` · test `src/plugins/chat/page/chat-layouts.test.ts`
- modify `src/plugins/chat/page/entry-list.ts` · test `src/plugins/chat/page/entry-list.test.ts`
- modify `src/plugins/chat/page/read-chat-layout.ts` · test `src/plugins/chat/page/read-chat-layout.test.ts`
- modify `src/plugins/chat/page/chat-view.ts` · test `src/plugins/chat/page/chat-view.test.ts`
- modify `src/plugins/chat/page/start.ts`
- test `src/plugins/chat/page/activity-runs.test.ts` (a row; `activity-runs.ts` needs no change)
- modify `src/plugins/chat/main/preview/preview-session.ts` · test `src/plugins/chat/main/preview/chat-preview.test.ts`
- modify `AGENTS.md` (§ Architecture, "A chat layout") · modify `docs/features/layouts/design.md` (§ What a layout
  draws)
- modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md`

Consumes:
- `ChatEntry`, `ChatEntryKind = ChatEntry['kind']` in `src/contracts/agent.ts` (tree today)
- `drawPart`, `PartPick<L>` in `src/shared/page/layout-host/draw-part.ts`; `pickLayout` in
  `src/shared/page/layout-host/pick.ts`; `requireLayoutParts` in
  `src/shared/page/layout-host/read-layout-module.ts` (tree today)
- `Registrations.track` in `src/contracts/disposable.ts` (tree today)

Produces:
- ``export type HarnessEntryKind = `${string}:${string}`;`` in `src/contracts/agent.ts`
- `| { kind: HarnessEntryKind; id: string; at: number; raw: unknown[] }` as the last member of `ChatEntry` in
  `src/contracts/agent.ts`
- ``export type HarnessEntryKind = `${string}:${string}`;`` in `src/plugins/chat/layouts/layout.d.ts`
- `export interface HarnessEntryInput` in `src/plugins/chat/layouts/layout.d.ts`
- `export type AnyEntryKind = EntryKind | HarnessEntryKind;` in `src/plugins/chat/layouts/layout.d.ts`
- `export interface ChatEntryRenderer<K extends AnyEntryKind = AnyEntryKind>` in `src/plugins/chat/contract.ts`
- `addEntryRenderer<K extends AnyEntryKind>(renderer: ChatEntryRenderer<K>): Disposable;` on `ChatPageExports` in
  `src/plugins/chat/contract.ts`
- `export function createEntryRenderers(log: PluginLog): EntryRenderers` in `src/plugins/chat/page/entry-renderers.ts`
- `export const ENTRY_RENDERER_NAME = 'entry renderer';` in `src/plugins/chat/page/entry-renderers.ts`

Decisions:
- A harness-specific kind is named `<harness id>:<kind>`, a template-literal type, so it never equals a known kind.
  It carries only `id`, `at` and `raw`; a renderer decodes `raw`. Source: plan.md Decisions, File Structure.
- The `ChatEntry` union still narrows on each known kind. A known literal such as `'tool'` holds no `:`, so it is not
  assignable to `` `${string}:${string}` ``, and `entry.kind === 'tool'` removes the harness member. TypeScript has
  narrowed on template-literal discriminants since 4.5; the repo pins `typescript` `^6.0.3`. `npm run typecheck`
  passing with no cast added at any existing `entry.kind` comparison proves it. (drafter, checked against the tree.)
- `layout.d.ts` declares its own `HarnessEntryKind`. The app writes `layout.d.ts` beside `kit.d.ts` into the user's
  layouts folder (`docs/features/layouts/design.md` § Folder and settings), so it cannot import
  `src/contracts/agent.ts`. A compile-time check in `read-chat-layout.ts` keeps the two equal. (drafter.)
- The layout contract opens additively. `EntryKind` stays the nine known kinds, and `EntryInputs`,
  `CompleteChatLayout.entries` and every known builder stay typed as today. Source: dispatch, plan.md.
- The draw order for an entry: the user's layout when it names the entry's kind; else the plugin renderers, the latest
  registration first, the first whose `kind` equals the entry's kind and whose `match`, when given, returns true;
  else `default`. Source: plan.md Decisions.
- `default` draws a harness kind with its `raw` builder. The user layout's `raw` builder does not draw a harness kind:
  in the plan's order, a user layout draws only the kinds it names. Source: plan.md Decisions, followups item ("drawn
  by the `raw` builder unless a layout names them").
- What `default`'s `raw` builder receives for a harness kind (lead): the `HarnessEntryInput` itself, its own
  `kind` kept, with `RawInput.kind` widened to `'raw' | HarnessEntryKind` and its comment saying so; a live default's
  `raw` builder can then show the kind.
- A harness kind joins no activity run: `isStep` stays `tool | thinking | raw`. Such an entry is its own row, a cursor
  row, and shows in the transcript whatever `activityInTranscript` says. Source: plan.md Decisions.
- A renderer's `build` has a layout entry builder's signature, `EntryBuilder<K>`: `(parent, input, kit)` with the
  chat kit. `match` reads the same `EntryInput<K>`. Source: dispatch.
- `addEntryRenderer` takes no id: two renderers for one kind may coexist, the later first. Source: plan.md File
  Structure (`{ kind, match?, build }`).
- A renderer is drawn through `drawPart` as a one-kind layout named `entry renderer` (`ENTRY_RENDERER_NAME`). Each
  renderer gets that layout object once, at `add`, so `drawPart`'s log-once per layout object holds per renderer.
  (drafter: reuses the page host's rollback and fallback.)
- A renderer whose `build` throws, or whose view's `update` throws, draws with `default`, as a user layout's builder
  does. `drawPart` logs `` `layout entry renderer ${kind} entry failed: ${error}` ``; an update failure logs
  `` `layout entry renderer ${kind} entry update failed: ${error}` ``. The entry toasts once per kind:
  `` `Chat entry renderer: ${kind} entries drawn with default` ``. (drafter: the user layout's pattern in
  `drawEntry` and `redrawSlot`.)
- A `match` that throws counts as false, and the registry logs `` `entry renderer ${kind} match failed: ${error}` ``.
  (drafter: as `addCompletionRow` counts a throwing draw as false.)
- A renderer added or disposed redraws every Chat tab's entries and clears the toasted kinds, as a layout change does
  for entries. Composers and side parts are not redrawn. (drafter: `layouts.onChange` in `mountChatView`.)
- The source is picked at each draw. A drawn view's `update` runs with each later version of the entry while it shows;
  a view with no `update` draws again, and that draw picks again. (drafter: today's slot rule.)
- The chat preview gains one entry of a harness kind, so `Space z l c` shows how `default` draws one:
  `{ kind: 'preview:sample', id: 'preview-harness', at: previewAt(13) + PREVIEW_ENTRY_STEP_MS / 2, raw: [{ preview:
  'harness kind' }] }` (`1767225627000`), placed after the `compaction` entry `preview-14` (`previewAt(13)`, `…626000`)
  and before the assistant entry `preview-15` (`previewAt(14)`, `…628000`), so the three `at` values are strictly
  ordered. Nothing sorts entries by `at` (the list keeps put order; `at` feeds only `activity-runs.ts` run times and
  `working-turn.ts` turn times, and a harness kind is no step), so a tie would have drawn the same; the half step
  keeps the preview's times distinct. The other preview ids and times do not change. (drafter, checked against
  `activity-runs.ts`, `working-turn.ts` and `preview-session.ts`.)

Every `entry.kind` site and what it does for a harness kind (measured at plan time, re-verify):

| Site | For a harness kind |
|---|---|
| `chat/page/activity-runs.ts` `isStep`, `StepEntry` | not a step: its own row |
| `chat/page/activity-runs.ts` `isCursorRow` | a cursor row |
| `chat/page/working-turn.ts` (lines 69–151: last user, last result, waiting permission, tool, streaming assistant, dock steps) | matches none; not in the dock's steps; not counted by `resultStepCount` |
| `chat/page/entry-list.ts` `isInTranscript` | always in the transcript |
| `chat/page/entry-list.ts` `entryInput` | the entry itself, as a `HarnessEntryInput` |
| `chat/page/entry-list.ts` `isDeliveryChanged`, `isMessage`, `stopText`, the two `kind === 'user'` sites | false or null: no delivery, not a message, no copy text |
| `chat/page/entry-list.ts` `buildEntry`, `drawEntry`, `redrawSlot`, `toastKindOnce` | the draw order above |
| `chat/page/chat-layouts.ts` `pickEntry` | `kind` widens to `ChatEntryKind`; a user layout names a harness kind under its own key |
| `chat/page/read-chat-layout.ts` `KIND_SET` and the compile-time checks | a key holding `:` is accepted under `entries` |
| `chat/page/chat-commands.ts` 157, 291, 355, 718, 724 (permission, user images) | matches none |
| `chat/page/chat-commands.ts` 749 focus log | logs `focused <kind> entry`, the harness kind in it |
| `chat/page/chat-kit.ts` 102, 110, 124 (`permissionActions`, `images`, update) | `permissionActions` and `images` throw as for any other kind |
| `chat/page/chat-state.ts` 33 (waiting permission) | matches none |
| `chat/page/chat-view.ts` `toastedKinds` | holds harness kinds too |
| `chat/main/chat-sessions.ts` 1715 (Bash calls' worktrees) | skipped |
| `chat/main/chat-sessions.ts` 2140 (older-host notice filter) | kept |
| `chat/main/chat-sessions.ts` `rowEntryOf`, `chat/main/chat-slots.ts` `putEntry` | stored and sent as any entry |
| `chat/main/preview/preview-session.ts` | gains the `preview:sample` entry |
| `chat/main/preview/chat-preview.ts` 108 | builds a notice; unchanged |
| `session-log`, `auto-retro`, `agents` | read no `ChatEntry` kind: session-log reads its event log, auto-retro switches on its own queue events (`retro-queue.ts` `nextQueue`), agents folds `chat.agentEvent` events |
| the claude-code adapter (`stream-decoder.ts`, `session-fold.ts`, `transcripts.ts`) | builds no harness kind today; unchanged |

Mandatory: AGENTS.md § A chat layout, § A composer part, § A side part, § An agent harness;
`docs/features/layouts/design.md` whole; `docs/features/agent-chat/design.md` § Activity line; `DESIGN.md`.

GIVEN a `fake:card` entry and no renderer WHEN the list draws it under `default` THEN `default`'s `raw` builder draws
it, with no log and no toast.
GIVEN a renderer for `fake:card` WHEN the list draws a `fake:card` entry THEN the renderer draws it, its root marked
`data-layout="entry renderer"`.
GIVEN a user layout naming `fake:card` and a renderer for it WHEN the list draws the entry THEN the user layout draws
it.
GIVEN two renderers for `notice`, the later with a `match` true only for tone `error` WHEN the list draws an `info`
and an `error` notice THEN the earlier draws the `info` one and the later the `error` one.
GIVEN a renderer whose `build` throws WHEN the list draws its kind THEN `default` draws the entry, the log reads
`layout entry renderer fake:card entry failed: boom`, and one toast reads
`Chat entry renderer: fake:card entries drawn with default`.
GIVEN a drawn tab WHEN a renderer is added and then disposed THEN the tab's entries redraw each time.
GIVEN a `fake:card` entry between two tool calls WHEN the rows are listed THEN the tools form two runs and the entry
its own row.
GIVEN a user layout whose `entries` holds `fake:card` WHEN the layout is read THEN it is accepted; a key `card` is
refused as no layout part.

Tests:
- create `entry-renderers.test.ts`:
  - `pick_Renderers_LatestMatchingFirst`: a table over `pick(input)`, asserting the picked renderer by a label on its
    `build`, or null. Rows: none added → null; one `fake:card` renderer, input kind `fake:card` → it; two `fake:card`
    renderers → the later; the later with `match: () => false` → the earlier; the later's `match` throws `boom` → the
    earlier, and the log `['entry renderer fake:card match failed: boom']`; one `fake:card` renderer, input kind
    `fake:other` → null; the only renderer disposed → null.
  - `pick_Renderer_LayoutNamedEntryRenderer`: the pick's `name` is `entry renderer`, and two picks of one renderer
    return the same `layout` object.
  - `onChanged_AddAndDispose_TellsEachOnce`: one listener hears 2 calls for one add and one dispose; a second
    `dispose` on the same handle adds none.
- `entry-list.test.ts` › `buildEntry: $name`: `Row` gains `renderers?: ChatEntryRenderer[]`, added to the list's
  registry before the puts, and a helper `harness(kind, id)` making `{ kind, id, at: 1000, raw: [] }`. New rows:
  - `harness kind under default draws with raw`: shown `default`, puts `[harness('fake:card', 'h1')]`, slots
    `[['chat-entry chat-raw@default']]`, no logs, no toasts.
  - `renderer draws a harness kind`: shown `default`, a renderer `{ kind: 'fake:card', build }` whose build appends
    `div.plugin`, slots `[['plugin@entry renderer']]`.
  - `user layout names the kind over a renderer`: shown `fancy` with `fancy: { 'fake:card': <a builder appending
    div.fancy> }` , the same renderer, slots `[['fancy@fancy']]`. `fancyLayout` builds
    its entries from `KINDS` alone today; it also copies each override key that holds `:`.
  - `renderer matches one notice`: shown `default`, a renderer `{ kind: 'notice', match: (input) => input.tone ===
    'error', build }` appending `div.plugin`, puts an `info` notice then an `error` notice, slots
    `[['chat-entry chat-notice chat-notice-info@default'], ['plugin@entry renderer']]`.
  - `renderer throws`: shown `default`, a `fake:card` renderer whose build throws `boom`, puts two `fake:card`
    entries, slots `[['chat-entry chat-raw@default'], ['chat-entry chat-raw@default']]`, logs
    `['layout entry renderer fake:card entry failed: boom']`, toasts
    `['Chat entry renderer: fake:card entries drawn with default']`.
  The `fancyLayout` helper's override type widens to `Partial<Record<AnyEntryKind, AnyBuilder | undefined>>`.
- `activity-runs.test.ts` › `listRows of $given → $expected`: add a row `a harness entry between two tools while
  working`, its list built directly (the spec parser splits on `:`): tool `t1`, `{ kind: 'fake:card', id: 'h',
  at: 1000, raw: [] }`, tool `t2`; expected `['run:activity:t1:false', 'entry:h', 'run:activity:t2:true']`.
- `read-chat-layout.test.ts`: add `{ layout: { entries: { 'fake:card': builder } } }` to the accepted rows; add
  `{ layout: { entries: { 'fake:card': 'card' } }, error: 'entries.fake:card is not a function' }` and
  `{ layout: { entries: { card: builder } }, error: 'entries.card is not a layout part' }` to the refused rows.
- `chat-layouts.test.ts`: add `pickEntry_HarnessKindTheUserNames_PicksTheUserLayout`: a user layout whose entries
  hold `fake:card` → the pick names the user layout; a user layout without it → `default`.
- `chat-view.test.ts`: add `renderers_AddAndDispose_RedrawsEveryTabsEntries`: a mounted tab holding one `fake:card`
  entry; after `add` of a `fake:card` renderer appending `div.plugin` the entry's slot holds `div.plugin`; after
  `dispose` it holds `div.chat-entry.chat-raw` again.
- `chat-preview.test.ts` › `open_FirstPress_OpensSelectedRowWithEveryKindAndControl`: the expected kind set gains
  `'preview:sample'`.
- Self-test: none. No built-in plugin registers a renderer, and the self-test drives keys, not page exports. The
  preview's harness-kind entry shows in the existing `layout preview` group's `chat-preview` screenshot; its look is a
  live check in task 17.

Approach:
- `src/contracts/agent.ts`: the new `ChatEntry` member's comment reads: a kind a harness adds, named
  `<harness id>:<kind>`; it carries only `raw`, which a renderer the harness's plugin adds decodes; `default` draws it
  with its `raw` builder.
- `layout.d.ts`:
  - ``export type HarnessEntryKind = `${string}:${string}`;``
  - `export interface HarnessEntryInput { kind: HarnessEntryKind; id: string; at: number; raw: unknown[] }`
  - `export type AnyEntryKind = EntryKind | HarnessEntryKind;`
  - `export type EntryInput<K extends AnyEntryKind> = K extends EntryKind ? EntryInputs[K] : HarnessEntryInput;`
  - `EntryView<K extends AnyEntryKind = EntryKind>` and `EntryBuilder<K extends AnyEntryKind>` widen their bound.
  - `ChatLayout.entries?: { [K in EntryKind]?: EntryBuilder<K> } & { [kind: HarnessEntryKind]:
    EntryBuilder<HarnessEntryKind> | undefined };` with its comment saying a user layout may name a harness kind.
  - `RawInput.kind: 'raw' | HarnessEntryKind` (the Decision above), its comment: `default`'s `raw` builder
    also draws an entry of a harness kind no layout or renderer names; `kind` is then that kind.
  - `CompleteChatLayout.entries` stays `{ [K in EntryKind]: EntryBuilder<K> }`.
- `contract.ts`:
  `export interface ChatEntryRenderer<K extends AnyEntryKind = AnyEntryKind> { kind: K; match?(input:
  EntryInput<K>): boolean; build: EntryBuilder<K> }`, imported types from `./layouts/layout` (as
  `src/plugins/workflow/contract.ts` imports its layout types). The `ChatPageExports` comment gains: `addEntryRenderer`
  adds a renderer for entries of `kind` until its `dispose`; an entry draws with the user's layout when it names the
  kind, else with the latest-added renderer whose `kind` matches and whose `match` passes, else with `default`;
  adding or disposing one redraws every Chat tab's entries.
- `entry-renderers.ts`: `export interface EntryRenderers { add(renderer: ChatEntryRenderer): Disposable;
  pick(input: EntryInput<AnyEntryKind>): PartPick<ChatLayout> | null; onChanged(listener: () => void): Disposable }`.
  `pick` walks the renderers latest first. Each held renderer keeps the layout `{ entries: { [renderer.kind]:
  renderer.build } }` made at `add`, returned as `{ name: ENTRY_RENDERER_NAME, layout }`.
- `chat-layouts.ts`: `pickEntry(shown, kind: ChatEntryKind)` keeps its rule. Add `pickEntryDraw(shown, renderers,
  input): { pick: PartPick<ChatLayout>; builderKind: AnyEntryKind }`:
  1. `pickEntry(shown, input.kind)` names a layout other than `default` → that pick, `builderKind` the entry's kind;
  2. else `renderers.pick(input)` → that pick, `builderKind` the entry's kind;
  3. else `DEFAULT_ENTRY_PICK`, `builderKind` `'raw'` for a harness kind (`input.kind` holds `:`), else the kind.
- `entry-list.ts` `buildEntry`: picks with `pickEntryDraw` unless `drawsWithDefault`. Its `part` reads
  `layout.entries?.[builderKind]`, and on `defaultLayout` reads `entries.raw` for a harness kind. `drawEntry`'s
  fallback toast uses `` `Chat entry renderer: ${kind} entries drawn with default` `` when the pick was a renderer's,
  and today's text otherwise. The slot keeps the name of the pick it drew with, and `redrawSlot`'s update-failure log
  uses it in place of a fresh `pickEntry`. `EntryListDeps` gains `renderers: Pick<EntryRenderers, 'pick'>`.
- Over a harness kind the layout types and the entry list's helpers become (checked against `layout.d.ts`,
  `read-chat-layout.ts`, `entry-list.ts` and `chat-kit.ts`):
  - `VARIANTS_FIT_INPUTS` (`read-chat-layout.ts`) maps over `EntryKind` only. `VariantFitsInput` becomes `{ [K in
    EntryKind]: Extract<ChatEntry, { kind: K }> & InputAddition<K> extends EntryInput<K> ? true : never }` and
    `InputAddition<K extends EntryKind>`. A mapped type over `ChatEntryKind` would meet the template-literal member and
    become an index signature that `{ ...KIND_SET }` cannot fill. One more check covers the harness member, in the
    same form: `const HARNESS_VARIANT_FITS_INPUT: Extract<ChatEntry, { kind: HarnessEntryKind }> extends
    HarnessEntryInput ? true : never = true;`, added to the file's `void [...]` list.
  - `EntryView<K extends AnyEntryKind = EntryKind>` (`layout.d.ts`): the default stays `EntryKind`, so a user layout's
    `EntryView` and `EntryView<'tool'>` mean what they do today; `update(input: EntryInput<K>)` takes the harness
    input for a harness kind.
  - `AnyBuilder` (`entry-list.ts`) becomes `EntryBuilder<AnyEntryKind>`. `BuiltEntry.view`, `DrawnEntry.view` and
    `Slot.view` become `EntryView<AnyEntryKind>`, and every `EntryInput<EntryKind>` in the file (lines 287, 1128, 1153,
    1154, 1450, 1473, 1523 and 1553 at plan time) becomes `EntryInput<AnyEntryKind>`. The cast `as AnyBuilder |
    undefined` in `buildEntry` stays: it already stands there, and a known kind's builder does not fit the wider
    parameter without it.
  - `EntryKit` and `createEntryKit(entry: ChatEntry, deps)` (`chat-kit.ts`) keep their signatures: they take a
    `ChatEntry`, which now holds the harness member, and `ChatKit` has no entry-kind parameter. `chat-kit.ts` needs no
    edit.
- `read-chat-layout.ts`: `KIND_SET` becomes `Record<EntryKind, true>`. `readChatLayout` passes `requireLayoutParts`
  the known kinds plus every key of `entries` that holds `:`. The compile-time checks compare `ChatEntryKind` with
  `AnyEntryKind` both ways. Two more checks join them, in the file's existing `? true : never = true` form, with the
  layout's type imported as `LayoutHarnessEntryKind`: the contract's `HarnessEntryKind` and
  `LayoutHarnessEntryKind` extend each other (one check each way), and `[EntryKind & HarnessEntryKind] extends
  [never]` (`KNOWN_KINDS_ARE_NOT_HARNESS_KINDS`).
- `chat-view.ts`: `ChatViewDeps` gains `renderers: Pick<EntryRenderers, 'pick' | 'onChanged'>`, passed to each
  entry list. `mountChatView` subscribes `deps.renderers.onChanged`: clear `toastedKinds`, then
  `tab.entries.rebuild(tab.state.entries)` for every tab.
- `page/start.ts`: `const entryRenderers = createEntryRenderers(services.log);`, passed into the view's deps; the
  exports gain `addEntryRenderer: (renderer) => consumer.track(entryRenderers.add(renderer))`.

Docs (land in this commit, beside the code):
- AGENTS.md § Architecture, "A chat layout": after the sentence ending `or a bare line when `default` throws too.`,
  add: `An entry of a harness kind (`<harness id>:<kind>`) carries only `raw`. A plugin draws entries of any kind,
  known or a harness's, through the `chat` page export `addEntryRenderer({ kind, match?, build })`, whose `build`
  takes an entry builder's arguments. An entry draws with the user's layout when it names the kind; else with the
  plugin renderers, the latest added first, the first whose `kind` matches and whose `match` passes when given; else
  with `default`, whose `raw` builder draws a harness kind. A harness kind joins no activity run.`
- `docs/features/layouts/design.md` § What a layout draws: add a last paragraph: `Chat's entries take one source
  between a user layout and `default`: the renderers plugins add through chat's `addEntryRenderer`. An entry draws
  with the user's layout when it names the entry's kind, else with the latest-added renderer whose `kind` matches and
  whose `match` passes, else with `default`, which draws a harness kind (`<harness id>:<kind>`) with its `raw`
  builder. A renderer that throws draws with `default`, as a user layout's builder does.`

Done when: `npm run lint` and `npm run typecheck` pass with no cast added at an existing `entry.kind` comparison; the
test gate runs the test files above.

Commit: one commit, the code and both doc paragraphs. It removes the "Open chat entry kinds and entry renderers" item
from `docs/features/followups.md` § Harness seams and ticks `[ ] Open chat entry kinds and entry renderers` to
`[x] Open chat entry kinds and entry renderers` in `docs/features/intent-alignment/master-plan.md` (the chat-pass
line, line 134 at plan time).

## Proof
