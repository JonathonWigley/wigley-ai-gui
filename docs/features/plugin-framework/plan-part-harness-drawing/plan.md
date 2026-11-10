# Part harness: loud `ready` failures and real layout drawing — plan

Feature: plugin-framework · Implements: none · Ticket: none
Target: main · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Close the first two items of `docs/features/followups.md` § Foundations:

1. **A throwing `ready` is silent in the part harness.** The plugin host logs a failed `ready` under the plugin's
   own id, and the part harness's host gets a log, and its `ready()` and `restart()` throw when a part's `ready`
   threw, so a test can no longer pass over one.
2. **The part harness cannot draw a layout part.** A page part test can draw layout parts through the real owner
   show (`ownerLayoutShow`), by starting the part with a new harness entry in the layout host.

## Architecture

Systems touched:

- `src/shared/plugin-host.ts`: the `ready` failure's log line (both processes' hosts share it).
- `src/shared/plugin-part-harness.test-support.ts`: the host's log, the loud `ready`, and a `layoutShow` seam on
  the page harness's options. It stays in layer `src/shared`, which may import only `src/contracts` and
  `src/shared/paths` (`scripts/check-layers.mts`, `CORE_LAYERS['src/shared']`).
- `src/shared/page/layout-host/page-part-harness.test-support.ts` (new): `startDrawingPagePart`, which fills that
  seam with `ownerLayoutShow` and `ownerKitServicesOf`. The layout host layer may import `src/shared`, so no layer
  rule changes.

## Preconditions

Each was verified at plan time on `main` at `10ee4da7`; `wigley:make` re-runs them before the first dispatch.

- The harness's draw throws: `grep -n "layouts.show draw not faked" src/shared/plugin-part-harness.test-support.ts`
  → one hit, in `fakeLayoutShow`.
- The harness host gets no log: `grep -n "host = startPlugins(hosted, process, (part, context)" src/shared/plugin-part-harness.test-support.ts`
  → one hit; the call passes three arguments.
- The host's line: `grep -n "ready of \${id} failed" src/shared/plugin-host.ts` → line 365, under source
  `plugin-host`.
- `startPlugins`' parameters are `(parts, process, start, known?, disabled = [], log?)`:
  `grep -n -A16 "^export function startPlugins" src/shared/plugin-host.ts`.
- Only tests read the old line: `grep -rn "ready of" src scripts` → `plugin-host.ts` (code and two comments) and
  `plugin-host.test.ts:575`, `:898`.
- The layout host may import `src/shared`: `grep -n -A8 "'src/shared/page/layout-host': {" scripts/check-layers.mts`
  lists `src/shared`.
- `ownerLayoutShow` and `ownerKitServicesOf` are exported from `src/shared/page/layout-host/owner-show.ts`:
  `grep -n "^export function owner" src/shared/page/layout-host/owner-show.ts` → both.

## Docs written ahead

- `AGENTS.md` § Architecture, the layer check paragraph: a page part test that draws a layout part starts the part
  with `startDrawingPagePart`. Commit `62e3bb8f`.

## Mandatory Reads

- `AGENTS.md`: § Architecture's bullets **A plugin**, **A registration**, **A layout**, and the `npm run lint`
  layer check paragraph; § Running and testing, the `npm test` bullet.
- No `CLAUDE*.md`, other `AGENTS*.md` or `.claude/rules/*.md` covers the touched files
  (`find . -name 'AGENTS*.md' -not -path './node_modules/*'` → the root file only).

## Design Overview

After the change:

```
page part test ──startDrawingPagePart(part, options)──┐        (src/shared/page/layout-host)
                                                       │ fills layoutShow with
                                                       │ ownerLayoutShow + ownerKitServicesOf(api)
                                                       ▼
page part test ──startPagePart(part, options)──► page harness (src/shared)
                                                   │ api.layouts.show(options)
                                                   ▼
                                     options.layoutShow ?? throwing show
                                                   │ given the fake inner show:
                                                   │ harness.showLayouts(set) → options.setLayouts(set)
                                                   ▼
                                     PageLayoutShow (registered on the part)

part's ready() throws ──► host logs (id, "ready failed: <error>")
                          harness.logs gets it; harness.ready()/restart() throw
                          "part harness: ready of <id> failed: <error>" after every ready ran
```

Decisions:

- Both part-harness items land in one plan (round 1).
- The drawing comes through a seam on the shared harness, filled on the page side (round 1); the layer rules stay
  as written.
- A failed `ready` logs under the plugin's id in the app too: `log(id, 'ready failed: <error>')`, which a scoped
  reader prints as `[<id>] ready failed: <error>` (Decided, round 1).
- The harness fails loud on a throwing `ready`: logging alone still lets a test pass over it. The host keeps its
  own rule (log and go on) and the harness's `ready()` throws once every part's `ready` has run (Decided,
  `wigley:writing-code` § Guards and failure, fail loud).
- The seam's default stays today's throwing show, so the 31 existing page test files keep their behaviour and imports;
  a test that draws opts in with the new entry (Decided: no migration a test does not need).
- The new entry takes the same options as `startPagePart` without `layoutShow`, and returns the same
  `PagePartHarness` (Decided: one harness surface, `wigley:codebase-design` depth).

Out of scope: every other Foundations item; moving the existing page tests to the new entry; any layer rule
change.

## File Structure

Modified:

- `src/shared/plugin-host.ts` — `readyEach`'s log line and the two comments quoting it (lines ~31, ~403).
- `src/shared/plugin-host.test.ts` — the two assertions on the old line.
- `src/shared/plugin-part-harness.test-support.ts` — the host's log, the loud `ready`, the `layoutShow` option and
  its type `HarnessLayoutShow`.
- `src/shared/plugin-part-harness.test.ts` — the loud `ready` test, and a row proving the seam is used.
- `docs/features/followups.md` — both items removed once landed.

New:

- `src/shared/page/layout-host/page-part-harness.test-support.ts` — `startDrawingPagePart`. It lives in the
  layout host because `ownerLayoutShow` does, and `src/shared` may not import it.
- `src/shared/page/layout-host/page-part-harness.test.ts` — its tests.

Shared signatures (02 produces, tests consume):

```ts
// src/shared/plugin-part-harness.test-support.ts
export type HarnessLayoutShow = <L>(
  api: PageApi<PluginManifest, any, any, any>,
  manifest: PluginManifest,
  options: ShowLayoutOptions<L>,
  show: (options: ShowLayoutOptions<L>) => LayoutShow,
) => PageLayoutShow<L>;
// PagePartHarnessOptions<M> gains: layoutShow?: HarnessLayoutShow;

// src/shared/page/layout-host/page-part-harness.test-support.ts
export function startDrawingPagePart<M extends PluginManifest>(
  part: PagePart<M>,
  options?: Omit<PagePartHarnessOptions<M>, 'layoutShow'>,
): PagePartHarness<M>;
```

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Loud ready failures](01-loud-ready-failures.md)

### Wave 2
- [ ] [Drawing page harness](02-drawing-page-harness.md) — after 01

### Wave 3
- [ ] [Doc re-read](03-doc-re-read.md) — after 02

### Wave 4
- [ ] [Final verification](04-final-verification.md) — after 03

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
