# 17 — Final verification

Status: in progress
Type: Task
Wave: 6 · Depends on: 01–16
Plan: [plan.md](plan.md)

Every check here needs the running app. Every other task defers its screen and reload checks to this task. Run the
checks through `npm run selftest` and a drive run (`.agents/skills/drive/SKILL.md`). Read each capture before a check
counts as passed. A check only the user's hands or eyes can settle goes in the wrap-up with its steps.

Each check is tagged **expected** (the change doing what it was made to do, on screen) or **low-confidence** (wiring
or layout no test can see), with its reason.

## Setup

- A drive run on its own temp home. Its user config folder holds `layouts/<owner>/test/layout.js` and
  `layout.css` for each owner the check names, and `settings.json` sets `<owner>.layout` (or `shell.layout`) to
  `test`. Each test layout overrides one part and adds one CSS rule under its `data-layout` root.

## Checks

### The core and the host

1. **Expected** — `npm run selftest` passes. The forms layout groups read their fixtures from
   `<temp home>/.config/wigley-ai-gui/layouts/forms/`. Reason: the folder moved.
2. **Expected** — a user forms layout with CSS draws, and saving its `layout.js` or `layout.css` redraws the open
   round and keeps every answer. Reason: the reload path moved to the core service.
3. **Low-confidence** — a `url()` image and a font in a layout's CSS load from `wigley-layout:`. Reason: the CSP
   entries have no test.
4. **Low-confidence** — at the startup reload, each owner's set arrives after the first read returns null, and every
   view draws its user layout. Reason: timing across two page loads.
5. **Low-confidence** — self-test steps that expect a part's failure line still pass, with `drawPart` logging once
   per layout object and part. Reason: the log change meets old step expectations.
6. **Low-confidence** — in the user's folder, `kit.d.ts` and an owner's `layout.d.ts` type-check together on a
   `// @ts-check` layout (the registry rewrote the kit import to `'../kit'`). Reason: no repo test runs tsc there.
7. **Low-confidence** — two owners' layouts both named `test`: each one's CSS restyles only its own owner's parts.
   Reason: `data-layout-owner` scoping is judged on screen.

### Every surface under `default`

8. **Expected** — with no layout setting, each surface looks as before the run: forms, chat (entries, composer,
   chips, attachment strip, start prompt steps, resume and archive lists, sign-in, deny-reason and end-session
   dialogs, image viewer), primer, docs (tree header hints, cursor prompt, chips, conflict prompt, name box with
   completions, Trash confirm), backlog (`backlog-home`, `backlog-editor`), settings (`settings-keymap`, plus the new
   Settings section with its Layout row), notes (fields, markup, confirmation), sessions (side bar rows, edge
   prompts, close prompt, tab strip), gallery (`Space z g`), keys (help, which-key, Keys button), and the shell
   chrome (traffic-light inset, centred title context). Compare each self-test screenshot with its copy from a
   self-test run on the review base. Reason: every view now draws through a layout; no test judges the look.
9. **Low-confidence** — the self-test's placement check logs no `[keys] unplaced` line. Backlog and docs rows now
   create anchors on every render: press `j` / `k` many times and check that no hint repeats. Then redraw the other
   owners many times: sessions (status changes, and the empty text with no session selected), gallery (press `t` a
   few times), notes (save the notes test layout twice with the popup open), and chat (a test `composerBar` that calls
   `kit.keyHint`, over a few state changes). Each hint shows once, and no `[keys] unplaced` line appears. Reason:
   anchors are recorded per part draw and disposed through `drawPart`'s `dispose`; the placement check cannot see a
   leaked anchor.

### Reloads keep the user's work

For each, save the owner's test layout while the state is in place, then check that it is still there.

10. **Low-confidence** — chat: the box has focus and holds a draft with attached images. Text, vim mode, focus and
    images stay. Pasting an image into the redrawn composer attaches it. Reason: a moved CodeMirror node can drop
    focus; the paste listener moved.
11. **Low-confidence** — chat: an open sign-in dialog keeps its typed code and link. Reason: the box moved.
12. **Low-confidence** — primer: a box has focus. It redraws in place and keeps focus and vim mode. Reason: reload
    wiring between the host and the primer.
