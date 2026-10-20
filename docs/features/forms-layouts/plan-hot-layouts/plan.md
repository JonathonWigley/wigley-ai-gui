# Forms layouts — hot-swappable card layouts — plan

Feature: forms layouts · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui · Written: 2026-10-19

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user changes how forms rounds look without rebuilding the app, in the packaged build and under `npm start`. A
**layout** is a folder of plain JS (and optional CSS) that builds each item's card from the app's card input and a kit
of ready-made parts. Saving the active layout's files redraws open rounds, keeping every answer. `Space z l n` /
`Space z l p` cycle the layouts, `Space z l c` copies the active one into a new folder, and `Space z l o` opens a
preview round (the built-in sample, then the saved real rounds) that sends nothing. Today's cards become the
built-in `default` layout, written against the same contract.

Plugin user data gets a common pattern on the way: each plugin has a data folder, which main reaches through the core
files service scoped to that folder, and which the page loads from through the `wigley-data:` scheme.

## Architecture

Systems touched:

- **files service** (new `src/contracts/files.ts`, `src/main/files/`, `src/shared/`): read, atomic write, list and
  watch, behind `Files`, with a Node adapter, an in-memory fake and a scoped wrapper. Plan B adds rename and trash.
- **plugin data** (`src/contracts/plugin.ts`, `src/main/plugins/main-api.ts`, `src/renderer/plugins/page-api.ts`,
  `src/main/main.ts`, new `src/main/data-protocol/`, new `src/shared/data-url.ts`, `index.html` CSP): `api.data`,
  `api.dataUrl`, and the `wigley-data:` scheme.
- **forms layouts** (new `src/plugins/forms/layouts/`, `src/plugins/forms/page/kinds/`, new
  `src/plugins/forms/page/layout/`, `round-view.ts`, `forms-view.ts`, page `start.ts`, `manifest.ts`): the Layout
  contract, the `default` layout, the kit, the card host with its fallback, loading and swapping, the commands and keys.
- **forms main** (`src/plugins/forms/contract.ts`, new `main/layouts/`, new `main/preview/`, `main/round-store.ts`,
  main `start.ts`, `selftest-script.ts`): the layout registry (list, active, cycle, copy, watch, `layout.d.ts`) and the
  preview round source.
- **layer check** (`scripts/check-layers.mts`): new layers, and `.js` files are checked too.

## Preconditions

Each re-run by `wigley:make` before the first dispatch:

- Docs-ahead commit present: `git -C ~/Documents/dev/wigley-ai-gui log --oneline | grep -c df00396` → 1.
- Docs-browser plan A has landed (this plan builds on its Form tab): `grep -c "addTab" src/plugins/sessions/contract.ts`
  → ≥ 1 and `grep -c "fill(" src/plugins/sessions/contract.ts` → 0. On a miss, stop: run plan A first.
- Tree clean in the touched areas: `git status --porcelain -- src scripts index.html` → empty. On any output, stop and
  ask the user whose the changes are.
- No `Space z` bind yet: `grep -rn "' ', 'z'" src/plugins src/config` → empty.
- No `wigley-data` anywhere: `grep -rn "wigley-data" src index.html scripts` → empty.
- CSP as at plan time: `grep -c "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:\*" index.html` → 1.
- Files contract: `test -e src/contracts/files.ts` → absent at plan time. If docs-browser plan B landed first and
  it exists, task 01 extends that contract and its adapters with the members below that are missing, and does not
  write them twice; the run log says so.
- Page cards still built by `buildCard`: `grep -c "buildCard" src/plugins/forms/page/kinds/item-format.ts` → 1.

## Docs written ahead

- wigley-ai-gui `AGENTS.md` (Contents, the layout tree's `data-protocol/` and `forms/` lines, **An item kind**'s
  layout sentences, **Debug and testing keys**, **Plugin data**, **A forms layout**, the preview line in **Running and
  testing**) — commit `df00396`.

## Mandatory Reads

