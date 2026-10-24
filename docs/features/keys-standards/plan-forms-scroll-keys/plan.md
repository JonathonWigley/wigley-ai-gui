# Forms scroll keys — plan

Feature: keys standards (Ctrl+j/k scroll, Ctrl+n/p boxes) · Implements: none · Ticket: none
Target: main · Written: 2026-10-24

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The form and its review scroll half a page on `Ctrl+j`/`Ctrl+k`, on the page and inside a box in
every vim mode, as the doc and the chat transcript do. Forms' next and previous box move from
`Ctrl+j`/`Ctrl+k` to `Ctrl+n`/`Ctrl+p`. `docs/keymap.md` names both as app-wide standards.

## Architecture

- Forms plugin page part: manifest commands, command handlers, the forms view and the round view.
- The default keymap (`src/plugins/keymap.ts`).
- The forms self-test script.
- Reuses `scrollHalfPage` and `halfPageText` from `src/shared/half-page.ts` and `HalfPageScroll`
  from `src/contracts/editor.ts`.

## Preconditions

- `main` is ahead of `origin/main` only by the docs commit `9e472e12` and the plan-folder commit,
  with a clean tree: `git fetch && git status -sb` and `git log --oneline origin/main..main`
  (verified 2026-10-24).
- No key in the default keymap binds `<C-n>` or `<C-p>`: `grep -n "<C-[np]>" src/plugins/keymap.ts`
  prints nothing (verified 2026-10-24).
- The forms view and the review are drawn in the round view's main column, `split.end`, the
  element `round-view.ts` already resets with `parts.main.scrollTop = 0`:
  `grep -n "const main = split.end" src/plugins/forms/page/round-view.ts` (verified 2026-10-24).

## Docs written ahead

Commit `9e472e12`:

- `docs/keymap.md` — Layers: the `Ctrl+hjkl` bullet (scroll standard) and the new
  `Ctrl+n / Ctrl+p` bullet (box standard).
- `docs/features/plugin-framework/design.md` — Keymap (plan A2): box keys and forms scroll.
- `docs/features/followups.md` — half-page `Ctrl+j`/`Ctrl+k` for the cursor list views.

## Mandatory Reads

- `AGENTS.md` (repo root): Architecture (a key, a plugin, the self-test), Running and testing
- `DESIGN.md` § Keys and focus
- `docs/keymap.md`

## Design Overview

```
Ctrl+j in forms.forms / forms.review (page, or a box in any vim mode)
  -> forms.halfPageDown handler (forms-commands.ts)
       -> deps.scrollForm(1)                       (start.ts wires view.scrollHalfPage)
            -> FormsView.scrollHalfPage(1)          (forms-view.ts)
                 -> the active round's RoundView.scrollHalfPage(1)   (round-view.ts)
                      -> scrollHalfPage(parts.main, 1)  (src/shared/half-page.ts)
       <- HalfPageScroll | null
       -> log('forms', halfPageText('the form', 1, scroll))  or  'no round to scroll'

Ctrl+n / Ctrl+p in forms.forms / forms.review -> forms.nextBox / forms.prevBox (handlers unchanged)
```

Decisions:

- Plain `j`/`k` keep moving between items (round 1).
- `Ctrl+j`/`Ctrl+k` scroll in every vim mode inside a box, as in the chat box and the doc editor; no
  key-engine change (round 1).
- Only forms changes now; the cursor list views are a follow-up (round 1).
- Scroll is half a page, matching the doc and chat; the gallery keeps its whole page (Decided).
- Inside a box, `Ctrl+j`/`Ctrl+k` scroll the form's main column, not the box's own text: form
  boxes are short and capped in height (Decided).
- `Ctrl+n`/`Ctrl+p` bind in both `forms.forms` and `forms.review`; the review's one box makes them
  stay put there (Decided).
- Seam: the round view owns its scroller and gains `scrollHalfPage`; the forms view reaches the
  active round's view; the commands reach the forms view through one injected dep, so
  `forms-commands.test.ts` hands a fake (codebase-design: accept dependencies, depth — the
  scroller element never leaves the round view).

Out of scope: half-page keys in list views (follow-up), the gallery's step size, a normal-mode-only
chord bind.

## File Structure

Modified:

- `src/plugins/forms/manifest.ts` — two commands
- `src/plugins/keymap.ts` — forms binds
- `src/plugins/forms/page/round-view.ts` — `RoundView.scrollHalfPage`
- `src/plugins/forms/page/forms-view.ts` — `FormsView.scrollHalfPage`
- `src/plugins/forms/page/forms-commands.ts` — dep and two handlers
- `src/plugins/forms/page/start.ts` — wires the dep
- `src/plugins/forms/page/boxes.ts` — the `Ctrl+j order` comment becomes `Ctrl+n order`
- `src/plugins/forms/page/forms-commands.test.ts` — tests
- `src/plugins/forms/main/selftest-script.ts` — key steps

No new files. Boundary: forms imports only `src/contracts`, `src/shared` and its own folder, as now.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Forms scroll and box keys](01-forms-scroll-and-box-keys.md)

### Wave 2
- [x] [Doc re-read](02-doc-re-read.md) — after 01

### Wave 3
- [x] [Final verification](03-final-verification.md) — after 02

## Run log

Review base: 6015e496

### Groups
- 01 · 491d4a29 · diff read: every Produces present; typecheck and lint clean · concerns: wigley:writing-tests not loadable in the worker; scroll test also pins store state unchanged (toBe); self-test steps unrun until the gate
- 02 · efa4c404 · diff read: one followups line; keymap.md, plugin-framework/design.md and docs-browser/design.md lines checked true · concerns: none
- 03 · 49b7033e · selftest all passed; drive run on the layout preview: page scroll moves only the main column, INSERT box keeps focus and mode through Ctrl+j and takes the next letter, review rows move at 900x360, key help lists Ctrl+N/P boxes and Ctrl+J/K scroll · concerns: none
### Contract changes
### Rulings
- Test names kept as the plan wrote them, matching the file's plain-sentence style — rename only — group 01 · group 01
- Review Ctrl+k self-test step placed right after the review opens, before help — passes even at the top since it expects only the command line — group 01 · group 01
- Both handlers share a private scrollForm(deps, direction) helper beside stepFocus and moveItem — none — group 01 · group 01
- Followups list-view entry gains the settings picker and chat session list; keymap.md's bracketed list stays as examples — a doc reader might expect it exhaustive — group 02 · group 02
- plugin-framework/design.md 'Ctrl+j / Ctrl+k until the forms scroll keys moved them' kept, matching that doc's changed-by history style — a stale-history note if the doc drops that style — group 02 · group 02
- Settings self-test timeout-reset failure was pre-existing (a keymap apply drops the pending gg); fixed test-side in 49b7033e outside the plan's files; the product-side replay of pending keys goes to the deferred list — a user typing gg as keymap.json applies still loses it — lead
### Review rounds
### Test gate
- forms-commands.test.ts (edited, the new handlers) and keymap.test.ts (checks the default keymap's commands and clashes) · 55 passed; npm run selftest (new forms steps) · all passed after 49b7033e, which fixed a settings timeout-reset race that also fails at 6015e496
