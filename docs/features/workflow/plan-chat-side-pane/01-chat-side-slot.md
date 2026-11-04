# 01 — Chat side slot

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/chat.css` · modify `src/plugins/chat/layouts/default/layout.css` · test `src/plugins/chat/page/chat-view.test.ts`
Consumes:  `createPartStore`, `placeContributedParts` in `src/shared/page/contributed-parts.ts` (in the tree)
Produces:  `export interface ChatSidePart extends ContributedPart` in `src/plugins/chat/contract.ts`
           `addSidePart(part: ChatSidePart): Disposable` on `ChatPageExports` in `src/plugins/chat/contract.ts`
Decisions:
- `addSidePart` has the rules of `addComposerPart`: it throws on an id already added, and a part draws in every Chat tab, the preview's included.
- A side part is built when its tab is built, and again when a side part is added or removed. A composer draw does not rebuild it. A part whose content changes redraws into its wrapper itself.
- A side part takes no stop and no key scope.
- The tab element becomes:
  - `div.chat-tab`: a flex row, with `container-type: inline-size` and `container-name: chat-tab`.
  - `div.chat-main`: first child, `position: relative`, `flex: 1`, `min-width: 0`, `height: 100%`. It holds the entries and the composer. `drawComposer` draws into it.
  - `div.chat-side-parts`: second child, built by `placeContributedParts`, `flex: none`.
- `--chat-composer-height` stays set on `.chat-tab`, and the classes on `.chat-tab` stay there. `.chat-main` inherits the custom property.
- Each `div.chat-side-part` wrapper holds one part, with `data-part="<id>"`. The holder's `place` is owner `chat`, noun `side part`.
- `chat.css` hides the holder while no wrapper has content, with the same `:not(:has(...))` shape as `.session-row-foot`: `.chat-side-parts:not(:has(.chat-side-part:not(:empty))) { display: none; }`.
- `layouts/default/layout.css` holds the width rule: `@container chat-tab (width < 640px) { .chat-side-parts { display: none; } }`.
- `ChatViewDeps` gains `sideParts: Pick<PartStore<ChatSidePart>, 'parts' | 'onChanged'>`. `start.ts` passes a `createPartStore<ChatSidePart>()`, and `addSidePart` calls its `add`.
- `chat.css` gives the holder a bounded height: `.chat-side-parts { display: flex; flex-direction: column; align-self: stretch; min-height: 0; }` and `.chat-side-part { flex: 1; min-height: 0; }`.
- A closed tab disposes its side parts, at the place that runs `tab.composer.dispose()`.
- Add a doc comment for `addSidePart` to the `ChatPageExports` comment block. Rewrite the `createTab`, `ChatViewDeps`, `mountChatView`, `followComposerHeight` and `chat.css` header comments for `.chat-main` and the side holder.
- Before the CSS lands, read where chat's dialogs, pickers, image viewer and key hints mount. `container-type` makes `.chat-tab` the containing block for its fixed-position descendants. When one of them mounts inside `.chat-tab`, report it as a concern and stop this task.
GIVEN a side part is added WHEN a Chat tab exists THEN the part builds into a `chat-side-part` wrapper with the tab's session id
GIVEN a Chat tab holds a side part WHEN the tab closes THEN the part's dispose runs once
GIVEN a side part's Disposable WHEN it is disposed THEN every tab disposes its build and the wrapper leaves the tab
Tests:     in `chat-view.test.ts`, `side parts build per tab, leave with their part, and dispose with their tab` — one test holds the three cases above, asserts the session id passed to `build` and a dispose count of 1 per build. The test mounts two tabs, adds a real `sideParts` store to the harness, and makes `onSessionRemoved` capture its listener so that the test can close a tab
Done when: `npm run typecheck` passes; the test gate runs the test above
Commit:    one commit for the group

## Proof