- `AGENTS.md` (repo root) — the only `AGENTS*.md` / `CLAUDE*.md` in the repo; there is no `.claude/rules/`.

## Design Overview

```
 user layout folder (userData/plugins/forms/layouts/<name>/layout.js, layout.css)
        │ saved                                   ▲ copy (Space z l c)
        ▼                                         │
 Files.watch ──► LayoutRegistry (forms main) ─────┘   writes layouts/layout.d.ts, layouts/active
                     │ channel: layoutChanged {name, revision, hasCss, reason}
                     ▼
 forms page: loadLayout ── import(wigley-data://forms/~<rev>/layouts/<name>/layout.js)
                     │        └─ default: bundled import of layouts/default/layout.js
                     ▼
 forms-view.setLayout ──► each RoundView rebuilds its children from the form state
                     │
                     ▼
 card host: layout.cards[kind](parent, cardInput, kit) ── throws? ──► default card + log + toast
                                                       kit parts (sections, choice list, answer controls,
                                                       verdict, action row) update themselves

 Space z l o ─► page command ─► channel openPreview ─► LayoutPreview ─► preview FormsService
                                                         (in-memory RoundStore, shared presenter)
                                                         sample round, then saved rounds' args
```

Decisions (interview rounds 1–3 and the design review):

- A layout is a runtime-loaded script that builds each card with the helpers the app hands it (round 1). It covers the
  cards and an optional head above them. Every card gets the round's heading and overview as data (round 2 note).
  The review screen, rail and status line stay built in.
- Swapping is reload-on-save plus cycling between named layouts (round 1). The active layout persists in
  `layouts/active` (round 2).
- The contract is the built-in cards' own: card input, the kit of parts that update themselves, and `run` for
  actions. The script returns `{ element, update }` (round 2).
- The built-in look ships as the `default` layout, in plain JS typed with `// @ts-check` and JSDoc (round 2).
  Design review: the page imports it through the bundle, not through the scheme, so the fallback can never fail to
  load, and main reads its text through a Vite `?raw` import for the copy command. Nothing ships through
  `extraResource`.
- Plain JS ES modules, typed by `layout.d.ts`, which the app writes into the layouts folder at every start (round 2).
  `src/plugins/forms/layouts/layout.d.ts` is the single source: the app's TS imports its types, the default layout
  checks against it, and main writes its `?raw` text to the user.
- Layouts live in forms' plugin data folder, `userData/plugins/forms/layouts/<name>/` (round 2, round 3).
- Each plugin gets a data folder and page access through one core scheme (round 3): `api.data` (scoped `Files`) and
  `api.dataUrl(path, revision)`.
- The core files service is built here, with read, write, list and watch; plan B adds rename and trash (round 2).
- Keys sit under a `Space z` debug leader: `Space z l n` / `p` / `c` / `o`, scope `any` (round 2 note, round 3).
- The preview opens the built-in sample, and each further press swaps in the next saved real round (round 3). It
  sends nothing and saves nothing (round 3).
