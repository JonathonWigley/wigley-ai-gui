# 25 — Every view's dispose against what it drew

Status: done
Type: Parallel
Rung: deep · a teardown audit across every plugin's view lifecycle (observers, timers, listeners, subscriptions): each of 26 views is checked for the undo of each, and a missed undo leaks DOM or listeners past a stop
Wave: 7 · Depends on: 24 (both list `session-tabs-view.ts`, `backlog-view.ts` and `settings-view.ts`; this audit reads 24's teardown rules as landed)
Plan: [plan.md](plan.md)

Follow-up (`followups.md`): **Every view's dispose against what it drew** (L700).

## The views

Enumerated at plan time with
`find src -name '*-view.ts' -not -name '*.test.ts' | sort` (28 files). Re-run it on merged
`main` first: a view the scheduled-tasks run added (its Schedules mode) joins the lot of its nearest plugin below,
under the same rule, and is named in the commit message. Left out, with the reason:

- `src/plugins/forms/page/round-view.ts` — Lane L tasks 12–13 rewrite it (plan.md Decisions: forms' Split caller waits
  for Lane L).
- `src/plugins/sessions/main/consumer-view.ts` — a main-process view: it draws nothing.

Added, though the name pattern misses it: `src/plugins/chat/page/image-viewer.ts`, a drawn viewer (lot B).

The 27 views, in four lots of about 40k tokens of reading each. Each lot is one worker's; no file sits in two lots.

| Lot | Views (`src/plugins/…` unless shown) |
|---|---|
| A — docs | `docs/page/doc-view.ts` · `docs/page/docs-view.ts` · `docs/page/tree-view.ts` |
| B — chat, sessions, panes | `chat/page/chat-view.ts` · `sessions/page/session-tabs-view.ts` · `sessions/page/sessions-view.ts` · `sessions/page/sidebar-view.ts` · `sessions/page/consumer-view.ts` · `src/shared/page/pane-tree/pane-tree-view.ts` · `src/renderer/log-view.ts` · `chat/page/image-viewer.ts` |
| C — settings, keys, gallery, notes | `settings/page/settings-view.ts` · `settings/page/leader-menu-view.ts` · `settings/page/keymap-view.ts` · `settings/page/plugin-rows-view.ts` · `settings/page/sections-view.ts` · `settings/page/setting-rows-view.ts` · `gallery/page/gallery-view.ts` · `keys/page/help-view.ts` · `keys/page/which-key-view.ts` · `notes/page/markup-view.ts` |
| D — forms, primer, backlog, pickers, practice, workflow | `audio-picker/page/picker-view.ts` · `backlog/page/backlog-view.ts` · `forms/page/forms-view.ts` · `practice/page/practice-view.ts` · `primer/page/primer-view.ts` · `workflow/page/workflow-view.ts` |

Each view below may be modified; its test file is modified, or created beside it when a gap is found in a view that
has none.

Files:
- modify `src/plugins/docs/page/doc-view.ts` · `src/plugins/docs/page/docs-view.ts` · `src/plugins/docs/page/tree-view.ts`
- modify `src/plugins/chat/page/chat-view.ts` · `src/plugins/sessions/page/session-tabs-view.ts` ·
  `src/plugins/sessions/page/sessions-view.ts` · `src/plugins/sessions/page/sidebar-view.ts` ·
  `src/plugins/sessions/page/consumer-view.ts` · `src/shared/page/pane-tree/pane-tree-view.ts` ·
  `src/renderer/log-view.ts` (no test file today) · `src/plugins/chat/page/image-viewer.ts`
- modify `src/plugins/settings/page/settings-view.ts` · `src/plugins/settings/page/leader-menu-view.ts` ·
  `src/plugins/settings/page/keymap-view.ts` · `src/plugins/settings/page/plugin-rows-view.ts` ·
  `src/plugins/settings/page/sections-view.ts` · `src/plugins/settings/page/setting-rows-view.ts` ·
  `src/plugins/gallery/page/gallery-view.ts` · `src/plugins/keys/page/help-view.ts` ·
  `src/plugins/keys/page/which-key-view.ts` · `src/plugins/notes/page/markup-view.ts`
- modify `src/plugins/audio-picker/page/picker-view.ts` · `src/plugins/backlog/page/backlog-view.ts` ·
  `src/plugins/forms/page/forms-view.ts` · `src/plugins/practice/page/practice-view.ts` ·
  `src/plugins/primer/page/primer-view.ts` · `src/plugins/workflow/page/workflow-view.ts`
- test: each view's `<name>.test.ts` beside it
- modify `AGENTS.md` (the "A registration" bullet; lot A's worker makes this edit)

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main`):
- The `find` above lists the 28 files named here: the 26 in the lots and the two left out.
- `grep -n "A plugin's own \`dispose\` undoes only what \`api\` cannot see" AGENTS.md` → one line in the "A
  registration" bullet of § Architecture.
- Task 24 has landed: `grep -n "isStopped\|isDisposed" src/plugins/backlog/page/backlog-view.ts` → the flag it added.

Consumes:  task 24's teardown rules as landed (the stopped flag, `callEach` for teardown steps). Nothing else.

Produces:  nothing another task consumes.

Decisions:
- **The rule each view is checked against.** List everything the view creates that outlives removing its own root
  element:
  1. an element it appends into a parent it did not create (a host area, `document.body`, an overlay or popup layer,
     another view's element);
  2. a listener it adds with `addEventListener` on `window`, `document`, or an element it did not create;
  3. a `ResizeObserver`, `MutationObserver` or `IntersectionObserver`;
  4. a `setTimeout`, `setInterval` or `requestAnimationFrame` handle, and a `services.timers` handle the view holds
     itself;
  5. a Disposable handed back to it: a drawn part (`DrawnPart`, `draws.draw`), key anchors, a scope, an overlay or
     contribution handle, a store or slot subscription, a child view it constructed;
  6. an entry it puts in state another module holds (a shared map, a focus target, a registry).
  Its `dispose` must undo each, in the `callEach` form task 24 set for several steps that can throw. A view with no
  `dispose` (`keymap-view.ts`, `plugin-rows-view.ts`, `setting-rows-view.ts` today) passes only when it creates
  nothing in the list; else it gains a `dispose` and its owner calls it where it drops the view. Not gaps: listeners on
  elements inside the view's own root, and anything it registers through `api`, which the host files and disposes.
- **A gap's fix** is the missing undo in `dispose` (or the owner's call), nothing else: no redesign of the view.
- **A gap's test** is one row per gap in the view's test file, named `<factory>_Dispose_<Undoes what>` (for example
  `createGalleryView_Dispose_RemovesTheDragGhost`), built on the file's existing setup; a view with no test file gets
  `<name>.test.ts` beside it on the nearest sibling view test's setup (`sessions-view.test.ts` for `sidebar-view.ts`).
  It asserts the undo directly: the appended element is no longer in its parent; a `window`/`document` event
  dispatched after `dispose` reaches no handler (a spy stays uncalled); the fake observer's `disconnect` ran; with
  fake timers, advancing past the delay runs no callback; the handed Disposable's `dispose` ran once.
- **Already fixed, checked again for the same reason:** the sessions side bar and the gallery's drag reorder (the
  follow-up's own examples).
- **The doc line.** The AGENTS.md "A registration" bullet's last sentence ("A plugin's own `dispose` undoes only what
  `api` cannot see: …") gains two sentences: a view's `dispose` undoes everything it drew or added outside its own
  root (the six kinds above, in short); and a continuation a stop cannot cancel checks its part's `isStopped` (a
  view's `isDisposed`), set as `dispose`'s first line, while a teardown of several steps that can throw runs them
  through `callEach` (task 24's Rules 1 and 3).

GIVEN any listed view WHEN its `dispose` runs THEN nothing it appended, listened to, observed, timed, was handed or
registered outside its root remains.

Tests: one row per gap found, as above; a view with no gap gets none. The group report lists every view with `clean`
or its gaps and the test row of each.

Done when: compiles (`npm run typecheck`); `npm test` runs every changed or created view test file green; `npm run
lint` clean. A view whose dispose changed in a plugin with a self-test script runs that script filtered
(`npm run selftest -- --plugin <id>`).

Commit:    one commit for the group (the lots' changes together), e.g. "Every view's dispose undoes what it drew:
           <views fixed> (follow-up: Every view's dispose against what it drew)"

## Proof

Commit 212d80115 · proof: diff read of all four lots: 10 gaps fixed with a test row each, 19 views reported clean with reasons; typecheck and lint (lead oxfmt over two test files) clean · concerns: chat's reason box, close-confirm and sign-in dialogs share image-viewer's undisposed layout subscription but sit outside the view list; notes popup never disposes its NotesParts draws and keys start never disposes its title-bar button Drawn; picker, forms and primer views drop their overlay contribute Disposable (harmless while view and part share a lifetime); doc-view's drawnPrompt is disposed only through endConflict; gallery-parts.ts edited outside the lot list
