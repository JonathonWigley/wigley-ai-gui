# App layouts — plan

Feature: Layouts everywhere · Implements: none · Ticket: none
Target: main · Written: 2026-10-27

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every surface of the app draws through a user-editable layout, and the primer shows each work item as its own
card. The user changes the look of any surface by editing `~/.config/wigley-ai-gui/layouts/<owner>/<name>/layout.js`
(and an optional `layout.css`). The running app redraws without a rebuild or a restart.

## Architecture

Systems touched:

- **Main core:** a new core LayoutService over `~/.config/wigley-ai-gui/layouts/`, built on the existing registry
  (`src/shared/layouts/layout-registry.ts`). A new URL scheme serves layout files to the page.
- **Plugin API:** `api.layouts` in main (register a contract, read the names) and on the page (show layouts).
- **Page host:** one module, `src/shared/page/layout-host/`, holds the code that forms and chat each copy today:
  showing layouts, the reader skeleton, the pick chain, rolling back a part that throws, the fallback to `default`,
  the command runner and the base kit.
- **Adopters:** shell, forms, chat, primer, docs, backlog, settings, notes, sessions, gallery, keys. Each adopter
  owns its contract (`layouts/layout.d.ts`), its `default` layout and its reader.
- **Primer state:** the rail gains item rows, and the card pane shows one card per rail row.

## Preconditions

Each claim was checked on 2026-10-27. `wigley:make` runs each command again before the first dispatch.

- The branch is `main` and the tree holds no change outside the plan folder's commit: after the lead commits the
  plan folder and the `design.md` edit together, `git -C ~/Documents/ai-dev/wigley-ai-gui status --short` prints
  nothing.
- No user layout exists in the old plugin data folders, only generated `layout.d.ts` files:
  `ls "$HOME/Library/Application Support/wigley-ai-gui/plugins/forms/layouts" "$HOME/Library/Application Support/wigley-ai-gui/plugins/chat/layouts"`
  prints only `layout.d.ts` twice.
- No `layouts/` folder exists in the user config folder: `ls ~/.config/wigley-ai-gui/` prints `settings.json` and
  no `layouts`.
- Only forms and chat call the registry and the loader:
  `grep -rln "startLayoutRegistry\|showLayouts\|createLayoutLoader" src --include='*.ts' | grep -v '\.test\.ts'`
  prints the two shared modules and the main and page `start.ts` of forms and chat.
- The page CSP allows `wigley-data:` for scripts and styles only: `grep -n "Content-Security-Policy" -A1 index.html`.

## Docs written ahead

Commit `604d4a1` (wigley-ai-gui):

- `docs/features/layouts/design.md` — the design: the core service, the page host, the folder and settings, what a
  layout draws, every adopter and its surfaces, the previews, the primer's item cards.
- `AGENTS.md` — § Intent (everything draws through a layout), the source tree, the user config folder, plugin
  data, § A layout, § A forms layout, the debug keys.
- `docs/features/primer/design.md` — § The Primer tab and § Keys for the nested rail and the item card.
- `DESIGN.md` — § Surfaces › Primer.

Commit `9a66a53` (wigley-ai-marketplace): `plugins/wigley/scripts/forms/README.md` § Layouts names the new forms
layouts folder. It bumps the wigley plugin to 1.12.1.

## Mandatory Reads

- `AGENTS.md`
- `DESIGN.md`
- `docs/keymap.md`
- `docs/features/layouts/design.md`
- `docs/features/primer/design.md` (tasks 01 and 05)
- `docs/features/agent-chat/design.md` (tasks 04, 14, 15)
- `docs/features/backlog/design.md` (task 07), `docs/features/settings/design.md` (task 08),
  `docs/features/notes/design.md` (task 09), `docs/features/key-hints/design.md` (task 12)
- `.agents/skills/drive/SKILL.md` (task 17)

## Design Overview