13. **Low-confidence** — docs: a doc open and scrolled, the tree filtered and a row selected. Both scrolls, the
    selection, the filter and focus stay. With the editor open and unsaved, the editor stays whole and the frames
    redraw on `:q` or `:wq`. With the name box open, its text, cursor and focus stay. Reason: moved scrollers lose
    `scrollTop`; the editor deferral is new.
14. **Low-confidence** — docs: scroll-to-line, `i` at the top visible line, and heading links land right. Reason:
    block tops are now measured from the scroller.
15. **Expected** — backlog: the editor open with a draft. The draft and the focused box stay. **Low-confidence** —
    the same with the filter open or the detail focused. Reason: the tests fake this focus wiring.
16. **Low-confidence** — notes: the body in insert mode with text. Focus, text and insert mode stay. Reason:
    CodeMirror moved between slots. **Low-confidence** — notes: the Target picker open with typed filter text, and a
    test layout that defines `pickerRow`. The picker stays open with its filter text and cursor, and each visible row
    carries `data-layout="test"`. Reason: `picker.redraw()` redraws the rows of an open picker, and no test opens a
    real picker over a reload. **Low-confidence** — notes: the markup view open on an image with a stroke drawn. The
    markup session and its stroke stay, and the toolbar redraws with the tool in use still marked. Save again with
    the discard confirmation open: it stays open in scope `notes.confirm`. Reason: the markup editor is a Fabric
    canvas the fake DOM does not run, and the toolbar's registered buttons are replaced on each draw.
17. **Low-confidence** — sessions: a Chat tab holds a draft. The draft stays when the tab strip redraws. Reason:
    the tab strip sits beside other plugins' tab elements.
18. **Low-confidence** — shell: typing in a box with the Sessions side bar scrolled. Focus, scroll and the
    activity mark stay. Press `Space z s` twice: the user's frame CSS still applies. Reason: the live DOM may differ
    from the fake DOM.
19. **Low-confidence** — keys: help is open. It redraws in place, and the Keys button keeps its place in the title
    bar's end track. Below 640px the Keys button still hides its hint. Reason: the slot sits beside the config
    badge, and the narrow rule targets new classes.

### User layouts and fallbacks

20. **Expected** — for each owner, setting `<owner>.layout` to `test` redraws at once, and only the test layout's
    part and CSS change. Settings mode redraws when `settings.layout` is set from its own form. Docs: a layout that
    defines only `treeRow` redraws rows in every open view, and the other parts stay `default`.
21. **Expected** — a chat entry builder that throws falls back to `default` with one toast.
22. **Low-confidence** — settings: a layout whose every part throws still draws in `default`, and `r` resets
    `settings.layout`. Docs: a `treeRow` that throws falls back per row. Reason: fallback wiring per owner.
23. **Low-confidence** — a user layout that restyles chat's `pickerRow` changes only chat's pickers; docs, backlog,
    settings and notes pickers stay as they were. Reason: the hook sits in a shared module with no DOM test.

### The primer

24. **Expected** — the expanded rail shows each item's mark, number and text, and the row prompt with `x include`
    wraps cleanly at narrow rail widths.
25. **Expected** — the item card header `⌃H ‹ n of m › ⌃L`, its include line and the Added tag look right, and
    `⌃L` / `⌃H` replace the card with no flicker and no lost scroll.
26. **Low-confidence** — clicking a rail item's mark toggles that item, not the one selected before. Reason: the
    order of the mark click and the row click in a real browser.

### Previews

27. **Expected** — `Space z l o` draws the forms preview as before.
28. **Expected** — `Space z l p` opens the sample primer with every section drawn.
29. **Expected** — `Space z l s` with no agent shows five sample rows (one selected, two with the attention dot,
    Claude, Codex and no harness, two status lines, one label ending in an ellipsis). A second press restores the
    real rows.
30. **Expected** — `Space z l c` shows all 14 sample entries and the Mode, Effort (unset), Model and Verbosity chips.
    The self-test saves a `chat-preview` screenshot.

## For the user (wrap-up only)

- In a visible `npm start`, open each preview (`Space z l o`, `p`, `s`, `c`): no notification, Dock badge or toast
  appears. An offscreen run cannot show notifications.

## Tests

None added. This task runs the checks above.

## Proof criteria

The report lists each check with pass or fail and the capture it read. A failed check is fixed in the task that owns
the code, and the check runs again.

## Proof

<written by wigley:make>
