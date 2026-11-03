# Live default layouts — plan

Feature: layouts · Implements: none · Ticket: none
Target: main · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user edits any owner's built-in `default` layout (`layout.js` and `layout.css`) in the repo clone, and the
running app (stable and dev) redraws at once, with no rebuild. Today only user layouts in
`~/.config/wigley-ai-gui/layouts/` reload; each `default` is bundled by Vite and changes only on a rebuild.

## Architecture

Systems touched:

- **Main, layouts:** `src/main/layouts/layout-service.ts`, `src/shared/layouts/layout-registry.ts`. Each owner's
  registry also watches that owner's default folder in the repo clone and announces `default` with a revision that
  rises on each save.
- **Main, scheme:** `src/main/data-protocol/data-protocol.ts`, `src/shared/layout-url.ts`. The `wigley-layout:`
  scheme serves `<owner>/default/<path>` from the owner's default folder in the clone.
- **Main, composition root:** `src/main/main.ts`, the Vite main and renderer configs, `scripts/install-app.mts`. The
  stable build carries the clone's path; the dev app uses its own repo, and its Vite dev server does not watch
  `layouts/default/`, so both apps redraw a default through the same live path.
- **Page, layout host:** `src/shared/page/layout-host/` (`layout-loader.ts`, `show-layouts.ts`, `draw-part.ts`),
  `src/contracts/plugin.ts`. The loader imports a live `default` like a user layout, links the default's
  stylesheet (bundled URL or live URL), and draws the bundled default for any failure.
- **Every owner (16):** each moves its default-look CSS into `layouts/default/layout.css` and hands the bundled URL
  of that file to the layout host.

## Preconditions

Each was run at plan time against `1f2710da`; `wigley:make` re-runs each before the first dispatch.

- 16 owners have a built-in default: `find src -path '*/layouts/default/layout.js' | wc -l` → `16`
  (measured at plan time, re-verify). The owners: agent-lines, agent-strip, backlog, chat, docs, forms, gallery,
  keys, notes, primer, sessions, settings, usage, visual, workflow, and the shell (`src/renderer/shell`).
- No default has a `layout.css` yet: `find src -path '*/layouts/default/layout.css' | wc -l` → `0`.
- The registry ignores a folder named `default`: `grep -n "DEFAULT_NAME" src/shared/layouts/layout-registry.ts`
  shows the constant and the filter.
- The loader never imports a built-in entry: `grep -n "builtIn" src/shared/page/layout-host/layout-loader.ts` shows
  the skip.
- `src/plugins/agents/layouts/default/` is an empty folder and not a layout owner: `ls -A src/plugins/agents/layouts/default`
  prints nothing.
- **Baseline captures (a preflight step, not a check).** Before the first dispatch, with no task landed, start a dev
  drive run (`npm run drive -- start`), take the "before" screenshots task 07 check 5 lists (same width, theme and
  steps), write the exact drive commands run (seed actions, keys, width, theme, `screenshot <name>` per owner) and the run folder in the Run log, and quit the run. Task 07 compares its "after" captures with these.

## Docs written ahead

Commit `1f2710da`:

- `docs/features/layouts/design.md` — § Live defaults, the Shape diagram, the owner's contract bullet, two Decisions.
- `AGENTS.md` — the look-change paragraph and the layout bullet under Architecture.

## Mandatory Reads

- `AGENTS.md` (repo root) — every section an edited file falls under; `DESIGN.md` for any CSS task.
- `docs/features/layouts/design.md` — § Shape, § Folder and settings, § Live defaults, § Decisions.
- Any `AGENTS*.md` in a folder a task edits (`find src scripts -name 'AGENTS*.md'`).

## Design Overview

