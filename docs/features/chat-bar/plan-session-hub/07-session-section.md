# 07 — Session section

Status: done
Type: Task
Wave: 3 · Depends on: 01, 04 (04 shares `chat-view.ts`, and this task consumes nothing from it)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` · modify `src/plugins/chat/page/composer-input.ts` · modify `src/plugins/chat/page/composer-kit.ts` · modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/layouts/default/layout.css` · create `src/plugins/chat/page/session-part.ts` · test `src/plugins/chat/page/session-part.test.ts` · test `src/plugins/chat/page/chat-view.test.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `ChatSidePart` ← 01
           `composerInputOf`, `displayPath`, `CHAT_HARNESS_ID`, `ChatSessionState.projectDir` (in the tree)
Produces:  in `src/plugins/chat/layouts/layout.d.ts`:
           `export interface SessionFactInput { label: string; value: string }`
           `export interface SessionFactsInput { facts: readonly SessionFactInput[] }`
           `Layout.sessionFacts?(parent: HTMLElement, input: SessionFactsInput, kit: BaseKit): PartView<SessionFactsInput>`
           in `src/plugins/chat/page/session-part.ts`:
           `export function sessionFactsOf(input: ComposerInput, projectDir: string, deps: { homeDir: string; paths: Paths }): SessionFactsInput`
           `export function createSessionPart(deps: SurfaceKitDeps & { layouts: ChatLayouts; log: Log; sourceOf(sessionId: string): ReturnType<ChatTabs['sessionFactsSource']> }): ChatSidePart` with id `chat.session`, title `Session`, order 40
           in `src/plugins/chat/page/composer-input.ts`: `export function modelEffortText(input: ModelEffortInput): string`
           on the object `mountChatView` returns: `sessionFactsSource(sessionId: string): { input(): SessionFactsInput; onChanged(listener: () => void): Disposable } | null`
Decisions:
- `sessionFactsOf` returns, in this order:
  - `Project`: `input.repo`
  - `Branch`: `input.branch`, left out when null
  - `Folder`: `displayPath(projectDir, homeDir, paths)`
  - `Harness`: `CHAT_HARNESS_ID`
  - `Model`: `modelEffortText(input.modelEffort)`, left out with null `modelEffort`
- `modelEffortText` returns `<model value> · <effort value>`, or the model value alone with null effort. The chip in `composer-kit.ts` `statusLineKit.modelEffortChip` holds this string now: it moves to `composer-input.ts`, and the chip calls it.
- `Paths` is the `paths` parameter's type on `displayPath`, from `contracts/paths`. Add `sessionFacts` to `PART_SET` in `read-chat-layout.ts`.
- `ChatViewDeps` gains `homeDir: string`. `start.ts` passes `services.homeDir`, as it does at its existing call.
- `chat-view.ts`'s `drawStatusLine(tab)` is the one function all status line changes run through. It also notifies the session's facts source after the status line draws, and after `drawComposer` when its fallback runs. The part compares nothing: the update is a cheap text change.
- `createSessionPart`'s `build` draws the `sessionFacts` part through `chatPartDraws`, updates it on each change, and disposes both at dispose. The section has no summary.
- With a null source, `build` draws nothing.
- The default `sessionFacts` draws `div.chat-session-facts`, one `div.chat-session-fact` per fact: `span.chat-session-fact-label` in `fg-tertiary`, then `span.chat-session-fact-value` with an ellipsis and `title` set to the whole value. `update` patches rows by `label`: an unchanged row keeps its elements, a new row goes in at its place in the facts order, and a gone row leaves. `.chat-session-facts` is `display: grid; grid-template-columns: max-content minmax(0, 1fr)`. Each `.chat-session-fact` is `display: grid; grid-column: 1 / -1; grid-template-columns: subgrid`, and the value takes `min-width: 0`. No section padding here: the body holds it (01).
- Chat reads only its own state here. It names no usage or workflow type.
GIVEN branch null WHEN `sessionFactsOf` runs THEN no `Branch` row shows
GIVEN `modelEffort` null WHEN `sessionFactsOf` runs THEN no `Model` row shows
GIVEN effort null WHEN `sessionFactsOf` runs THEN `Model` reads the model value alone
GIVEN a model and an effort WHEN `sessionFactsOf` runs THEN `Model` reads `Opus 5 · high`
GIVEN a project folder under home WHEN `sessionFactsOf` runs THEN `Folder` starts with `~`
GIVEN a Session part built WHEN the branch changes THEN the value updates in the same element
GIVEN facts `[Project]`, then `[Project, Branch]`, then `[Project]` WHEN each updates THEN the `Project` row element stays and `Branch` comes and goes
GIVEN a `branch` message WHEN `drawStatusLine` runs THEN the source's listener runs once, and once too when a composer update throws and the fallback draws
Tests:     `sessionFactsOf` as a table in `session-part.test.ts`, each row a built `ComposerInput` and the whole expected `facts` array. One test for the update: a fake source fires `onChanged`, and the assertion reads the value span's text and checks the row element is the same one. In `layout.test.ts`, the row-patch GIVEN and a row for two facts giving two rows with `title` set. In `chat-view.test.ts`, the notify GIVEN
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 6b720a24 · proof: diff read: every Produces present; typecheck and lint clean over the whole tree at the commit; worker: 171 tests in the touched files pass · concerns: the subgrid label column and value ellipsis are unseen until task 09; facts listeners fire on every status line draw, box focus included, patching about five rows, unmeasured; session-part.ts and chat-view.ts import each other, type-only at one end
