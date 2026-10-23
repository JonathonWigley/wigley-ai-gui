# 09 — A Split drag ends on the window's pointer up, so a handle removed mid-drag still saves

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/ui/split.ts` · test `src/shared/page/ui/split.test.ts`
Consumes:  nothing new (`createSplit`, `UiState` in the tree)
Produces:  no new export; `createSplit(options: SplitOptions): Split` in `src/shared/page/ui/split.ts` keeps its
           signature and the `Split` interface is unchanged
Decisions: `Split` ends a drag on a window `pointerup` or `pointercancel` for its pointer (plan.md, Decided notices);
           no `dispose` on `Split` and no owner changes (the self-contained fix, so no owner can forget it)

## Behaviour

- While a drag runs, the split listens on `window` for `pointerup` and `pointercancel`. The `pointerdown` handler adds
  both listeners after it sets `dragPointer`; `endDrag` removes both. The listeners are two handler functions created
  once per `createSplit` and held in its closure, so `removeEventListener` gets the same references `addEventListener`
  did.
- Each window handler calls `endDrag()` only when `event.pointerId === dragPointer`; another pointer's release leaves
  the drag running.
- Order on a normal drag in the document: the handle's `pointerup` reaches the window handler first and ends the drag
  (one `uiState.set` when the width changed), then the handle's `lostpointercapture` finds `dragPointer` null and does
  nothing. No double save.
- A handle removed from the document mid-drag: its `pointerup` still reaches `window` (the event targets whatever is
  under the pointer and bubbles), so the drag ends and the width last shown by `pointermove` is saved.
- The existing paths stay: `lostpointercapture` for the drag's pointer ends the drag, and a `pointerdown` that finds
  `dragPointer` set with its capture gone ends the old drag first (that `endDrag` removes the old listeners before the
  new drag adds its own). The window listeners are never added twice: `pointerdown` returns early while
  `isDragging()`, and otherwise any old drag is ended before the new one starts.
- No new guard: `endDrag` is safe to run with listeners already removed (`removeEventListener` on an absent listener
  does nothing).

## Comments

- The comment above `let dragPointer` (now: kept until its capture loss reaches the handle; a handle moved out of the
  document mid-drag gets no lostpointercapture, so the drag stays set with its capture gone) becomes: the pointer whose
  drag the handle holds, until that pointer's `pointerup` or `pointercancel` reaches the window or its capture loss
  reaches the handle; the window hears the release even after the handle has left the document.
- The comment above the `lostpointercapture` listener stays true (the browser fires it after `pointerup` and
  `pointercancel` release capture); it gains nothing.
- The `createSplit` comment ("written back once per drag, when the drag changed it") stays true.

GIVEN a drag that moved the handle to 300 WHEN `pointerup` for the drag's pointer reaches the window and the handle
gets no `lostpointercapture` THEN `uiState` holds 300 under the split's key and the handle loses `is-active`
GIVEN a drag WHEN `pointercancel` for the drag's pointer reaches the window THEN the drag ends and saves as above
GIVEN a drag by pointer 1 WHEN pointer 2's `pointerup` reaches the window THEN the drag runs on and nothing is saved
GIVEN a drag WHEN it ends by any path THEN the window holds no `pointerup` or `pointercancel` listener from the split

## Tests

`split.test.ts`, sentence names under `describe('createSplit drag')` as the file uses:

- Test setup: `beforeEach` also stubs `window` with `vi.stubGlobal('window', …)`: a fake holding a listener map by
  event type, with `addEventListener`, `removeEventListener` (removes by reference) and a `fire(type, fields)` that
  calls each listener of that type with `{ type, ...fields }`, the same shape as `fakeElement`'s `fire`. Every test
  needs it now, since `pointerdown` reads `window` (the vitest environment is `node`). The existing `afterEach`
  `vi.unstubAllGlobals()` clears it.
- `saves the dragged width when the pointer is released off the handle` — `press(handle, 1)`, `move(handle, 1, 300)`,
  window fires `pointerup` with `pointerId: 1`, no `lostpointercapture`; `saved.get('side')` is 300 and
  `handle.classes.has('is-active')` is false.
- `saves the dragged width when the pointer is cancelled` — the same with `pointercancel`; saved 300.
- `keeps the drag when another pointer is released` — `press(handle, 1)`, `move(handle, 1, 300)`, window fires
  `pointerup` with `pointerId: 2`; `is-active` still set, `saved.has('side')` false; then `move(handle, 1, 320)`
  gives `split.width()` 320.
- `stops listening on the window once the drag ends` — `press(handle, 1)`, `loseCapture(handle, 1)`; the fake window
  holds no `pointerup` and no `pointercancel` listener.

The three existing drag tests and the two `reloadWidth` tests stay as they are and must pass with the window stub.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Live checks for task 15

- Low-confidence — a normal drag now ends through the window's `pointerup` before `lostpointercapture`, an event order
  the fakes assume and only the real browser shows. In a drive run with a docs session (`docs.connectSession`),
  `key Space k s` to its Docs tab, `drag` `.docs-split .ui-split-handle` 60 px right, then `restart`, show the tab
  again and `query` `.docs-split` for its `--ui-split-start`: the dragged width came back, and the handle has no
  `is-active` class after the drag. A removal mid-drag is not drivable (one `drag` call cannot remove a session
  between press and release); the unit tests carry it.

## Proof

0d2ae5d · diff read, createSplit and Split unchanged; window listeners added at pointerdown and removed in endDrag; lostpointercapture guard keeps a single save · concerns: endDragOnRelease and endDrag refer to each other (safe: neither runs before both exist)