```
 install-app ── bakes the clone path ──▶ stable build          dev app: its own repo
                                              │
 main: LayoutService.register(owner, layoutTypes, defaultFolder)
        ├─ user registry:    ~/.config/wigley-ai-gui/layouts/<owner>/<name>/
        └─ default watch:    <clone>/<defaultFolder>/layout.js|layout.css
              │ announces { name: 'default', revision: n, hasCss, builtIn: false } while the folder holds layout.js
              │ announces { name: 'default', revision: 1, hasCss: false, builtIn: true } with no clone or no layout.js
 scheme: wigley-layout://<owner>/default/~<rev>/<path> → <clone>/<defaultFolder>/<path>
              │
 page: layout loader
        ├─ default not built in: import it, read it with the owner's reader, keep the last good version
        ├─ default stylesheet link: live layout.css URL while a live default is loaded, else the bundled URL
        └─ any failure (import, read, a part that throws or is missing) → the bundled default, same toast
```

Out of scope:

- CSS for parts the app draws itself (slots, panes, editors, text boxes) stays in each plugin's page CSS.
- A user layout folder named `default` stays ignored.
- No setting or override for the clone path.

Decisions (rounds 1–2 and the design review):

- The live default is read from the repo clone's working tree, uncommitted edits included (round 1).
- Each default's look CSS moves to `layouts/default/layout.css`; only the rules for what the layout draws move
  (rounds 1, 2).
- The stable build learns the clone path at build time from `install-app`; the dev app uses its own repo (Decided).
- A plugin's default folder is `src/plugins/<id>/layouts/default`, derived from its id; the shell passes
  `src/renderer/shell/layouts/default` (Decided).
- The bundled `layout.css` is linked by the loader as a file, never bundled into the page CSS, so a rule deleted
  live disappears (Decided).
- A part that throws in a live default logs and draws the bundled part, as a throwing user-layout part does today;
  a load or read failure raises the existing toast (Decided, task 03).
- A live default must define every function part the bundled default defines; a missing part fails the load with
  `layout default has no <part>` (Decided, task 03).
- The default stylesheet link is one element, present whichever layout is picked, because a user layout draws its
  missing parts from the default and several moved rules are not scoped to `default` (Decided, tasks 03, 05).
- Classes both the default layout and the app create (`.chat-entry`, `.settings-bind` and others task 05 names) keep
  their CSS in the page bundle, so restyling them still needs a rebuild (Decided, task 05).
- Design review: the registry stays the one module that announces an owner's layouts, and the page sees a live
  default as an ordinary entry (`builtIn: false`), so the loader's existing import, revision and last-good paths
  carry it; the scheme stays one handler with the owner's default folder looked up by owner; the bundled default
  stays the final fallback in `draw-part.ts`.

## File Structure

Names and signatures more than one task uses:

- `LayoutService.register(owner: LayoutOwner, layoutTypes: string, defaultFolder: string): Disposable` in
  `src/main/layouts/layout-service.ts` — `defaultFolder` is relative to the clone root. The plugin host passes
  `src/plugins/<id>/layouts/default`; `main.ts` passes `src/renderer/shell/layouts/default` for the shell.
- The registry entry keeps its shape `{ name, revision, hasCss, builtIn }`. `default` is `builtIn: false` while a
  live default folder holds `layout.js`, with its own revision and `hasCss`; else `builtIn: true`, revision 1,
  `hasCss: false`, as today.
- `ShowLayoutOptions<L>.defaultStylesheet: string | null` in `src/contracts/plugin.ts` — the bundled URL of the
  owner's `layouts/default/layout.css`, from `import defaultStylesheet from '../layouts/default/layout.css?url'`;
  null for an owner with no default CSS. The shell's page host takes the same field.
- `layouts/default/layout.css` in each owner — the rules for what that owner's default layout draws, each selector
  kept exactly as it is today.
- `LayoutRegistryDeps.defaultFolder: Files | null` in `src/shared/layouts/layout-registry.ts` — the owner's default
  folder in the clone, scoped to it; null with no clone (task 01 adds it, task 04 fills it).