```
 ~/.config/wigley-ai-gui/layouts/
   kit.d.ts                         ← core writes at start: BaseKit and the shared kit types
   <owner>/layout.d.ts              ← core writes at start: the owner's contract (imports ../kit)
   <owner>/<name>/layout.js (+css)  ← the user's layouts
        │ watched per owner
 main: LayoutService ── one registry per registered owner ── sends LayoutSet per owner over the Bridge
        │ wigley-layout://<owner>/<name>/~<revision>/<path>
 page: api.layouts.show(...) → layout host
        pick (owner setting → default) · read · draw each part · roll back a throw → default
        · data-layout on each part root · stylesheet link per layout · redraw on a new set
        │
 adopter view: the app keeps selection, keys, scroll, splits, boxes, editors; the layout draws the parts
```

Primer rail after the change:

```
 Feature           Daily Quest Board
 Primer
   Quest data model    Yes 3/3     ← selected task, expanded
     ☑ 1 Add QuestDefinition…      ← item row; selecting it shows the item card
     ☑ 2 Persist progress…
     ☑ 3 Midnight reset…
   Remote config       Unclear 2/2 ← collapsed
```

Decisions (the interview, 2026-10-27):

- Only the selected task expands its items in the rail. `j` / `k` walk task row, item rows, next task.
- The card pane shows one card for the selected rail row: Feature, task or item.
- The task card holds heading, tags, need, Question / Evidence / Probes / Pointer, the extra task's name box, the
  add-item box and the task comment. It lists no items.
- The item card holds the header `⌃H ‹ n of m › ⌃L`, the item text, the include mark, an Added tag and the comment
  box.
- `x` toggles the selected item's include mark in the rail and on the item card. `y` / `n` / `u` on an item row set
  its task's need. `<C-l>` / `<C-h>` on the card step to the next / previous rail row.
- The review pane does not change.
- Every surface gets a layout: every plugin view, the overlays and dialogs, and the shell chrome.
- Each owner has its own setting: `<plugin>.layout`, and the core setting `shell.layout`. There is no app-wide
  layout setting.
- Layouts live in `~/.config/wigley-ai-gui/layouts/<owner>/`, shared by the stable and dev apps.
- Each app writes `layout.d.ts` at start; the app started last wins.
- A layout's CSS restyles only under its own `data-layout` root. Primitives keep their app-wide look in themes.
- Forms, primer, chat and sessions get a preview sample under `Space z l`.
- One plan, in waves.

Design review (Decided):

- The layouts folder and the shell are core, so layouts are a core service, `api.layouts`. A plugin never reaches
  the folder through `api.data`.
- One page host replaces the copies in forms and chat. Every later adopter uses it.
- The core writes `layouts/kit.d.ts`, and each owner's `layout.d.ts` imports its shared types from `../kit`. No
  owner restates `HeadKit`, `TagTone` or `ButtonVariant`.
- The old per-plugin channel members `layout()` and `layoutChanged` go. The Bridge carries each owner's set.
- A dialog or prompt is drawn by the layout of the owner that opens it. The shared confirm prompt
  (`src/shared/page/confirm-prompt.ts`) takes its look from the owner's layout through the host.

Out of scope:

- Restyling or replacing primitives app-wide from a layout.
- Reading layouts from the old plugin data folders.

## File Structure

### Names more than one task uses

Task 02 § Produces (`02-layout-core.md`) is the one source of these names and signatures. Every other task
consumes them as written there. A task that needs a different signature reports a concern; it does not change the
name in its own code. The names:

- Contracts: `LayoutOwner` (`src/contracts/layouts.ts`); `MainApi.layouts` (`register`, `names`), `PageApi.layouts`
  (`show`), `ShowLayoutOptions`, `ShownLayouts`, `LayoutShow` (`src/contracts/plugin.ts`; their members are in 02
  § Produces); the Bridge's `layouts` and `onLayouts`.
