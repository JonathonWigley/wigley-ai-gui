# 04 — Activity move

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/composer-kit.ts` · modify `src/plugins/chat/page/working-turn.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` · modify `src/plugins/chat/page/activity-dock.ts` (comments) · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/layouts/default/layout.css` · modify `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/agent-lines/main/selftest-script.ts` · modify `src/plugins/agent-strip/main/selftest-script.ts` · modify `src/plugins/usage/main/selftest-script.ts` · create `src/plugins/chat/page/main-agent-part.ts` · test `src/plugins/chat/page/main-agent-part.test.ts` · test `src/plugins/chat/page/working-turn.test.ts` · test `src/plugins/chat/page/composer-kit.test.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `ChatSidePart`, `ChatSideSection`, `.is-side-hidden`, `.chat-side-section-body` ← 01
           `createActivityDock`, `workingInput`, `doneInput` (in the tree)
Produces:  in `src/plugins/chat/layouts/layout.d.ts`: `Layout.workingLine?(parent: HTMLElement, input: WorkingInput, kit: BaseKit): PartView<WorkingInput>`
           on `ComposerSurface` in `src/plugins/chat/page/composer-kit.ts`:
           `dockSlot: HTMLElement`
           `dockInput(): WorkingInput | null`
           `onDockChanged(listener: (input: WorkingInput | null) => void): Disposable`
           in `src/plugins/chat/page/working-turn.ts`: `export function dockSummary(input: WorkingInput | null): string | null`
           in `src/plugins/chat/page/main-agent-part.ts`: `export function createMainAgentPart(deps: { surfaceOf(sessionId: string): ComposerSurface | null }): ChatSidePart`
           on the object `mountChatView` returns: `composerOf(sessionId: string): ComposerSurface | null`
Decisions:
- Each surface keeps one `createActivityDock`. Its `changed` draws both parts and then calls the `onDockChanged` listeners, through `callEach`, so a throwing listener does not stop the other draws.
- `dockSlot` is `div.chat-dock-slot`, made once by the surface, hidden while the input is null. The `working` part draws there, with the same draw, update and retry path as today.
- `workingSlot` (`.chat-working-slot`) stays in the composer at the same place, and the new `workingLine` part draws there, through its own `chatPartDraws`. It hides on the same condition.
- A composer draw retries a failed default draw for both parts, as it does today for `working`. A layout change redraws both.
- The surface's `dispose` disposes both draws, the dock's tick and every listener.
- `createMainAgentPart` returns id `chat.mainAgent`, title `Main agent`, order 10. Its `build` appends the surface's `dockSlot` to `parent`, calls `section.setSummary(dockSummary(surface.dockInput()))`, subscribes through `onDockChanged`, and on dispose removes the slot from `parent` and disposes the subscription. It does not dispose the slot, because a side part rebuild moves the same slot.
- When `surfaceOf` returns null, `build` draws nothing and returns no dispose. Task 01 places parts after the tab is held, so a live tab always has a surface.
- `chat/page/start.ts` adds the part to its own side part store, the one `addSidePart` writes, through `view.composerOf`.
- `dockSummary`: a live input returns the `m:ss` time of `now - startedAt`, or `h:mm:ss` from one hour, the same format as `turnTime` in the default layout. A negative span clamps to `0:00`, as `turnTime` does. A `done` input and null return null.
- The default `workingLine` draws `div.chat-working-line`. For a `done` input it holds the `doneLine` text, in `.chat-working-done`. For a live input it holds the head that `fillWorking` draws: `chat-working-time`, `chat-working-state`, and `chat-working-trigger` during a compaction. It draws no bar and no box. Share the head builder and `doneLine` with `fillWorking`. `.chat-working-line` has the `.chat-working` font, `display: flex`, `min-width: 0`, `overflow: hidden` and `white-space: nowrap`, and takes `is-done` for a `done` input. Share the selector with `.chat-working.is-done`, so the finished line takes the same dim colour and tabular numerals. Add `workingLine` to `PART_SET` in `read-chat-layout.ts`.
- `layouts/default/layout.css` adds: `@container chat-tab (width >= 640px) { .chat-tab:not(.is-side-hidden) .chat-working-slot { display: none; } }`. Put it beside the `width < 640px` rule that hides `.chat-side-parts`, under one comment that says the two must keep one threshold. A collapsed Main agent section does not bring the line back: the user collapsed it on purpose.
- The dock's CSS stays on `.chat-working`. Check that it still fits the `264px` column minus the section body's padding (01). Tool lines take an ellipsis at that width; the box does not scroll sideways.
- Add `.chat-working-line` to the four self-test fit lists, beside `.chat-working-action` and `.chat-working-done`. Those lists are at `chat/main/selftest-script.ts:785`, `agent-lines/main/selftest-script.ts:116`, `agent-strip/main/selftest-script.ts:156` and `usage/main/selftest-script.ts:149` (measured at plan time, re-verify).
- Rewrite these comments for the new places: `layout.d.ts`'s `working` and `LiveWorkingInput`, the composer kit's `working`, `composer-kit.ts`'s header, `activity-dock.ts`'s header and `changed`, and `chat-view.ts`'s `createTab` and `drawTurn`.
GIVEN a running turn WHEN the dock ticks THEN the `working` part and the `workingLine` part each update with the same input
GIVEN a live input at 0 s, 65 s, 3,725 s and with `now` before `startedAt`, a `done` input and null WHEN `dockSummary` runs THEN it returns `0:00`, `1:05`, `1:02:05`, `0:00`, null, null
GIVEN a Main agent part built WHEN the dock changes THEN the section's summary follows it
GIVEN a Main agent part WHEN its build is disposed and it builds again THEN the same `dockSlot` is in the new parent and one listener is subscribed
GIVEN a dock with null input WHEN both slots draw THEN both are hidden, so the section hides through 01's rule
GIVEN a default `workingLine` part that fails WHEN the composer draws again THEN the line draws again, and the dock is unaffected
Tests:     `dockSummary` as a table in `working-turn.test.ts`. The Main agent cases in `main-agent-part.test.ts`, with a real surface or the existing fake, asserting the summary strings, `dockSlot.parentElement` and the listener count after dispose. In `composer-kit.test.ts`, these five tests move to read `surface.dockSlot`: `working_SetTurn_LiveThenDoneThenHidden`, `working_UserUpdateThrows_RedrawsWithDefault`, `working_LayoutChange_RedrawsFreshWithTheNewLayout`, `working_DefaultDrawThrows_HidesTheSlotAndLogs`, `working_Dispose_DisposesThePartAndClearsTheTick`. Add a `workingLine` twin for the failure and layout-change cases, and the tick case as a row. In `layout.test.ts`, `workingLine` rows for a `thinking` input, a `compacting` input with a trigger, and a `done` input: assert the child classes, `is-done`, and that `chat-working-bar`, the tool box and `chat-working-counts` are absent
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. Which of the two shows at which width is a check in [09](09-final-verification.md)
Commit:    one commit for the group

## Proof

