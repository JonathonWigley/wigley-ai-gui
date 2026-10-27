# 13 — Shell layout

Status: in progress
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

**Contents**

- **Intent** — what this task changes and what a good outcome is.
- **Files** — every path this task creates, modifies or tests.
- **Consumes** — the names this task takes from task 02, including the two core-side calls.
- **Produces** — the contract, the reader, the chrome module, the setting.
- **Decisions** — `ShellLayout` versus the user layout, the parts, frames, slots, reloads, the kit.
- **Behaviour** — GIVEN / WHEN / THEN.
- **Tests** — each test and the break it catches.
- **Done when** and **Commit**.

## Intent

The shell chrome draws through a layout that the owner `shell` owns. The chrome is the title bar, the activity bar,
the side bar frame and the status bar. The user picks the layout with the core setting `shell.layout`. The built-in
`default` layout draws the same look as today. A reload of a shell layout draws the chrome again. It does not lose
mode state, focus or scroll.

The session tab strip is not in this task. By the lead's ruling, the sessions plugin owns it
(`src/plugins/sessions/page/session-tabs-view.ts`), and task 10 draws it as its `tabBar` / `tab` parts. The Adopters
table in `docs/features/layouts/design.md` already gives the strip to `sessions`.

## Files

- create `src/renderer/shell/layouts/layout.d.ts` — the shell layout contract.
- create `src/renderer/shell/layouts/default/layout.js` — the built-in look, plain JS under `// @ts-check`.
- create `src/renderer/shell/read-shell-layout.ts` — the reader.
- create `src/renderer/shell/shell-chrome.ts` — draws the chrome parts into app-owned slots and draws them again on
  a new set.
- modify `src/renderer/shell/shell.ts` — `Shell.setChromeLayout`.
- modify `src/renderer/shell/title-bar.ts` — remove `mountTitleBarContext` and `mountDevTag`. `shell-chrome.ts`
  draws them. Delete the file if nothing is left in it.
- modify `src/renderer/shell/activity-bar.ts` — each item draws through the `activityItem` part.
- modify `src/renderer/shell/shell.css` — slot rules and the context and badge rules (see Decisions).
- modify `src/renderer/config-push.ts` — remove `contributeConfigProblems`. `PushTargets['problems']` stays the same.
- modify `src/renderer/renderer.ts` — wires the chrome, the setting and the page-side show.
- modify `src/main/main.ts` — registers the owner `shell`.
- modify `src/shared/command-registry.ts` — adds `has(id)` for the shell kit's `KitCommands` (see The kit).
- modify `src/contracts/settings.ts` and `src/config/settings.ts` — the core setting `shell.layout`.
- test `src/renderer/shell/read-shell-layout.test.ts` (new)
- test `src/renderer/shell/shell-chrome.test.ts` (new)
- test `src/renderer/shell/shell.test.ts` — add one test.
- test `src/renderer/config-push.test.ts` — remove the `contributeConfigProblems` block. Its four cases move to
  `shell-chrome.test.ts`.

## Consumes

Names as `02-layout-core.md` § Produces writes them:

- ← 02: the main call for an owner that is not a plugin, `LayoutService.register(owner: LayoutOwner, layoutTypes:
  string): Disposable` (`src/main/layouts/layout-service.ts`). `main.ts` calls it as
  `layoutService.register('shell', shellLayoutTypes)` on the service it builds in `createWindow`.
- ← 02: the page call for an owner that is not a plugin, `PageLayouts.show<L>(owner: LayoutOwner, options:
  ShowLayoutOptions<L>): LayoutShow` (`src/shared/page/layout-host/show-layouts.ts`). `renderer.ts` builds the
  `PageLayouts` with `createPageLayouts` (task 02) and hands it to `createPageApi`; this task calls
  `pageLayouts.show('shell', options)` on the same object. `api.layouts.show` wraps the same call with a plugin's
  id, and refreshes on that plugin's settings. The shell show has no such wrapper, so `renderer.ts` calls `refresh`
  itself.