- Main: `LayoutService`, `createLayoutService` (`src/main/layouts/`); `LAYOUT_SCHEME`, `layoutUrl`,
  `layoutFilePath` (`src/shared/layout-url.ts`); `registerFileSchemes`, `serveLayoutScheme`.
- Page host (`src/shared/page/layout-host/`): `readLayoutModule`, `isRecord`, `PartPick`, `RollbackDeps`,
  `DrawPartOptions`, `drawPart` (its `build(builder, parent, rollback)` returns the owner's own object
  `R`, and the call returns `{ built, layoutName, dispose() }`; an owner calls the previous draw's `dispose` before
  it draws the same part again and when the view goes), `requireElementIn`, `pickLayout`, `BaseKitDeps` (`keysFor` returns
  `string | null`; `scope` may be `null`), `createBaseKit`, `KitCommands` (`exists`, `run`), `commandRunner`,
  `PageLayouts`, `createPageLayouts`.
- `kit.d.ts`: `BaseKit` (forms' `HeadKit` members, plus `keyHint` options, `statusDot`, `setDotStatus`, `row`,
  `emptyState`, `keyPrompt`), `TagTone`, `ButtonVariant`, `KitButtonOptions`, `DotStatus`, `KeyHintOptions`,
  `KitRowOptions`.
- Shared dialogs: the list picker's `drawRow` and `redraw()`; the confirm prompt's `drawBody`, `ConfirmBodyParts`
  and `redraw()`. Only task 02 edits `list-picker.ts` and `confirm-prompt.ts`; each owner fills the hooks for its
  own pickers and prompts in its own task.
- The repo's `layout.d.ts` imports `BaseKit` from `'../../../shared/page/layout-host/kit'`. The registry rewrites
  that specifier to `'../kit'` in the user's copy.
- `drawPart` sets `data-layout="<name>"` and `data-layout-owner="<owner>"` on each part root.
- `api.layouts.show` refreshes on the owner's settings change by itself; no adopter calls `refresh()` for it.
- Gallery and keys get register-only main parts (task 02), each with a placeholder `layout.d.ts` that tasks 11 and
  12 fill. The shell registers with `layoutService.register('shell', layoutTypes)` in `main.ts` and shows with
  `pageLayouts.show('shell', options)` in `renderer.ts` (task 13).

Settings: each plugin adopter adds `layout: 'default'` to its manifest `settings` and a `layout` entry to
`settingInfo`. The shell's setting is the core setting `shell.layout` (`src/contracts/settings.ts`,
`src/config/settings.ts`), added by task 13.

Commands and keys: each preview command is declared in its plugin's manifest and bound in `src/plugins/keymap.ts`
under `<Leader>zl`: `p` primer (task 05), `s` sessions (task 10), `c` chat (task 15). The `<Leader>zl` group in
`keymap.ts` `groups` is renamed from `forms layouts` to `layout previews` by task 05.

### Existing files modified (by owner task)

- 01: `src/plugins/primer/page/{primer-state,primer-commands,primer-view,boxes}.ts`, `primer.css`, their tests
  (`primer-events.test.ts` included),
  `src/plugins/primer/main/selftest-script.ts`, `src/plugins/primer/manifest.ts`, `src/plugins/keymap.ts`
- 02: the files listed in `02-layout-core.md` (contracts, main, preload, renderer, the host, `index.html`,
  `scripts/check-layers.mts`, forms and chat start code, `list-picker.ts`, `confirm-prompt.ts`, the gallery and keys
  main parts)
- 03: `src/plugins/forms/page/layout/*`, `src/plugins/forms/layouts/*`
- 04: `src/plugins/chat/page/{entry-list,read-chat-layout,chat-kit}.ts`, `src/plugins/chat/layouts/*`
- 05: `src/plugins/primer/**` (layout wiring, preview), `src/plugins/keymap.ts`
- 06 docs, 07 backlog, 08 settings, 09 notes, 10 sessions (+ `keymap.ts`), 11 gallery, 12 keys: each its own
  plugin folder
