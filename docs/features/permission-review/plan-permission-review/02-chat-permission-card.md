# 02 — Chat entry parts and the redrawn permission card

Status: done
Type: Task
Rung: hard · adds the `addEntryPart` seam and `kit.entryParts` that 05 consumes
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths in later fields are under `src/plugins/chat/` unless they start with `src/`.

Files:
- modify `src/plugins/chat/contract.ts` · `src/plugins/chat/layouts/layout.d.ts` · `src/plugins/chat/page/chat-kit.ts` ·
  `src/plugins/chat/page/entry-list.ts` · `src/plugins/chat/page/chat-view.ts` · `src/plugins/chat/page/start.ts` ·
  `src/plugins/chat/layouts/default/layout.js` · `src/plugins/chat/layouts/default/layout.css` ·
  `src/plugins/chat/main/preview/preview-session.ts` · `src/plugins/chat/main/selftest-script.ts`
- test `src/plugins/chat/page/chat-kit.test.ts` · `src/plugins/chat/page/entry-list.test.ts` ·
  `src/plugins/chat/page/chat-view.test.ts` · `src/plugins/chat/layouts/default/layout.test.ts`

Consumes:
- `summary: string` on the `ChatEntry` `'permission'` variant ← 01
- `createPartStore` and `PartStore` (`src/shared/page/contributed-parts.ts`, in the tree)
- `ChatKit.expander(parent, summary, body: () => HTMLElement): HTMLElement`, `ChatKit.json`, `ChatKit.edgeCard`,
  `ChatKit.permissionActions` (`layouts/layout.d.ts`, in the tree)