- `layoutFilePath(url: string, layoutsRoot: string, paths: Paths, defaultFolderOf: (owner: LayoutOwner) => string | null): string | null`
  in `src/shared/layout-url.ts`, and
  `serveLayoutScheme(layoutsRoot: string, paths: Paths, defaultFolderOf: (owner: LayoutOwner) => string | null): void`
  in `src/main/data-protocol/data-protocol.ts` — the name `default` maps to `defaultFolderOf(owner)`, null → 404
  (task 02 adds them, task 04 passes the service's lookup).
- `LayoutService.defaultFolderPath(owner: LayoutOwner): string | null` in `src/main/layouts/layout-service.ts` — the
  absolute default folder of a registered owner; null when unregistered or with no clone. The scheme's lookup.
- `declare const WIGLEY_CLONE_DIR: string` in `src/main/clone-dir.d.ts`, set by `vite.main.config.mts`'s `define`
  from the build's `WIGLEY_CLONE_DIR` environment variable, else the repo the build runs in. `install-app` sets the
  variable to the main clone. Kept out of `src/declarations.d.ts`, which task 05 may edit for `?url`.

Existing files modified: see each task's Files line. New files: one `layouts/default/layout.css` per owner that has
default-look CSS (moved, not written new).

Boundary rules: main code imports no page code; the page learns of a live default only through the registry's
entry and the scheme; no task adds a `process.platform` check.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Registry announces a live default](01-registry-live-default.md)
- [x] [Scheme serves `<owner>/default/`](02-scheme-serves-default.md)
- [x] [Page loads a live default](03-page-loads-live-default.md)

