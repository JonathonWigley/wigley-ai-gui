# 06 — Sessions row parts

Status: not started
Type: Task
Wave: 1 · Depends on: none (precondition: the chat-panes plan `docs/features/chat-panes/plan-chat-panes/` lands first; it restructures the side bar and edits the same sessions files)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · create `src/plugins/sessions/page/row-parts.ts` ·
           modify `src/plugins/sessions/page/layout/sessions-parts.ts` · modify `src/plugins/sessions/page/sessions-view.ts` ·
           modify `src/plugins/sessions/page/start.ts` · modify `src/plugins/sessions/layouts/layout.d.ts` ·
           modify `src/plugins/sessions/layouts/default/layout.js` · modify `src/plugins/sessions/page/sessions.css` ·
           modify `src/plugins/sessions/page/sessions-view-fakes.ts` ·
           test `src/plugins/sessions/page/row-parts.test.ts` · test `src/plugins/sessions/page/layout/sessions-parts.test.ts`
Consumes:  nothing from another task; mirrors forms' `FormsCardPart` / `addCardPart` (`src/plugins/forms/contract.ts`),
           `createFormsContributions` (`src/plugins/forms/page/contributions.ts`) and `placeContributedParts`
           (`src/plugins/forms/page/layout/card-kit.ts`)
Produces:  in `src/plugins/sessions/contract.ts`:
           `export interface SessionRowPart { id: string; build(parent: HTMLElement, sessionId: string): { dispose?(): void }; }`
           `SessionsPageExports.addRowPart(part: SessionRowPart): Disposable;`
           in `src/plugins/sessions/layouts/layout.d.ts`:
           `export interface RowKit extends SessionsKit { contributedParts(parent: HTMLElement): HTMLElement; }`
           and `Layout.row?(parent: HTMLElement, input: SessionRowInput, kit: RowKit): SessionsPart;`
           in `src/plugins/sessions/page/row-parts.ts`:
           `export interface SessionRowParts { add(part: SessionRowPart): Disposable; parts(): SessionRowPart[]; onChanged(listener: () => void): Disposable; }`
           `export function createSessionRowParts(): SessionRowParts;`
