# 01 — Anchors, KeyPrompt and the hint setting

Status: in progress
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

**Contents**

- **Files** — what this task creates, changes and tests.
- **Consumes / Produces** — the signatures other tasks use.
- **Decisions** — the choices settled for the implementer.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — names and the values they assert.
- **Approach** — the start.ts wiring and when the unplaced check runs.
- **Done when / Commit**

This task adds the anchor API, the KeyPrompt primitive, the vim key list, the unplaced check, the
`keys.showHints` setting and two slots in the shared list picker. It moves the confirm prompt onto
anchors. The key bar stays: task 10 deletes it.

## Files

- create `src/shared/page/ui/key-prompt.ts` · create `src/shared/page/ui/key-prompt.css`
- create `src/plugins/keys/page/anchors.ts` · test `src/plugins/keys/page/anchors.test.ts`
- create `src/plugins/keys/page/vim-keys.ts` · test `src/plugins/keys/page/vim-keys.test.ts`
- create `src/plugins/keys/page/unplaced.ts` · test `src/plugins/keys/page/unplaced.test.ts`
- create `src/plugins/keys/page/unplaced-log.ts` · test `src/plugins/keys/page/unplaced-log.test.ts`
- modify `src/plugins/keys/page/keys-for.ts` · test `src/plugins/keys/page/keys-for.test.ts`
- modify `src/plugins/keys/contract.ts` · modify `src/plugins/keys/manifest.ts` · modify `src/plugins/keys/page/start.ts`
- modify `src/shared/page/confirm-prompt.ts` · test `src/shared/page/confirm-prompt.test.ts`
- modify `src/shared/page/list-picker.ts` · modify `src/shared/page/list-picker.css` · test `src/shared/page/list-picker.test.ts` (create)
- modify `src/plugins/gallery/page/gallery-view.ts`

This task does not open the three callers of `createConfirmPrompt` (`src/plugins/forms/page/forms-view.ts`,
`src/plugins/primer/page/primer-view.ts`, `src/plugins/backlog/page/backlog-view.ts`). They compile
through `keys: deps.keys`. Backlog's `keys` is typed `KeysPageExports`, which gains `anchor` here, so it
fits the new `ConfirmKeys`. `FormsViewDeps.keys` and `PrimerViewDeps.keys` are
`Pick<KeysPageExports, 'keysFor' | 'onChanged'>`; task 02, in this wave, widens both Picks to add `'anchor'`
and adds `anchor` to both views' test fakes. Each caller each still passes `platform` and `onBaseChanged`, which stay in
`ConfirmPromptDeps`. Task 02 edits `forms-view.ts` and `primer-view.ts` in the same wave. Tasks 04,
05 and 09 drop each caller's `onBaseChanged`. Task 10 removes the unused `platform` dep and the
`platform:` line in each caller.

This task does not open the four callers of `createListPicker` (`settings-view.ts`,
`src/plugins/chat/page/picker.ts`, `backlog-view.ts`, `docs-dialogs.ts`). The two new request
fields are optional, so each caller compiles unedited.

## Consumes / Produces

Consumes: the tree only. `keys.scope()`, `keys.onScopeChanged`, `keys.keymap()`,
`keys.onKeymapChanged`, `keys.label` and `api.onSettingsChanged` in `src/contracts/plugin.ts`;
`services.log` in `PageServices`; `keysFor` in `src/plugins/keys/page/keys-for.ts`; `formatKeys`,
`formatVimKeys` and `vimTokens` in `src/shared/key-hints.ts`; `pageKeysFor` and
`vimTokenForPageKey` in `src/shared/key-notation.ts`; `kbd` in `src/shared/page/ui/kbd.ts`;
`row({ trailing })` in `src/shared/page/ui/row.ts`.