### Wave 2
- [x] [Main wires the clone and each owner's default folder](04-main-wires-clone-defaults.md) — after 01, 02
- [x] [Default CSS to `layout.css`](05-default-css-to-layout-css.md) — after 03

### Wave 3
- [x] [Doc re-read](06-doc-re-read.md) — after 01, 02, 03, 04, 05

### Wave 4
- [x] [Final verification](07-final-verification.md) — after 01, 02, 03, 04, 05, 06

## Run log

Review base: 46f417b5

### Groups
- 02 · 10b8f622 · diff read: both Produces signatures present; layout-url tests 17/17; typecheck clean on its files (worker, and the only tree error is task 03 WIP in draw-part.ts); oxfmt clean · concerns: npm run lint stops at check-styles on agent-strip.css:17 raw 2px, pre-existing at the review base
- 01 · 71f55e08 · diff read: defaultFolder: Files | null on LayoutRegistryDeps present, entry rule as planned; registry tests 39/39; oxfmt clean; tree typecheck errors are task 03 WIP only · concerns: a throw from starting the default-folder watch rejects startLayoutRegistry, so the owner user layouts fail to start too (matches the user-folder watch); a default folder missing at start stays unwatched until the next start
- 03 · e8dfeb96 · diff read: ShowLayoutOptions.defaultStylesheet, LayoutLoaderDeps.defaultStylesheet and DrawnPart.drewPick present; typecheck clean; layout-host, entry-list, primer-view, page-api tests 238/238; oxlint and oxfmt clean on its files (worker) · concerns: renderer.ts (shell) also took defaultStylesheet: null, for task 05 to fill; drawPart tests now overlap the new drewPick table rows, kept for their dataset asserts
- 05 · f26de97e · diff read over 9 slices; 16 layout.css files; css_conserve.py per owner: base rules == page CSS + layout.css, lost 0 added 0 for all 16; no defaultStylesheet: null in any show call (test fixtures only); ?url declared; typecheck clean outside src/main (task 04 WIP); layers clean; check-styles and oxfmt flag only the pre-existing agent-strip min-height calc, moved verbatim to agent-strip/layouts/default/layout.css:11 · concerns: cascade ties for task 07 check 5: settings .settings-head vs .ui-section-header (justify-content), notes .notes-markup-group .is-active vs .ui-icon-button.is-active; to look at: agent-strip box vs kit rules, shell .activity-item and .config-problem-badge vs shared button rules, settings .settings-row vs .ui-row if a row ever takes ui-row, sessions .ui-row.session-row:not(.is-selected) vs .ui-row hover background; docs layout.css holds two consecutive .docs-doc-frame rules from the split, unmerged
- 04 · 61a1518b · diff read: register(owner, layoutTypes, defaultFolder), defaultFolderPath, repoDir on LayoutServiceDeps and declare const WIGLEY_CLONE_DIR present; whole-tree typecheck clean; resolve-clone-dir, layout-service, main-api tests 28/28; oxlint 0; oxfmt clean on its 13 files · concerns: Vite server.watch.ignored behaviour rests on the vite 8.3.4 source, not its docs; the assetsInlineLimit .css check could miss a path carrying a query string (task 07 check 7 checks the package); a drive run or self-test reads defaults from its own repo, uncommitted edits included; install-app baking the main clone has no test until a real install-app run
- 06 · 246bfbdb · diff read: 3 design.md § Live defaults bullets (Reload, CSS, Fallback) and the AGENTS.md layout bullet fixed against the code; 20 listed lines and the grep hits already true; oxfmt clean on AGENTS.md (docs/features is oxfmt-ignored) · concerns: the equal-specificity tie-break of moved rules is documented nowhere; worth a DESIGN.md line if task 07 check 5 finds it matters
- 07 · 246bfbdb · live checks on a dev drive run (report /tmp/claude-live-defaults/reports/07-1.md): 1 pass (keys and shell layout.js redraw, revision 2, load unchanged); 2 pass (outline rgb(255,0,0) at revision 3); 3 pass (deleted .keys-title-bar-button rule gone, one live link ~4); 4 pass (syntax-error and missing-part toasts, throwing part logged once and bundled part drawn, revert at revision 13); 5 pass (backlog, docs, gallery, notes, settings pixel-identical; rest differ only by caret, pulse dot, elapsed text; Agents meter gap traced to replay seed order); 6: 10 of 12 self-tests pass, chat and primer fail but both fail the same at the review base; 7 pass (package bakes the WIGLEY_CLONE_DIR or worktree path, 16 separate layout css files, no data:text/css); every default edit reverted · concerns: not compared in check 5: .config-problem-badge and the sessions row hover, neither shown by the replay; the notes markup toolbar was read with query, not on screen
### Contract changes
- src/main/clone-dir.ts and clone-dir.test.ts (named by the cold-read decision, not a Produces item): planned clone-dir.ts → landed resolve-clone-dir.ts / resolve-clone-dir.test.ts · why: tsc skips a foo.d.ts beside a foo.ts, leaving WIGLEY_CLONE_DIR undeclared; clone-dir.d.ts keeps its Produces name · consumers: none · group 04
### Rulings
- layout-url.ts keeps its own private DEFAULT_NAME, as registry, draw-part and layout-parts each do — no shared export exists — a later pass may fold the four copies into one · group 02
- main.ts passes () => null to serveLayoutScheme until task 04 wires the lookup — per the task doc — none · group 02
- npm run lint fails at the review base on src/plugins/agent-strip/page/agent-strip.css:17 (check-styles raw-length, from 65d29099, outside this plan); lint proofs this run read check-styles output for the run's own files and run oxlint and oxfmt directly — not this plan's to fix — a real style failure in a run file could hide behind it · lead
- the registry sends on a default-folder change only when default is live now or was before, and bumps the revision on every send, so a folder that gains layout.js after start goes live at revision 2 — the page only needs a rising number — none known · group 01
- the default folder is watched non-recursively, filtered to exactly layout.js and layout.css — none · group 01
- task 04 waits for task 03 as well as 01 and 02: both edit src/contracts/plugin.ts (03 ShowLayoutOptions, 04 the MainApi layouts.register comment), which the wave check missed — a later 04 start costs only wall time · lead
- Baseline captures (preflight) at 46f417b5 in worktree .claude/worktrees/live-defaults-baseline, run folder /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui/.claude/worktrees/live-defaults-baseline/.drive/20261103-003256-d044 (15 owners, screenshots/<name>.png; full replay notes in baseline-replay.md there), 1400x900, catppuccin-mocha, fake harness; drive commands in order, each 'npm run drive -- <cmd>': start ; setting theme '"catppuccin-mocha"' ; setting plugins.disabled '["usage-tab-line"]' ; restart ; resize 1400 900 ; do usage.seed '{"variant":"fresh"}' ; key Escape ; key Space z l a ; screenshot shell-chrome ; screenshot agent-lines-preview ; key Space z l o ; screenshot forms-preview ; key Escape ; key Space z l p ; screenshot primer-preview ; key Escape ; key Space z l c ; screenshot chat-preview ; key Escape ; key Space z l w ; key '<A-o>' ; screenshot workflow-preview ; key Escape ; key Space z l s ; screenshot sessions-preview ; key Escape ; key Space z l s ; key Escape ; key Space z g ; screenshot gallery ; key Escape ; key Space k , ; screenshot settings ; key Escape ; do docs.seed '{}' ; key Space k d ; screenshot docs ; key Escape ; key Space k b ; screenshot backlog ; key Escape ; key Space n n ; screenshot notes ; key Escape ; key Space k s ; key Space v u ; screenshot usage-details ; key Space '?' ; screenshot keys-help ; key Escape ; key Space ; screenshot keys-which-key ; key Escape ; quit. Visual has only the whole-window chat-preview capture (element screenshot failed UnknownVizError); if shell-chrome shows no Agents preview, press Space z l a once more · lead
- src/renderer/plugins/page-api.test.ts (off the Files line) gained defaultStylesheet: null, since the required field broke its compile — none · group 03
- chat entry-list adds isBundledView (!drewPick || pick is the bundled object) beside isDefaultView: redrawSlot branches on it, isDefaultView still drives the toast — one more boolean · group 03
- the default stylesheet link is one element made at loader creation, attached only while it has an href, re-attached before the first user layout link — none · group 03
- the part check reads plain object as isRecord from read-layout-module.ts — a bundled default holding an array or class instance would have its function members checked too · group 03
- task 05 (Parallel, 16 owners x 3 files) splits into 9 workers by owner, an owner's three files never split: A agent-lines+agent-strip+src/declarations.d.ts, B backlog+gallery, C chat, D docs, E forms+keys, F notes+primer, G sessions+workflow, H settings+usage, I visual+shell; at most 5 workers run at once with task 04 — 6 files per worker is past the 5-file guide, kept to keep each owner whole · lead
- section and split comments copied to both sides, each naming its own subjects; page-CSS file-head comments rewritten where they described moved rules (notes, sessions, settings, usage, visual, workflow) — cosmetic · group 05
- the pre-existing agent-strip raw 2px/7lh calc and its oxfmt wrap moved verbatim into agent-strip/layouts/default/layout.css, unfixed — the lint failure now names that file · group 05
- resolveCloneDir checks absoluteness with node:path isAbsolute, keeping the planned (baked, isFolder) signature — a Windows \\foo path counts as absolute, which a baked path never is · group 04
- AGENTS.md:593 (off the Files line) updated to the three-argument shell register call, as it had gone stale — none · group 04
- no doc text added for the cascade tie-break or the never-resetting revision, as no listed line contradicted the code there — a missing note only · group 06
### Review rounds
- 1 · 61288a54 · NEEDS FIXES · 2 Important, 13 Minor, 2 pre-existing; lead applied #2 #7 #8 #10 #11 #14 #15 in 87834842; dispatched #1 #3 #4 #6 #12; #13 #16 #17 to follow-ups; #5 #9 left
### Test gate
- npm test (whole Vitest suite: every owner page start.ts, the shared layout host and main layouts changed) · 380 files, 6220 tests passed, no type errors; npm run selftest -- --plugin for each owner with a script (agent-lines, agent-strip, backlog, chat, docs, forms, notes, primer, sessions, settings, usage, workflow), the layout-host change reaching every owner page · 10 pass; chat fails 8 fits-the-minimum-width steps (nav.ui-tabs.session-tabs holds 120px in 99px) and primer fails activated Layout preview, both identical at the review base 46f417b5 (chat re-run there by the lead), so neither is this plan's