Produces (names and signatures exactly as plan.md's File Structure gives them):
- `PermissionInput` gains `summary: string` (`layouts/layout.d.ts`)
- `ChatKit` gains `entryParts(parent: HTMLElement): void` (`layouts/layout.d.ts`)
- `ChatEntryPartContext<K extends AnyEntryKind> { sessionId: string; input: EntryInput<K>; }` (`contract.ts`)
- `ChatEntryPart<K extends AnyEntryKind = AnyEntryKind> { id; kinds: readonly K[]; build(parent, context): { update?(input: EntryInput<K>): void } }` (`contract.ts`)
- `ChatPageExports.addEntryPart<K extends AnyEntryKind>(part: ChatEntryPart<K>): Disposable` (`contract.ts`)
- the wrapper markup 05's CSS may target: `div.chat-entry-parts` holding one `div.chat-entry-part` per part, with
  `data-part="<id>"`

Internal (chat only, no other task consumes them):
- `KitDeps` gains `sessionId: string`, `entryParts(): readonly ChatEntryPart[]` and `log: PluginLog`
- `createEntryKit(entry: ChatEntry, input: EntryInput<AnyEntryKind>, deps: KitDeps): EntryKit` (was `(entry, deps)`)
- `EntryKit` gains `updateParts(input: EntryInput<AnyEntryKind>): void`
- `ChatViewDeps` gains `entryParts: Pick<PartStore<ChatEntryPart>, 'parts' | 'onChanged'>`

## Decisions

- **No copy to change for `summary`.** `entryInput` in `page/entry-list.ts` returns a permission entry as it is
  (only `result`, `tool`, `thinking` and `user` are rebuilt), so once 01 puts `summary` on `ChatEntry`, the input
  carries it. The change on the page side is the type in `PermissionInput`, placed after `toolName`, with this
  comment above the interface:
  `// \`summary\` is the call's target line, the same text a tool entry shows (a Bash command's first line, an edited`
  `// file's path); empty when the tool has none.`
- **The registry is a part store, not a new module.** `page/start.ts` makes
  `const entryParts = createPartStore<ChatEntryPart>();` beside `composerParts`, `statusParts` and `sideParts`. The
  store already throws `part <id> is already added` on a duplicate id, removes the part on `dispose` (a second
  dispose does nothing), and tells `onChanged` of each add and removal. The export is
  `addEntryPart: (part) => consumer.track(entryParts.add(part as unknown as ChatEntryPart))`, with the comment
  `// TypeScript cannot tie a part's kinds to its build's input.` (the same cast `entry-renderers.ts` makes).
  `page/entry-renderers.ts` stays as it is: it orders latest first and has no duplicate check, which a part does not
  want.
- **Adding or disposing a part redraws every Chat tab's entries.** `mountChatView` subscribes
  `deps.entryParts.onChanged` beside `deps.renderers.onChanged`, and the listener runs
  `tab.entries.rebuild(tab.state.entries)` for each tab. The layout preview's tab is a Chat tab, so it redraws too.
- **The session id reaches the kit through `KitDeps`.** `chat-view.ts` already builds each tab's `KitDeps` with the
  tab's `sessionId` in scope (the `createEntryList({ kit: { … } })` call, around line 1327). It adds
  `sessionId`, `entryParts: () => deps.entryParts.parts()` and `log: deps.log`.
- **The kit gets the input as well as the entry.** A part's context is `{ sessionId, input }`, and an `EntryInput`
  differs from its `ChatEntry` for user, tool, thinking and result entries. `createEntryKit` takes the input as its
  second argument. Both calls in `entry-list.ts` `buildEntry` (the drawn path and the bare-line catch) already hold
  `input`.
- **`kit.entryParts(parent)`** works the way forms' `placeContributedParts` does
  (`src/plugins/forms/page/layout/card-kit.ts`, around line 366):
  - The parts are `deps.entryParts()` whose `kinds` include the entry's kind, in add order.
  - When at least one part matches, it appends `div.chat-entry-parts` to `parent`, and per part a
    `div.chat-entry-part` with `data-part="<id>"`, then calls `part.build(wrapper, { sessionId: deps.sessionId, input })`.
  - When no part matches, it appends nothing. A card with no parts keeps its spacing.
  - A build that throws is logged as `entry part <id> failed: <errorText(error)>`, and its wrapper is removed. The
    other parts still draw.
  - A second call in one draw throws `<kind> entry placed entry parts twice` (`permission entry placed entry parts
    twice`). The page host then draws the entry with `default`, as it does for any builder that throws.
  - A layout that never calls it shows no parts. There is no append-unplaced step, unlike forms, because design.md
    § The card says a user layout that leaves out the call shows none.
- **Parts update when the view updates in place, and build again when it builds again.** `redrawSlot` in
  `entry-list.ts` runs `slot.kit.update(entry)` first, then either the view's `update(input)` or a full rebuild,
  which disposes the old kit and makes a new one. The default `permission` builder has no `update`, so an answer
  rebuilds the entry (checked in `redrawSlot`: `view?.update !== undefined` decides). So:
  - `EntryKit.updateParts(input)` runs each placed part's `update?.(input)` in place order. `redrawSlot` calls it
    right after `view.update(input)` returns without throwing, before its `return`.
  - When the slot is drawn again (a view with no `update`, a changed pick, or an update that threw), the new kit
    builds the parts afresh with the new input, and `updateParts` is not called.
  - A part `update` that throws is logged only the first time for that placed part, as
    `entry part <id> update failed: <errorText(error)>`. The other parts still update.
  - `EntryKit.update(entry)` stays as it is (permission actions only).
- **The default `permission` builder** (`layouts/default/layout.js`, around line 772), top to bottom inside the edge
  card:
  1. `kit.entryParts(prompt)`.
  2. `div.chat-permission-head` holding `span.chat-permission-tool` with `input.toolName`, then, only when
     `input.summary !== ''`, `span.chat-permission-target` with `input.summary`. The `Allow <tool>?` text goes: the
     actions ask it.
  3. `kit.expander(prompt, 'Full call', body)`, built closed. `body` makes `div.chat-permission-call` on its first
     call, with `kit.json(call, input.input)` inside, keeps it, and returns the same element on every later open.
     The builder keeps no `update`, so the comment above it stays true and reads:
     `// No update: an answer builds the entry again, its card losing the attention edge and its parts built anew.`
  4. `kit.permissionActions(prompt)`.
  The edge stays `attention` while unanswered and none once answered, as now.
- **The styles go in `layouts/default/layout.css`**, where `.chat-permission-head` already lives, not in
  `page/chat.css`: they style the default layout's own classes. Theme tokens only.
  - `.chat-permission-head` keeps `margin-bottom: var(--wg-space-1)`, gains `display: flex; flex-wrap: wrap;
    align-items: baseline; gap: var(--wg-space-2)`, and drops its `font-weight`.
  - `.chat-permission-tool` takes `font-weight: var(--wg-weight-semibold)`.
  - `.chat-permission-target` takes `font-family: var(--wg-font-mono); font-size: var(--wg-text-12); color:
    var(--wg-fg-secondary); overflow-wrap: anywhere; min-width: 0`.
  - `.chat-permission-call .chat-json` takes `white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: hidden`.
    Every other `.chat-json` keeps `white-space: pre` and scrolls sideways.
- **`ChatKit.entryParts` doc comment** in `layouts/layout.d.ts`, placed after `permissionActions`:
  `// \`div.chat-entry-parts\`, holding one \`div.chat-entry-part\` (\`data-part="<id>"\`) per part other plugins added`
  `// for this entry's kind, in the order they were added, each built for the entry and its session; appends nothing`
  `// when no part draws in the kind. Call it once, where the parts go: a layout that leaves it out shows no parts. A`
  `// part that throws is logged and draws nothing. A second call throws \`<kind> entry placed entry parts twice\`, so`
  `// the entry draws with \`default\`. A view's \`update\` updates the parts after it; a view drawn again builds them again.`
- **`contract.ts` doc comments**, in the `addEntryRenderer` style. In the `ChatPageExports` block comment, after the
  `addEntryRenderer` paragraph:
  `// \`addEntryPart\` adds a part drawn inside entries of its \`kinds\` until its`
  `// \`dispose\`, wherever a layout calls \`kit.entryParts\`; it throws on an id`
  `// already added, and adding or disposing one redraws every Chat tab's entries.`
  Above `ChatEntryPartContext`:
  `// What a part's \`build\` is handed: the session the entry belongs to, and`
  `// the entry's input as the layout's builder gets it.`
  Above `ChatEntryPart` (placed after `ChatEntryRenderer`):
  `// Draws inside entries of \`kinds\`, a known kind or a harness's own, into`
  `// its own wrapper. \`update\`, when returned, runs with each later version of`
  `// the entry after the entry's view updated in place; an entry drawn again`
  `// builds the part again. A \`build\` that throws is logged and draws nothing;`
  `// the entry still draws.`
- **The preview's permission entries** (`main/preview/preview-session.ts`, `preview-7` to `preview-9`) carry the
  `summary` their tool would mint: `src/app.ts` (Edit), `rm -rf build` (Bash), `notes.md` (Write). 01 adds the
  field, so its typecheck already forces a value here; 02 makes sure these are the values.
- **Chat's self-test opens and closes the Full call.** In `PERMISSION_CURSOR_STEPS`, after the first
  `...NEWER_CARD_FOCUSED_STEPS` and before the `y` step, two steps:
  `{ keys: ['Enter'], expect: '[chat] expanded permission entry', screenshot: 'permission-full-call', checksFit: true }`
  and `{ keys: ['Enter'], expect: '[chat] collapsed permission entry' }`. The log lines exist: `toggleEntry` in
  `page/chat-commands.ts` logs `` `${result} ${kind} entry` ``, and a permission entry has no markdown block, so
  Enter reaches the entry's expanders. Until now the card had none, so this is the first step that opens one.
  The step opens and closes the expander and screenshots it; `FAKE_PERMISSION_TEXT`'s input is too short to wrap, so
  07 checks the wrap on a long input. The `permission cursor`
  group's `why` gains, after its first sentence:
  ` Enter on the focused card opens its Full call and Enter again closes it.`

GIVEN a permission entry with `toolName: 'Bash'`, `summary: 'rm -rf build'` and no answer WHEN the default layout
draws it THEN its edge card holds, in order, the contributed parts, a head reading `Bash` then `rm -rf build` in the
mono font, a closed `Full call` expander, and Allow once and Deny.

GIVEN a permission entry whose `summary` is empty WHEN it draws THEN the head holds the tool name and no target span.

GIVEN the Full call expander WHEN the user opens it THEN the input shows as pretty-printed JSON whose long lines wrap.

GIVEN a part added with `kinds: ['permission']` WHEN a Chat tab draws a permission entry and an assistant entry
THEN the part builds once, in the permission entry, with that tab's session id and the entry's input.

GIVEN two parts of the kind added a then b WHEN the entry draws THEN their wrappers hold a then b.

GIVEN a part whose build throws WHEN the entry draws THEN `[chat] entry part <id> failed: <reason>` is logged, the
part leaves no wrapper, and the card and the other parts still draw.

GIVEN a part already added WHEN another part with the same id is added THEN `addEntryPart` throws
`part <id> is already added`.

GIVEN open Chat tabs WHEN a part is added or its `Disposable` disposed THEN every tab's entries draw again.

GIVEN an entry whose view has an `update` WHEN the entry arrives again THEN each placed part's `update` runs with the
new input after the view's. GIVEN the default permission entry WHEN its answer arrives THEN the entry builds again
and its parts build again with the answered input.

## Tests

- `page/chat-kit.test.ts`: `kitOf` passes `sessionId: 's1'`, `log` (recording into `logged`) and a settable
  `entryParts` list; `createEntryKit` takes the entry's input (the entry itself for these fixtures). `PERMISSION`
  gains `summary: ''`.
  - New table test `entryParts_PlacesPartsOfTheKindInAddOrder: $case`. Each row: the entry, the parts (id, kinds,
    whether build throws), the expected wrapper ids in the holder (null for no holder), and the expected logs. Rows:
    - a permission entry with parts a (`permission`), b (`tool`), c (`permission`, `tool`): wrappers `['a', 'c']`
    - an assistant entry with those parts: no holder
    - no parts added: no holder
    - a permission entry with a (`permission`, build throws `boom`) and c (`permission`): wrappers `['c']`, logs
      `['entry part a failed: boom']`
    - a harness kind `fake:card` with a part of kinds `['fake:card']`: wrappers `['a']`
  - `entryParts_Build_GetsSessionIdAndInput`: the build's context equals `{ sessionId: 's1', input }`, and each
    wrapper's `dataset.part` is its id.
  - `entryParts_CalledTwice_Throws`: the second call throws `permission entry placed entry parts twice`.
  - `updateParts_RunsEachPartsUpdate_LogsAThrowOnce`: parts a, whose update throws `boom`, and b. Two
    `updateParts(next)` calls give b two calls with `next` and log only `['entry part a update failed: boom']`.
- `page/entry-list.test.ts`: one table test `redraw_EntryParts_UpdateInPlaceOrBuildAgain: $case` in
  `describe('entry list')`, with a part of the drawn kind that counts builds and records each update's input. Rows:
  an assistant entry drawn by a user layout whose view has an `update` (one build, one update with the second
  input), a permission entry drawn by `default`, put again with an answer (two builds, no update), and an assistant
  entry drawn by a user layout whose view `update` throws (two builds, no update, and one wrapper per part in the
  rebuilt entry). The list deps fixture gains `sessionId`, `entryParts` and `log`.
- `page/chat-view.test.ts`: `entryParts_AddAndDispose_RedrawsEveryTabsEntries` in a `describe('mountChatView entry
  parts')`, modelled on `renderers_AddAndDispose_RedrawsEveryTabsEntries`: a tab showing a permission entry has no
  `chat-entry-part`, then one with `data-part` of the added id after `add`, then none after `dispose`. A second
  test, `entryParts_Build_GetsEachTabsOwnSessionId`, mounts two tabs with session ids `s1` and `s2`, each showing a
  permission entry, and asserts the part's builds received `s1` and `s2`, one each: it breaks if `KitDeps.sessionId`
  comes from the focused tab instead of the drawing tab. `mounted()`
  makes a `createPartStore<ChatEntryPart>()` and passes it as `entryParts`, counted like the other stores. The
  duplicate id rule is `createPartStore`'s own, already covered by `add_TakenId_Throws` in
  `src/shared/page/contributed-parts.test.ts`, so it gets no new test.
- `layouts/default/layout.test.ts`: `fakeKit` gains `entryParts: (parent) => part(parent, 'div', 'entryParts')`
  (returning nothing to the caller) and `expander`, which records its summary and body in `calls.expanders` and
  appends a part tagged `expander:<summary>`. `permissionEntry` gains `summary: 'rm x'`. The two permission tests
  become:
  - `permission_draws: $case`, a table over the unanswered entry and an entry with `summary: ''`. The card's
    children are `['entryParts', <head>, 'expander:Full call', 'permissionActions']` in that order. The head's
    children are `span.chat-permission-tool:Bash` then `span.chat-permission-target:rm x`, or the tool span alone
    for the empty summary. `view.update` is undefined.
  - `permission_fullCallBody_holdsTheInputJson_sameElementEachOpen`: calling the recorded body twice returns the
    same `div.chat-permission-call`, holding `json:{"command":"rm x"}` once.
  - `permission_answeredPlainCard` stays, with `summary` on its input.
- Run: `npm test -- src/plugins/chat` (every chat test, since `KitDeps` and `createEntryKit` change for each fixture)
  and `npm test -- src/shared/page/contributed-parts.test.ts`.

## Approach

- In `chat-kit.ts`, the kit holds a `placedParts: { id: string; update?: (input) => void; isUpdateFailureLogged:
  boolean }[] | null`, null until `entryParts` runs, the same shape as forms' `PlacedPart`.
- `chat-view.ts`'s store subscriptions list gets the new `onChanged`, so the view's `dispose` ends it too.

## Done when

- `npm run typecheck` passes.
- `npm run lint` passes (`check-styles` judges the new CSS).
- `npm test -- src/plugins/chat` and `npm test -- src/shared/page/contributed-parts.test.ts` pass.
- `npm run selftest -- --plugin chat` passes, the `permission cursor` group included.
- The look of the card (the target line, the wrapped Full call) is checked in 07, Final verification, from the
  `chat-permission-full-call` screenshot and the layout preview.

## Commit

One commit for the group, by pathspec over the Files above, with no co-author trailer:
`chat: addEntryPart and kit.entryParts; permission card shows its target line and folds the call into Full call`

## Proof

Commit 2c084001, b4773ef2 · proof: diff read: addEntryPart, ChatEntryPart(Context), kit.entryParts, PermissionInput.summary present; wave typecheck and lint pass after test-typing fix on the same rung · concerns: entryParts returns void though the ChatKit header says every part returns what it appended; the entry-parts onChanged keeps toastedKinds
