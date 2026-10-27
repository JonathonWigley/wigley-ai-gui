# 04 — Chat entries onto the host

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Chat's entries draw through the page host from task 02, in the host's part form `(parent, input, kit)`, and
`ChatKit` extends the shared `BaseKit`. So task 14's new chat parts (composer, start prompt, sign-in dialog) and the
entries share one form and one kit base. Chat's own fallback code in `entry-list.ts` and its reader skeleton go.
Chat's other surfaces are task 14's.

Files:

- modify `src/plugins/chat/layouts/layout.d.ts`
- modify `src/plugins/chat/layouts/default/layout.js` · test `src/plugins/chat/layouts/default/layout.test.ts`
- modify `src/plugins/chat/page/entry-list.ts` · test create `src/plugins/chat/page/entry-list.test.ts`
- modify `src/plugins/chat/page/chat-kit.ts` · test create `src/plugins/chat/page/chat-kit.test.ts`
- modify `src/plugins/chat/page/read-chat-layout.ts` · test `read-chat-layout.test.ts`
- modify `src/plugins/chat/page/chat-view.ts` (kit deps), `src/plugins/chat/page/start.ts` (commands and platform
  into the view's deps)
- modify `src/plugins/chat/ids.ts`
- modify `docs/features/agent-chat/design.md` § Layouts and the image viewer paragraph; `AGENTS.md` § A chat layout

Consumes ← 02 (`src/shared/page/layout-host/`, exact signatures in `02-layout-core.md` § Produces):

- `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>): { built: R; layoutName: string; dispose(): void }`,
  `RollbackDeps` (`draw-part.ts`)
- `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps` (`keys.keysFor` returns `string | null`),
  `KitCommands { exists(id): boolean; run(id): void }` (`base-kit.ts`)
- `readLayoutModule(module, name)`, `isRecord(value)` (`read-layout-module.ts`)
- `BaseKit`, `DotStatus` (`kit.d.ts`)
- `api.layouts.show` (task 02 already switched chat's `page/start.ts` to it)

Produces (chat names task 14 and 15 consume):

- `ChatLayout` in `src/plugins/chat/layouts/layout.d.ts`, the layout type. Its `entries` stay required, every kind,
  so `ChatLayout` is also the complete layout; chat has no separate complete-layout type. Task 14 adds its surfaces
  to `ChatLayout` itself.
- entry builder form:
  `entries: { [K in EntryKind]: (parent: HTMLElement, input: EntryInput<K>, kit: ChatKit) => EntryView<K> }` — the
  builder appends its element to `parent` and returns it in `element`.
- `ChatKit extends BaseKit` in `layout.d.ts`, with chat's parts:
  ```ts
  json(parent: HTMLElement, value: unknown): HTMLElement;
  expander(parent: HTMLElement, summary: string, body: () => HTMLElement): HTMLElement;
  collapsibleCard(parent: HTMLElement, options: CollapsibleCardOptions): CollapsibleCard;
  edgeCard(parent: HTMLElement, edge?: CardEdge | null): HTMLElement;
  permissionActions(parent: HTMLElement): HTMLElement;
  images(parent: HTMLElement): HTMLElement;
  ```
  `markdown`, `card`, `statusDot`, `setDotStatus` and `sectionHeader` are `BaseKit`'s (parent first).
- `DotStatus` re-exported from `layout.d.ts` (`export type { DotStatus } from '…/kit'`); chat's own `DotStatus`
  goes.
- `readChatLayout(module: unknown, name: string): ChatLayout` in `read-chat-layout.ts`, signature unchanged.
- `chatCommandNamed(short: string): CommandId | null` in `src/plugins/chat/ids.ts` (new; it does not exist today),
  written as `formsCommandNamed` is.
- `createEntryKit(entry: ChatEntry, deps: KitDeps): EntryKit` in `chat-kit.ts`, signature unchanged; `KitDeps`
  gains `platform: Platform`, `commands: KitCommands`, and `keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>`.

## Decisions

- **Contract.** `layout.d.ts` writes `import type { BaseKit, DotStatus } from '../../../shared/page/layout-host/kit';`
  (the specifier 02 pins; the registry rewrites it to `'../kit'` in the user's copy). Chat's old parent-less parts
  change to the parent-first form above. `card(edge)` becomes `edgeCard(parent, edge)`, since `BaseKit.card` is
  `card(parent, className?)`. No user chat layout exists (a plan precondition), so the change breaks nothing on disk.
- **Default layout.** `layouts/default/layout.js` moves to the new form: each builder appends what it builds to
  `parent` and draws the same elements, classes and text as today. Its tests move with it. The `tool` entry draws
  its dot with `kit.statusDot(root, toolStatus(input))` into the entry root and passes the element it returns as the
  collapsible card's `leading`; the card's head appends `leading`, so it moves the dot into the head, as today.
- **Kit.** `createEntryKit` builds `createBaseKit({ markdown, keys, commands, platform, scope: chatScope('chat'),
  commandNamed: chatCommandNamed })` and spreads it under chat's parts. The base kit's anchors go through a
  recorder kept by the entry kit, and `EntryKit.dispose` disposes them with the permission actions' anchors.
  `chat-view.ts` hands `platform` and `commands` into `KitDeps`; `page/start.ts` builds `commands` as
  `{ exists: (id) => api.keys.command(id) !== undefined, run: (id) => api.commands.run(id) }`.
- **Entries.** `buildEntry` calls `drawPart` with `owner: 'chat'`, `parent` = the entry's slot (`li.chat-entry-slot`),
  `pick` = `{ name: shown.name, layout: shown.layout }` (`{ name: 'default', layout: defaultLayout }` once the slot
  draws with default), `defaultLayout`, `part: (layout) => layout.entries[entry.kind]`, `partName: '<kind> entry'`,
  `logSource: 'chat'`. Its `build` makes the entry kit, records `() => kit.dispose()` through `rollback.recordBox`,
  calls the builder, and returns `{ element: view.element, view, kit }`; the call returns
  `{ built, layoutName, dispose }`, and the slot keeps `dispose`, which runs `kit.dispose()`.
  `drawPart` sets `data-layout` and `data-layout-owner="chat"` on the entry's root. A layout's `layout.css` selects under `[data-layout-owner="chat"][data-layout="<name>"]`. The host's log line is
  `layout <name> <kind> entry failed: <error>`, chat's line today.
- **Toasts and the bare line** stay chat's. When `drawPart` returns `layoutName` `default` and the shown layout is
  not `default`, chat toasts `Chat layout <name>: <kind> entries drawn with default` once per kind per shown layout,
  as today. When `drawPart` throws (the default builder threw), chat logs `default layout <kind> entry failed:
  <error>`, draws the bare `div.chat-entry.chat-raw` line naming the kind, and toasts
  `Chat layout default: <kind> entries drawn as bare lines` once per kind when the shown layout is `default`.
- **Redraw.** `redrawSlot` keeps its order: the kit's update, then the view's `update`; an update that throws under
  the shown layout is logged and toasted as today (`layout <name> <kind> entry update failed`) and the slot draws
  with default from then on. A rebuild reads the open expander states, calls the previous draw's `dispose` (so the
  old kit is disposed), empties the slot, draws through `drawPart` into it, then restores the open states. Where the
  list disposes every slot's kit today (`disposeKits`, on a new list and on `dispose`), it calls each slot's
  `dispose` in its place.
- **Reader.** `readChatLayout` takes its record from `readLayoutModule(module, name)` and checks each kind with the
  host's `isRecord`; chat's `isRecord` goes. Its messages stay.
- **Docs.** `docs/features/agent-chat/design.md` § Layouts says user chat layouts are folders in
  `~/.config/wigley-ai-gui/layouts/chat/`, drawn through the core layout service and the page host (not chat's
  plugin data, and not "the forms layout machinery moves to the shared layer"); the image paragraph names
  `images(parent)`. `AGENTS.md` § A chat layout says each entry kind's builder takes `(parent, entry, kit)`, that
  `ChatKit` extends the shared base kit, and names `edgeCard` in place of `card`.

GIVEN a shown chat layout `fancy` whose `tool` builder anchors a key, appends a card, and throws
WHEN a tool entry arrives
THEN the anchor is disposed, the card is gone from the slot, `[chat] layout fancy tool entry failed: <error>` is
logged, `Chat layout fancy: tool entries drawn with default` is toasted once, and the default tool entry draws in the
slot.

## Tests

- `entry-list.test.ts`, `buildEntry` as one table — rows: shown layout draws (no toast); shown layout throws (default
  draws, one toast per kind across two such entries; and when the `fancy` `tool` builder anchors a key through the
  kit and appends a card before it throws: that anchor is disposed, the slot holds only the default entry's element,
  and `[chat] layout fancy tool entry failed: <error>` is logged; break: `buildEntry` not recording
  `() => kit.dispose()` through `rollback.recordBox`, the one place chat wires its rollback); default throws (bare line, toast only when default is shown);
  update throws under the shown layout (the slot draws with default from then on). Break: a toast per entry, a lost
  bare line, a slot that keeps retrying the broken layout.
- `chat-kit.test.ts`: `dispose_DisposesBaseKitAnchors` — an anchor named through the base kit's `keyHint` is
  disposed by `EntryKit.dispose`. Break: anchors leaking from a rolled-back or dropped entry.
- `read-chat-layout.test.ts`: keep its cases.
- `layouts/default/layout.test.ts`: the existing cases, each builder now called with a parent; each case also checks
  the returned element is `parent`'s child. Break: a default builder that returns an element it never appended,
  which `drawPart` would reject.

Done when: `npm test` and `npm run lint` pass. `grep -n "function isRecord\|buildDefaultEntry\|reportLayoutFailure"
src/plugins/chat/page/*.ts` prints nothing. The live checks go to task 17 (Final verification).

Commit: one commit for the group.

## Proof
