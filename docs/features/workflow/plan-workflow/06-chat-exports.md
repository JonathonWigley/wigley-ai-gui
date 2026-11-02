# 06 — Chat exports send, clear, fillComposer and composer parts

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/start.ts` ·
           test `src/plugins/chat/main/start.test.ts` ·
           modify `src/plugins/chat/main/preview/preview-session.ts`, `chat-preview.ts`, `chat-preview.test.ts`
           (the preview host id moves to the contract) ·
           modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/page/chat-commands.ts` ·
           test `src/plugins/chat/page/chat-commands.test.ts` · modify `src/plugins/chat/page/chat-view.ts` ·
           modify `src/plugins/chat/page/composer-kit.ts` · test `src/plugins/chat/page/composer-kit.test.ts` ·
           modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` ·
           modify `src/plugins/chat/page/chat.css` ·
           create `src/shared/page/contributed-parts.ts` (moved from `src/plugins/sessions/page/session-part-store.ts`
           and `placeSessionParts` in `src/plugins/sessions/page/layout/sessions-parts.ts`) ·
           test `src/shared/page/contributed-parts.test.ts` (moved from `session-part-store.test.ts`) ·
           modify `src/plugins/sessions/page/start.ts`, `sessions-view.ts`, `sessions-view-fakes.ts`,
           `layout/sessions-parts.ts` (imports only)
Consumes:  in the tree (the clear-command, pending-messages and subagent-lines plans landed):
           `ChatSessions.send(sessionId: string, message: UserMessage): Promise<void>` and
           `ChatSessions.clear(sessionId: string): void` and `ChatSessions.sessions()` in
           `src/plugins/chat/main/chat-sessions.ts`; `ChatMainExports` and `ChatPageExports` in
           `src/plugins/chat/contract.ts`; `ChatView.reveal(sessionId)`, `ChatTabs.session(sessionId)` and
           `putBack` in `src/plugins/chat/page/`; `createComposerSurface`, `ComposerKit`; `SessionPart`,
           `createSessionPartStore` and `placeSessionParts` in the sessions plugin; `PREVIEW_HOST_ID` in
           `src/plugins/chat/main/preview/preview-session.ts`
Produces:  in `src/plugins/chat/contract.ts`, word for word as plan.md § File Structure writes them:
           `ChatMainExports.send(sessionId: string, message: UserMessage): Promise<void>;`
           `ChatMainExports.clear(sessionId: string): Promise<void>;`
           `ChatPageExports.fillComposer(sessionId: string, text: string): void;`
           `ChatPageExports.addComposerPart(part: ChatComposerPart): Disposable;`
           `export interface ChatComposerPart { id: string; build(parent: HTMLElement, sessionId: string): { dispose?(): void } }`
           `export const CHAT_PREVIEW_HOST_ID = 'chat-layout-preview';`
           in `src/plugins/chat/layouts/layout.d.ts`: `ComposerKit.contributedParts(parent: HTMLElement): HTMLElement;`
           in `src/plugins/chat/page/chat-commands.ts`:
           `export function fillComposer(deps: Pick<ChatCommandDeps, 'tabs' | 'log'>, sessionId: string, text: string): void;`
           in `src/shared/page/contributed-parts.ts`:
           `export interface ContributedPart { id: string; build(parent: HTMLElement, sessionId: string): { dispose?(): void } }`
           `export interface PartStore<P extends ContributedPart> { add(part: P): Disposable; parts(): P[]; onChanged(listener: () => void): Disposable }`
           `export function createPartStore<P extends ContributedPart>(): PartStore<P>;`
           `export function placeContributedParts(parent: HTMLElement, sessionId: string, parts: readonly ContributedPart[], place: ContributedPartsPlace, log: Log, rollback: RollbackDeps): HTMLElement;`
           `export interface ContributedPartsPlace { owner: string; noun: string; holderClass: string; wrapperClass: string }`
Decisions: **main `send`** (`exports.send` in `chat/main/start.ts`): an async function. It rejects with
           `chat holds no session <sessionId>` when `chat.sessions()` lists no session with that id. The preview
           session is not in that list, so it rejects too. Otherwise it returns `chat.send(sessionId, message)`.
           It does what the composer's send does, so the pending-messages queue applies: while a turn runs, the
           message is queued and arrives as `queued`, and it is written when the turn ends (drafting decision: one
           send path; the workflow sends only when no turn runs, so it never queues in practice). It does not run
           app slash commands: those run in the page, and `/wigley:*` names none.
           **main `clear`**: an async function with the same `chat holds no session <sessionId>` rejection. Then it
           calls `chat.clear(sessionId)`, which is synchronous, and resolves when that call returns. That is the
           resolve point "once the new process started": `ChatSessions.clear` returns after
           `startProcess`, so the fresh process exists, and its events arrive in later microtasks. When
           `chat.clear` throws (a missing profile or harness, or a fresh start that fails and leaves the row
           resting), the promise rejects with that error. After `killAll` chat logs and does nothing, and the
           promise resolves. The `sessions.hostSessionChanged` event is emitted inside `chat.clear`, before it
           returns; the comment on `clear` says so, since the workflow folds `cleared` from that event.
           Contract comments: above `send`, "Sends as the composer does: queued while the session's turn runs.
           Rejects for a session chat does not hold, the layout preview included." Above `clear`, "The `/clear`
           command's clear: resolves once the fresh process started; rejects when it cannot start, or for a
           session chat does not hold."
           **`CHAT_PREVIEW_HOST_ID`** (for the workflow preview, 09 and 10, which runs on chat's preview session):
           move `PREVIEW_HOST_ID` from `preview-session.ts` into `chat/contract.ts` as `CHAT_PREVIEW_HOST_ID`, with
           its comment ("The layout preview's row host session id; no harness holds a session by it."). Its two
           users and the preview test import it from the contract. `preview-session.ts` keeps no copy.
           **page `fillComposer`**: `exports.fillComposer` calls `fillComposer({ tabs: view, log }, sessionId,
           text)`. The function sits beside `putBack` in `chat-commands.ts`. When `deps.tabs.session(sessionId)` is
           undefined, it logs `fillComposer for unknown session <sessionId> ignored` and does nothing. Otherwise it
           calls `session.box.setText(text)`, which replaces the draft and leaves the attached images, then
           `deps.tabs.reveal(sessionId)`, which activates the session, selects its Chat tab and focuses the box in
           insert mode at the end.
           **composer parts — one shared helper** (drafting decision: a composer part has the exact shape of a
           session part, AGENTS.md "A composer part"). Move sessions' part store and its placement into
           `src/shared/page/contributed-parts.ts`, generic over `ContributedPart`:
           - `createPartStore` is `createSessionPartStore` unchanged but for its type parameter. Its throw text
             stays `part <id> is already added`.
           - `placeContributedParts` is `placeSessionParts` unchanged, with `place.owner` as the log's plugin name
             in place of the literal `'sessions'`.
           - Sessions imports both; `SessionPartStore` becomes `PartStore<SessionPart>`, and sessions' two
             `ContributedPartsPlace` values gain `owner: 'sessions'`. Sessions' behaviour and its tests do not
             change. `session-part-store.ts` and its test are deleted; the test's three cases move into
             `contributed-parts.test.ts` unchanged.
           - `src/shared/page` is a layer that sessions' and chat's page parts already import, so
             `scripts/check-layers.mts` needs no change. Check it with `npm run lint`.
           **page `addComposerPart`**: chat's page `start.ts` holds one `composerParts = createPartStore<ChatComposerPart>()`.
           `exports.addComposerPart` is `(part) => composerParts.add(part)`. `ChatViewDeps` and
           `ComposerSurfaceDeps` gain `composerParts: PartStore<ChatComposerPart>`; `ComposerPieces` gains
           `sessionId: string`, the session whose parts the composer draws. `mountChatView` hears
           `composerParts.onChanged` and draws every tab's composer again, as its `layouts.onChange` does. The
           contract comment on `ChatPageExports` says: `addComposerPart` throws on an id already added; adding a
           part and disposing its `Disposable` each draw every Chat tab's composer again; a part is built each time
           the composer draws, which is at a layout change and at a part add or removal, not on each bar change,
           so a part whose content changes redraws into its wrapper itself. A part is drawn in every Chat tab, the
           layout preview's included.
           **where the parts draw: the `composer` part's kit** (`ComposerKit`), not `ComposerBarKit`. The bar
           redraws on each input change (mode, focus, controls), which would build the parts again on every key.
           The composer draws once per layout change. In `drawComposer`, `ComposerKit.contributedParts(parent)`
           calls `placeContributedParts(parent, pieces.sessionId, deps.composerParts.parts(),
           { owner: 'chat', noun: 'composer part', holderClass: 'chat-composer-parts', wrapperClass: 'chat-composer-part' },
           deps.log, rollback)`, so the composer's rollback disposes each built part before the next draw. A second
           call throws `composer placed contributed parts twice`, and the composer draws with `default`. When the
           composer's layout never calls it and a part is held, the parts holder is placed as the first child of
           the composer's root, since the parts sit above the box.
           **layout contract** (`layout.d.ts`, above the new `ComposerKit` member): "`div.chat-composer-parts`,
           holding one `div.chat-composer-part` (`data-part="<id>"`) per part other plugins added for every Chat
           tab, in the order they were added, each drawn for the tab's session; returns the
           `div.chat-composer-parts`. Call it once, where the parts go: a composer that leaves it out gets the
           parts first in its element. A part that throws is logged and draws nothing. A second call throws
           `composer placed contributed parts twice`, so the composer draws with `default`."
           **default layout** (`layouts/default/layout.js`, `composer`): `kit.contributedParts(panel)` first, then
           `kit.attachments(panel)`, `kit.box(panel)`, `kit.bar(panel)`. Its comment becomes "The glass panel:
           other plugins' parts, the attached images, the box, then the bar." When `layout.test.ts`'s `fakeKit`
           lacks the member and a test draws the composer, add it there as a recording stub.
           **CSS** (`chat.css`): `.chat-composer-parts` is a column with no gap of its own;
           `.chat-composer-parts:empty` is `display: none`, so a Chat tab with no part shows no space. Use only the
           tokens `DESIGN.md` names.
           **self-test**: chat's self-test (`src/plugins/chat/main/selftest-script.ts`) does not change: no key or
           view it checks changes. The workflow self-test (10) proves the strip draws.
GIVEN a session chat does not hold WHEN another plugin calls main `send` or `clear` with its id THEN the promise
rejects naming the id, and no process gets a message
GIVEN a held session WHEN main `clear` resolves THEN the harness has started a second process for it
GIVEN two composer parts added in order WHEN a Chat tab's composer draws with `default` THEN the panel's first child
is `div.chat-composer-parts` holding the two wrappers in add order, each built with the tab's session id
Tests:     `chat/main/start.test.ts`, in `describe('chat main part')`, over `startChatPart()` (its fake process gains
           `end` and `interrupt` stubs, and its harness counts `start` calls, as `clear` needs):
           - `exports_$method_SessionChatDoesNotHold_Rejects`, an `it.each` with rows `send` and `clear`, each for
             `row-9` (never opened) and for the open preview's row: rejects with `chat holds no session <id>`;
             `processSends` is not called and `start` is not called again. It catches an export that skips the
             check and acts on a relay or preview row.
           - `exports_Send_WritesToTheProcess`: after `start`, `exports.send('row-1', { text: '/wigley:make /p', images: [] })`
             resolves and `processSends` got that message once. It catches an export not wired to `chat.send`.
           - `exports_Clear_ResolvesAfterTheFreshStart`: after `start` and one send, `exports.clear('row-1')`
             resolves, and by then the harness's `start` ran twice. It catches a resolve before the restart, or a
             clear that never restarts.
           `chat-preview.test.ts`: its import changes to `CHAT_PREVIEW_HOST_ID`; no assertion changes.
           `chat-commands.test.ts`: `fillComposer_$case`, an `it.each` over `setUp(shown)` with the fake tabs
           gaining a recording `reveal`:
           - `held session`: the box held `draft`; `fillComposer(deps, shown.sessionId, '/wigley:feature ')` leaves
             the box at `/wigley:feature `, the attachments as they were, and `reveal` called once with the id
           - `unknown session`: `fillComposer(deps, 'other', 'x')` leaves the box at `draft`, calls no `reveal`, and
             logs `fillComposer for unknown session other ignored`
           They catch a text appended to the draft in place of replacing it, and a fill with no reveal.
           `composer-kit.test.ts`:
           - `composer_ContributedParts_BuiltInAddOrderAboveTheBox`: the third GIVEN, with two recording parts; on
             a second `drawComposer` the first draw's parts are disposed before the parts build again. It catches a
             part not handed the session id, parts built twice without a dispose, and parts placed under the box.
           - two rows in `composerParts_PieceLeftOutOrPlacedTwice_KeysStillReachTheBox`: `a composer that never
             calls kit.contributedParts`, with one part held: the layout stays `mine` and the parts holder is the
             root's first child; `a composer that calls kit.contributedParts twice`: the layout is `default` and the
             log is `layout mine composer failed: composer placed contributed parts twice`. Where the table asserts
             pieces at the end of the root, the parts row asserts the holder at the start instead; add a field to
             the row for it.
           `contributed-parts.test.ts`: the three moved cases of `session-part-store.test.ts`, unchanged. Sessions'
           `sessions-parts.test.ts` runs unchanged and proves the moved placement.
Done when: compiles; the test gate runs `chat/main/start.test.ts`, `chat-preview.test.ts`, `chat-commands.test.ts`,
           `composer-kit.test.ts`, `layouts/default/layout.test.ts`, `contributed-parts.test.ts` and
           `sessions-parts.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof

Commit bbdee57 · proof: diff read: send, clear, fillComposer, addComposerPart, ChatComposerPart, CHAT_PREVIEW_HOST_ID, composer contributedParts slot, shared contributed-parts present; typecheck and lint clean; chat/sessions/shared tests 1751 pass · concerns: sessions-parts.test.ts and chat layout.test.ts changed beyond the Files line (imports and one slot-order assertion); forms keeps its own part store (src/plugins/forms/page/contributions.ts), a candidate to move onto the shared helper
