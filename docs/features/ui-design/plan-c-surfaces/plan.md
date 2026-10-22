# UI design plan C — surfaces — plan

Feature: UI design rework · Implements: none · Ticket: none
Target: main · Written: 2026-10-21

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Rebuild every existing surface on plan B's primitives and plan A's tokens, each on its `DESIGN.md`
layer, and land the key changes that bring forms and chat under the key rule (raw keys act on the
focused scope, chords navigate the visible scope, the leader changes scope):

- the chrome (title bar, activity bar, side bar, status bar and key bar) on the chrome material
- floating surfaces (which-key, help, pickers, dialogs, toasts) on the floating material
- Sessions, the Form tab (rail as a split), Chat (transcript, tool cards, permission cards, the
  floating composer), Docs (tree in the side bar in Docs mode, a split pane in a session's Docs tab)
- the forms and chat layout kits handing the primitives to user layouts
- the editor active-line band, and every stylesheet off check-styles' legacy list

## Architecture

Systems touched:

- **renderer** — `shell/shell.css`, `toasts.ts`, `codemirror-vim/` (active-line band, editor theme on
  tokens), `index.css` (the global `kbd` rule leaves)
- **shared/page** — `dialog.css` (deleted), `dom.ts` (`appendKeys` deleted), `markdown.css`, `list-picker.ts`
- **config** — `theme-tokens.ts` and the Mocha theme (`editor-active-line`)
- **plugins** — `keys/page` (which-key, help, key bar), `sessions/page`, `forms/page` + `forms/layouts/default`
  + forms manifest keys, `chat/page` + `chat/layouts/default` + chat manifest keys, `docs/page` + docs
  manifest keys
- **scripts** — `scripts/check-styles.mts` (the legacy list removed)
- **docs** — `DESIGN.md`, `AGENTS.md`, `docs/features/ui-design/design.md`, `followups.md`, earlier
  feature designs' key lines

## Preconditions

| Claim | Command | Expected |
|---|---|---|
| Plan B has closed | `test -d docs/features/ui-design/plan-b-primitives && echo open` | prints nothing |
| Plan B's primitives and gallery are in the tree | `test -f src/shared/page/ui/materials.css && test -f src/plugins/gallery/manifest.ts && test -f scripts/check-styles.mts && echo ok` | `ok` |
| The style check passes before any surface changes | `npm run lint` | exit 0 |
| Plan B's fit check lets the primitives' ellipsis parts clip (plan B 02) | `grep -c "ui-row-label\|ui-tab-label\|ui-collapsible-summary" src/main/selftest-config.ts` | 1 or more |
| Plan B put `src/shared/page/ui` in every plugin page layer and the `src/shared/page` layer (plan B 06) | `grep -n "'src/shared/page/ui'" scripts/check-layers.mts` | a hit in the `layers` of every `src/plugins/<plugin>/page` entry and of `src/shared/page` |
| No other run is editing chat, forms, docs or sessions | `ls -d docs/features/*/plan-* \| grep -v ui-design` | prints nothing |
| No uncommitted source edits from another session | `git status --short src scripts` | prints nothing |

No package is installed by this plan.

## Docs written ahead

Commit `e1f6b73` holds `DESIGN.md`, `AGENTS.md` and `docs/features/ui-design/design.md`; plans A and
B corrected them against their code. The doc re-read task re-reads them against this plan's code.

## Mandatory Reads

- `AGENTS.md`
- `DESIGN.md`
- `docs/features/ui-design/design.md`

## Design Overview

```
┌ title bar  L1 material-chrome ── shown mode's context ───────────────── actions ┐
├ activity ┬ side bar  L1 material-chrome--dense ┬ tab strip (tabStrip/tab) on the sheet ┤
│ bar      │ Sessions: row(list) per session     │ ┌ sheet() L2 ─────────────────────────┐│
│ L1       │ Docs mode: the docs tree, row(tree) │ │ Form tab: createSplit(rail │ cards) ││
│ icons    │                                     │ │ Chat tab: transcript ↓ beneath      ││
│          │                                     │ │   ┌ composer L3 floatingPanel ───┐  ││
│          │                                     │ │   │ editor · chip()s · send      │  ││
│          │                                     │ │ Docs tab: createSplit(tree │ doc)││
│          │                                     │ └─────────────────────────────────────┘│
├ status bar L1 ── key bar: kbd() + label ── problem / round status items ─────────────┤
└ overlay: which-key, help, pickers, createDialog over scrim, toasts — floatingPanel ───┘
```

Every stylesheet a task rebuilds leaves check-styles' legacy list in spirit at once: the task's
Done when runs `node scripts/check-styles.mts --no-legacy` over its own files (no violation; a listed
file that passes prints a note, not a failure), and task 10 deletes the list, after which
`npm run lint` checks every file. No task but 10 edits `LEGACY_FILES`.

Decisions (interview; `design.md` § Surfaces and § Keys hold the reasons):

- Layers per surface as `design.md` § Surfaces tables them.
- Tool-call cards show a status dot and no duration; permission cards say **Allow once** and
  **Deny**; the recommended choice carries the accent, not peach.
- The chat composer floats (L3, `radius-xl`, inset `space-3`) with the transcript scrolling beneath
  it, holding the editor, the session controls as chips, and send.
- The Docs view hands back its tree and its doc as two parts: Docs mode puts the tree in its mode
  side bar; a session's Docs tab puts it in the left pane of a split.
- Keys — forms: raw `c` clear, `f` fix now, `u` follow-up, `s` leave it on the page, with
  `<Leader>a…` kept in a text box; the `Space a 1-9` page binds go; jump to question (`Space 1-9`,
  `<Leader>1-9`, `jumpTo1..9`) is removed; next and previous unanswered move to `<A-n>` / `<A-p>`,
  page and box, replacing `Space e n` / `Space e p`; submit moves to `<D-Enter>`, replacing
  `Space Enter`.
- Keys — chat: the session controls move to raw `m` `e` `o` `c` in the chat scope, with
  `<Leader>c…` kept in the composer box; chat gains `gg`. Docs tree gains `gg` / `G`. Session rows
  stay on `<A-S-o>` / `<A-S-i>`.
- A dialog's actions run safe first, danger last (rightmost), in forms, chat and docs: Keep answering then
  Cancel round (04), Back then Deny and Keep it running then End the session (06), and plan B's gallery dialog
  already reads that way. Neither `DESIGN.md` nor plan B's `createDialog` pins an order, so this plan does. A
  docs dialog that gains a danger action follows it; today's docs dialogs draw no action buttons (08).
- Buttons never take focus; the keyboard cursor always shows, drawn with the one focus ring.

## File Structure

### Shared names

Plan C consumes plan B's primitives and plan A's shell, exactly as `plan-b-primitives/plan.md` and
`plan-a-foundation/plan.md` spell them (both plans have closed when plan C runs, so the code is the
final word: a task checks each signature in the tree before building on it). Plan B also lands two
things plan C relies on and no plan C task repeats: its task 02 makes the self-test's fit check treat
the primitives' ellipsis parts (`.ui-row-label`, `.ui-row-detail`, `.ui-tab-label`,
`.ui-collapsible-summary`) as allowed to clip, so no plan C task adds them to a `SCROLLS_ITSELF`; its
task 06 adds `src/shared/page/ui` to every plugin page layer and to the `src/shared/page` layer in
`scripts/check-layers.mts`, so no plan C task edits that script.

