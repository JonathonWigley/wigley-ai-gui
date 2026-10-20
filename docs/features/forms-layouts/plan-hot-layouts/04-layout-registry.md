# 04 — Layout registry in forms main

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:     create `src/plugins/forms/main/layouts/layout-registry.ts` · modify `src/plugins/forms/contract.ts`
           · modify `src/plugins/forms/main/start.ts` · modify `src/declarations.d.ts` (only if `?raw` imports need a
             module declaration under `tsc`)
           · test `src/plugins/forms/main/layouts/layout-registry.test.ts`
Consumes:  `MainApi.data: Files` ← 03 · `Files`, `createMemoryFiles()` ← 01
           · `src/plugins/forms/layouts/layout.d.ts` and `layouts/default/layout.js`, as `?raw` text ← 02
Produces:  in `src/plugins/forms/contract.ts`:
           `export interface LayoutChoice { name: string; revision: number; hasCss: boolean; builtIn: boolean; reason: 'start' | 'cycled' | 'reloaded' | 'copied' }`
           `FormsChannel.invoke` gains `layout(): Promise<LayoutChoice>`, `cycleLayout(step: 1 | -1): Promise<LayoutChoice>`,
             `copyLayout(): Promise<LayoutChoice>`, `openPreview(): void` (`MainChannel.handle` takes exactly the declared
             type, so the awaiting handlers need the `Promise`)
           `FormsChannel.messages` gains `layoutChanged: LayoutChoice`
           in `src/plugins/forms/main/layouts/layout-registry.ts`:
           `export interface LayoutRegistry { current(): LayoutChoice; cycle(step: 1 | -1): Promise<LayoutChoice>; copy(): Promise<LayoutChoice>; dispose(): void }`
           `export function startLayoutRegistry(deps: { data: Files; send(choice: LayoutChoice): void; log: Log; layoutTypes: string; defaultLayout: string }): Promise<LayoutRegistry>`
Decisions: reload on save and cycling between named layouts (round 1) · the active layout persists in
           `layouts/active` (round 2) · `layout.d.ts` written at every start (round 2 notice) · `layout.d.ts` and the
           default layout reach main as `?raw` text, not shipped files (design review)
Commit:    one commit for the group

## Behaviour

All paths are relative to forms' data folder, through `api.data`.

- **Start**: write `layouts/layout.d.ts` from `layoutTypes`; list the layouts; read `layouts/active` (trimmed). An
  absent file, or a name that is not listed, makes `default` active with no write. Watch `layouts`. `current()`
  returns `reason: 'start'`.
- **Listing**: the order is `default` (built-in), then every folder `layouts/<name>/` holding a `layout.js`, sorted
  by `localeCompare`. A user folder named `default` is skipped, with the log line
  `layouts/default is ignored; the built-in default layout wins` (source `forms`).
- **hasCss**: `layouts/<name>/layout.css` exists. Always false for `default`.
- **cycle(step)**: moves through the listing (re-read now) by `step`, wrapping at both ends; writes the name to
  `layouts/active`; sends and returns `reason: 'cycled'`, with the layout's current revision.
- **Watch**: any changed path under a layout folder bumps the revision, so a layout edited while inactive loads
  fresh when cycled to. A change under `<active>/` (the watch reports paths relative to `layouts`) also re-reads
  `hasCss` and sends `reason: 'reloaded'`. If the active folder lost its `layout.js`, `default` becomes
  active, `layouts/active` is written, and `reason: 'cycled'` is sent. A change elsewhere sends nothing. The
  registry's own writes (`active`, `layout.d.ts`) sit at the root of `layouts` and never match a layout folder.
- **Revision**: one counter for the registry, starting at 1, incremented on every watched change under a layout
  folder and before every send. `current()` always reports `reason: 'start'`. The page puts it in
  the URL path, so a reload always fetches fresh modules.
- **copy()**: the new name is `<active>-<n>` for the lowest `n ≥ 2` not listed. `default` copies to
  `layouts/<new>/layout.js` from `defaultLayout`. A user layout copies every file in its folder (recursive `list`,
  `read`, `write`). Then the copy becomes active (`layouts/active` written), and `reason: 'copied'` is sent and
  returned. The registry keeps the paths it wrote during the copy and ignores the next watch report for each, so the
  Node adapter's late reports send no reloads.
- **dispose**: closes the watch. The main part's `dispose` calls it.

## Wiring (`main/start.ts`)

`start` is synchronous and the registry starts asynchronously. Start it at once and keep the promise. The channel
handlers `layout`, `cycleLayout` and `copyLayout` await it, so a page that asks early gets the answer once it is
ready. `send` is `api.channel.send('layoutChanged', choice)`. A failed start is logged as
`layouts not started: <errorText>` (source `forms`), and `layout()` then rejects with that error, which the page reports (task
05). The raw texts are `import layoutTypes from '../layouts/layout.d.ts?raw'` and
`import defaultLayout from '../layouts/default/layout.js?raw'`, at the paths these files hold relative to
`start.ts`. The `openPreview` handler is registered by task 06.

GIVEN layouts `default`, `alpha` and `beta` with `beta` active WHEN `cycle(1)` runs THEN `default` is active,
`layouts/active` holds `default`, and one `layoutChanged` is sent with `reason: 'cycled'`.

Tests (`createMemoryFiles()`, each test writing its own layouts; `send` recorded):

- `start_NoActiveFile_DefaultActive`.
- `start_WritesLayoutTypes`: `layouts/layout.d.ts` holds the given `layoutTypes`.
- `start_ActiveNamesMissingFolder_DefaultActive`.
- `cycle_Forward_WrapsToDefaultAndPersists`: the GIVEN/WHEN/THEN above.
- `cycle_Backward_FromDefault_WrapsToLast`.
- `start_UserFolderNamedDefault_IsSkippedAndLogged`.
- `watch_SaveInActiveFolder_BumpsRevisionAndSendsReloaded`.
- `watch_ActiveLayoutJsRemoved_FallsBackToDefault`: `remove` on the active folder's `layout.js`.
- `copy_Default_WritesDefaultTextAndActivates`: `layouts/default-2/layout.js` equals `defaultLayout`.
- `copy_Twice_TakesNextFreeNumber`: `default-3`.
- `copy_UserLayout_CopiesEveryFileIncludingNested`.
- `copy_LateWatchReportsForCopiedFiles_SendNothing`: over a `Files` wrapper around the memory fake that holds watch
  reports until the test flushes them; after `copy()`, flushing sends nothing more.
- `watch_SaveInInactiveFolder_BumpsRevisionWithoutSending`: cycling to that layout afterwards sends a revision
  greater than the one before the save.
- `hasCss_TrueWhenLayoutCssPresent`.

Done when: compiles; `npm run lint` passes; the test gate runs the tests above.

## Proof
