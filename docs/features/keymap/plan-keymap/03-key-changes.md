# 03 — Key changes: Alt focus, Ctrl half-page scroll, gallery paging

Status: in progress
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Three changes approved in round 1, each bringing a key in line with `docs/keymap.md` § Layers.

Files:     modify `src/plugins/keymap.ts` · `src/plugins/docs/manifest.ts` · `src/plugins/docs/page/doc-view.ts` ·
           `src/plugins/docs/page/docs-view.ts` · `src/plugins/docs/page/start.ts` · `src/plugins/chat/manifest.ts` ·
           `src/plugins/chat/page/entry-list.ts` · the chat page file that registers chat's command handlers
           (`src/plugins/chat/page/start.ts` or `chat-commands.ts`; follow `nextEntry`) ·
           `src/plugins/gallery/manifest.ts` · `src/plugins/gallery/page/start.ts` ·
           `src/plugins/docs/main/selftest-script.ts` · `src/plugins/chat/main/selftest-script.ts` ·
           `src/plugins/forms/main/selftest-script.ts` (its gallery `d` steps)
Consumes:  `defaultKeymap: DefaultKeymap` in `src/plugins/keymap.ts` ← 01 (its Docs, Chat and Gallery sections)
Produces:  docs commands `halfPageDown`, `halfPageUp` in `src/plugins/docs/manifest.ts`
           chat commands `halfPageDown`, `halfPageUp` in `src/plugins/chat/manifest.ts`
           gallery command `pageUp` in `src/plugins/gallery/manifest.ts`
           `scrollHalfPage(direction: 1 | -1): void` on `EntryList` in `src/plugins/chat/page/entry-list.ts`
Decisions: Alt+hjkl is pane focus, Ctrl+j/k scroll (round 1) · chat half-page scroll leaves the focused entry and
           following as they are, as a mouse-wheel scroll does today (agent, from `entry-list.ts`: no scroll listener
           changes following) · gallery keeps full-page steps, as its `pageDown` does today

## Pinned values

| Scope | Was | Now | Command |
|---|---|---|---|
| `docs.tree` | `<C-l>` | `<A-l>` | `docs.focusDoc` |
| `docs.doc` | `<C-h>` | `<A-h>` | `docs.focusTree` |
| `docs.doc` | — | `<C-j>` | `docs.halfPageDown` |
| `docs.doc` | — | `<C-k>` | `docs.halfPageUp` |
| `chat.chat` | — | `<C-j>` | `chat.halfPageDown` |
| `chat.chat` | — | `<C-k>` | `chat.halfPageUp` |
| `gallery.gallery` | `d` | `<C-j>` | `gallery.pageDown` |
| `gallery.gallery` | — | `<C-k>` | `gallery.pageUp` |

Command declarations (labels, groups):

- docs `halfPageDown`: `{ label: 'scroll half a page down', group: 'doc', runsIn: 'page' }`; `halfPageUp`:
  `'scroll half a page up'`, group `doc`.
- chat `halfPageDown` / `halfPageUp`: same labels, group `entries`.
- gallery `pageUp`: `{ label: 'scroll up a page', group: 'gallery', runsIn: 'page' }`; it logs `paged up`, or
  `reached the top` when the sheet's `scrollTop` is below 1 after the scroll (mirroring `pageDown`).

Behaviour:

- Docs: the doc view scrolls its pane by half the pane's `clientHeight` per press; the docs page routes the commands to
  the active view as `scrollDown` / `scrollUp` are routed today (`onActiveView`).
- Chat: `scrollHalfPage` moves the list's `scrollTop` by half its `clientHeight`; focus, `is-cursor` and following are
  left alone.
- Chord binds fire inside a text box too, so `<C-j>`/`<C-k>` scroll the transcript while the user types in the chat
  composer, and the doc while the user edits a doc, in place of vim's insert-mode Ctrl+j/Ctrl+k. Intended, as forms'
  `<C-j>` next box already does in a box (agent's call; `docs/keymap.md` § Layers: Ctrl+j/k scroll).

## Self-test steps

- Docs (`src/plugins/docs/main/selftest-script.ts`): every `<C-l>` step becomes `<A-l>` and every `<C-h>` step
  `<A-h>`, same expects (lines 74, 122, 133, 150, 173, 179, 186, 192, 195, 202, 213, 219 at plan time; re-verify). After
  the `j` / `k` scroll steps (line 196–197) add `<C-j>` and `<C-k>` steps expecting the page log line for each command,
  in the format the neighbouring steps use for chords (read how a chord's `ran` line prints before writing).
- Chat (`src/plugins/chat/main/selftest-script.ts`): with a transcript showing, a `<C-j>` and a `<C-k>` step
  expecting their `ran` lines.
- Forms (`src/plugins/forms/main/selftest-script.ts`): every gallery `d` step becomes `<C-j>`, same expects.

## Tests

None: each change is a bind and a scroll by a measured height, which the self-test steps and the final verification
check live (`wigley:writing-tests` § What earns a live run instead). The keymap checks test from task 01 covers clashes.

Done when: compiles; `npm run lint`; the test gate passes; the snapshot recipe in task 01 § Proof diffed against
`keymap-before.txt` shows exactly the rows of the pinned table — removed `page docs.tree ["<C-l>"]`,
`page docs.doc ["<C-h>"]`, `page gallery.gallery ["d"]`; added the eight `Now` rows as page binds — and nothing else.
Commit:    one commit for the group

## Proof
