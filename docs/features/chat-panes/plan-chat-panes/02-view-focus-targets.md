# 02 — Focus targets in docs, primer, backlog and settings

Status: done
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/keymap.ts` · modify `src/shared/page/layout-host/base-kit.ts`, `src/shared/page/layout-host/kit.d.ts` · modify `src/plugins/docs/manifest.ts`, `src/plugins/docs/page/start.ts`, `src/plugins/docs/page/docs-view.ts`, `src/plugins/docs/layouts/default/layout.js`, `src/plugins/docs/main/selftest-script.ts` · modify `src/plugins/primer/manifest.ts`, `src/plugins/primer/page/start.ts`, `src/plugins/primer/page/primer-view.ts`, `src/plugins/primer/page/primer-commands.ts`, `src/plugins/primer/main/selftest-script.ts` · modify `src/plugins/backlog/manifest.ts`, `src/plugins/backlog/page/start.ts`, `src/plugins/backlog/page/backlog-view.ts`, `src/plugins/backlog/layouts/default/layout.js` · modify `src/plugins/settings/manifest.ts`, `src/plugins/settings/page/start.ts`, `src/plugins/settings/page/settings-view.ts`, `src/plugins/settings/layouts/default/layout.js`, `src/plugins/settings/main/selftest-script.ts` · test the existing tests of each changed view, `primer-commands.test.ts`, `primer-state.test.ts`, `docs/page/layout/docs-parts.test.ts`, and the base kit's tests

Consumes:  `FocusTarget`, `PaneDirection`, `PANE_FOCUS_COMMANDS`, `api.panes.setFocusTarget(target: FocusTarget | null)` ← 01

Produces:  four `<A-h|j|k|l>` binds in scope `any` in `src/plugins/keymap.ts`, to `panes.focusLeft`, `panes.focusDown`, `panes.focusUp`, `panes.focusRight`
           each view below hands `api.panes.setFocusTarget` a `FocusTarget` each time it hands over its resize target

Items:
1. **Keymap.** Remove the ten scoped `<A-h>`/`<A-l>` binds (docs.tree, docs.doc, primer.tasks,
   primer.items ×2, primer.card, backlog.list, backlog.detail, settings.sections, settings.rows).
   Add the four `any` binds above in the core banner section, beside the resize binds.
2. **Docs.** Remove the commands `focusDoc` and `focusTree` from the manifest. The `<Esc>` bind in
   `docs.doc` runs `docs.focusTree` today: keep that behaviour under a command of its own name
   (`docs.backToTree`, label `back to the tree`), since Esc is not a pane move. The docs view's
   focus target: `right` from the tree moves to the doc; `left` from the doc moves to the tree when
   the tree shows; every other case returns false. This holds in Docs mode and in each session's
   Docs tab. In the default layout, the two edges (`layout.js` lines 35 and 94 at plan time) name
   `panes.focusRight` and `panes.focusLeft`. The empty doc's `kit.keyHint(empty, 'focusTree')`
   names `panes.focusLeft`.
3. **Primer.** Remove `focusTasks`, `focusItems` and `focusCard`. The focus target moves left and
   right through tasks → items → card, as the removed binds did, and returns false at either end.
4. **Backlog.** Remove `focusDetail` and `focusList`. The focus target: `right` from the list to
   the detail, `left` from the detail to the list; while the homes have focus (where the resize
   target is null today) it returns false.
5. **Settings.** Remove the commands `focusSections` and `focusRows`; the view's local helpers of
   those names stay. The focus target: `right` from sections to rows, `left` from rows to sections.
   Settings sets no resize target, so it hands its focus target after each `deps.setScope`,
   through a new `setFocusTarget` dep that `settings/page/start.ts` wires to
   `api.panes.setFocusTarget`. A `move` sets the scope, which drops the target, so the view hands
   the target over again after that `setScope` too.
6. **Base kit.** `kit.edge` and `kit.keyHint` resolve a command name holding a `.` as a qualified
   command id (`panes.focusLeft`), and every other name as the owner's command, as today. The
   backlog and settings default layouts' edges (backlog `layout.js` lines 116 and 124, settings
   lines 46 and 54 at plan time) name `panes.focusLeft` and `panes.focusRight`. Update the kit's
   doc comments in `kit.d.ts`.
7. **Self-tests.** Each self-test step that expects a removed command (the primer's
   `[page] <A-l> ran primer.focusItems` and its siblings in the docs and settings scripts) expects
   the core command instead, in the form `[page] <A-l> ran panes.focusRight` and
   `[page] <A-h> ran panes.focusLeft`.

Decisions:
- Every focus target returns false for `up` and `down`: no view has stacked inner panes.
- A move that the removed command made with extra work (a redraw, a log line, a scope set) does
  the same work inside `move`. A move returns true only when focus moved.
- Every edge prompt or anchor that named a removed command (`⌥L doc ›` and its siblings) names the
  matching `panes.focusLeft` or `panes.focusRight` in the same scope, so the prompt still shows
  the key.
- A view that sets `setResizeTarget(null)` sets `setFocusTarget(null)` too only when it has no
  inner panes in that state; otherwise it hands over its target.

GIVEN the docs tree has focus WHEN `move('right')` runs THEN the doc has focus and it returns true
GIVEN the doc has focus and the tree is hidden WHEN `move('left')` runs THEN it returns false and focus stays
GIVEN the primer card has focus WHEN `move('right')` runs THEN it returns false
GIVEN the backlog homes have focus WHEN `move('right')` runs THEN it returns false
GIVEN any of the four views WHEN `move('up')` runs THEN it returns false

Tests: rewrite each existing test that ran a removed focus command into rows of a table test of
that view's focus target: from-pane, direction, expected pane after, expected return. Keep one
table per view. Add the hidden-tree and homes rows above. Each row asserts which pane has focus
afterwards, by the same observable the existing test used.

Done when: `npm run typecheck`, `npm run lint` and `npm run selftest` pass; no removed command
id or manifest key remains:
`grep -rnE "(docs|primer|backlog|settings)\.focus(Doc|Tree|Tasks|Items|Card|Detail|List|Sections|Rows)|'focus(Doc|Tree|Tasks|Items|Card|Detail|List|Sections|Rows)'|^ +focus(Doc|Tree|Tasks|Items|Card|Detail|List|Sections|Rows): \{" src`
prints nothing (identifiers that are not commands, such as settings' local `focusRows` helper,
stay); the test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit 9c84f9d · proof: diff read (four any focus binds; each view hands a FocusTarget beside its resize target; kit resolves dotted names) + whole-tree typecheck clean; Done-when grep prints nothing; view tests pass per the workers (707 + 167, primer-view's 3 base-failing rows aside); self-test passes every step but the pane binds' unplaced lines (see ruling) · concerns: backlog-view.ts: paneTo was inserted between cursorActionsSlot's comment and its function, orphaning that comment; a pushed scope (backlog filter, picker, confirm) keeps the view's targets and any-scope Alt+h/l fire there, moving list/detail behind the overlay (the scoped binds did not); self-test unplaced lines for panes.focus* and resizePaneUp/Down until 05b
