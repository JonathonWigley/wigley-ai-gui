# 05 — Layout loading, swapping and keys on the page

Status: done
Type: Task
Wave: 4 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/forms/page/layout/layout-loader.ts` · modify `src/plugins/forms/page/start.ts`
           · modify `src/plugins/forms/page/forms-commands.ts` · modify `src/plugins/forms/manifest.ts`
           · test `src/plugins/forms/page/layout/layout-loader.test.ts` · test `src/plugins/forms/page/forms-commands.test.ts` (extend)
           · test `src/plugins/forms/manifest.test.ts` (extend `EXPECTED_PAGE`, as plan A left it)
Consumes:  `PageApi.dataUrl(path, revision)` ← 03 · `LayoutChoice`, channel `layout` / `cycleLayout` / `copyLayout` /
           `openPreview`, message `layoutChanged` ← 04 · `Layout` (`layout.d.ts`), the default layout, and
           `setLayout(layout, layoutName)` on the mounted forms view ← 02
Produces:  in `src/plugins/forms/page/layout/layout-loader.ts`:
           `export function readLayout(module: unknown, name: string): Layout` (throws naming what is missing)
           `export function layoutUrls(choice: LayoutChoice, dataUrl: (path: string, revision: number) => string): { script: string; style: string | null }`
           `export function createLayoutLoader(deps: { importModule(url: string): Promise<unknown>; dataUrl(path: string, revision: number): string; defaultLayout: Layout; head: HTMLElement }): { load(choice: LayoutChoice): Promise<Layout> }`
           manifest commands `nextLayout`, `prevLayout`, `copyLayout`, `openPreview` (group `debug`, `runsIn: 'page'`)
Decisions: keys under the `Space z` debug leader in scope `any` (round 2 note, round 3 notice) · a failed reload keeps
           the last good layout (round 2 notice) · the commands exist in both builds (round 3 notice)
Commit:    one commit for the group

## Pinned values

- Commands and labels: `nextLayout` 'next layout', `prevLayout` 'previous layout', `copyLayout` 'copy the layout to
  a new folder', `openPreview` 'open the layout preview round'; group `debug`.
- Page keys, scope `any`, appended at the end of `keys.page` in this order: `[' ', 'z', 'l', 'n']` → `nextLayout`, `[' ', 'z', 'l', 'p']` → `prevLayout`,
  `[' ', 'z', 'l', 'c']` → `copyLayout`, `[' ', 'z', 'l', 'o']` → `openPreview`.
- URLs: `script` is `dataUrl('layouts/<name>/layout.js', revision)`; `style` is
  `dataUrl('layouts/<name>/layout.css', revision)` when `hasCss`, else null. `layoutUrls` is not called for a
  built-in choice.
- `importModule` in `start.ts` is `(url) => import(/* @vite-ignore */ url)`.
- Toasts: `cycled` → `Layout: <name>` (info) · `copied` → `Layout copied to layouts/<name> in forms' data folder`
  (success) · a failed load → `Layout <name> failed: <errorText>` (error). `reloaded` and `start` show no toast.
  Each outcome also logs, with source `forms`: `layout <name> shown (<reason>, revision <n>)`, or
  `layout <name> failed: <errorText>` (shown as `[forms] layout …`). Task 07's steps wait on these lines.

## Behaviour

- `readLayout` requires a default export with `cards.question`, `cards.finding` and `cards.notice` functions, and
  `head` a function or absent. It throws `Error('layout <name>: <what> is missing or not a function')`, naming the
  first gap, or `Error('layout <name>: the default export is missing or not an object')`.
- The loader returns `defaultLayout` for a built-in choice. For a user layout it imports `script`, reads it with
  `readLayout`, then points the one `<link rel="stylesheet">` it keeps in `head` at `style`, or removes it when
  `style` is null. The stylesheet changes only after the script loaded, so a broken reload keeps the old look whole.
  Switching to `default` removes the link.
- `start.ts`: after mounting the forms view, invoke `layout()`, then hear `layoutChanged`. Each choice is loaded in
  arrival order: a newer choice that arrives while one is loading is applied after it. The view's `setLayout` runs on
  success. On failure the current layout stays. A failure at startup leaves the default layout in place.
- The four commands invoke their channel method. A rejection toasts `Layout command failed: <errorText>` (error) and
  logs it. `cycleLayout` and `copyLayout` return a choice, but the page applies only what `layoutChanged` delivers, so
  there is one path for every change.

GIVEN a module whose default export lacks `cards.notice` WHEN `readLayout(module, 'mine')` runs THEN it throws
`layout mine: cards.notice is missing or not a function`.

Tests:

- `layout-loader.test.ts` (no DOM; `readLayout` and `layoutUrls` are pure):
  - `readLayout_MissingNoticeCard_ThrowsNamingIt`: the GIVEN/WHEN/THEN above.
  - `readLayout_NoDefaultExport_Throws`.
  - `readLayout_HeadNotFunction_Throws`.
  - `readLayout_ValidModule_ReturnsItsDefault`.
  - `layoutUrls_WithCss_BuildsBothWithRevision`: a fake `dataUrl` records `('layouts/mine/layout.js', 4)` and
    `('layouts/mine/layout.css', 4)`.
  - `layoutUrls_WithoutCss_StyleNull`.
- `forms-commands.test.ts`: `nextLayout_InvokesCycleLayoutForward`, `prevLayout_InvokesCycleLayoutBackward`, and
  `openPreview_Rejects_ToastsError`, in the file's existing fake style.

Done when: compiles; `npm run lint` passes; the test gate runs the tests above.

## Proof

Commit `f8afed4`. Diff read: every Produces signature present (`LayoutLoaderDeps` / `LayoutLoader` named); one
contract addition (`FormsCommandDeps.layouts`). Typecheck clean; layer check 200 files clean; oxlint clean.

Concerns: `showLayouts` (the queue and drop-stale logic) has no unit test; task 07's live run covers it.