- Design review: the scheme is registered privileged (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`) and
  answers with an explicit `Content-Type` and `Access-Control-Allow-Origin: *`. The revision sits in the URL's path,
  so a changed module's relative imports load fresh as well.
- Design review (seam): the preview is a round source with its own `FormsService` over an in-memory `RoundStore`
  adapter, the store's second adapter, and it shares the one channel presenter.
- Design review (depth): kit parts update themselves, so a layout's own `update` is optional.
- Design review (locality): the watch debounce lives in the Node files adapter. A burst of events for one path reports
  once.
- Cold read: any text box a layout card leaves unmounted, the app appends in its default field, so the box keys
  always reach it. A layout edit while another layout is active still loads fresh, because every watched change
  bumps the revision. The preview re-waits through `collect_last_round` after its deadline, so it never sticks.
- A broken reload keeps the last good layout. A card that throws falls back to the default card. Errors show as a toast
  and a log line (round 2 notice).

Out of scope: layouts for the rail, review or status line; TypeScript layouts; settings hot reload and the user config
file (follow-ups); images through `wigley-data:` (the follow-up can now use the scheme); files `rename` / `trash`
(plan B).

## File Structure

Existing files modified:

- `index.html` — CSP adds `wigley-data:` to `script-src` and `style-src`.
- `scripts/check-layers.mts` — new layers, `.js` files checked.
- `src/contracts/plugin.ts` — `MainServices.files`, `MainApi.data`, `PageApi.dataUrl`.
- `src/main/main.ts` — registers the scheme before ready, serves it, picks the data root, hands out `files`.
- `src/main/plugins/main-api.ts` — `data` scoped to the plugin's folder.
- `src/renderer/plugins/page-api.ts` — `dataUrl`.
- `src/plugins/forms/contract.ts` — `LayoutChoice`, the layout and preview channel methods and message.
- `src/plugins/forms/manifest.ts` — four page commands, group `debug`, their keys.
- `src/plugins/forms/page/kinds/item-format.ts`, `kinds/formats.ts`, `kinds/card-parts.ts`,
  `kinds/{question,notice,finding}/*-card.ts` — card input in place of `buildCard`; the parts become kit parts.
- `src/plugins/forms/page/editor-boxes.ts` — `destroyBox`, so a failed layout card's boxes can be unmounted.
- `src/plugins/forms/manifest.test.ts` — the four new page binds.
- `src/plugins/forms/page/round-view.ts`, `forms-view.ts`, `start.ts`, `forms-commands.ts` — layout-built cards,
  `setLayout`, layout loading and the four commands.
- `src/plugins/forms/main/start.ts` — the registry, the shared presenter, the preview.
- `src/plugins/forms/main/round-store.ts` — `recentArgs`.
- `src/plugins/forms/main/selftest-script.ts` — layout and preview steps.

New files:

- `src/contracts/files.ts` — the `Files` seam (Node adapter and in-memory fake: two adapters).
- `src/main/files/node-files.ts` — the Node adapter.
- `src/shared/memory-files.ts` — the in-memory adapter, used by plugin tests.
- `src/shared/scoped-files.ts` — the `Files` wrapper that refuses paths outside its root.
- `src/shared/data-url.ts` — builds and resolves `wigley-data:` URLs; both processes use it.
- `src/main/data-protocol/data-protocol.ts` — the Electron scheme adapter, the only `protocol` import.
- `src/plugins/forms/layouts/layout.d.ts` — the Layout contract, the single source of the user's types.
- `src/plugins/forms/layouts/default/layout.js` — the built-in layout.
- `src/plugins/forms/page/layout/card-kit.ts` — builds a card's kit from the parts.
- `src/plugins/forms/page/layout/layout-cards.ts` — the card host: builds through the layout, falls back per card.
- `src/plugins/forms/page/layout/layout-loader.ts` — imports and validates a layout module; manages its stylesheet.
- `src/plugins/forms/main/layouts/layout-registry.ts` — list, active, cycle, copy, watch, `layout.d.ts`.
- `src/plugins/forms/main/preview/preview-round.ts` — the sample round's ask_round args.
- `src/plugins/forms/main/preview/memory-round-store.ts` — the in-memory `RoundStore`.
- `src/plugins/forms/main/preview/layout-preview.ts` — the preview round source.
- Tests beside each, as each task names.

Boundary rules:

- `src/plugins/forms/layouts/` imports nothing. A layout is copied to the user as is, so it reaches the app only
  through its `kit` and `input` parameters; the layer check enforces this on `.js` and `.d.ts` files.
- `electron`'s `protocol` and `net` are imported only in `src/main/data-protocol/`; `node:fs` for plugin data only in
  `src/main/files/`.
- Forms reaches its data folder only through `api.data`, and its page only through `api.dataUrl`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Files service](01-files-service.md)
- [x] [Layout contract and the default layout](02-layout-contract.md)

### Wave 2
- [x] [Plugin data folders and the wigley-data scheme](03-plugin-data.md) — after 01

### Wave 3
- [x] [Layout registry in forms main](04-layout-registry.md) — after 02, 03

### Wave 4
- [x] [Layout loading, swapping and keys on the page](05-page-layouts.md) — after 02, 03, 04
- [x] [Preview round](06-preview-round.md) — after 04

### Wave 5
- [x] [Self-test steps](07-selftest.md) — after 05, 06

### Wave 6
- [x] [Doc re-read](08-doc-re-read.md) — after 07

### Wave 7
- [x] ~~[Final verification](09-final-verification.md)~~ — dropped: the user closed the run before the live run; its
  checks and the self-test on the fixes are carried to `docs/features/followups.md`

## Run log

Review base: b8ce743

Peers on the tree at preflight: wigley-ai-gui-de runs docs-browser plan A (01–05 landed; 06 self-test and 07 doc
re-read open) — commits pathspec-scoped, review range an explicit commit list.

### Groups
- 01 files service · 191f4d7 · proved (diff read, typecheck clean in its files, layer check) · concerns: Node watcher
  has no error listener; real-time watch test; oxfmt fails on `docs/features/` plan docs (pre-existing)
- 03 plugin data · f9e9db6 · proved (diff read, typecheck clean outside forms, layer check) · concerns: `URL.parse`
  untested until 09; plugin ids must be lowercase; Windows path separators untested
- 02 layout contract · b5142a6 · proved (diff read, typecheck clean incl. `layout.js`, layer check) · concerns:
  fallback card's build uncaught; detached-article layouts mount editors detached; `setLayout` clears the focused
  box; DOM behaviour proved only by the self-test
- 04 layout registry · c070e90 · proved (diff read, typecheck clean in its files, layer check) · concerns: a copied
  path's ignore mark lingers until its watch report arrives
- 05 page layouts · f8afed4 · proved (diff read, typecheck clean, layer check) · concerns: `showLayouts` untested
  until task 07
- 06 preview round · 66789d6 · proved (diff read, typecheck clean, layer check) · concerns: an unused forms tool
  session rides on the preview row; no `sessions.ended` listener; memory store grows per press
- 07 self-test · 25718bd · proved (`npm run selftest` all passed, typecheck clean, layer check) · concerns: fixed
  revisions assume a fresh data folder
- 08 doc re-read · a4f3184 · proved (diff read: one AGENTS.md line) · concerns: none
### Contract changes
- `Files.watch`: → `watch(folder, onChange, onError?)`; the Node adapter closes a failed watch and reports once ·
  why: review finding 2 · consumers: 04 (registry logs `layouts watch failed`) · fix round 1
- `createChannelPresenter`: → returns `ChannelPresenter` (`RoundPresenter` plus `quiet`); the preview shows
  through `quiet` · why: review finding 21 · consumers: 06 · fix round 1
- `createRoundView`: → gains `layout: Layout, layoutName: string` after `round`; `RoundViewDeps` gains `log: Log`,
  `boxes` widens to `Pick<EditorBoxes, 'mount' | 'destroyBox' | 'destroyRound'>` · why: builds through the layout
  from the first build and logs failures · consumers: 05 · group 02
- `FormsViewDeps`: → gains `log: Log`; page `start.ts` passes `services.log` · why: the card host logs with source
  `forms` · consumers: 05 · group 02
- `CardDeps`: → gains `destroyBox(target: TextTarget): void` and `log: Log` · why: the host undoes a throwing
  builder's boxes · consumers: 05, 07 · group 02
- `ItemFormat` / `AnswerableFormat`: → generic over the card input (`cardInput(round, index): Input`);
  `item-format.ts` exports `CardInputs` / `CardKits` from `Layout['cards']` · why: the compiler check that a kind has
  a card input and a `cards` entry · consumers: none · group 02
- `ids.ts`: → gains `formsCommandNamed(short: string): CommandId | null`, widened out of `numberedCommand` · why:
  `kit.keys` qualifies an unchecked short name · consumers: none · group 02
- `FormsCommandDeps`: → gains `layouts: LayoutCommandChannel` (`cycleLayout(step)`, `copyLayout()`,
  `openPreview()`, each `Promise<unknown>`); page `start.ts` wires it to `api.channel.invoke` · why: the handlers
  invoke main's channel · consumers: none · group 05
- Self-test steps: → also `export const SELFTEST_LAYOUT = { path, text }` in `selftest-script.ts`; forms main
  `serveLayouts(api, written)` starts the registry after the fixture write settles · why: no watch report bumps the
  revision, so the steps' revisions are fixed · consumers: none · group 07
### Rulings
- `layoutChanged` listener registers before `layout()` is invoked; an answer arriving after a change is dropped
  (the change is newer) — no stale `start` choice overwrites a newer one — none known · group 05
- A rejected `layout()` logs `[forms] layout not read: <errorText>`, no toast, default stays — the spec lists toasts
  for load outcomes only — one toast line if the user should see it · group 05
- A rejected command logs `layout command failed: <errorText>` and toasts `Layout command failed: <errorText>`
  (error); `readLayout` names `cards.question` when `cards` is absent, and `head is missing or not a function` for a
  non-function head — the spec's one message shape — none known · group 05
- Node watch drops an event named after the watched folder when no child of that name exists (FSEvents self-report)
  — the burst test failed on it, and every new watch would report a stray `layouts` — a real child sharing the
  folder's name that is deleted would go unreported · group 01
- `read` passes Node's missing-file error through (it names the path) — no wrapper — wording differs from the memory
  fake's `no file at <path>` · group 01
- Memory files key every path through `resolveInside`, so `/a/b` and `a/b` are one file — a test meaning two files
  would collide · group 01
- `npm run lint`'s oxfmt step fails on plan docs under `docs/features/` (not this run's code); groups are proved on
  the layer check, oxlint and oxfmt over `src` — lead
- Started with plan A's 06–07 still open, by the user's go: this plan's 07 waits for plan A's 06 (both edit
  `selftest-script.ts`), and 08 for plan A's 07 (both edit `AGENTS.md`) — lead
- 404 answers carry `Access-Control-Allow-Origin: *` too; a host of `.` or `..` resolves to null — a module
  import's 404 would read as a CORS error otherwise — none known · group 03
- The services fake in `main-api.test.ts` casts `as unknown as MainServices` — TS2352 on the direct cast — a fake
  missing a member compiles · group 03
- Plan A finished its groups 01–07 (`6126427`) mid-run, so this plan's 07 and 08 no longer wait on it — lead
- The user's standing ruling for this session: at every review triage, take every review recommendation without a
  triage round (the recommended action on each finding) — user
- `answerControls` returns the `div.toggles` row (today's DOM has no wrapper round its three parts) — a wrapper
  would change the DOM — a layout wanting the whole block gets the middle row · group 02
- A throwing `layout.head` is caught and logged `layout <name> head failed: <errorText>` (source `forms`); the head
  slot `div.layout-head` sits in `.round-main` before `div.items`, created only when the layout has a head — an
  uncaught throw would abort the round view — task 07 may want the line pinned · group 02
- A layout `update` that keeps throwing is still called; only its first throw is logged — the plan says once per
  card — a throwing layout stays silent after its first line · group 02
- A blank (after trim) choice reason draws nothing; card inputs copy their arrays and objects; `destroyBox` throws
  `No box is mounted as <key>` for an unmounted box; a notice's host `update` sets no `data-status` — as today's
  cards — none known · group 02
- `copy_Twice_TakesNextFreeNumber` cycles back to `default` between copies: `<active>-<n>` from the active
  `default-2` would name `default-2-2` — the Behaviour line's rule read literally — if the plan meant to strip a
  trailing `-n`, `freeCopyName` changes · group 04
- `openPreview` is declared with no handler (compiles: `handle` registers per method); group 06 registers it ·
  group 04
- File hand-off with plan A's session: it holds forms page `start.ts`, `forms-view.ts`, `forms-commands.ts` (+test)
  until group 05 commits; this run never reads `api.areas.main` — lead
- `round-store.ts` exports `roundQueries(readAll)`, `openRecord` and `isFinished`, shared by both stores (widened,
  not copied) — the memory store could hold copies · group 06
- The memory store implements every `RoundStore` method, so a re-shown sample pre-fills answers typed earlier in the
  app's run — its `newestFor` could return null · group 06
- `savedArgs()` is re-read on every press and the cursor indexes the fresh list — a round saved mid-cycle shifts the
  order by one · group 06
- Both `FormsSession.end()` and `ConnectedSession.end()` run on submit or cancel; a non-abort rejection logs
  `[forms] preview round failed: <errorText>` and ends the session, as do `no_round` and `needs_manual_open` — the
  spec names submit, cancel and draft only — none known · group 06
- `ConnectedSession` exposes the session as `.session` (the brief said `.connected`) — lead's brief corrected by the
  tree · group 06
- Steps 2 and 3 (no keys) cannot pass — one `setLayout` logs every card line and the shown line at once, and a step
  awaits one line — so each line gets its own switch: ␣zln finding failed (rev 2), ␣zlp default (3), ␣zlp notice
  failed (4), ␣zln default (5), ␣zlp selftest shown (6) — four extra cycle steps · group 07
- Step 4 is `k 2`: the shown question 2 logs its update failure during the cycle itself, so `k` shows question 1's
  freshly built card, whose first update logs the line; `Enter` and `j` restore the answers and focus — proves the
  failure is logged, not that it fires on a pick · group 07
- Step 5 expects revision 7; step 6 expects `[forms] round shown: Layout preview · Layout preview`; the fixture
  notice calls `textBox(article, 'notes')` (same throw) — none known · group 07
- Mark expiry uses global `setTimeout` (main code has no injected timers; `forms-service.ts` uses the globals) ·
  fix round 1, W3
- Dot-led file names (`.#layout.js`) never reload, beyond the brief's extension list · fix round 1, W3
- The presenter's `quiet` view rather than quiet session ids: a round's `sessionId` is a random per-connect id ·
  fix round 1, W4
- `definePlugin` holds the lowercase id check: every manifest passes through it in both processes · fix round 1, W1
### Review rounds
- review 1 · 765db00 · NEEDS FIXES — 5 Important, 20 Minor (report `review-765db00.md`); every recommendation taken
  by the user's ruling; fix round 1 dispatched as four workers by file (W1 core, W2 cards, W3 registry and page
  loader, W4 preview); 09's check 6 fixed by the lead
- fix round 1 · da7ea3c 82d23b7 fb578bd b555114 05c9bac f027f58 · typecheck and lint clean (the oxfmt ignore for
  `docs/features/**` landed), 705 tests in 42 files pass
- re-review 1 · f027f58 · PASS on every prior finding (R1 core, R2 forms); 2 Minor, 1 follow-up and 1
  recommendation raised, all taken by the user's ruling — fix round 2 dispatched (asset extensions redraw and are
  served typed; `watch` start-failure comment; check-layers header reflow; the self-test proves the preview row
  selected)
- fix round 2 · 1b86e3e · typecheck and lint clean, 729 tests in 44 files pass
- re-review 2 · 1b86e3e · PASS, no findings; every round-2 item closed
- Self-test on the fixes: pending — blocked while the user's `npm start` holds the app's data folder
### Test gate
- Range: this run's commits 191f4d7 f9e9db6 b5142a6 c070e90 f8afed4 66789d6 25718bd a4f3184. Pass 1 (written):
  node-files, main-api, layout-registry, layout-preview, preview-round, round-store, manifest, editor-boxes,
  forms-commands, card-input, card-answer, layout-actions, layout-loader, data-url, scoped-files (`.test.ts`). Pass 2
  (break): forms-service, page `kinds/formats`, page-api (`.test.ts`), and `npm run selftest` (its script changed) ·
  18 files, 228 tests passed; self-test exit 0, 107 steps PASS, `[selftest] all passed`
