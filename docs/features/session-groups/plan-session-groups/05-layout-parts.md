# 05 — Section and group layout parts

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/layouts/layout.d.ts` · modify `src/plugins/sessions/layouts/default/layout.js` ·
           modify `src/plugins/sessions/layouts/default/layout.css` · modify `src/plugins/sessions/page/layout/sessions-parts.ts` ·
           test `src/plugins/sessions/page/layout/sessions-parts.test.ts` · modify `src/plugins/sessions/page/sessions-view-fakes.ts` ·
           modify `src/plugins/sessions/page/layout/read-sessions-layout.ts`
Consumes:  `iconButton`, `icon` (tree, `src/shared/page/ui/`)
Produces:  in `layout.d.ts`:
           `export interface SectionInput { kind: 'favorites' | 'recent'; label: string; dropHint: string; isEmpty: boolean }`
           `export interface SectionPane extends SessionsPart { groups: HTMLElement }`
           `export interface GroupInput { project: string; count: number; isFavorite: boolean }`
           `export interface GroupPane extends SessionsPart { header: HTMLElement; rows: HTMLElement }`
           `export interface GroupKit extends SessionsKit { favoriteToggle(parent: HTMLElement): HTMLElement; dragHandle(parent: HTMLElement): HTMLElement }`
           `section?(parent: HTMLElement, input: SectionInput, kit: SessionsKit): SectionPane` and
           `group?(parent: HTMLElement, input: GroupInput, kit: GroupKit): GroupPane` on `interface Layout`
           in `sessions-parts.ts`:
           `export interface DrawnGroup extends GroupPane { favoriteToggle: HTMLElement | null }`
           `section(parent: HTMLElement, input: SectionInput): DrawnPart<SectionPane>` and
           `group(parent: HTMLElement, input: GroupInput): DrawnPart<DrawnGroup>` on `interface SessionsParts`
           in `sessions-view-fakes.ts`: a `sessionsPartsSetup` helper building `createSessionsParts` from the same fake deps `sessionsViewSetup` uses
Decisions: mockup 4 (round 2) · everything draws through a layout, so each new surface ships its contract and
           `default` (AGENTS.md § Intent) · the star is clicked and the header dragged, both kept by the app (Decided,
           plan read) · the grip is a visual cue only; the whole header is the drag source (plan read) · both sections
           always draw, an empty one hidden except during a drag, so a group can be dragged into an empty Favorites
           or out into an empty Recent (plan read)

- **Contract prose.** The side bar's `rows` box takes the two `section`s, Favorites then Recent; a `section`'s
  `groups` box takes one `group` per project; a `group`'s `rows` box takes that project's `row`s. A part whose
  `groups`, `header` or `rows` is not inside its `element` draws with `default` (`requireElementIn`, as `sideBar`
  does). Rewrite the Panes paragraph, `SideBarPane.rows`' comment and `layout.js`'s header comment to say so.
  Add to "The app keeps": the star's click; the drag on each group's `header`; `is-empty` on a section with no
  groups; `has-favorites` and `is-reordering` on the side bar's `rows` box.
- **Kit.** `favoriteToggle` is an `iconButton` (`star-full` and label `Unfavorite` when `input.isFavorite`, else
  `star-empty` and `Favorite`), class `session-group-star`, `is-active` on a favorite, with a no-op click that
  task 06 replaces by its own listener on `DrawnGroup.favoriteToggle`. `dragHandle` draws the `gripper` icon in
  `span.session-group-grip` and returns it; nothing reads it. Each places at most once: a second call throws
  `favoriteToggle placed twice` / `dragHandle placed twice`, so the group draws with `default`. A layout that
  leaves the star out gives `favoriteToggle: null`.
- **default.** `section` is `div.session-section` holding `div.session-section-label` (the label, then a hairline
  rule filling the line), `div.session-section-drop-hint` (`input.dropHint`), then `div.session-section-groups`.
  `group` is `div.session-group` holding `div.session-group-header` (grip, star, `span.session-group-name`,
  `span.session-group-count`) then `div.session-group-rows`.
- **layout.css.** Header in `fg-secondary` at `text-12`; name `weight-semibold` in `fg`. The grip, and the star
  of a group that is not a favorite, keep their space under `visibility: hidden` until the header is hovered, so
  the name never shifts and a hidden star takes no click; a favorite's star always shows, in `status-warning`.
  Section labels show only under `has-favorites` or `is-reordering`. A section with `is-empty` is hidden, and
  under `is-reordering` shows its drop hint as a dashed `border-default` box; the hint is hidden otherwise. Gaps
  from the `space-*` tokens, matching `.session-sidebar`'s.
- **Codicon names** `star-full`, `star-empty` and `gripper` are taken from the Codicons icon list
  (microsoft.github.io/vscode-codicons); the final verification's captures show whether each draws.
- `read-sessions-layout.ts`'s `LAYOUT_PARTS` gains both names (the compiler demands it).

GIVEN the default layout WHEN `group` draws a favorite with 2 rows THEN its header holds the grip, a `star-full` star with `is-active` and label `Unfavorite`, the name and `2`, and `header` and `rows` are inside `element`
GIVEN the default layout WHEN `group` draws a non-favorite THEN its star is `star-empty`, label `Favorite`, without `is-active`
GIVEN the default layout WHEN `section` draws THEN it holds the label, the drop hint and `groups`, with `groups` inside `element`
GIVEN a user layout whose `group` returns `rows` outside its `element`, or calls `favoriteToggle` twice, or `dragHandle` twice WHEN it draws THEN the group draws with `default`
GIVEN a user layout whose `section` returns `groups` outside its `element` WHEN it draws THEN the section draws with `default`
GIVEN a user layout whose `group` leaves the star out WHEN it draws THEN `DrawnGroup.favoriteToggle` is null
Tests:     `sessions-parts.test.ts` — one table test `groupAndSectionParts` over the GIVENs above, drawing through
           `sessionsPartsSetup` (the view draws neither part until task 06)
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit b21962a4 · proof: diff read; every Produces present in layout.d.ts, sessions-parts.ts and sessions-view-fakes.ts; compile clean; the worker's lint clean · concerns: CSS unseen on screen until task 08's captures: the sm star may set a taller header than text-12, and no grab cursor is set; contract prose describes sections while the view still fills rows until task 06