Produces (the File Structure's shared names, word for word):

- `export interface AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string }` in
  `src/plugins/keys/contract.ts`, with the comments plan.md gives
- `anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable;` added to
  `KeysPageExports` in `src/plugins/keys/contract.ts`
- `export function keyPrompt(keys: string, platform: Platform, label?: string): HTMLElement;` in
  `src/shared/page/ui/key-prompt.ts`; root class `ui-key-prompt`, part `ui-key-prompt-label`
- the class `is-hint-hidden`, with the rule `.is-hint-hidden { visibility: hidden; }` in
  `src/shared/page/ui/key-prompt.css`
- the class `ui-key-chevron`, with its rules in `src/shared/page/ui/key-prompt.css` (Decisions)
- the log line `[keys] unplaced <keys> <command> in <scope>`
- in `src/shared/page/list-picker.ts`, two fields on `ListPickerRequest<T>`:
  - `headerEnd?: HTMLElement | null`
  - `cursorEnd?(item: T): HTMLElement | null`

Produces (new names beyond plan.md, used inside the keys plugin and by tasks 04, 05, 09 and 10):

- in `src/plugins/keys/page/vim-keys.ts`:
  - `export const VIM_KEYS: readonly string[]`
  - `export function isVimKeys(keys: string): boolean`
  - `export function pageVimKeys(keys: readonly string[]): string`
- in `src/plugins/keys/page/keys-for.ts`:
  - `export function promptKeysFor(keymap: Keymap, command: CommandId, scope: ViewScope | undefined, platform: Platform, where: HintWhere): string | null`
- in `src/plugins/keys/page/unplaced.ts`:
  - `export interface UnplacedBind { keys: string; command: CommandId }`
  - `export function unplacedBinds(keymap: Keymap, scope: ViewScope, placed: ReadonlySet<CommandId>): UnplacedBind[]`
  - `export function unplacedLine(bind: UnplacedBind, scope: ViewScope): string`
- in `src/plugins/keys/page/anchors.ts`:
  - `export interface AnchorDeps { keysFor(command: CommandId, scope: ViewScope | undefined, where: HintWhere): string | null; label(id: CommandId): string; scope(): ViewScope; showHints(): boolean; platform: Platform }`
  - `export interface Anchors { anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable; redraw(): void; applyVisibility(): void; placedIn(scope: ViewScope): ReadonlySet<CommandId> }`
  - `export function createAnchors(deps: AnchorDeps): Anchors`
- in `src/plugins/keys/page/unplaced-log.ts`:
  - `export interface UnplacedLogDeps { keymap(): Keymap; scope(): ViewScope; placedIn(scope: ViewScope): ReadonlySet<CommandId>; onScopeChanged(listener: (scope: ViewScope) => void): void; log: Log }`
  - `export interface UnplacedLog { checkSeen(): void }`
  - `export function startUnplacedLog(deps: UnplacedLogDeps): UnplacedLog`
- in `src/shared/page/confirm-prompt.ts`:
  - `ConfirmKeys` becomes `{ anchor(element: HTMLElement, command: CommandId, options?: { scope?: ViewScope }): Disposable }`
  - `ConfirmPromptDeps.onBaseChanged` becomes optional: `onBaseChanged?(): void`

**Contract for every wave-2 task.**

- A command counts as placed in a scope once the page load has named any anchor for it in that
  scope, or with no scope. A disposed anchor still counts.
- The keys plugin checks placement only when `checkSeen()` runs, at the end of a self-test run
  (task 10). It checks every scope that was in force during the page load, against the full anchor
  history. So a view may name an anchor after an await, or in any later state of the page load.
- The view owns the anchor element's children: the keys plugin replaces them. The view puts nothing
  else in the anchor element.
- A chevron or arrow beside a prompt (`›`, `▼`, `‹ tree`) is a `span.ui-key-chevron` that the view
  places next to the anchor element, before it or after it. KeyPrompt draws the keys first and
  then the label, in every case.

## Decisions

- **KeyPrompt.** `keyPrompt` returns a `span.ui-key-prompt` that holds `kbd(keys, platform)` and,
  when `label` is given, a `span.ui-key-prompt-label` with the label text after it. CSS:
  `.ui-key-prompt` is `inline-flex`, `align-items: baseline`, `gap: var(--wg-space-1)`,
  `white-space: nowrap`. `.ui-key-prompt-label` is `color: var(--wg-fg-tertiary)` and
  `font-size: var(--wg-text-12)`. No new theme token. The builder imports `./key-prompt.css`, as
  `kbd.ts` imports `./kbd.css`. KeyPrompt has no option that puts the label first.
- **Chevrons.** `key-prompt.css` also holds the rules for `.ui-key-chevron`, a view's chevron or
  arrow beside an anchor element. It is `color: var(--wg-fg-tertiary)` and
  `font-size: var(--wg-text-12)`. It hides with the anchor it stands next to:
  - `.ui-key-chevron:has(+ .is-hint-hidden), .is-hint-hidden + .ui-key-chevron { visibility: hidden; }`
  - `.ui-key-chevron:has(+ :empty), :empty + .ui-key-chevron { display: none; }` (an unbound command)

  Reason: KeyPrompt always draws keys and then the label, so `› ⌥O` and `‹ tree ⌥H` put the chevron
  in a view element before the anchor. One shared rule keeps that chevron hidden while its hint is
  hidden, in every view.
- **What an anchor draws.** `anchor` reads `deps.keysFor(command, options.scope, options.where ?? 'page')`.
  Null keys: the element gets no children. Keys: the element's children become one
  `keyPrompt(keys, platform, text)`. `text` is `deps.label(command)` for `label: true`, the string
  for a string `label`, and no label for `false` or absent. A command that is unbound draws no label.
- **Which bind a prompt shows.** `start.ts` wires `deps.keysFor` to `promptKeysFor`, not `keysFor`.
  `promptKeysFor` takes the binds of `command` that fire in `scope` (`any` binds included, every
  scope when `scope` is undefined), on the page or in a box as `where` says, in keymap order. It
  formats the first of these binds whose keys are not vim's own keys (`isVimKeys`). When every one
  of these binds is a vim key, it formats the first bind. When there is no bind, it returns null.
  A page bind's keys are tested in vim notation (`pageVimKeys(bind.keys)`); a box bind's keys are
  tested as written. Formatting is as `keysFor` does it: `formatKeys` for a page bind,
  `formatVimKeys` for a box bind. Examples from `src/plugins/keymap.ts`: `forms.nextItem` in
  `forms.forms` binds `j`, then `<C-l>`, so the prompt shows `⌃L`; `forms.acceptRecommendation`
  binds `<CR>` only, so the prompt shows `↩`. `keysFor` and `KeysPageExports.keysFor` do not change.
- **Visibility.** The registry sets `is-hint-hidden` on the anchor element while `deps.showHints()`
  is false, or while the anchor has a `scope` and that scope is not `deps.scope()`. It removes the
  class otherwise. An anchor without `scope` shows in every scope. `anchor` applies visibility at
  once, so a new anchor never shows for one frame in the wrong scope.
- **Redraw.** `redraw()` draws every live anchor again from `keysFor`. `applyVisibility()` sets the
  class on every live anchor. The registry subscribes to nothing; `start.ts` calls them (Approach),
  so the test drives them directly.
- **Dispose.** `dispose` removes the element's children, removes `is-hint-hidden`, and removes the
  anchor from the live set. A second `dispose` does nothing. `redraw` and `applyVisibility` never
  touch a disposed anchor. The anchor's command stays in the placement history.
- **Placement history.** The registry keeps, for the page load, a map from each scope to the
  commands anchored in it, plus a set of the commands anchored with no scope. `anchor` adds to it.
  `dispose` does not remove from it. `placedIn(scope)` returns the commands anchored in `scope`
  plus the commands anchored with no scope. The `where` of an anchor does not matter: the check is
  by command, as AGENTS.md states it. Reason: a view draws some targets only in some states (a
  sixth choice, a waiting permission card) and disposes them when the state goes. The target was
  on screen in that state, so the bind is placed.
- **Vim keys.** `VIM_KEYS` is exactly, in this order:
  `j` `k` `h` `l` `gg` `G` `<CR>` `<Esc>` `<C-j>` `<C-k>` `<C-S-j>` `<C-S-k>`.
  `isVimKeys(keys)` is true when `keys`, in vim notation, equals one entry exactly. The default keymap
  writes these keys in this spelling (`src/plugins/keymap.ts`: `'<Esc>'` 30 times, `'<CR>'` 19 times,
  measured at plan time). `pageVimKeys(keys)` returns a page bind's keys in vim notation:
  `keys.map(vimTokenForPageKey).join('')` (`['g','g']` is `gg`, `['Escape']` is `<Esc>`, `['Tab']`
  is `<Tab>`). `promptKeysFor` and `unplacedBinds` both use it.
- **Unplaced binds.** `unplacedBinds(keymap, scope, placed)` is pure. It lists, in this order:
  1. each page bind in `keymap.page` whose scope is `scope` or `any`, its keys as `pageVimKeys(bind.keys)`.
  2. each box bind in `keymap.editor.binds` whose scope is `scope` or `any`, keys as written.

  It leaves out each bind whose keys start with the leader: a page bind whose `keys[0]` is
  `pageKeysFor(leader, leader)[0]`, and a box bind whose `vimTokens(keys, leader)[0]` is `leader`
  (the test `src/plugins/keys/page/key-bar.ts` uses today; copy it, since task 10 deletes that file).
  It leaves out each bind whose keys pass `isVimKeys`, and each bind whose command is in `placed`.
  A `{ keys, command }` pair already listed is not listed again, so a chord bound on the page and
  in a box shows once.
- **The log line.** `unplacedLine(bind, scope)` returns `unplaced ${bind.keys} ${bind.command} in ${scope}`.
  The plugin logs it with `services.log('keys', line)`, which prints `[keys] unplaced …`.
- **When the check runs.** `startUnplacedLog` records every scope that was in force during the
  page load, in the order each first came in force: `deps.scope()` at start, then each scope that
  `onScopeChanged` reports. A scope change records the scope only; it checks and logs nothing.
  `checkSeen()` checks every recorded scope, in that order. To check a scope, it computes
  `unplacedBinds(deps.keymap(), scope, deps.placedIn(scope))` and logs each line it has not logged
  before. Nothing else logs an unplaced line. Task 10 calls `checkSeen()` at the end of a
  self-test run. Reason: at the end of the run every state the self-test reached has drawn, so the
  history holds every anchor those states named, whatever order the scopes came in.
- **De-duplication.** `startUnplacedLog` keeps a set of the lines it logged, for the page load. It
  logs a line only when the set does not hold it, so it logs each `(scope, bind)` once per page
  load, however many times `checkSeen()` runs. A keymap change does not clear the set: a rebind
  gives new keys, so its line is a new line.
- **The setting.** `keysManifest.settings` gains `showHints: true`. `settingInfo.showHints` is
  label `Key hints`, description
  `Show each key beside the control or row it acts on. Which-key and the Keys dialog list every key either way.`
  The copy does not hold the word "help": the settings self-test filters on `help` and expects
  `keys.toggleHelp` as the first row (`src/plugins/settings/main/selftest-script.ts:106`).
- **Confirm prompt.** `ConfirmKeys` holds only `anchor` (signature above), a structural type, since
  `src/shared/page/` cannot import a plugin. `choiceButton` makes `element('span', 'ui-confirm-hint')`,
  passes it to `textButton` as `hint`, and calls
  `deps.keys.anchor(hint, choice.command, { scope: deps.scope })`. The prompt keeps no anchor
  handle: it lives as long as the page. The import of `appendKeyHint` goes. Rewrite the doc comment
  of `createConfirmPrompt`: each button's hint is an anchor for its command in the prompt's pushed
  scope. `ConfirmPromptDeps.platform` stays in this task (Files says why).
- **Confirm prompt's `onBaseChanged`.** It becomes optional, `onBaseChanged?(): void`, and the
  pushed scope's listener calls `deps.onBaseChanged?.()`. Its comment becomes: runs on each base
  scope change under the pushed scope, when given. Reason: backlog passes `() => undefined` today,
  and forms and primer pass `updateStatus`, which tasks 04 and 05 delete when the status line moves
  into their rail headers. After those tasks no caller has work for it, so tasks 04, 05 and 09 omit it.
- **List picker slots.** `ListPickerRequest<T>` gains two optional fields. Their comments:
  - `headerEnd?: HTMLElement | null` — drawn at the end of the title line while this request is open.
  - `cursorEnd?(item: T): HTMLElement | null` — drawn at the trailing end of the cursor row, on each draw.

  `createListPicker` puts the title in a new `div.ui-picker-head`, in place of the bare `h2` in the
  panel. `open` sets the head's children to the title, then `next.headerEnd` when it is not null or
  absent; so a later `open` removes the earlier request's element. The open request keeps
  `cursorEnd`. `draw` passes `trailing: request.cursorEnd(item)` to `row` for the cursor row only,
  and no `trailing` for the other rows; a null result gives no `trailing`. The caller keeps one
  element and the picker moves it on each draw. `list-picker.css`: `.ui-picker-head` is
  `display: flex`, `align-items: baseline`, `justify-content: space-between`,
  `gap: var(--wg-space-2)`, and takes the `padding` that `.ui-picker-title` has now; the title
  keeps its other rules. Rewrite the `ListPicker` doc comment to name the two slots. Reason: chat
  (task 06) and notes (task 09) draw a filter key in the picker's header and a row action on its
  cursor row, and the picker rebuilds every row on each draw, so a caller cannot keep an element
  there without these slots.
- **Gallery.** A `KeyPrompt` section follows the `Kbd` section in `createGalleryView`, built by a new
  `keyPromptSection(platform)` beside `kbdSection`. Its cells:
  - `keyPrompt('<A-o>', platform)`, caption `Keys`
  - `keyPrompt('s', platform, 'star')`, caption `Keys and label`
  - the same prompt with `withClass(…, 'is-hint-hidden')` in a `frame(…)`, caption
    `Hidden, keeps its space`

  The gallery's own `kbd('t', platform)` status hint stays; task 08 owns it.
- **Out of this task:** the key bar, `closeHelpHint`, `src/shared/page/key-hint.ts` (task 10 deletes
  them); every view's anchors (tasks 03–09).

## Behaviour

- GIVEN a command bound to `d` in scope `a.list` WHEN a view anchors it with `{ scope: 'a.list' }`
  while `a.list` is in force THEN the element shows the prompt `d` with no `is-hint-hidden`.
- GIVEN that anchor WHEN the scope in force becomes `a.detail` THEN the element carries
  `is-hint-hidden` and keeps its prompt.
- GIVEN an anchor with no scope WHEN any scope is in force THEN it shows.
- GIVEN `keys.showHints` is false WHEN any anchor is drawn THEN it carries `is-hint-hidden`.
- GIVEN an anchor WHEN the user rebinds its command THEN the prompt shows the new keys; WHEN the user
  unbinds it THEN the element is empty.
- GIVEN an anchor WHEN it is disposed THEN the element is empty, carries no `is-hint-hidden`, and its
  command still counts as placed in its scope for the rest of the page load.
- GIVEN `forms.nextItem` binds `j` then `<C-l>` in `forms.forms` WHEN a view anchors it in that scope
  THEN the prompt shows `⌃L`. GIVEN a command bound only to `<CR>` THEN the prompt shows `↩`.
- GIVEN scope `a.s` has the page bind `x` for `a.trash` with no anchor WHEN `a.s` comes into force
  and leaves again THEN nothing is logged; WHEN `checkSeen()` runs THEN the log holds
  `[keys] unplaced x a.trash in a.s` once; WHEN `checkSeen()` runs again THEN nothing more is logged.
- GIVEN a view names the `a.trash` anchor in `a.s` after `a.s` left force WHEN `checkSeen()` runs
  THEN nothing is logged for `a.s`.
- GIVEN the confirm prompt WHEN it is built THEN it names one anchor per button, for that button's
  command in the prompt's scope.
- GIVEN a list picker request with `headerEnd` and `cursorEnd` WHEN it opens and its cursor moves
  THEN the header element sits at the title line's end, and the cursor element sits in the cursor
  row only.

## Tests

`anchors.test.ts` uses `installFakeDom` from `src/shared/page/test-dom.ts`, as
`confirm-prompt.test.ts` does, and the real `keyPrompt`. The fake deps hold a mutable
`Record<CommandId, string | null>` read by `keysFor`, which also records each call; a mutable
`scope`; a mutable `showHints`; `label` from a fixed map (`a.trash` → `trash`); platform `macos`.

- `anchor_Bound_DrawsTheKeyPrompt` — keys `d`: the element's `textContent` is `d`; one `ui-key-prompt` inside.
- `anchor_LabelTrue_DrawsTheCommandLabelAfterTheKeys` — `textContent` `dtrash`; the `ui-key-prompt-label` part reads `trash`.
- `anchor_LabelString_DrawsThatText` — `label: 'remove'`: `textContent` `dremove`.
- `anchor_Unbound_DrawsNothing` — keys null: `children.length` 0.
- `anchor_ScopeAndWhere_ReadsKeysThere` — `{ scope: 'a.list', where: 'box' }`: `keysFor` called with `('a.trash', 'a.list', 'box')`; no options: `('a.trash', undefined, 'page')`.
- `redraw_KeysChanged_DrawsTheNewKeys` — keys to `x`, `redraw()`: `textContent` `x`; keys to null, `redraw()`: `textContent` empty.
- `applyVisibility_OtherScope_HidesAndKeepsThePrompt` — anchor scope `a.list`, deps scope `a.detail`: has `is-hint-hidden`; `textContent` still `d`.
- `applyVisibility_ScopeInForce_Shows` — deps scope becomes `a.list`, `applyVisibility()`: no `is-hint-hidden`.
- `anchor_NoScope_ShowsInEveryScope` — no `is-hint-hidden` under scopes `a.list` and `b.other`.
- `applyVisibility_ShowHintsOff_HidesEveryAnchor` — `showHints` false: both a scoped anchor in force and an unscoped anchor carry `is-hint-hidden`.
- `dispose_RemovesThePromptAndKeepsThePlacement` — after `dispose()`: `children.length` 0, no `is-hint-hidden`, `placedIn('a.list')` still holds `a.trash`; keys to `x` and `redraw()`: still empty; a second `dispose()` throws nothing.
- `placedIn_ListsScopedAndUnscopedCommands` — anchors `a.x` (scope `a.s`), `a.y` (no scope), `a.z` (scope `a.other`): `placedIn('a.s')` equals `new Set(['a.x', 'a.y'])`.

`vim-keys.test.ts`:

- `VIM_KEYS_IsThePinnedList` — equals `['j', 'k', 'h', 'l', 'gg', 'G', '<CR>', '<Esc>', '<C-j>', '<C-k>', '<C-S-j>', '<C-S-k>']`.
- `isVimKeys_Listed_True` — `gg`, `G`, `<C-S-k>`: true.
- `isVimKeys_NotListed_False` — `g`, `jj`, `x`, `<C-l>`, `<A-o>`: false.
- `pageVimKeys_PrintsVimNotation` — `['g', 'g']` is `gg`; `['Escape']` is `<Esc>`; `['Tab']` is `<Tab>`.

`keys-for.test.ts` builds its `Keymap` literals as the existing tests do; platform `macos`:

- `promptKeysFor_VimBindFirst_ShowsTheFirstOtherBind` — page binds `['j']` then `['<C-l>']` in `forms.forms` for `forms.nextItem`: `promptKeysFor(keymap, 'forms.nextItem', 'forms.forms', 'macos', 'page')` is `⌃L`.
- `promptKeysFor_OnlyVimBinds_ShowsTheFirst` — page bind `['Enter']` in `forms.forms` for `forms.acceptRecommendation`: `↩`.
- `promptKeysFor_AnyScopeBind_Counts` — page bind `['<A-o>']` in `any` for `a.next`, scope `a.s`: `⌥O`.
- `promptKeysFor_BoxVimBindFirst_ShowsTheFirstOtherBind` — box binds `<Esc>` then `<C-c>` in `a.s` for `a.leave`, `where` `box`: the `<C-c>` keys as `formatVimKeys` prints them.
- `promptKeysFor_Unbound_Null` — no bind: null.
- every existing `keysFor` test stays as it is.

`unplaced.test.ts` builds a `Keymap` literal as `keys-for.test.ts` does (leader `<Space>`):

- `unplacedBinds_PageBindInScope_IsListed` — page `['x']` in `a.s` for `a.trash`: `[{ keys: 'x', command: 'a.trash' }]`.
- `unplacedBinds_AnyScope_IsListed` — page `['<A-o>']` in `any` for `a.next`, scope `a.s`: `[{ keys: '<A-o>', command: 'a.next' }]`.
- `unplacedBinds_OtherScope_LeftOut` — page `['x']` in `a.other`: `[]`.
- `unplacedBinds_LeaderSequence_LeftOut` — page `[' ', 'k', 's']` and box `<Leader>x`: `[]`; with leader `,`, page `[',', 'k']`: `[]`.
- `unplacedBinds_VimKeys_LeftOut` — page `['j']`, `['g', 'g']`, `['Enter']`, `['Escape']`, `['<C-S-j>']` and box `<Esc>`, `<CR>`: `[]`.
- `unplacedBinds_PlacedCommand_LeftOut` — page `['x']` for `a.trash`, placed `new Set(['a.trash'])`: `[]`.
- `unplacedBinds_BoxBind_IsListed` — box `<C-p>` in `a.s` for `a.prevBox`: `[{ keys: '<C-p>', command: 'a.prevBox' }]`.
- `unplacedBinds_SamePairOnPageAndInBox_ListedOnce` — page `['<C-p>']` and box `<C-p>`, both `a.prevBox`: one entry.
- `unplacedBinds_PageKeys_PrintInVimNotation` — page `['Tab']` for `a.cycle`: `[{ keys: '<Tab>', command: 'a.cycle' }]`.
- `unplacedLine_FormatsTheMessage` — `unplacedLine({ keys: 'x', command: 'a.trash' }, 'a.s')` is `unplaced x a.trash in a.s`.

`unplaced-log.test.ts`: `log` is `vi.fn()`; the keymap is mutable and starts with page `['x']` in
`a.s` for `a.trash` and page `['y']` in `a.t` for `a.copy`; the scope is mutable and starts at
`a.s`; the test keeps the `onScopeChanged` listener and calls it after it sets the scope;
`placedIn` reads a mutable `Set<CommandId>`, empty at start.

- `scopeChange_LogsNothing` — scope to `a.t`, then `a.s`: no `log` call.
- `checkSeen_ChecksEveryScopeInForceOnce` — scope to `a.t`, then `checkSeen()`: `log` called twice, the `a.s` line then the `a.t` line; a second `checkSeen()` logs nothing more.
- `checkSeen_UnseenScope_LeftOut` — no scope change, then `checkSeen()`: only the `a.s` line.
- `checkSeen_AnchorNamedAfterTheScopeLeft_LogsNothing` — scope to `a.t`, then add `a.trash` to the placed set, then `checkSeen()`: no `a.s` line.
- `checkSeen_SameScopeTwice_RecordedOnce` — `a.t`, `a.s`, `a.t`, then `checkSeen()`: `log` called twice.
- `keymapChange_NewKeys_LogANewLine` — `a.t`, `checkSeen()` (logs the `a.s` line); keymap `a.trash` bind to `['z']`; `checkSeen()`: `log` called with `('keys', 'unplaced z a.trash in a.s')`.

`confirm-prompt.test.ts`: the fake `keys` becomes `{ anchor }`. The fake `anchor` records
`[command, options]` and sets the element's `textContent` to the test's keys for that command.

- keep `draws the keep choice first and runs each choice command on click` — `Keepn` and `Cancel formy`, as now.
- replace `draws each hint again with the keys after a keymap change` with `names an anchor for each choice in the prompt scope` — recorded calls equal `[['test.keep', { scope: 'test.confirm' }], ['test.confirm', { scope: 'test.confirm' }]]`.
- add `dismisses on a base change with no onBaseChanged given` — deps without `onBaseChanged`, the prompt asked and shown, a base change: `dismiss` called once, nothing throws.
- every other test stays as it is.

`list-picker.test.ts` (create) installs the fake DOM as `confirm-prompt.test.ts` does. Its deps
give no `filterEditor`; `pushScope` returns a fake `PushedScope`; `log` is `vi.fn()`. Each request
has three string items, `label` is the identity, and `chosen` is `vi.fn()`.

- `open_HeaderEnd_DrawsAtTheTitleLineEnd` — `headerEnd` a `span`: the `.ui-picker-head` children are the title, then that span.
- `open_NextRequestWithoutHeaderEnd_RemovesTheEarlierOne` — open with a `headerEnd`, then open a request without one: the head holds the title alone.
- `draw_CursorEnd_SitsInTheCursorRowOnly` — `cursorEnd` returns one kept `span` for every item: after `open`, the span is inside the first row; after `down()`, inside the second row, and the first row holds none.
- `draw_CursorEndNull_DrawsNoTrailing` — `cursorEnd` returns null: the cursor row holds no `.ui-row-trailing`.

## Approach

`start.ts` builds the registry and the check once, after `keysFor` exports exist:

- `createAnchors` with `keysFor: (command, scope, where) => promptKeysFor(keys.keymap(), command, scope, platform, where)`,
  `label: keys.label`, `scope: () => keys.scope()`, `showHints: () => api.settings().showHints`, `platform`.
- `keys.onKeymapChanged` calls `anchors.redraw()` (add it to the existing listener, which also
  redraws help and the key bar).
- `keys.onScopeChanged` and `api.onSettingsChanged` call `anchors.applyVisibility()`.
- `startUnplacedLog` with `keys.keymap`, `keys.scope`, `anchors.placedIn`, `keys.onScopeChanged`
  and `services.log`. `start.ts` keeps the `UnplacedLog` it returns; task 10 wires its `checkSeen`.
- `exports.anchor` is `anchors.anchor`.

When the check runs changes behaviour, so it is fixed here (Decisions, When the check runs).
`keys.onScopeChanged` runs inside `setScope` (`src/renderer/key-scope.ts`), before the view that
set the new scope draws, so a scope change only records the scope. The check runs only from
`checkSeen()`, and it reads the placement history, so an anchor that a view names and later
disposes still counts. It needs no timer.

Rewrite the doc comment of `keysPagePart` to name the anchors, the setting and the unplaced log.
Keep its key bar sentence until task 10.

## Done when

`npm run lint` and the type check pass; the test gate runs the tests above. Runtime and visual
checks of hints are in task 12 (Final verification).

## Commit

One commit for the group.

## Proof