Names plan C adds and shares across its own tasks:

```ts
// src/shared/key-hints.ts (01) — editor binds read as space-separated keys Kbd can split
export function readVimKeys(keys: string, leader: string, platform: Platform): string;
export function editorHints(editor: EditorKeymap, label: CommandLabel, platform: Platform): KeyHint[]; // gains platform

// src/plugins/sessions/page/sessions-view.ts, session-tabs-view.ts (03)
//   SessionsViewDeps.noSelectionHint(): HTMLElement | null
//   SessionTabsDeps.noSelectionHint(): HTMLElement | null
// the session's L2 sheet: `div.session-bodies` is `sheet()`, and each session tab's element fills
// its `div.session-body` — Form, Chat and Docs tabs build no sheet of their own (03)

// src/plugins/docs/page/docs-view.ts (08) — the docs view hands back two parts
export interface DocsView { tree: HTMLElement; doc: HTMLElement; treeHidden(): void; /* … */ }
//   tree: Docs mode's side bar, or a session Docs tab's split start pane
//   doc:  Docs mode's sheet, or the split's end pane
//   DocsViewDeps gains revealTree(): void and addOverlay(element: HTMLElement): Disposable

// src/config/theme-tokens.ts (09) — core token `editor-active-line` (kind `color`), Mocha "surface0 / 0.4"
```

`createListPicker(deps: ListPickerDeps): ListPicker` and `createToasts(layer, timers)` keep their
signatures (02); chat's and docs' picker call sites set `overlayClass: ''` and `dialogClass: ''` in
06 and 08.

### File ownership

Each file belongs to one task, so the tasks in a wave never share one. A file two tasks touch sits in
different waves, named in the third column.