- ← 02: the LAYERS entries `src/renderer/shell/layouts` (`layers: ['src/shared/page/layout-host']`);
  `src/renderer` (which holds `src/renderer/shell/`) listing `src/renderer/shell/layouts` and
  `src/shared/page/layout-host`; `src/renderer/renderer.ts` listing both; `src/main/main.ts` listing
  `src/renderer/shell/layouts` for the `?raw` import. This task does not edit `scripts/check-layers.mts`.
- ← 02: the repo specifier `import type { BaseKit } from '../../../shared/page/layout-host/kit';` in
  `src/renderer/shell/layouts/layout.d.ts`. It resolves from `src/renderer/shell/layouts/` with no tsconfig change,
  and the registry rewrites it to `'../kit'` in `layouts/shell/layout.d.ts`.
- ← 02, from `src/shared/page/layout-host/`: `readLayoutModule`, `isRecord`, `drawPart<L extends object, B, R
  extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>): { built: R; layoutName: string; dispose(): void }` (options
  `owner`, `parent`, `pick`, `defaultLayout`, `part(layout)`, `build(builder, parent, rollback): R`, `log`,
  `logSource`, `partName`), `PartPick`, `RollbackDeps`, `pickLayout`, `createBaseKit`, `BaseKitDeps` (`keys.keysFor`
  returns `string | null`; `scope: ViewScope | null`), `KitCommands { exists(id): boolean; run(id): void }`,
  `commandRunner(qualifiedId: CommandId, commands: KitCommands): () => void`, and `BaseKit` from `kit.d.ts`.
- ← 02: `ShowLayoutOptions<L>`, `ShownLayouts<L>` and `LayoutShow` from `src/contracts/plugin.ts`; `LayoutOwner` from
  `src/contracts/layouts.ts`.
- The tree's own: `mountShell`, `ShellLayout`, `AreaName`, `Area`, `ModeContext`, `Mode`, `ModeHandle`,
  `ConfigProblem`, `AppInstance`, `icon` (`src/shared/page/ui/icon.ts`), `tag`.

## Produces

`src/renderer/shell/layouts/layout.d.ts`:

```ts
import type { BaseKit } from '../../../shared/page/layout-host/kit';

export interface ContextInput { title: string; detail: string | null }
export interface ProblemInput { file: string; message: string }
export interface ProblemsInput { problems: readonly ProblemInput[] }   // never empty when drawn
export interface ActivityItemInput { id: string; title: string; icon: string }

export interface ShellKit extends BaseKit {
  // `i.codicon` for the Codicon `name`.
  icon(parent: HTMLElement, name: string): HTMLElement;
}

// Every part appends its element to `parent` and returns it.
export interface Layout {
  // The title bar's centre: the shown mode's context. Drawn again on each change; not drawn while the mode has none.
  titleContext?(parent: HTMLElement, input: ContextInput, kit: ShellKit): HTMLElement;
  // At the title bar's start, in the dev app only.
  devTag?(parent: HTMLElement, kit: ShellKit): HTMLElement;
  // At the title bar's end while a config file is broken. Drawn again on each change.
  configProblems?(parent: HTMLElement, input: ProblemsInput, kit: ShellKit): HTMLElement;
  // One per mode in the activity bar. The app shows the mode on a click and marks the shown mode's item.
  activityItem?(parent: HTMLElement, input: ActivityItemInput, kit: ShellKit): HTMLElement;
}
export interface CompleteLayout extends Layout { /* every member of Layout, required */ }
```

Write a comment on `Layout` that says three things:

- each part comes from the first layout that defines it among `shell.layout` and `default`.
- a part that throws, or returns no element appended to `parent`, is drawn by `default` instead.
- the layout's `layout.css` restyles the chrome frames under `[data-layout-owner="shell"][data-layout="<name>"]` on
  the title bar, activity bar, side bar and status bar elements, and the layout does not move the areas.

Other names:

