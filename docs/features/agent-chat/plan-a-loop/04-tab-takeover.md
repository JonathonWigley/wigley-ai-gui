# 04 — Sessions page: takeOver, and forms taking over

Status: done
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/page/tabs.ts`
           · test `src/plugins/sessions/page/tabs.test.ts` · modify `src/plugins/sessions/page/session-tabs-view.ts`
           · modify `src/plugins/forms/page/forms-view.ts`
Consumes:  members the tree holds: `TabsState`, `tabsAfterSelect`, `tabsAfterRemove` (`page/tabs.ts`);
           `mountSessionTabsView` and its private `select` and `liveTab` (`page/session-tabs-view.ts`);
           `SessionTabHandle` (`contract.ts`); `syncRoundViews`, `destroyRoundView`, `destroySessionRoundViews`
           (`forms/page/forms-view.ts`). Waits on 03 only because both edit `src/plugins/sessions/contract.ts`.
Produces:  `src/plugins/sessions/contract.ts`: `SessionTabHandle.takeOver(): { release(): void }`
           `src/plugins/sessions/page/tabs.ts`:
             `export interface TakeOver { tabId: string; previousTabId: string | null }`
             `export function tabsAfterTakeOver(tabs: TabsState, tabId: string): { tabs: TabsState; takeOver: TakeOver }`
             `export function tabsAfterRelease(tabs: TabsState, takeOver: TakeOver): TabsState`
Decisions: `takeOver` on a tab handle; forms takes over where it calls `select()` today and releases when the round
           leaves (design review; design.md Sessions and tabs; AGENTS.md **A session tab**)
           · **Rule** (pure, in `tabs.ts`): `tabsAfterTakeOver` remembers `previousTabId = tabs.selectedTabId` (null
             when none is selected) and returns `tabsAfterSelect(tabs, tabId)`. `tabsAfterRelease` returns
             `tabsAfterSelect(tabs, previousTabId)` only when `tabs.selectedTabId === takeOver.tabId`, `previousTabId`
             is non-null and `tabs.tabIds` still holds it; otherwise it returns `tabs` itself (same value), so the
             view can skip its redraw by identity, as `select` does today.
           · **Stacking**: each take over remembers what was selected when it took over, and each release follows
             the rule above on its own. Form takes over from Chat, then Docs from Form: releasing Docs then Form gives
             Form then Chat; releasing Form first changes nothing (Docs is selected), and Docs' release then gives
             Form.
           · **A tab taking over while already selected** remembers itself, so its release changes nothing.
           · **View** (`session-tabs-view.ts`): the handle's `takeOver()` on a live tab applies `tabsAfterTakeOver`
             to its session's tabs and runs `changed()` when the value changed (so `shown` reaches the tab when its
             session shows, as `select` does). It returns `{ release }`, whose first call, when the tab is still live
             (`liveTab`), applies `tabsAfterRelease` and runs `changed()` when the value changed; every later call
             does nothing. `takeOver()` on a dropped or removed tab selects nothing and returns a release that does
             nothing. A release after its tab dropped or was removed does nothing.
           · **Selection only inside the session**: like `select()`, `takeOver` never changes the selected session.
             A round for a session not on screen therefore takes over inside that session, and main's `mark` (called
             by forms' presenter) marks its row; the user's current session stays on screen — today's behaviour.
           · **Forms** (`forms-view.ts`): `mountFormsView` keeps `takeOvers: Map<string, { release(): void }>` by round
             id. In `syncRoundViews`, `formTab.handle.select()` becomes `takeOvers.set(round.roundId,
             formTab.handle.takeOver())`. `destroyRoundView` calls the round's release and deletes it from the map
             after removing the view, so the round leaving by submit, cancel or main's `roundClosed` gives the session
             back, and `forgetSession`'s destroys (tabs already dropped) release to no effect. One release per round:
             the map entry goes with its first release. `showForm` (guardClose's path) keeps `select()`.
           · Contract comment on `SessionTabHandle` adds: "`takeOver` selects the tab inside its session and returns
             a release; the first release selects the tab selected before the take over, unless another tab was
             selected since or that tab is gone."
GIVEN a session showing its Chat tab WHEN forms opens a round there THEN the Form tab is selected; WHEN the round is
      submitted or cancelled THEN the Chat tab is selected again
GIVEN the user moved from the Form tab to another tab during the round WHEN the round ends THEN the selection stays
      where the user put it
GIVEN two stacked take overs WHEN they release in either order THEN each gives back only while its own tab is
      selected
GIVEN a tab taken over and later removed WHEN its release runs THEN nothing changes
Tests:     in `src/plugins/sessions/page/tabs.test.ts`, inside `describe('tabs')`:
           `tabsAfterTakeOver selects the tab and remembers the one selected before` — from `{ tabIds: ['chat',
             'form'], selectedTabId: 'chat' }` and `'form'`: `tabs` equals `{ tabIds: ['chat', 'form'],
             selectedTabId: 'form' }`, `takeOver` equals `{ tabId: 'form', previousTabId: 'chat' }`
           `tabsAfterRelease gives the session back while the taking tab is selected` — that result released:
             `{ tabIds: ['chat', 'form'], selectedTabId: 'chat' }`
           `tabsAfterRelease keeps a selection the user moved since` — `{ tabIds: ['chat', 'form', 'docs'],
             selectedTabId: 'docs' }` with `{ tabId: 'form', previousTabId: 'chat' }`: returns the same value
             (`toBe`)
           `tabsAfterRelease keeps the selection when the remembered tab is gone` — `{ tabIds: ['form'],
             selectedTabId: 'form' }` with `{ tabId: 'form', previousTabId: 'chat' }`: returns the same value
           `tabsAfterRelease changes nothing once the taking tab was removed` — take over `'form'` from `'chat'` in
             `['chat', 'form', 'docs']`, then `tabsAfterRemove(…, 'form')` (selects `'docs'`), then release: returns
             that same value, `selectedTabId` `'docs'`
           `tabsAfterTakeOver with none selected remembers none, and its release keeps the selection` — from `{
             tabIds: ['form'], selectedTabId: null }`: `takeOver.previousTabId` `null`; release of `{ tabIds: ['form'],
             selectedTabId: 'form' }` returns that same value
           `tabsAfterTakeOver of the selected tab remembers itself, and its release changes nothing` — from `{ tabIds:
             ['chat', 'form'], selectedTabId: 'form' }`: `tabs` is the same value, `previousTabId` `'form'`, release
             returns the same value
           `stacked take overs each give back what they took` — `['chat', 'form', 'docs']` on `'chat'`; form takes
             over, then docs: releasing docs gives `'form'`, then releasing form gives `'chat'`; in the other order,
             releasing form first returns the same value (`'docs'` selected), then releasing docs gives `'form'`
           The view's once-only release, the dead-tab no-ops and forms' wiring run in DOM code the suite cannot reach
           (vitest runs without a DOM; `session-tabs-view.ts` and `forms-view.ts` have no tests, measured at plan time,
           re-verify): task 13's check 5 (**Form swap**: submit, then cancel, each giving back the Chat tab) and check
           6 (**Round for another session**) carry them live.
Done when: compiles; `grep -c "formTab.handle.select()" src/plugins/forms/page/forms-view.ts` → 0 (the remaining
           `select()` is `showForm`'s `formTabs.get(sessionId)?.handle.select()`); the test gate runs the tests above
Commit:    one commit for the group

## Proof

c70ed85 · diff read: `takeOver` on the contract and the handle, `TakeOver`, `tabsAfterTakeOver` and `tabsAfterRelease` in `tabs.ts`; forms keeps a release per round; `grep -c "formTab.handle.select()"` → 0; typecheck and the layer check pass at f83d324. Concern: a private `setTabs` helper was extracted in `session-tabs-view.ts` and is shared by `select` and `takeOver`.