| Task | Owns | Also touched, by wave |
|---|---|---|
| 01 | `src/renderer/shell/shell.css`, `shell-layout.ts`, `src/plugins/keys/page/*`, `src/plugins/keys/manifest.ts`, `src/shared/key-hints.ts` (+ test) | `shell.css`: 02 (W1) deletes its toast rules |
| 02 | `src/shared/page/list-picker.ts` (+ `.css`), `src/renderer/toasts.ts` (+ `.css`), `src/shared/page/dialog.css` (its list picker rules leave) | `dialog.css`: 10 (W5) deletes it |
| 03 | `src/plugins/sessions/page/*` | |
| 04 | `src/plugins/forms/page/**` (but `forms-commands.ts`), `src/plugins/forms/layouts/**` | |
| 05 | `src/plugins/forms/manifest.ts` (+ test), `src/plugins/forms/ids.ts`, `src/plugins/forms/page/forms-commands.ts` (+ test), forms' `main/selftest-script.ts` | chat's `main/selftest-script.ts`: 05 (W3) changes its forms submit step only, 07 (W4) the rest |
| 06 | `src/plugins/chat/page/**` (but `chat-commands.ts`), `src/plugins/chat/layouts/**` | |
| 07 | `src/plugins/chat/manifest.ts`, `src/plugins/chat/page/chat-commands.ts` (+ test), chat's `main/selftest-script.ts` | |
| 08 | `src/plugins/docs/**` | |
| 09 | `src/renderer/codemirror-vim/*`, `src/shared/page/markdown.css`, `src/config/theme-tokens.ts`, `src/config/themes/catppuccin-mocha.json`, the hand-written core token lists in tests | |
| 10 | `scripts/check-styles.mts` (the only task editing `LEGACY_FILES`); deletes `src/shared/page/dialog.css`, `appendKeys` in `src/shared/page/dom.ts` and the global `kbd` rule in `src/renderer/index.css` | |
| 11 | `DESIGN.md`, `AGENTS.md`, `docs/features/ui-design/design.md`, `docs/features/followups.md`, earlier feature designs' stale key lines | |

No plan C task edits `scripts/check-layers.mts` (plan B 06) or adds a `.ui-*` ellipsis selector to a
`SCROLLS_ITSELF` (plan B 02). A stale `SCROLLS_ITSELF` entry is dropped by the task owning that
script: forms' by 05, chat's by 07, docs' by 08. A plugin's dialogs move onto `createDialog` in that
plugin's task, which also drops its `dialog.css` import; 02 converts only the shared builders and the
core's toasts.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Floating: pickers, dialogs, toasts](02-floating.md)
- [x] [Sessions: session rows and session tabs](03-sessions.md)
- [x] [Editors, markdown prose, active-line band, log view](09-editors-and-prose.md)

### Wave 2
- [x] [Chrome: title bar, activity bar, side bar, status bar, key bar, which-key, help](01-chrome.md) — after 02
- [x] [Form tab: rail split, cards, layout kit](04-forms-surface.md) — after 03
- [x] [Chat tab: transcript, tool and permission cards, floating composer, layout kit](06-chat-surface.md) — after 02, 03
- [x] [Docs: tree and doc parts, side bar, split, keys](08-docs.md) — after 02, 03

### Wave 3
- [x] [Forms keys](05-forms-keys.md) — after 04

### Wave 4
- [x] [Chat keys](07-chat-keys.md) — after 05, 06