Decisions:
- **Shape** is forms' `addCardPart` with `update` replaced by `dispose`, because rows redraw on every `render`
  (plan.md File Structure; plan.md Design review: "sessions gains a generic `addRowPart` hook shaped like forms'
  `addCardPart`"). `row-parts.ts` is `contributions.ts` cut down to one list: `add` throws
  `row part <id> is already added` on a held id, appends in add order and notifies; the `Disposable` removes the part
  and notifies once, and a second `dispose` does nothing. `onChanged` wraps each listener so each handle removes only
  its own.
- **The row's kit only** gains `contributedParts`: a new `RowKit` that only `row` takes. `sideBar`, `tab` and
  `emptyText` keep `SessionsKit`. `RowKit` is the name, matching `SideBarKit` and `TabBarKit`.
- **Placement lives in `sessions-parts.ts`'s `row` draw, not in `sidebar-view.ts`.** Only the draw holds the
  attempt's `RollbackDeps`. `contributedParts(parent)` appends `div.session-row-parts` to `parent`. It holds one
  `div.session-row-part` (`data-part="<id>"`) per part from `rowParts.parts()`, in add order, and each wrapper gets
  `part.build(wrapper, input.sessionId)`. It returns the holder, and a second call in one draw throws
  `row placed contributed parts twice`, so the row draws with `default`. When the builder returns without calling
  it, and at least one part is held, the same holder is appended at the end of the row's returned `element`. That is
  forms' rule: at the card's end. The append happens inside the draw's build callback, after the builder returns and
  before the draw's own checks; those checks look only at `parent`'s children, so the append passes them.
- **Dispose bookkeeping.** Each built part's `dispose` is recorded with `rollback.recordBox`. The row's
  `DrawnPart.dispose`, which `sidebar-view.ts` already runs before every redraw (`disposeRows`) and in
  `redrawPane`, therefore runs it. A user row that throws after placing parts has them disposed by the rollback
  before `default` draws them again. Each recorded dispose is wrapped: a throw logs
  `[sessions] row part <id> dispose failed: <error>` (through `errorText`) and the other disposes still run.
  The chat-panes plan (`docs/features/chat-panes/plan-chat-panes/`) lands first and restructures the side bar, so
  this task's implementer re-reads the sessions files it changed and hooks the row parts into the row draw as it
  stands then: the `row` part's draw inside the layout, so the draw's rollback disposes them.
- **A part whose `build` throws** has its wrapper removed and logs `[sessions] row part <id> failed: <error>`. The
  other parts and the row still draw (plan.md File Structure).
- **Redraw on add or remove.** `mountSessionsView` deps gain `rowParts: SessionRowParts`, and `SessionsPartsDeps`
  gains `rowParts: Pick<SessionRowParts, 'parts'>`. The view subscribes with `rowParts.onChanged(() => drawSidebar())`,
  so the rows redraw: the real rows, or the preview sample while it shows. `start.ts` makes the registry with
  `createSessionRowParts()`, hands it to `mountSessionsView`, and its export is
  `addRowPart: (part) => rowParts.add(part)`. The preview's sample rows build parts too, with their `preview-<n>` ids.
- **A click inside a part selects the session**, as a click on the row does. No listener is added: the holder sits
  inside the row's element, so the real DOM bubbles the click to the row's existing `rowAction`. The fake DOM does not
  bubble, so 12 checks this live.
- **Default layout**: `row` calls `kit.contributedParts(element)` last, after the status line. Its header comment
  names the slot.
- **Contract comment** in `layout.d.ts`: the `RowKit` member's comment follows forms' `contributedParts` comment. It
  says to call it once where the parts go; a row that leaves it out gets the parts appended at its element's end; a
  part that throws is logged and draws nothing.
- **Styling** (`sessions.css`, tokens only, so `scripts/check-styles.mts` passes): `.session-row-parts` takes
  `grid-column: 1 / -1`, `min-width: 0`, and `display: flex; flex-direction: column`, so it spans the row's grid
  under the label line and status. `.session-row-part` takes `min-width: 0`. Nothing else: the part styles its own
  content.
- `sessions-view-fakes.ts`'s `sessionsViewSetup` takes an optional `rowParts` (default `createSessionRowParts()`) and
  returns it.

GIVEN two session rows and two added parts WHEN the side bar renders THEN each row holds one `div.session-row-parts`
whose wrappers carry `data-part` p1, p2 in add order, and each part was built once per row with that row's sessionId.
GIVEN rows drawn with parts WHEN `render` runs again THEN every part dispose from the first draw has run before the
second draw's first build.
GIVEN a user layout whose `row` never calls `contributedParts` WHEN rows draw with one part held THEN the holder is
the last child of the row's element.
GIVEN a part whose `build` throws WHEN rows draw THEN `[sessions] row part <id> failed: <error>` is logged, its
wrapper is gone, and the other part and the row still draw.
GIVEN drawn rows WHEN a part is added, then its `Disposable` is disposed THEN the rows redraw each time without a new
`render`: the part's wrappers appear, then are gone.

Tests:
- `row-parts.test.ts` (mirror `contributions.test.ts`):
  - `add_TakenId_Throws`: the message holds the id. Catches two plugins silently sharing one id.
  - `add_Dispose_RemovesPartAndNotifiesOnce`: `parts()` is `[]` and the listener ran once. Catches a remove that
    leaves the part or notifies twice.
  - `add_DisposeTwice_SecondDoesNothing`: a second held part stays, and the listener ran once. Catches a second
    dispose splicing out another part (`indexOf` -1).
- `layout/sessions-parts.test.ts` (new tests beside the existing ones, using `sessionsViewSetup`; each part records
  `build:<id>:<sessionId>` and `dispose:<id>:<sessionId>` into one array):
  - `rowParts_DefaultRow_BuildsEachPartPerRowInAddOrder`: wrappers' `data-part` per row are `['p1','p2']`, and the
    record is `['build:p1:a','build:p2:a','build:p1:b','build:p2:b']`.
  - `rowParts_RenderAgain_DisposesBeforeRebuilding`: after two renders of one row and one part, the record is
    `['build:p1:a','dispose:p1:a','build:p1:a']`. Catches a leak of the first build's timers.
  - `rowParts_UserRowWithoutSlot_AppendsAtRowEnd`: the row element's last child has class `session-row-parts`.
  - `rowParts_PartThrows_LogsAndOthersDraw`: the log holds `[sessions] row part bad failed: boom`; one wrapper
    (`good`) remains; the row is drawn.
  - `rowParts_AddAndDispose_RedrawsRows`: wrapper count 1 after `add` and 0 after `dispose`, with no `render` between.
Done when: compiles; `npm test` runs the tests above; `npm run lint` passes (layers and styles)
Commit:    one commit for the group

## Proof
