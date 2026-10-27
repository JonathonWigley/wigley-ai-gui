# 12 — Keys overlays layout

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

**Contents**

- **Intent** — what this task changes and what a good outcome is.
- **Files** — every path this task creates, modifies or tests.
- **Consumes** — the names this task takes from task 02.
- **Produces** — the contract, the reader, the views and the setting.
- **Decisions** — the parts, what the app keeps, the scopes, the reload rules.
- **Behaviour** — GIVEN / WHEN / THEN.
- **Tests** — each test and the break it catches.
- **Done when** and **Commit**.

## Intent

The keys plugin draws three surfaces: the help overlay (`Space ?`), the which-key panel and the title bar's Keys
button. After this task, each surface draws through a `keys` layout. The user picks the layout with the setting
`keys.layout`. The built-in `default` layout draws the same look as today. The keys plugin keeps the keys, the
scopes, the anchors, the dialog and panel lifecycle and the which-key timers. The KeyPrompt and Kbd primitives stay
app-owned: themes style them, and a layout places them only through its kit.

## Files

- modify `src/plugins/keys/layouts/layout.d.ts` — replace 02's placeholder (`export {};`) with the keys layout
  contract.
- create `src/plugins/keys/layouts/default/layout.js` — the built-in look, plain JS under `// @ts-check`.
- create `src/plugins/keys/page/layout/read-keys-layout.ts` — the reader.
- create `src/plugins/keys/page/layout/keys-kit.ts` — the kit builders and the short-name lookup.
- create `src/plugins/keys/page/layout/keys-parts.ts` — draws each part through the host, per part pick.
- modify `src/plugins/keys/page/help-view.ts` — the help body draws through the `help` part.
- modify `src/plugins/keys/page/which-key-view.ts` — the panel body draws through the `whichKey` part.
- modify `src/plugins/keys/page/start.ts` — calls `api.layouts.show`, builds the Keys button through the
  `titleBarButton` part, and redraws on a new set.
- modify `src/plugins/keys/page/keys.css` — the help dialog width rule keys on an app class (see Decisions).
- modify `src/plugins/keys/manifest.ts` — the `layout` setting and its `settingInfo`.
- test `src/plugins/keys/page/layout/read-keys-layout.test.ts` (new)
- test `src/plugins/keys/page/layout/keys-parts.test.ts` (new)

This task does not edit `src/plugins/main.ts`, `scripts/check-layers.mts` or `src/plugins/keys/main/start.ts`.

## Consumes

Names as `02-layout-core.md` § Produces writes them:

- ← 02: the register-only main part `src/plugins/keys/main/start.ts`. It calls
  `api.layouts.register({ layoutTypes })` with the raw text of `src/plugins/keys/layouts/layout.d.ts`. It is listed in
  `src/plugins/main.ts`. Its LAYERS entry exists. It needs no change when this task fills the contract.
- ← 02: the LAYERS entries `src/plugins/keys/layouts` (`layers: ['src/shared/page/layout-host']`), and
  `src/plugins/keys/page` listing `src/plugins/keys/layouts` and `src/shared/page/layout-host`.
- ← 02: `PageApi.layouts.show<L>(options: ShowLayoutOptions<L>): LayoutShow`, with `ShowLayoutOptions<L>`,
  `ShownLayouts<L>` and `LayoutShow` from `src/contracts/plugin.ts`.
- ← 02, from `src/shared/page/layout-host/`: `readLayoutModule(module, name)`, `isRecord(value)`,
  `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>): { built: R;
  layoutName: string; dispose(): void }` (options `owner`, `parent`, `pick`, `defaultLayout`, `part(layout)`, `build(builder, parent,
  rollback): R`, `log`, `logSource`, `partName`), `PartPick<L>`, `RollbackDeps`, `requireElementIn`,
  `pickLayout<L>(chain, layouts, defines)`, `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps`
  (`keys.keysFor` returns `string | null`; `scope: ViewScope | null`), `KitCommands { exists(id): boolean; run(id):
  void }`, `commandRunner(qualifiedId: CommandId, commands: KitCommands): () => void`.