- `src/renderer/shell/read-shell-layout.ts`: `export function readShellLayout(module: unknown, name: string): Layout`.
- `src/renderer/shell/shell-chrome.ts`:

  ```ts
  export interface ShellChromeDeps {
    areas: Pick<Record<AreaName, Area>, 'titleBar' | 'activityBar'>;
    defaultLayout: CompleteLayout;
    kit: ShellKit;
    instance: AppInstance;
    log: Log;
  }
  export interface ShellChrome {
    showContext(context: ModeContext | null): void;
    showProblems(problems: readonly ConfigProblem[]): void;
    addMode(mode: Mode, handle: ModeHandle): void;
    markMode(modeId: string): void;
    setLayouts(shown: ShownLayouts<Layout>): void;
  }
  export function mountShellChrome(deps: ShellChromeDeps): ShellChrome;
  ```

  `showProblems` satisfies `PushTargets['problems']` through `{ show: chrome.showProblems }`.
- `src/renderer/shell/shell.ts`: `Shell.setChromeLayout(name: string): void`.
- `src/contracts/settings.ts`: `Settings.shell: { layout: string }`.
- `src/config/settings.ts`: `defaultSettings.shell = { layout: 'default' }`, and `settingInfo['shell.layout']`.

## Decisions

**`ShellLayout` and the user shell layout.** `ShellLayout` (`shell-layout.ts`, `shell.setLayout`) keeps the
arrangement. It builds the area elements, their grid and their tracks, in code. The gallery's `Space z s` swap
replaces it as it does today. The user's shell layout draws what the core puts in the chrome, and restyles the
frames through its CSS. It does not move areas. A user layout and a `setLayout` swap work at the same time, and
neither one undoes the other.

**The parts.** The core puts these in the chrome today:

| Part | Today's code | Area, alignment |
| --- | --- | --- |
| `titleContext` | `title-bar.ts` `mountTitleBarContext`: `span.title-bar-context` > title span, detail span; tooltip | titleBar, center |
| `devTag` | `title-bar.ts` `mountDevTag`: `tag('Dev', 'neutral')` | titleBar, start |
| `configProblems` | `config-push.ts` `contributeConfigProblems`: error tag `config-problem-badge`, text and tooltip | titleBar, end |
| `activityItem` | `activity-bar.ts` `add`: `button.activity-item` holding `icon(mode.icon)`, `title` and `aria-label` | activityBar, start; one per mode |

The side bar's and the status bar's contents belong to plugins. The core draws nothing in them.

**Frames are CSS only.** The four chrome area elements (title bar, activity bar, side bar, status bar) carry
`data-layout="<shown.user>"` and `data-layout-owner="shell"`, so the user layout's CSS restyles the frames under its
own name, as 02's Layout CSS decision writes it. No JS part wraps an
area. A wrapper would sit between the area and its tracks. That breaks the child selectors in `shell.css` and in the
gallery's `gallery.css`, and it moves the side bar's contents, which loses focus and scroll.

- `Shell.setChromeLayout(name)` sets `data-layout` to `name` and `data-layout-owner` to `shell` on those four area
  elements. `mountShell` keeps the name and sets
  it again after every mount: the first mount, `setLayout`, and its `dispose`.
- `renderer.ts` calls `shell.setChromeLayout(shown.user)` in `setLayouts`.

**Slots.** `mountShellChrome` contributes one `span.shell-part-slot` per part to its area, once, with today's
alignment: context `center`, Dev tag `start` (dev app only), problems `end`, one per mode in add order. A part draws
inside its slot. A redraw replaces only the slot's children, so the slot keeps its place in the track.

- The app hides the context slot while the context is null, and the problems slot while the list is empty. In those
  states, the app draws no part.
- `shell.css`: add `.shell-part-slot { display: contents; }`. Change `.shell-track > *` to
  `.shell-track > *, .shell-part-slot > *` so a part keeps `min-width: 0`.
- The `title-bar-context*` and `config-problem-badge` rules stay. They style the default's classes.

**What the app keeps:**