- 13: `src/renderer/shell/*`, `src/renderer/renderer.ts`, `src/renderer/config-push.ts`, `src/shared/command-registry.ts`, `src/contracts/settings.ts`, `src/config/settings.ts`
- 14: `src/plugins/chat/page/*` (composer, start prompt, pickers, dialogs, image viewer), `src/plugins/chat/layouts/*`
- 15: `src/plugins/chat/**` (preview), `src/plugins/keymap.ts`

### New files

- `src/shared/page/layout-host/` — the page host (task 02): one home for the code forms and chat copy today.
- `src/main/layouts/` — the core LayoutService (task 02): the folder is core-owned.
- `src/plugins/<owner>/layouts/layout.d.ts` and `layouts/default/layout.js` for primer, docs, backlog, settings,
  notes, sessions, gallery and keys; `src/renderer/shell/layouts/` for the shell — each owner's contract and
  built-in look.

### Boundary rules

- An adopter imports the host only from `src/shared/page/layout-host/`. It never imports another plugin's
  `layout/` code.
- Task 02 adds a `LAYERS` entry in `scripts/check-layers.mts` for every owner's `layouts` folder in this plan, so no
  later task edits that file.
- A layout reaches app state only through its kit. The app keeps selection, keys, scrolling, split widths, text
  boxes and editors.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Primer nested rail and item cards](01-primer-item-cards.md)
- [x] [Core layout service and page host](02-layout-core.md)

### Wave 2
- [x] [Forms onto the host](03-forms-host.md) — after 02
- [x] [Chat entries onto the host](04-chat-entries-host.md) — after 02
- [x] [Primer layout and preview](05-primer-layout.md) — after 01, 02
- [ ] [Docs layout](06-docs-layout.md) — after 02
- [x] [Backlog layout](07-backlog-layout.md) — after 02
- [ ] [Settings layout](08-settings-layout.md) — after 02
- [ ] [Notes layout](09-notes-layout.md) — after 02
- [ ] [Gallery layout](11-gallery-layout.md) — after 02
- [ ] [Keys overlays layout](12-keys-layout.md) — after 02
- [ ] [Shell layout](13-shell-layout.md) — after 02

### Wave 3
- [ ] [Sessions layout and preview](10-sessions-layout.md) — after 02, 05 (`keymap.ts`)
- [ ] [Chat surfaces layout](14-chat-surfaces-layout.md) — after 04

### Wave 4
- [ ] [Chat preview](15-chat-preview.md) — after 10 (`keymap.ts`), 14

### Wave 5
- [ ] [Doc re-read](16-doc-re-read.md)

### Wave 6
- [ ] [Final verification](17-final-verification.md)

## Run log

Review base: efe64ec38d6a802e539ab917ad27c20037a321ae