- ← 02: `BaseKit`, `KeyHintOptions` and `KitRowOptions` in the core's `kit.d.ts`, imported in the contract as
  `import type { BaseKit } from '../../../shared/page/layout-host/kit';` (the registry rewrites it to `'../kit'` in
  the user's copy). This task uses its members `el`, `sectionHeader`, `kbd`, `keyHint(parent, command, options?:
  KeyHintOptions)`, `command` and `row(parent, options: KitRowOptions)`.
- The tree's own: `createDialog` (`src/shared/page/ui/dialog.ts`), `floatingPanel` and `openFloatingPanel`
  (`floating-panel.ts`), `iconButton` (`icon-button.ts`), `createAnchors` (`page/anchors.ts`), `helpSections`,
  `whichKeyModel`, `startWhichKey`.

## Produces

`src/plugins/keys/layouts/layout.d.ts`:

```ts
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One key in help: its keys as the user reads them, and what it does.
export interface HelpHint { keys: string; label: string }
export interface HelpSectionInput { title: string; hints: readonly HelpHint[] }
export interface HelpInput { sections: readonly HelpSectionInput[] }
// One key that continues a pending sequence.
export interface WhichKeyEntryInput { keys: string; label: string; kind: 'command' | 'prefix' }
export interface WhichKeyInput { title: string; entries: readonly WhichKeyEntryInput[] }

export interface KeysKit extends BaseKit {
  // `button.ui-icon-button.ui-icon-button--sm` holding the Codicon `icon`, `label` as its tooltip and aria-label;
  // never takes focus.
  iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement;
}
export interface HelpKit extends KeysKit {
  // Draws `section` through the `helpSection` part the layouts pick, appended to `parent`.
  section(parent: HTMLElement, section: HelpSectionInput): HTMLElement;
}
export interface HelpSectionKit extends KeysKit {
  // Draws `hint` through the `helpRow` part the layouts pick, appended to `parent`.
  hint(parent: HTMLElement, hint: HelpHint): HTMLElement;
}
export interface WhichKeyKit extends KeysKit {
  // Draws `entry` through the `whichKeyEntry` part the layouts pick, appended to `parent`.
  entry(parent: HTMLElement, entry: WhichKeyEntryInput): HTMLElement;
}

