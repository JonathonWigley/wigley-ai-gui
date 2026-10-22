# 06 — Chat tab: transcript, tool and permission cards, floating composer, layout kit

Status: done
Type: Batch
Wave: 2 · Depends on: 02 (the list picker's layer), 03 (the session's sheet)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/entry-list.ts` ·
           modify `src/plugins/chat/page/entry-focus.ts` · test `src/plugins/chat/page/entry-focus.test.ts` ·
           modify `src/plugins/chat/page/chat-kit.ts` · modify `src/plugins/chat/page/chat-dialogs.ts` ·
           modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/page/chat.css` ·
           create `src/plugins/chat/page/key-hint.ts` · create `src/plugins/chat/page/control-commands.ts` ·
           test `src/plugins/chat/page/control-commands.test.ts` ·
           modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` ·
           test `src/plugins/chat/layouts/default/layout.test.ts` · modify `src/plugins/chat/page/picker.ts`
           (its `createListPicker` call's two class options only)
Consumes:  `floatingPanel(): HTMLElement`, `card(edge?: CardEdge | null): HTMLElement`,
           `createCollapsibleCard(options: CollapsibleCardOptions): CollapsibleCard`, `createDialog(title: string): Dialog`,
           `sectionHeader(text: string, trailing?: HTMLElement | null): HTMLElement` ← plan B 05 (after plan B) ·
           `kbd(keys: string, platform: Platform): HTMLElement`, `textButton(label, onClick, options?: TextButtonOptions): HTMLButtonElement`,
           `chip(label: string, value: string, onClick: (() => void) | null): HTMLElement`, `statusDot(status: DotStatus): HTMLElement`,
           `setDotStatus(dot: HTMLElement, status: DotStatus): void`, `inputFrame(): HTMLElement` ← plan B 04 (after plan B) ·
           `PageApi.platform: Platform` (`src/contracts/plugin.ts`), `Platform` (`src/contracts/platform.ts`) ← plan A (after plan A) ·
           `KeysPageExports.keysFor(command: CommandId, scope?: ViewScope): string | null` ← tree ·
           `PageApi.commands.run(id: CommandId, context?: PageCommandContext): void` ← tree ·
           the session's L2 sheet: `div.session-bodies` is `sheet()`, and each session tab's element fills
           its `div.session-body` — Form, Chat and Docs tabs build no sheet of their own ← 03 ·
           `createListPicker(deps: ListPickerDeps): ListPicker` in `src/shared/page/list-picker.ts`, signature and
           `ListPickerDeps` / `ListPicker` / `ListPickerRequest` members unchanged ← 02 ·
           `node scripts/check-styles.mts --no-legacy`: checks every file, ignoring LEGACY_FILES ← plan B task 03 ·
           the self-test's fit check treating the primitives' ellipsis parts (`.ui-row-label`, `.ui-row-detail`,
           `.ui-tab-label`, `.ui-collapsible-summary`) as allowed to clip ← plan B task 02 ·
           `src/shared/page/ui` in every plugin page layer in `scripts/check-layers.mts` ← plan B task 06
Produces:  `export function focusFirst(ids: readonly string[]): EntryFocus` in `src/plugins/chat/page/entry-focus.ts` ·
           `EntryList.first(): ChatEntry | null` and `EntryList.followBottom(): void` in `src/plugins/chat/page/entry-list.ts` ·
           `ChatSession.entries: Pick<EntryList, 'move' | 'latest' | 'first' | 'toggleFocused'>`,
           `ChatViewDeps.run(command: CommandId): void`, `ChatViewDeps.platform: Platform` in `src/plugins/chat/page/chat-view.ts` ·
           `export const CONTROL_IDS = { pickMode: 'mode', pickEffort: 'effort', pickModel: 'model' } as const` and
           `export function controlCommand(controlId: string): ChatCommandName` in `src/plugins/chat/page/control-commands.ts` ·
           `export function keyHint(keys: Pick<KeysPageExports, 'keysFor'>, platform: Platform, command: ChatCommandName, scope: ChatScopeName): HTMLElement | null`
           in `src/plugins/chat/page/key-hint.ts` ·
           `KitDeps.platform: Platform` in `chat-kit.ts` · `DialogDeps.platform: Platform` in `chat-dialogs.ts` ·
           the kit contract in `src/plugins/chat/layouts/layout.d.ts` (see **Layout kit**)
Decisions: see **Decisions** below
GIVEN entries a, b, c WHEN `focusFirst` THEN a is focused and not following
GIVEN one entry WHEN `focusFirst` THEN it is focused and following (it is also the last)
GIVEN no entries WHEN `focusFirst` THEN `START_FOCUS`
GIVEN a control id `mode` / `effort` / `model` WHEN `controlCommand` THEN `pickMode` / `pickEffort` / `pickModel`; any other id THEN `pickControl`
GIVEN a tool entry WHEN the default layout builds it THEN a closed mono collapsible card with a running dot; its result arriving sets the dot and never opens or closes the card
GIVEN an unanswered permission WHEN built THEN a card with the attention edge; answered THEN a card with no edge, and the view has no `update`
Tests:     see **Tests** below
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass, the tests below among them;
           `node scripts/check-styles.mts --no-legacy` prints no line naming `src/plugins/chat/` (other
           tasks' files may still fail it); `npm run selftest` passes; no `appendKeys`, `button(` from `dom.ts`,
           `buildExpander`, `chat-controls`, `chat-expander` or `is-focused` remains under `src/plugins/chat/`;
           this task's live checks are in [12 — Final verification](12-final-verification.md)
Commit:    one commit for the group

## Decisions

- **Layers** (design.md § Surfaces): the transcript is L2 on the session's sheet; the composer is L3
  (`floatingPanel()`), the only glass in the tab.
- **The sheet is the session's** (lead ruling, plan.md): `div.chat-tab` fills task 03's
  `div.session-body` on the session's one L2 sheet (`height: 100%`) and builds no sheet of its own.
- **User turn**: `kit.card()` (no edge) holding the markdown, inside the entry root; not a bubble,
  full width (DESIGN.md § Surfaces).
- **Assistant prose**: markdown on the sheet. Every `.md` in the transcript (user turns included)
  takes `text-14`, `leading-prose` and `max-width: var(--wg-prose-measure)`.
- **Tool card**: `kit.collapsibleCard({ summary: toolLine(input), mono: true, leading: dot, body })`,
  where `dot = kit.statusDot(toolStatus(input))`: `running` while `result` is null, `error` when
  `result.isError`, else `success`. No duration (the harness reports duration per turn result only).
- **Collapsed once done** (drafter): every tool card is built closed, running or done, and the
  result arriving only sets the dot (`kit.setDotStatus`) and refills the body; it never opens or
  closes the card. The harness sends no output while a tool runs, so an open running card would show
  only its input, and opening then closing every quick tool would jump the transcript. A card the
  user opened stays open. Enter (`toggleEntry`) still toggles it through the kit's expanders.
- **Thinking and raw events**: `kit.expander(...)`, which is now a collapsible card in the UI font
  with no leading part.
- **Permission card** (drafter): the view is built with `kit.card(input.answer === null ? 'attention' : null)`
  holding `div.chat-permission-head` (`Allow ${toolName}?`), `kit.json(input.input)` and
  `kit.permissionActions()`, and returns **no** `update`, so the answer rebuilds the entry and the
  attention edge goes (peach means "needs you"). No layout code toggles a primitive's class.
- **Permission copy** (interview; pinned): buttons **Allow once** (`textButton`, `primary`: the
  recommended choice carries the accent, and `y` accepts it) and **Deny** (`secondary`), each with
  `keyHint(... 'allowPermission' / 'denyPermission', 'chat')`. Answered: `Allowed once`, `Denied`,
  `Denied: <reason>`. "Allow once" is the true meaning: `permission-tool.ts` answers an allow with
  `{ behavior: 'allow', updatedInput }` and no permission update (checked in the tree). No
  "Always allow".
- **Composer** (interview): `floatingPanel()` with class `chat-composer`, absolutely placed in
  `div.chat-tab` (`position: relative`) at `left`, `right` and `bottom` `var(--wg-space-3)`,
  `border-radius: var(--wg-radius-xl)`, `max-height: 50%`, a flex column with `gap: var(--wg-space-2)`
  and `padding: var(--wg-space-2)`. It holds, in order: `inputFrame()` with class `chat-box` (the
  editor's parent; `min-height: 0`, `overflow-y: auto`), then `div.chat-composer-bar` (flex,
  `align-items: center`, `flex-wrap: wrap`, `gap: var(--wg-space-2)`): `span.chat-box-mode` (today's
  `modeLabel`, `text-11`, `weight-semibold`, `fg-secondary`), one `chip()` per declared control, and
  the send button last (`margin-left: auto`).
- **Transcript clears the composer** (drafter): a `ResizeObserver` on the composer writes its border-box
  height, rounded, as the unitless `--chat-composer-height` on `div.chat-tab`'s inline style (the
  plan B split pattern; no raw length in an inline style). `.chat-entries` takes
  `padding-bottom` and `scroll-padding-bottom` of `calc(var(--chat-composer-height, 0) * 1px + var(--wg-space-3) * 2)`,
  so the last entry stops one inset above the composer and `scrollIntoView` keeps a focused entry
  clear of it. After each write the observer calls `entries.followBottom()`, so a following list
  stays on its last entry as the composer grows.
- **Chips** (drafter): `chip(control.label, valueLabel(control), onClick)`, `onClick` running
  `deps.run(chatCommand(controlCommand(control.id)))`, so a chip opens the same picker as its key;
  a control with no key of its own opens the Controls list. One table, `CONTROL_IDS` in
  `control-commands.ts`, holds the command ↔ control pairing (07 moves `chat-commands.ts` onto it).
  Once the session has ended every chip and the send button are `disabled`; the `sessionEnded`
  handler redraws the bar.
- **Send** (drafter): `textButton('Send', () => deps.run(chatCommand('send')), { variant: 'ghost', hint: keyHint(keys, platform, 'send', 'chat') })`
  — ghost, the quieter choice (DESIGN.md § Intent); the hint shows `<D-Enter>` as the platform
  prints it.
- **Hints are read at each draw** (drafter): the composer bar rebuilds its chips and send button on
  every draw (focus, blur, mode, controls, end), permission actions on every draw, and each dialog
  rebuilds its action buttons on every `open`, so a rebind reaches them without a keymap listener.
- **Entry cursor**: the focused slot carries `is-cursor` (was `is-focused`), drawn as the one focus
  ring: `box-shadow: inset 0 0 0 1px var(--wg-focus-border)`, `border-radius: var(--wg-radius-md)`,
  no fill.
- **`gg` support** (plan.md, keys in 07): `focusFirst` and `EntryList.first()` land here because 07
  owns no file under `page/` but `chat-commands.ts`. `first()` focuses the first entry, scrolls the
  list to its top (`list.scrollTop = 0`) and returns the focused entry (null with none).
- **Dialogs** onto `createDialog` (plan.md): the reason box is `createDialog('Deny')`, `setTitle(`Deny ${toolName}?`)`
  on open, body `p.chat-dialog-text` (`Optional: tell Claude why. It reads your reason.`) and an
  `inputFrame()` with class `chat-reason-box` holding the editor; actions **Back** (`secondary`, hint
  `cancelReason` in `reason`) then **Deny** (`danger`, hint `submitReason` in `reason`): the safe action first,
  the danger action last (plan.md). The
  confirmation is `createDialog('End this session?')`, body `p.chat-dialog-text` (`Claude is still
  working. Ending the session stops it.`), actions **Keep it running** (`secondary`, `keepSession` in
  `confirm`) then **End the session** (`danger`, `endSession` in `confirm`). Copy unchanged from
  the tree. Each `dialog.element` is contributed to the overlay once; `show` / `hide` replace
  `overlay.hidden`; scopes, logs and close rules stay as they are. `role="alertdialog"` goes:
  `createDialog` sets `role="dialog"` (drafter).
- **Pickers and the start prompt** are 02's list picker, whose `ListPickerDeps` is unchanged: in
  `picker.ts` the `createListPicker` call's `overlayClass: 'overlay'` and `dialogClass: 'chat-picker'`
  become `overlayClass: ''` and `dialogClass: ''` (02's layer and panel size themselves), and
  `chat.css` deletes the `.chat-picker` and `.chat-reason` width rules. Nothing else in `picker.ts`
  changes.
  `start.ts` drops `import '../../../shared/page/dialog.css'`; chat no longer uses its classes.
- **Code blocks in tool bodies**: `.chat-json` and `.chat-tool-result` keep their class names (the
  self-test's `SCROLLS_ITSELF` names them), `background: var(--wg-block-background)`, no border,
  `border-radius: var(--wg-radius-md)`, `font-family: var(--wg-font-mono)`, `font-size: var(--wg-text-12)`,
  `padding: var(--wg-space-2) var(--wg-space-3)`, `max-height: calc(var(--wg-space-8) * 12)` (drafter:
  today's 24rem on a token; a `chat.block-max-height` plugin token would need the manifest, 07's).
- **Tool body sections**: `kit.sectionHeader('Input' | 'Result' | 'Error')` replaces
  `div.chat-section-label`; `Running…` stays `div.chat-muted` (`fg-tertiary`).
- **Streaming**: `.chat-streaming` draws a right edge `box-shadow: inset calc(var(--wg-indicator-width) * -1) 0 0 var(--wg-status-running)`
  (running, not the accent); static.
- **Result line**: `text-12`, `fg-tertiary`, `font-variant-numeric: tabular-nums`; text unchanged.
  **Notice**: `box-shadow: inset var(--wg-indicator-width) 0 0 var(--wg-status-info)`,
  `padding-left: var(--wg-space-2)`; the error tone uses `status-error` for edge and text.
- **Spacing**: `.chat-entries` `padding: var(--wg-space-3) var(--wg-space-6)` plus the bottom above;
  slots `margin: var(--wg-space-1) 0`, `padding: var(--wg-space-1) var(--wg-space-2)`; under
  `@media (max-width: 800px)` the side padding is `var(--wg-space-3)`.
- **Every chat stylesheet reads tokens only**; `0`, `1px`, `50%`, `100%` and `@media` breakpoints are
  the only raw values.

## Layout kit

`layout.d.ts` stays self-contained (main writes its raw text into chat's data folder), so it
re-declares the primitive types with plan B's names and shapes. `ChatKit` after this task:

| Member | Type | Built on |
|---|---|---|
| `markdown` | `(text: string) => HTMLElement` | unchanged |
| `json` | `(value: unknown) => HTMLElement` | unchanged |
| `expander` | `(summary: string, body: () => HTMLElement) => HTMLElement` | `createCollapsibleCard({ summary, body })`, registered as an expander |
| `collapsibleCard` | `(options: CollapsibleCardOptions) => CollapsibleCard` | `createCollapsibleCard`, registered as an expander |
| `card` | `(edge?: CardEdge \| null) => HTMLElement` | `card` |
| `statusDot` | `(status: DotStatus) => HTMLElement` | `statusDot` |
| `setDotStatus` | `(dot: HTMLElement, status: DotStatus) => void` | `setDotStatus` |
| `sectionHeader` | `(text: string) => HTMLElement` | `sectionHeader(text)` |
| `permissionActions` | `() => HTMLElement` | `textButton` + `keyHint` (copy above) |

Declared beside `ChatKit`, exactly as plan B spells them: `DotStatus`, `CardEdge`,
`CollapsibleCardOptions { summary: string; mono?: boolean; leading?: HTMLElement | null; open?: boolean; body(): HTMLElement }`,
`CollapsibleCard { element: HTMLElement; isOpen(): boolean; setOpen(open: boolean): void }`.
Each member's one-line comment states what it draws; `permissionActions`' names Allow once / Deny.

In `chat-kit.ts` the private `Expander` type becomes `Pick<CollapsibleCard, 'isOpen' | 'setOpen'>`,
`buildExpander` is deleted, and `Expanders` keeps its five members over the registered cards.
`CollapsibleCard.isOpen()` is a method, where chat's `Expander` exposes `isOpen` as a property
(`chat-kit.ts`); the callers in `Expanders` (`isAnyClosed`, `openStates`, the toggle) call it when the
expanders move onto the cards.

## Tests

`src/plugins/chat/page/entry-focus.test.ts` (added):

- `focusFirst_FirstOfMany_NotFollowing` — `focusFirst(['a','b','c'])` → `{ entryId: 'a', following: false }`
- `focusFirst_OnlyEntry_Follows` — `focusFirst(['a'])` → `{ entryId: 'a', following: true }`
- `focusFirst_NoIds_Start` — `focusFirst([])` → `START_FOCUS`

`src/plugins/chat/page/control-commands.test.ts` (new):

- `controlCommand_KeyedControls` — `'mode'` → `'pickMode'`, `'effort'` → `'pickEffort'`, `'model'` → `'pickModel'`
- `controlCommand_UnkeyedControl_ListsEveryControl` — `'sandbox'` → `'pickControl'`

`src/plugins/chat/layouts/default/layout.test.ts` — the fake kit gains `collapsibleCard` (records
its options, returns a fake element tagged `collapsibleCard:<summary>` and a handle recording each
`setOpen`), `card` (`card:<edge or none>`), `statusDot` (`dot:<status>`), `setDotStatus` (records
`[dot part, status]`) and `sectionHeader` (`section:<text>`); `expander` stays:

- `user_cardHoldsMarkdown_updateReplacesIt` — root `chat-entry chat-user` holds `card:none`, which
  holds `markdown:hello`; `update` with `hello there` keeps the root and the card and leaves
  `markdown:hello there` in the card
- `tool_closedMonoCardWithRunningDot` — `collapsibleCard` called once with summary `Bash · ls -la`,
  `mono: true`, `leading` the `dot:running` element, `open` absent or false; the opened body is
  `div.chat-tool-body` holding `section:Input`, the input json, `div.chat-muted:Running…`
- `tool_lineWithoutSummary` — summary `Bash`
- `tool_updateSetsTheDotAndRefillsTheBody (isError $isError)` — after `update` with
  `{ text, isError }`: `setDotStatus` recorded once with `error` / `success`, the same body holds
  `section:Input`, the input json, `section:Error` / `section:Result`, `pre.chat-tool-result:<text>`,
  and no `setOpen` was recorded
- `permission_unansweredAttentionCard_noUpdate` — the root holds `card:attention`, which holds
  `div.chat-permission-head:Allow Bash?`, the input json and `permissionActions`; `view.update` is
  undefined
- `permission_answeredPlainCard` — with `answer: { allowed: true, reason: null }` the root holds
  `card:none`
- `thinking_expanderBodyRefilledInPlace`, `result_lineFormats`, `notice_toneClass`,
  `raw_expanderShowsTheEvents`, `assistant_streamingClass_updateInPlace` — kept as they are

The kit's DOM, the composer and the dialogs are judged on screen (the test environment is `node`).

## Changes by file

| File | Now | After |
|---|---|---|
| `chat-view.ts` `createTab` | `div.chat-tab` = entries, `div.chat-box`, status line | entries, then the composer; `ResizeObserver` as above; the box mounts in the composer's `inputFrame()` |
| `chat-view.ts` `buildStatusLine` | mode span + `span.chat-control` texts | the composer bar draw (mode, chips, send), disabled once ended |
| `chat-view.ts` `sessionEnded` handler | sets `ended`, status | also redraws the bar |
| `entry-list.ts` | `is-focused`; no first, no bottom-only scroll | `is-cursor`; `first()`; `followBottom()` scrolls to the bottom only while following |
| `chat-kit.ts` | `button`, `appendKeys`, `buildExpander` | the kit table above; `KitDeps.platform` |
| `chat-dialogs.ts` | `.overlay` / `.dialog` markup, `button`, `appendKeys` | `createDialog`, `textButton`, `inputFrame`, `keyHint`; `DialogDeps.platform` |
| `start.ts` | no platform; `dialog.css` import | passes `platform: api.platform` to the view, kit (through the view), dialogs, and `run` to the view |
| `picker.ts` | `overlayClass: 'overlay'`, `dialogClass: 'chat-picker'` | `overlayClass: ''`, `dialogClass: ''` |

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Chat.

## Proof

Commit `fc54416`. Diff read against Decisions, Layout kit and Changes by file; typecheck, lint, tests and the self-test's chat script pass. Concerns: chat-commands.ts keeps a private CONTROL_IDS copy until 07; the Send hint and the composer's stacking are judged on screen.