### Groups
- 01 · a218909 · diff read: every Produces present; primer tests and 25 new self-test steps pass; typecheck clean in primer (remaining errors in 02's in-flight files) · concerns: check-styles not run (lint stopped at 02's layer check); i on a non-extra task card now focuses add-item box
- 02 · ba033b8 · diff read: every Produces present; typecheck, lint, npm test (3728) and selftest pass · concerns: check-layers gained src/main/plugins→src/main/layouts and src/main/layouts→src/shared/paths; test-dom FakeElement.contains added; AGENTS.md lines 159/161/532 still say keys and gallery have no main part (for task 16)
- 03 · 99e38f4 · diff read: Produces present; forms and host tests 618/618; forms typecheck and oxlint/oxfmt clean (full lint blocked by in-flight chat test) · concerns: buildSection in card-parts.ts has no caller now, left as out of scope; drawPart's dispose ignored, round view owns cleanup as before
- 04 · ab26664 · diff read: Produces present (entries (parent,input,kit), ChatKit extends BaseKit with edgeCard, DotStatus re-export, chatCommandNamed); chat tests 308 pass; chat typecheck/lint clean · concerns: layout.test.ts keeps its own fake element (layer check bars chat/layouts from test-dom); chat-kit.ts copies base-kit's private appended helper
- 07 · 4309e98 · diff read: Produces present; backlog tests 136 pass; backlog typecheck/oxlint/oxfmt clean · concerns: 02's confirm-prompt caches a keepButton a throwing confirmBody asked for, so rollback loses the Keep button; 02's list picker drawRow rows lack ui-row--action (no pointer cursor); cursorActions display:contents breaks .ui-row-trailing + .backlog-row-actions spacing (visual, task 17); detail oneLine is now a span; view test patches FakeElement focus/blur per test
- 05 · 860a80b · diff read: Produces present, zl group renamed, zlp bound; primer tests 181 pass; primer self-test incl. layout preview group passes, every key placed; check-layers/check-styles clean · concerns: AGENTS.md still names only Space z l o (task 16); task card box order duplicated in the kit since boxes.ts was out of scope; screenshots show a blank band under the selected rail row with card focus, Unclear 2/2 count wrapping, raw markdown link in pointer — same as before, compare in task 17
### Contract changes
- LayoutLoaderDeps: dataUrl → layoutUrl(name, revision, path), plus owner: LayoutOwner · why: the loader marks each link's data-layout-owner · consumers: none outside show-layouts.ts · group 02
- LayoutLoader: gains dispose() removing its links · why: LayoutShow.dispose() removes the show's stylesheet links · consumers: none outside show-layouts.ts · group 02
- createBacklogKit scope: BacklogBaseScope → BacklogKitScope (adds picker, confirm) · why: picker-row and confirm-body kits fire in pushed scopes · consumers: none outside 07 · group 07
- BacklogView: gains dispose() beside setLayouts · why: release the shown layouts · consumers: none (PageStart has no dispose hook) · group 07
### Rulings
- selectedRow returns stored selection without railRows lookup — selection is the identity rows are built from — a stale selection would come back as is · group 01 · group 01
- showTarget checks only the target's task exists, not the item — no caller builds a missing-item target — would select a row with no item · group 01 · group 01
- i on a non-extra task card focuses the add-item box, first box shown — follows shownBoxes order — was item 1's comment before · group 01 · group 01
- drawPart treats a pick named default as the default attempt — no double build or log — a user layout named default is already ignored by the registry · group 02 · group 02
- list picker disposes row anchors on every draw pass, cursor moves included — redraw rebuilds rows — extra anchor churn on j/k · group 02 · group 02
- page api's layouts.show wraps the host's LayoutShow so dispose also stops the settings refresh — owners never call refresh — none seen · group 02 · group 02
- forms register failure logs [forms] layouts not registered; core logs start failures as [<owner>] layouts not started — split by who throws — a reworded log line · group 02 · group 02
- cards and panes keep requireElementIn after drawPart — keeps the 'returned no element' message — pane error names now rail/review · group 03 · group 03
- new scopedAnchor in card-kit.ts — BaseKitDeps gives no scope-bound anchor — a second anchor path beside the base kit · group 03 · group 03
- when the shown layout and the default builder both throw, chat still toasts '<kind> entries drawn with default' as before — the Toasts line read literally gives none — a misleading toast in a double failure · group 04 · group 04
- default layout calls kit.markdown(parent, text, 'md') — keeps the old .md class — none · group 04 · group 04
- default pane roots are div.backlog-pane with inline display:contents — keeps the grids and list scroll; backlog.css outside Files — inline style where a CSS rule would be cleaner · group 07 · group 07
- setLayouts redraws inside keepFocusedBox and restores both lists' scrollTop; detail redraws from the top — matches drawDetail on a new key — none · group 07 · group 07
- talliesText removed, no caller left — none · group 05 · group 05
- view disposed before destroyForm — layout anchors go before the form — none seen · group 05 · group 05
### Review rounds
### Test gate