- on each activity item root: the `click` listener that calls `handle.show()`, and `is-shown` with
  `aria-current="true"` on the shown mode's item. `markMode` sets them, and every redraw sets them again.
- the log line `marked <title> in the activity bar`, once per change, as today.
- the area arrangement, the side bar's `data-side-bar` and its hidden state, and `--wg-status-bar-height`.
- every plugin contribution and every mode element. A reload does not touch them.

**Reloads.** `setLayouts(shown)` draws each slot again with the new picks. It touches nothing outside the slots, so
the modes, the side bar contents and the focused element stay where they are. Chrome parts take no focus: `button()`
from `dom.ts` never takes focus. Each part draws through `drawPart` with `owner` `shell`, `logSource` `shell` and
`partName` the part's key, so each part root carries `data-layout="<name>"` and `data-layout-owner="shell"`.
`drawPart` hands `build` a fresh `RollbackDeps` per attempt, and a part draw records its anchors there. Each slot keeps
the `dispose` that `drawPart` returns, and calls it before the next draw of that part and when the slot goes.

**The kit.** `createBaseKit` with these deps:

- `markdown`: `services.markdown`.
- `platform`: `config.platform`.
- `scope`: `null`: the chrome shows in every scope.
- `commands`: the `KitCommands` `{ exists: (id) => registry.has(id), run: (id) => registry.run(id, {}) }` over the
  page's `CommandRegistry`. The registry has no `has` today: this task adds `has(id: CommandId): boolean` to
  `src/shared/command-registry.ts`.
- `commandNamed`: `() => null`, because the core declares no page command.
- `keys`: `anchor` returns a no-op `Disposable` and draws nothing. `keysFor` returns `null`. The core cannot reach the
  keys plugin's exports before the plugins start, and it binds no page key of its own. Say this in the contract's
  comment on `ShellKit`.

`ShellKit.icon` calls `icon(name)` from `src/shared/page/ui/icon.ts` and appends it.

**The default layout** draws today's DOM:

- `titleContext`: `span.title-bar-context` with `.title-bar-context-title` and `.title-bar-context-detail`. The detail
  span is hidden when `detail` is null. The tooltip is `detail ?? title`.
- `devTag`: `kit.tag(parent, 'Dev', 'neutral')`.
- `configProblems`: `kit.tag(parent, text, 'error')` with class `config-problem-badge`. The text is
  `<file>: <message>` for one problem and `<n> config problems` for more. The tooltip is each `<file>: <message>` on
  its own line.
- `activityItem`: `button.activity-item` holding `kit.icon(item, input.icon)`, with `title` and `aria-label` set to
  `input.title`. Build the button with `kit.el`, then set `type="button"` and `tabIndex = -1`, and prevent default on
  `mousedown`. This is the never-takes-focus behaviour of `dom.ts` `button()` (`src/shared/page/dom.ts:30`). The app,
  not the layout, adds the click listener.

**The setting.** In `src/contracts/settings.ts`, `Settings` gets `shell: { layout: string }`, with the comment: "The
layout the shell chrome draws with: a folder in `layouts/shell/`, or `default`." In `src/config/settings.ts`, add
`shell: { layout: 'default' }` and this entry:

- `'shell.layout': { label: 'Shell layout', description: 'The layout that draws the title bar, activity bar, side
  bar and status bar: a folder in the layouts/shell folder, or default.' }`

**Main.** `main.ts` imports `../renderer/shell/layouts/layout.d.ts?raw` as `shellLayoutTypes`. It calls
`layoutService.register('shell', shellLayoutTypes)` once the LayoutService exists, and before the window loads. The
service's `dispose` on quit ends the registration.

**Renderer wiring** in `start()`:

1. Mount the shell.
2. Build the kit.
3. Call `mountShellChrome` in place of `createActivityBar`, `mountTitleBarContext`, `mountDevTag` and
   `contributeConfigProblems`.
