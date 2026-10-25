# 03 — Window title and a Dev tag in the title bar

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/renderer.ts` · modify `src/renderer/shell/title-bar.ts` · modify `index.html`
           · modify the shell title bar CSS the tag needs, if any (find it beside `title-bar.ts` or in the shell CSS)
Consumes:  `AppConfig.appInstance: AppInstance` ← 01
Produces:  `export function mountDevTag(area: Area, instance: AppInstance): void` in `src/renderer/shell/title-bar.ts`
Decisions: dev shows as "Auri Dev" with a Dev tag in the title bar (Q6) · display only (Q6)

**Changes**

- `index.html`'s `<title>` becomes `Auri`; `renderer.ts` sets `document.title = config.appInstance.displayName`
  where it reads the served config (beside `dataset.platform`, line ~98). The page title is what Windows shows in
  the taskbar and Alt+Tab for the hidden-title-bar window.
- `mountDevTag` contributes `tag('Dev', 'neutral')` (`src/shared/page/ui/tag.ts`) to the title bar area with
  `{ align: 'start' }` when `instance.isDev`, and nothing otherwise. Neutral, since colour at rest means a status
  or the brand accent (`DESIGN.md`); the title bar already pads clear of the macOS traffic lights and the Windows
  overlay (`src/renderer/shell/shell.css`). No raw values (`npm run lint` checks).
- `renderer.ts` calls `mountDevTag(areas.titleBar, config.appInstance)` next to `mountTitleBarContext`.

**Pinned values**

- Tag: `tag('Dev', 'neutral')`, `align: 'start'`
- Titles: `Auri` (stable), `Auri Dev` (dev)

Tests:     none — what shows on screen is a live check in group 08 (`wigley:writing-tests` § What earns a live run instead)
Done when: `npm run typecheck` and `npm run lint` pass
Commit:    one commit for the group

## Proof

Commit fbb31f31 · proof: diff read: mountDevTag present as planned, document.title from appInstance, index.html title Auri; worker: own files pass oxfmt/oxlint/layers/styles; tsc clean outside group 02's in-flight endpoint.test.ts; full compile at step 4 · concerns: none
