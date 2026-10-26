# 04 — Toggle mark primitive

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

Add the ToggleMark primitive that `DESIGN.md` § Primitives already lists ("an on/off mark beside a row's label, such
as an included item; a click toggles it, and the key that toggles it belongs to the view"), and show it in the
gallery in every state. The primer card (task 07) draws one per work item.

Files:
- create `src/shared/page/ui/toggle-mark.ts`, `src/shared/page/ui/toggle-mark.css`
- modify `src/plugins/gallery/page/gallery-view.ts`

Consumes:
- `button` (`src/shared/page/dom.ts`), `icon` (`src/shared/page/ui/icon.ts`), `row` (`src/shared/page/ui/row.ts`) —
  in the tree
- the gallery's `section`, `cell`, `withClass` and `ignore` helpers in `gallery-view.ts` — in the tree

Produces:

`src/shared/page/ui/toggle-mark.ts`:
```ts
export interface ToggleMarkOptions {
  isOn: boolean;
  // The accessible name and tooltip, e.g. `Include the item`.
  label: string;
  onToggle: () => void;
}
// A small square on/off mark that never takes focus: on, it carries `is-selected` and shows a check. A click calls
// `onToggle` and changes nothing itself; the view sets the new state with `setToggleMark`. A disabled mark
// (the button's `disabled` attribute) drops its clicks.
export function toggleMark(options: ToggleMarkOptions): HTMLButtonElement;
export function setToggleMark(mark: HTMLElement, isOn: boolean): void;
```

The gallery section `ToggleMark` in `src/plugins/gallery/page/gallery-view.ts`, built by a new
`toggleMarkSection()` placed in `createGalleryView`'s `sections.append(...)` list right after `tagSection()`, the
order `DESIGN.md` § Primitives lists them in.

Decisions:
- **One source of state.** The mark does not flip itself on click, as `statusDot` / `setDotStatus` keep the
  status with the caller. The primer's state owns `include`; the view calls `setToggleMark` on each render.
- **Markup.** `toggleMark` builds `button('ui-toggle-mark', '', onToggle)` (so it never takes focus and keeps the
  page keys), sets `aria-label` and `title` to `label`, appends `icon('check')`, and calls
  `setToggleMark(node, isOn)`. `setToggleMark` toggles `is-selected` and sets `aria-pressed` to `'true'` or
  `'false'`.
- **CSS, tokens only** (`scripts/check-styles.mts`; `DESIGN.md` § Tokens and themes). The rules, all under the
  root class `ui-toggle-mark`:
  - the box: `display: inline-flex`, centred, `flex: none`, `width` and `height` `var(--wg-icon-size)`,
    `padding: 0`, `border: 1px solid var(--wg-border-strong)`, `border-radius: var(--wg-radius-sm)`,
    `background: transparent`, `color: var(--wg-fg-on-accent)`, `cursor: pointer`, and a `transition` of
    `background-color` and `border-color` over `var(--wg-duration-fast) var(--wg-ease-out)`;
  - the check: `.ui-toggle-mark .codicon[class*='codicon-']` sets `font-size: var(--wg-text-12)` (this selector
    outranks `icon.css`'s `.codicon[class*='codicon-']`), and `visibility: hidden` while off;
  - on (`.is-selected`): `background` and `border-color` `var(--wg-accent)`, the check visible;
  - hover (`:not(:disabled):hover` and `.is-hover`): off takes `border-color: var(--wg-accent)`; on takes
    `background` and `border-color` `var(--wg-accent-hover)`;
  - pressed (`:not(:disabled):active` and `.is-pressed`): off takes `background: var(--wg-accent-tint-strong)`;
  - disabled (`:disabled`): `border-color: var(--wg-border-default)`, `cursor: default`; on and disabled takes
    `background: var(--wg-border-default)` and `color: var(--wg-fg-disabled)`.
  The accent marks "on" because `DESIGN.md` § Colour gives the one accent to selection; the mark carries no status
  colour.
- **No focus ring on the mark.** `DESIGN.md` § Keys and focus draws the keyboard cursor on the row; the mark sits in
  the row's leading slot and takes no `is-cursor` state of its own.
- **Gallery cells**, one section, two rows of cells, each caption verbatim:
  - row 1: `Off` (`isOn: false`), `On` (`isOn: true`), `Off, hover` and `On, hover` (`withClass(..., 'is-hover')`),
    `Off, pressed` (`withClass(..., 'is-pressed')`), `Off, disabled` and `On, disabled` (the `disabled` helper),
    and `Live`: a mark whose `onToggle` flips its own state with `setToggleMark`, so a click shows both states;
  - row 2: one wide cell, caption `Beside a row label`: `row({ density: 'list', label: 'Write the store',
    leading: toggleMark({ isOn: true, label: 'Include the item', onToggle: ignore }) })`.
  Every other cell's mark takes `label: 'Include the item'` and `onToggle: ignore`.
- **No layer or DESIGN.md change.** `src/plugins/gallery/page` may import `src/shared/page/ui` already, and
  `DESIGN.md` already lists ToggleMark.

GIVEN the gallery WHEN it opens THEN the ToggleMark section shows every state above. This is a visual claim: task 14
live check 5 screenshots it; no unit test asserts it (`wigley:writing-tests` § What earns a live run instead).

Tests: none. The builder holds no logic a test can decide beyond setting two attributes; its look is task 14's
live check 5, and the self-test's gallery screenshots (`forms-gallery-full-*`, `forms-gallery-reduced-*`) capture
it in both transparency settings.

Approach: none beyond Decisions.

Done when: `npm run typecheck` and `npm run lint` pass (the style check judges `toggle-mark.css`).
Commit: one commit for the group in wigley-ai-gui

## Proof

Commit 9a512e3 · proof: diff read: toggleMark, setToggleMark, ToggleMarkOptions and the gallery section present as planned; typecheck passes; worker ran lint clean; visual check is task 14 live check 5 · concerns: none
