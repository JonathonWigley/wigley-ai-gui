# 02 — Completion popup on the page body

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` (where a box's extensions are assembled;
           `prefix-completion.ts` instead if the completion extension is built there) ·
           modify `src/renderer/codemirror-vim/editor-theme.ts`
Consumes:  `tooltips` from `@codemirror/view` (a direct dependency)
Produces:  no new symbol: every editor the host creates mounts its CodeMirror tooltips on `document.body`
Decisions: fix in the editor adapter, for every box (round 1 Decided notice)
Done when: compiles; lint passes; the live check in task 08 shows the popup unclipped
Commit:    one commit for the group

## Change

The slash popup is clipped because it mounts inside the editor, inside `.chat-box { overflow-y: auto }` in the
floating composer (`src/plugins/chat/page/chat.css`). Add `tooltips({ parent: document.body })` to the extensions of
every editor the host creates (boxes and document editors), so CodeMirror mounts tooltips in a container on the body
that still carries the editor's theme classes (CodeMirror reference, `tooltips` config `parent`). The editor theme's
`.cm-tooltip.cm-tooltip-autocomplete` rule in `editor-theme.ts` must still apply; check that it is not scoped under a
selector the body container misses (such as `.chat-box`). Vim boxes sit in the floating composer and in dialogs (the reason box, the
sign-in box), so the tooltip rule in `editor-theme.ts` always sets `z-index: calc(var(--wg-z-dialog) + 1)`, the
pattern `src/plugins/keys/page/keys.css:13` uses: above every surface a box sits in, below `z-toast`.

The `document` read is the page adapter's own (the host already lives in the renderer); pass `document.body` where
the host is built if the file takes its DOM from parameters.

## Tests

None: where the popup draws is a live check (task 08), and no test can see clipping.

## Proof

Commit 63e9972 · diff read · typecheck and lint pass · concerns: EditorHost.contains / hostedViewOf no longer see the popup DOM — check mouse clicks on popup rows in task 08