// Every part appends its element to `parent` and returns it.
export interface Layout {
  help?(parent: HTMLElement, input: HelpInput, kit: HelpKit): HTMLElement;
  helpSection?(parent: HTMLElement, input: HelpSectionInput, kit: HelpSectionKit): HTMLElement;
  helpRow?(parent: HTMLElement, input: HelpHint, kit: KeysKit): HTMLElement;
  whichKey?(parent: HTMLElement, input: WhichKeyInput, kit: WhichKeyKit): HTMLElement;
  whichKeyEntry?(parent: HTMLElement, input: WhichKeyEntryInput, kit: KeysKit): HTMLElement;
  titleBarButton?(parent: HTMLElement, kit: KeysKit): HTMLElement;
}
export interface CompleteLayout extends Layout { /* every member of Layout, required */ }
```

Notes for the contract text:

- `HelpSectionKit.hint` draws one help row through the `helpRow` part. It is not named `row`: `BaseKit.row(parent,
  options: KitRowOptions)` takes options a `HelpHint` does not match, so a `row(parent, hint: HelpHint)` member
  would not compile.
- Write a comment on `Layout` that says: each part comes from the first layout that defines it among the
  `keys.layout` setting and `default`; a part that throws or returns no element appended to `parent` is drawn by
  `default` instead.

Other names:

- `src/plugins/keys/page/layout/read-keys-layout.ts`: `export function readKeysLayout(module: unknown, name: string):
  Layout`.
- `src/plugins/keys/page/layout/keys-kit.ts`: `export function keysCommandNamed(short: string): CommandId | null` —
  `keys.<short>` when the keys manifest declares `short`, else null.
- `src/plugins/keys/page/layout/keys-parts.ts`: `export interface KeysParts { help(parent: HTMLElement, input:
  HelpInput): Drawn; whichKey(parent: HTMLElement, input: WhichKeyInput): Drawn; titleBarButton(parent: HTMLElement):
  Drawn; setLayouts(shown: ShownLayouts<Layout>): void }` with `interface Drawn { element: HTMLElement; dispose():
  void }`, and `export function createKeysParts(deps: KeysPartsDeps): KeysParts`. `dispose` removes the element and
  disposes every anchor the drawn part (and its nested parts) recorded.
- `src/plugins/keys/manifest.ts`: setting `layout: 'default'`.

## Decisions

**The parts.** Each pane and each repeated row of the three surfaces is a part:

| Part | Today's code | Repeated? |
| --- | --- | --- |
| `help` | `help-view.ts` `mountHelpView`: `div.keys-help-sections` grid in the dialog body | pane |
| `helpSection` | `help-view.ts` `renderSection`: `section.keys-help-section`, `sectionHeader`, `ul.keys-help-list` | per section |
| `helpRow` | `renderSection`: `row({ density: 'list', label, trailing: kbd, tag: 'li' })` | per hint |
| `whichKey` | `which-key-view.ts` `show`: `sectionHeader(title)` and `div.which-key-list` | pane |
| `whichKeyEntry` | `which-key-view.ts` `show`: list row with `which-key-row is-<kind>` | per entry |
| `titleBarButton` | `start.ts`: `iconButton('record-keys', 'Keys', …, 'sm')` with class `keys-title-bar-button` and the hint `span.keys-title-bar-hint` | once |

**Each part picks on its own.** Every part, nested parts included, uses `pickLayout(chain, layouts, defines)` with
the chain `[shown.user, 'default']` and draws through `drawPart` with `owner` `keys`, `logSource` `keys` and
`partName` the part's key. Each part root carries `data-layout="<name>"` and `data-layout-owner="keys"`. So a user layout that defines only `helpRow` gets
its rows inside the default sections. The keys plugin names no layout per item, so `namesInUse` is left out.

**What the app keeps:**

- the help dialog: `createDialog('Keys')`, its scrim, `show` / `hide`, its title, and the Close button in
  `dialog.actions` with the `keys.closeHelp` anchor in scope `keys.help`. The `help` part draws only into
  `dialog.body`.
- the pushed `keys.help` scope, focus before help and its return, and close on `onBaseChanged`.
- the which-key `floatingPanel` with class `which-key`: its placement, `hidden`, `openFloatingPanel`, and the timers
  and logs in `which-key-controller.ts`. The `whichKey` part draws the panel's children only.
- the help sections and the which-key model (`helpSections`, `whichKeyModel`): the layout gets them as input, with
  keys already formatted for the platform.
- the anchors registry, `keysFor`, `onChanged`, the unplaced log, and the `showHints` setting.
- the Keys button's slot: the app contributes one `span.keys-title-bar-slot` to `api.areas.titleBar` with
  `{ align: 'end' }`, once, at start. The `titleBarButton` part draws inside it. Add
  `.keys-title-bar-slot { display: contents; }` to `keys.css`.
- the help dialog width: the app adds the class `keys-help-dialog` to the dialog panel. Change the `keys.css` rule
  `.ui-dialog:has(> .ui-dialog-body > .keys-help-sections)` to `.ui-dialog.keys-help-dialog`, so every layout's help
  gets the wide dialog.

**The kit.** `createKeysKit` builds `createBaseKit` with these `BaseKitDeps`:

- `markdown`: `api.services.markdown`.
- `keys.anchor`: `anchors.anchor` (the plugin's own registry, not its exports).
- `keys.keysFor`: returns `keysFor(keys.keymap(), command, scope, platform)`, a `string | null`, as it is.
- `commands`: the `KitCommands` `{ exists: (id) => api.keys.command(id) !== undefined, run: (id) =>
  api.commands.run(id) }`, as 02's Kit commands decision writes it.
- `commandNamed`: `keysCommandNamed`.
- `platform`: `api.platform`.
- `scope`: `keys.help` for `help`, `helpSection` and `helpRow`. `any` for `whichKey` and `whichKeyEntry`. `null`
  for `titleBarButton`.

With `scope: null` the base kit anchors with no `scope` option, so `keyHint` on the Keys button passes only `label`
to `anchors.anchor`. Today's button hint has no scope and shows in every scope. An anchor with scope `any` shows only
while `any` is the scope in force. The kit does not wrap `keys.anchor` to drop the scope.

`KeysKit.iconButton` calls `iconButton(icon, label, onClick, 'sm')` and appends the result to `parent`. It stays in
the keys kit: 02's `BaseKit` holds no icon button.

**No picker or prompt.** Keys opens no list picker and no confirm prompt, so this task fills neither hook.

**The default layout** draws today's DOM and class names, so `keys.css` keeps styling it. The default
`titleBarButton` draws `kit.iconButton(parent, 'record-keys', 'Keys', kit.command('keys.toggleHelp'))`, adds the
class `keys-title-bar-button`, and appends `kit.keyHint(button, 'toggleHelp', { className: 'keys-title-bar-hint' })`.
The default `helpRow` draws `kit.row(parent, { density: 'list', label, trailing: <kbd>, tag: 'li' })`. The 640px
media rule in `keys.css` stays as it is.

**Reloads.** `setLayouts(shown)` stores the shown layouts. Then:

- the Keys button: dispose the drawn button, then draw `titleBarButton` again in its slot.
- help: when help shows, draw `help` again into `dialog.body` in place of the old one. Help stays shown. When help is
  hidden, draw it on the next `setSections` or `show`. Do not leave two bodies.
- which-key: no redraw. The next `show` draws with the layouts stored then.
- `help.setSections` (a keymap change) draws the `help` part again with the same layouts.

A drawn part's anchors are disposed when the part is drawn again. `drawPart`'s `RollbackDeps.recordAnchor` records
them, and `Drawn.dispose` calls the `dispose` that `drawPart` returns (and that of each nested part) before it
removes the element.

**The setting.** In `manifest.ts`, `settings` gets `layout: 'default'`, and `settingInfo` gets:

- `layout: { label: 'Keys layout', description: 'The layout that draws help, which-key and the Keys button: a folder
  in the layouts/keys folder, or default.' }`

`start.ts` calls `api.layouts.show({ defaultLayout, read: readKeysLayout, userLayout: () => api.settings().layout,
setLayouts: (shown) => parts.setLayouts(shown) })`. The show refreshes on each change of keys' settings by itself,
so `start` calls no `refresh`.

**The reader.** `readKeysLayout` calls `readLayoutModule(module, name)`. It throws `layout <name>: <key> is not a
layout part` for a key outside the six parts. It throws `layout <name>: <part> is not a function` for a part that is
not a function. The pattern is the same as forms' `readLayout`.

## Behaviour

- GIVEN `keys.layout` names a layout that defines only `helpRow` WHEN help opens THEN each section is the default
  section, and each row is the user's row, with `data-layout` set to the user's name and `data-layout-owner` to
  `keys`.
- GIVEN help is open WHEN the user's layout file is saved THEN the help body is drawn again in place, help stays
  open, the `keys.help` scope stays pushed, and the dialog holds one body.
- GIVEN a user `titleBarButton` that throws WHEN the set loads THEN the default Keys button is drawn in the slot, and
  the title bar holds one Keys button.
- GIVEN any layout WHEN the scope in force is not `any` THEN the Keys button's hint still shows.
- GIVEN a which-key panel shows WHEN a new set arrives THEN the panel does not change, and the next show draws with
  the new set.

## Tests

- `read-keys-layout.test.ts` → `readKeysLayout_Shapes_AcceptsOrNamesTheFirstBadKey`. A table with these rows:
  - a module with no default export throws.
  - an unknown key `footer` throws, and the message names `footer`.
  - `helpRow: 3` throws, and the message names `helpRow`.
  - a layout with only `whichKeyEntry` is accepted, and the result holds that function.

  Break: the reader lets a non-function part through, and the throw happens later inside a draw.
- `keys-parts.test.ts` → `help_UserDefinesOnlyHelpRow_RowsFromUserInsideDefaultSections`. Break: a nested part takes
  its parent's pick instead of its own pick.
- `keys-parts.test.ts` → `setLayouts_HelpShown_RedrawsOneBodyInPlace`. Break: a redraw appends a second body, or
  hides the open help.
- `keys-parts.test.ts` → `setLayouts_WhichKeyShown_PanelUnchangedNextShowUsesNewSet`. Show the panel with one set,
  call `setLayouts` with a set whose `whichKey` draws a marker class, and assert the panel's children are the same
  nodes. Then show the panel again, and assert the marker is there. Break: a redraw on each new set, which moves the
  open panel under the user, or a show that keeps the old set.
- `keys-parts.test.ts` → `titleBarButton_Redraw_DisposesOldHintAnchor`. Use a recording `anchor` double. After two
  draws, one anchor is live. Break: an anchor leaks on each reload, and its element stays on the page.
- `keys-parts.test.ts` → `titleBarButton_Hint_AnchoredWithoutScope`. The recording double sees `scope` undefined.
  Break: the kit passes `any`, and the hint hides in every other scope. The button's kit has `scope: null`.

The fallback to `default` on a throw belongs to 02's `drawPart` tests. This task adds no row for it.

Runtime and visual checks go to [17 — Final verification](17-final-verification.md): the default look matches today,
and a user keys layout reloads live.

## Done when

- The code compiles. `npm run lint` passes, including `check-layers` and `check-styles`.
- The test gate runs the tests above and the existing `which-key.test.ts`, `which-key-controller.test.ts`,
  `anchors.test.ts` and `help-sections.test.ts`.

## Commit

One commit for the group. Example message: "Keys draws help, which-key and its title bar button through a keys
layout".

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