### Wave 5
- [x] [Remove the style check's legacy list](10-legacy-list.md) — after 01–09

### Wave 6
- [x] [Doc re-read](11-doc-re-read.md) — after 01–10

### Wave 7
- [x] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: ea1eb3afb84a0b22ac33df3436d17dc5e786d305

### Groups
- 09 · e43a111 · proved (diff read, typecheck, lint, tests, self-test) · concerns: no hand-written token fixture exists
- 02 · cd87ae7 · proved (same) · concerns: chat/docs layers keep `.overlay`/`.docs-overlay` until 06/08; `statusbar-height` theme token may be unread now
- 03 · 7e42310 · proved (same) · concerns: session rows are divs not buttons; sheet's `overflow: auto` wraps tab bodies
- 01 · 85cfdd8 · proved (diff read, typecheck, lint, tests, self-test) · concerns: record-keys icon unchecked; dialog.css `.dialog-help` leftover
- 08 · 03ebb98 + runner fix f37d5e1 · proved (diff read, typecheck, lint, tests; self-test 3 consecutive passes after the fix) — first self-test failed from its `G` step: the fit check's width restore raced the narrow media query; second dispatch BLOCKED on that root cause outside docs; fixed by opus-high in `src/main/selftest.ts` · concerns: `.docs-chips` hits the Done-when grep (expected: the table keeps it); out-of-sight guard lives in start.ts's onActiveView
- 06 · fc54416 · proved (same) · concerns: chat-commands.ts keeps a private CONTROL_IDS until 07
- 04 · 9045497 · proved (same) · concerns: is-disabled greys rail rows under confirm; DESIGN.md rail line and AGENTS.md kit list stale (11); `.rail-title` in forms self-test (05)
- 05 · 82e8635 · proved (diff read, typecheck, lint, tests, self-test) · concerns: which-key.test.ts builds made-up jumpTo commands; Option+n dead key live check
- 07 · 8ace8a1 · proved (diff read, typecheck, lint, tests, self-test) · concerns: AGENTS.md:246 and agent-chat/design.md:120 still name Space c … (11)
- 10 · 089f3d4 · proved (diff read, style check, typecheck, lint, tests, self-test) · concerns: dialog.css grep false positive on ui/dialog.ts; kbd.css resets redundant
- 11 · 4517890 · proved (diff read, Done-when grep empty, lint) · concerns: none
- 12 · no code · proved (four commands, 22 screenshots read, live checks carried to live-checks.md) · concerns: none
- review fixes · 1f87a66 chat, 15d99fc forms, 6431e2e sessions, 4bc8528 docs, c47cdb3 shared · proved (diff read, typecheck, lint, 1900 tests, self-test, screenshots) · concerns: no DOM unit tests (vitest has no DOM); two workers ran `npx --version` by mistake, nothing installed
### Contract changes
- `parseStyleArguments(args, filesInSrc)` (plan B) → `argumentFailures(args): string[]`; `legacyListProblems` removed · why: the script takes no argument · consumers: check-styles.mts only · group 10
- `readVimKeys` (01): planned → not added; `formatVimKeys` already holds its body · why: landed earlier · consumers: none · group 01
- `DialogDeps.keys` (06): `Pick<KeysPageExports, 'keysFor' | 'onChanged'>` → `Pick<KeysPageExports, 'keysFor'>` · why: dialogs rebuild buttons on every open · consumers: none · group 06
- `keyHint` (04): gains a non-null overload; card-parts.ts also exports `appendKeyHint(control, readKeys, platform): () => void` replacing `showKeys` · why: hints that redraw on keymap change · consumers: none outside forms · group 04
- `DialogDeps.keys` (06, review fix): back to `Pick<KeysPageExports, 'keysFor' | 'onChanged'>` · why: dialog hints follow a rebind · consumers: chat start.ts · review
- `keyHint` (04, review fix): the non-null overload removed; the kit's `kbd` calls the Kbd primitive · consumers: card-kit · review
- `ListPickerDeps` (02, review fix): `overlayClass` and `dialogClass` removed · consumers: chat picker, docs dialogs · review
- `DocViewDeps.emptyHint()` and `DocsViewDeps.kbd(keys)` added (08, review fix) · consumers: docs-view, start.ts · review
### Rulings
- Every review triage round this run takes the agent's recommendation without a form — the user's instruction at the run's start ("go with your suggestions on all review for this session") — costs a choice the user would have made differently · lead
- `npm run selftest` (one Electron instance) is run by the lead per group, never by parallel workers — two instances at once collide — costs nothing · lead
- Task 01's `readVimKeys` and `editorHints(…, platform)` already stand in the tree as `formatVimKeys` and `editorHints(editor, label, platform)`, with their tests; 01 keeps `formatVimKeys` and adds no duplicate — costs a renamed helper if a later task names `readVimKeys` · lead
- 08's Done-when grep hits `.docs-chips` (doc-view.ts, docs.css): expected, the docs.css table keeps that container — costs nothing · lead
- The self-test runner race (fit check restoring width without a redraw wait) is fixed in `src/main/selftest.ts`, a file no task owns — a test-harness fix that changes no app behaviour — costs a slower fit check (three frames) · lead
- The forms self-test's user-keymap block moves `toggleNotApplicable` instead of the removed `jumpTo2` — the spec's "every other step stays" could not hold once jumpTo went — costs nothing · group 05
- check-styles drops its paths mode with `--no-legacy`: paths only ever worked behind that flag and only plan C proofs used them — costs a single-file check, which would return as a new flag · group 10
### Review rounds
- Round 1 · implementation review of ea1eb3a..586ca5a · 6 lanes (correctness ×4, plan-and-design ×2) · NEEDS FIXES · report `review-586ca5a….md` in the session scratchpad · applied (prose-only) c0b2f39 · 15 findings: fix now 1–6, 9–15 (five fix workers: chat, sessions, forms, docs, shared); follow-up 7 (empty docs tree), 8 (on-demand accent tag) and O1 (docs keys in sentences); O2, O3 left · the chat/pd-B contradiction on `DialogDeps.keys` resolved toward AGENTS.md § Key hints (redraw on `onChanged`) · triage took the agent's recommendations (lead ruling)
- Round 2 · correctness re-review of 4a5c132..c47cdb3 · PASS · all 13 sent findings closed, no new findings
### Test gate
- `npm test` full suite (covers both passes over `ea1eb3a..HEAD`): 134 files, 1901 tests passed; `npm run typecheck` 0; `npm run lint` clean (`styles: 287 files clean`); `npm run selftest` `[selftest] all passed` · after 4517890
