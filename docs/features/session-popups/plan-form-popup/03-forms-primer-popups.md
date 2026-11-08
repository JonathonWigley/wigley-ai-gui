# 03 — Forms and primer in popups; tab take-over removed

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/page/forms-commands.ts` · `src/plugins/primer/page/primer-commands.ts` · `src/plugins/primer/page/primer-state.ts` (comments only) · create `src/shared/page/session-form-popups.ts` · test `src/shared/page/session-form-popups.test.ts` · delete `src/shared/page/session-form-tabs.ts` · `src/shared/page/session-form-tabs.test.ts` · modify `src/plugins/forms/page/forms-view.ts` · `src/plugins/forms/page/start.ts` · `src/plugins/forms/page/forms.css` · `src/plugins/primer/page/primer-view.ts` · `src/plugins/primer/page/start.ts` · `src/plugins/primer/page/primer.css` · `src/plugins/primer/main/tool-definitions.ts` · `src/plugins/primer/manifest.ts` · `src/plugins/primer/layouts/layout.d.ts` · `src/plugins/forms/main/preview/preview-round.ts` · `src/shared/page/session-forms.ts` · `src/plugins/sessions/contract.ts` · `src/plugins/sessions/page/tabs.ts` · `src/plugins/sessions/page/session-tabs-view.ts` · test `src/plugins/forms/page/forms-view.test.ts` · `src/plugins/primer/page/primer-view.test.ts` · `src/plugins/forms/page/forms-commands.test.ts` · `src/plugins/primer/page/primer-commands.test.ts` · `src/plugins/chat/page/chat-view.test.ts` · `src/plugins/sessions/page/consumer-view.test.ts` · `src/plugins/sessions/page/tabs.test.ts` · `src/plugins/sessions/page/session-tabs-view.test.ts`
Consumes:  `SessionPopupView`, `SessionPopupHandle`, `SessionsPageExports.addPopup` ← 01
Produces:  `export function createSessionFormPopups(deps: SessionFormPopupsDeps): SessionFormPopups` in `src/shared/page/session-form-popups.ts`, with
           `SessionFormPopupsDeps { addPopup(sessionId: string, popup: FormPopupView): FormPopupHandle; popupId: string; title: string; icon: string; className: string; beforeClose(sessionId: string): boolean; shown(): void; formShown(sessionId: string, shown: boolean): void }`
           `SessionFormPopups { mount(sessionId: string, root: HTMLElement): void; sync(statusOf: (sessionId: string) => string | null): void; forget(sessionId: string): void; open(sessionId: string): void; isShown(): boolean }`
           (`FormPopupView` / `FormPopupHandle` are the helper's structural copies of the sessions types, as `FormTabView` / `FormTabHandle` are today)
Decisions: both forms and primer move (interview Q1) · every session, terminal ones included (Q2) · a new round opens the popup even over a hidden one (design § Open, hidden and gone) · take-over removed with its last caller (design § Forms and the primer)

## What to build

- **Helper.** Same role as `session-form-tabs.ts`, with these changes:
  - `mount` adds the session's popup when it has none (`addPopup` opens it) and inserts the root into its element;
    when the popup exists it inserts the root and calls `open()`, so a new round opens a popup the user had hidden.
  - No idle state: `sync` sends each popup's status (`statusOf`) and calls `formShown` as today, and when `statusOf`
    returns null for a session that holds a popup it disposes the popup, drops the entry and calls
    `formShown(sessionId, false)` if it had reported true.
  - `takeOver` / `release` are gone (the popup's own add/dispose is the take-over). `select` becomes `open`.
- **forms-view.ts / primer-view.ts** build through the helper (`popupId` `'form'` / `'primer'`, titles `'Form'` /
  `'Primer'`, icons and class names as today), drop `idleText`, the `tabs.takeOver` call in `syncRoundViews` (primer:
  its sibling) and `tabs.release` in `destroyRoundView`; `showForm` / `showPrimer` call `open`; `isShown()` keeps
  gating the cancel prompt's base-scope restore. Deps types pick `'addPopup' | 'setActivity'` instead of `'addTab'`.
  Rename `tabs` locals and comments to `popups` so no comment calls it a tab.
- **Scope after registration.** `addPopup` runs the popup's `shown` inside `mount`, before the view is in
  `roundViews` / `primerViews`, so the resize (and primer's focus) target would be null. After `roundViews.views.set`
  (primer: its `primerViews` set) in `syncRoundViews`, when `popups.isShown()`, call `setBaseScope(state)` /
  `setScopeFor(state)` once more.
- **CSS.** The idle rules `.form-tab > .ui-empty` and `.primer-tab > .ui-empty` go with `idleText`. The class names
  stay `form-tab` / `primer-tab`; their `height: 100%` fills the popup body (01 pins the body to fill its root).
- **Close guard** (`session-forms.ts` `GuardSessionCloseDeps.showForm`): its doc says it opens the session's form
  popup; behaviour unchanged.
- **Copy naming the tab**: `primer/main/tool-definitions.ts` (`…in the wigley-ai-gui app's Primer tab` → `…app's
  primer popup`), `primer/manifest.ts` layout setting description (`The primer layout that draws the primer popup`),
  `primer/layouts/layout.d.ts:3`, `forms/main/preview/preview-round.ts` lines naming the Form tab, `forms.css` /
  `primer.css` comments (`forms.css:1,11,14`, `primer.css:1,11`), `forms-commands.ts:344`, `primer-commands.ts:520`,
  `primer-state.ts:312,321`, `forms/page/start.ts:123-124`, `primer/page/start.ts:128-130`: no comment or string in
  forms or primer calls the surface a tab. The marketplace restates "Primer tab"
  (`plugins/wigley/scripts/forms/README.md:363`, `plugins/wigley/skills/feature-primer/SKILL.md:17`); task 05 fixes
  those, so this task leaves that repo alone.
- **Remove the take-over** now that nothing calls it: `SessionTabHandle.takeOver` and its doc
  (`sessions/contract.ts`), the handle's `takeOver` and `latestTakeOver` in `session-tabs-view.ts` (`dispose` just
  removes the tab), `tabsAfterTakeOver`, `tabsAfterRelease`, `TakeOver`, `tabsWithSelected` and the `selections`
  field in `tabs.ts` (`tabsAfterSelect` keeps today's selection behaviour without the counter), their tests, and the
  `takeOver:` members of the fakes in `forms-view.test.ts`, `primer-view.test.ts`, `chat-view.test.ts`,
  `consumer-view.test.ts`. `npm run lint` and `tsc` must show no reference left
  (`grep -rn "takeOver\|tabsAfterRelease\|tabsAfterTakeOver" src` → only chat main's unrelated `takeOverSkipped`).

GIVEN a session with no popup WHEN its first round mounts THEN one popup is added (open) and `formShown(true)` reports once the status is set
GIVEN a session whose popup the user hid WHEN a new round mounts into it THEN `open()` runs
GIVEN a session's last round leaves WHEN `sync` runs THEN its popup is disposed and `formShown(false)` reports
GIVEN a round in a background session WHEN the user closes that session THEN the guard opens its popup and asks to cancel, as it selected the tab before
GIVEN forms and primer both open in one session THEN two popups exist, the later one on top

Tests:     `session-form-popups.test.ts` — the helper's rules above as a table where they share a shape (mount new / mount existing / sync null / sync status unchanged sends nothing), plus `isShown` and `forget`; port what `session-form-tabs.test.ts` pinned that still holds (status sent only on change, `formShown` only on change). `forms-view.test.ts`, `primer-view.test.ts`: their fake `addTab` becomes a fake `addPopup`; the existing take-over-on-open cases become "a round opens a popup"; `forms-commands.test.ts` "close guard selects the session's Form tab" becomes "…opens the session's form popup". A view test per view: a session's first round opens, and `setResizeTarget` was last called with that round view's target (primer: and `setFocusTarget` with its focus target). The forms-plus-primer GIVEN is a row in `session-form-popups.test.ts` building two helpers (`'form'`, `'primer'`) over one fake `addPopup`: two popup ids added for one session, in mount order. Remove the take-over cases from `tabs.test.ts` and `session-tabs-view.test.ts`.
Done when: `npm test` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 616576b6 · proof: diff read; tsc --noEmit and npm run lint clean; worker ran npm test green (10093); takeOver grep only chat's takeOverSkipped · concerns: plan's 'scope after registration' premise did not hold (render's trailing confirm.setBaseScope covers it); enterFrame cancel has no direct sessions test; usage-tab-line manifest still names '(Chat, Form, Primer)' session kinds