4. Pass `chrome.addMode`, `chrome.markMode` and `chrome.showContext` to `createModes`, and `{ show: chrome.showProblems
   }` to `createConfigPush`.
5. Call `pageLayouts.show<Layout>('shell', { defaultLayout, read: readShellLayout, userLayout: () =>
   live.current().settings.shell.layout, setLayouts: (shown) => { chrome.setLayouts(shown);
   shell.setChromeLayout(shown.user); } })` on the `PageLayouts` that 02's wiring builds in `renderer.ts`.
6. Call the show's `refresh()` on each `live.onChanged`: the shell show has no plugin settings wrapper.

Until the first set arrives, every part draws with `default`.

`activity-bar.ts` keeps `createActivityBar` as the item list behind `mountShellChrome`. Change its `add` to draw
through a part callback. The implementer may fold it into `shell-chrome.ts` instead. Either way, one module owns the
items.

## Behaviour

- GIVEN `shell.layout` names a layout that defines only `activityItem` WHEN the page starts THEN every mode's item is
  the user's item with `data-layout` set to the user's name and `data-layout-owner` to `shell`, and the title context
  is the default one.
- GIVEN a focused text box in a mode and Sessions marked shown WHEN the shell layout file is saved THEN each slot is
  drawn again in its place, the Sessions item still carries `is-shown`, and the text box keeps focus.
- GIVEN the user's `activityItem` WHEN the user clicks a drawn item THEN its mode shows.
- GIVEN a user layout and the gallery's `Space z s` swap WHEN the swap is undone THEN the four chrome areas still carry
  the user's `data-layout` and `data-layout-owner="shell"`.
- GIVEN one config problem WHEN problems show THEN the default badge reads `<file>: <message>`. GIVEN two problems THEN
  it reads `2 config problems`. GIVEN none THEN its slot is hidden.

## Tests

- `read-shell-layout.test.ts` → `readShellLayout_Shapes_AcceptsOrNamesTheFirstBadKey`. A table with these rows:
  - a module with no default export throws.
  - an unknown key `sideBar` throws, and the message names `sideBar`.
  - `activityItem: {}` throws, and the message names `activityItem`.
  - a layout with only `devTag` is accepted.

  Break: a bad part passes the reader and throws on every draw.
- `shell-chrome.test.ts` → `setLayouts_UserDefinesActivityItem_ItemsFromUserContextFromDefault`. Break: one pick for
  the whole layout instead of one per part.
- `shell-chrome.test.ts` → `setLayouts_Redraw_KeepsSlotOrderShownMarkAndFocus`. Contribute a focused element to a
  second area before the redraw. Break: a redraw contributes new slots (the order changes), loses `is-shown`, or
  touches a contribution outside the slots.
- `shell-chrome.test.ts` → `activityItem_Click_ShowsItsMode`. Break: the app forgets the click on a layout-drawn item.
- `shell-chrome.test.ts` → `showProblems_Counts_DefaultBadgeTextAndHidden`. A table with these rows, moved from
  `config-push.test.ts`: none → slot hidden; one → text and tooltip hold the message; two → text holds `2` and the
  tooltip names both files; one then none → hidden. Break: the problems wiring or the default's one-versus-many rule.
- `shell.test.ts` → `mountShell_SetLayoutThenDispose_KeepsChromeLayoutName`. Stub `ResizeObserver`. Break: a swap or a
  restore mounts new area elements without `data-layout` or `data-layout-owner`, and the user's frame CSS drops.

The fallback to `default` on a throw belongs to 02's `drawPart` tests. `settingInfo` is checked by the compiler.

Runtime and visual checks go to [17 — Final verification](17-final-verification.md): the default chrome matches
today, and a user shell layout reloads live without losing focus or the side bar's scroll.

## Done when

- The code compiles. `npm run lint` passes, including `check-layers` and `check-styles`.
- The test gate runs the tests above, `modes.test.ts` and the rest of `config-push.test.ts`.

## Commit

One commit for the group. Example message: "The shell chrome draws through a shell layout picked by shell.layout".

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
