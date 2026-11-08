# 06 — Chat tab panes: transcript, box and session hub on the focus keys

Status: not started
Type: Task
Wave: 6 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start.ts` ·
           modify `src/plugins/chat/page/side-sections.ts` · modify `src/plugins/chat/manifest.ts` ·
           modify `src/plugins/chat/page/chat-commands.ts` (the `Omit` list of `chatCommandHandlers` only) ·
           modify `src/plugins/chat/page/chat.css` · modify `src/contracts/editor.ts` ·
           modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` · modify `src/plugins/keymap.ts` ·
           modify `src/plugins/chat/main/selftest-script.ts` ·
           test `src/plugins/chat/page/chat-view.test.ts` · test `src/plugins/chat/page/side-sections.test.ts` ·
           test support `src/shared/page/test-dom.ts` (`getClientRects` on `FakeElement`)

Beyond plan.md's File Structure row for 06: `chat-commands.ts` (its `Omit` list must name the new hub commands, or
`chatCommandHandlers` fails to compile; Task 07 edits that file later, wave 7), `chat.css` (the cursor ring and the
hub handle's resize prompt), and the editor contract and host (the box leaving insert mode). The lead records these
in the Run log's Contract changes.

Consumes:  the core focus chain ← 01: a `false` from the view's `FocusTarget.move` goes on to the outer panes, then
           the side bar (left) and the right bar (right), and every base scope change resets the area to main.
           `api.panes.setFocusTarget` / `api.panes.setResizeTarget`, `FocusTarget`, `ResizeTarget`
           (`src/contracts/panes.ts`), `SplitDivider` (a `ResizeTarget`), `scrollContent` / `scrollText`
           (`src/shared/content-scroll.ts`), `textLineHeightPx` (`src/shared/page/text-line.ts`) — all in the tree.

Produces:
- `src/plugins/chat/manifest.ts`: scope `hub: 'In the session hub'` (qualified `chat.hub`); commands, group `hub`,
  `runsIn: 'page'`:
  `nextSection` ('next section'), `prevSection` ('previous section'), `firstSection` ('first section'),
  `lastSection` ('last section'), `toggleSection` ('fold or unfold the section'),
  `leaveHub` ('back to the transcript'), `hubLineDown` ('scroll the section a line down'),
  `hubLineUp` ('scroll the section a line up'), `hubHalfPageDown` ('scroll the section half a page down'),
  `hubHalfPageUp` ('scroll the section half a page up').
- `src/plugins/chat/page/chat-view.ts`:
  - `export type ChatTabScope = 'chat' | 'hub';`
  - `ChatViewDeps` gains `setFocusTarget(target: FocusTarget | null): void` and
    `setResizeTarget(target: ResizeTarget | null): void`; `onScopeChanged` becomes
    `onScopeChanged(listener: (scope: ViewScope | undefined) => void): void` (the scope in force, from `coreScopeSlot`).
  - `export interface HubKeys { move(by: 1 | -1): void; toEdge(edge: 'first' | 'last'): void; toggle(): void;
    leave(): void; scroll(step: ScrollStep, direction: 1 | -1): void; hiddenChanged(): void; }`, each acting on the
    visible Chat tab's hub.
  - `ChatTabs` gains `hub: HubKeys`.
- `src/plugins/chat/page/side-sections.ts`:
  - `export interface SectionCursor { isReachable(): boolean; enter(): string | null; move(by: 1 | -1): string | null;
    toEdge(edge: 'first' | 'last'): string | null; toggle(): string | null;
    scrollBy(step: ScrollStep, direction: 1 | -1): { title: string; scroll: ContentScroll } | null; }`
  - `SideTab` gains `divider: ResizeTarget` (the hub's width divider) and `cursor: SectionCursor`.
- `src/contracts/editor.ts`: `export interface BlurOptions { toNormal?: boolean; }`, and `TextEditor.blur` becomes
  `blur(options?: BlurOptions): void`.
- `src/plugins/chat/page/chat.css`: `.chat-tab.is-at-hub` (the root class while the hub holds the keys) and
  `.chat-side-section-head.is-cursor` (the cursor's head).

Names Task 07 must keep: `ChatTabScope`, the `Omit` entries for the ten hub commands in `chatCommandHandlers`, the
`is-at-hub` class (the transcript's left bar hides under it, as under `is-at-stop`), and `BlurOptions`.

## Decisions

- **A key move into a Chat tab lands in normal mode** (lead, settles Task 03's seam). Task 03 makes a key move
  between Sessions' chat panes, and Sessions' `focusMain`, run `chat.focusBox` as a click does, which puts the box in
  insert mode. Once this task gives chat its own panes, a key move (`paneKeyFocused` and `focusMain` in
  `src/plugins/sessions/page/start.ts`) instead hands the Chat tab its last pane with the box in normal mode, through
  the step `shown` uses; a click keeps `chat.focusBox`. Add `sessions/page/start.ts` to this task's files, and update
  Task 03's `paneKeyFocused_RunsFocusBox` test and its `keys to pane` self-test step to the new landing.

Pane model of one Chat tab (pinned):

```
            ┌─────────────────────────┬───────────┐
            │ transcript (entries)    │           │
            │   └ composer part stop  │  session  │
            │     (agent strip)       │   hub     │
            ├─────────────────────────┤           │
            │ box                     │           │
            └─────────────────────────┴───────────┘
 Alt+l  transcript | strip | box → hub (while the hub is reachable)
 Alt+h  hub → the pane focus came from (box, else transcript)
 Alt+j  transcript | strip → box        Alt+k  box | strip → transcript
 every other move → false (outer chat panes, then the core's areas)
```

- **Where focus is** is read from the tab, in this order: the hub (`isAtHub`, a new `HeldTab` field set when chat
  takes `hub` keys and cleared when it takes `chat` keys), a composer part's stop (`stop.holding() !== null`), the
  box (`isBoxFocused`), else the transcript. Each `HeldTab` holds one `FocusTarget` built in `createTab`.
- **One helper hands the keys over.** Every place chat-view calls `deps.setScope` today (`shown`, `cursorToEntries`,
  the stop holder's `toBox` and `setChatScope`) goes through one function that calls, in this order,
  `deps.setScope(scope)`, `deps.setResizeTarget(tab.side.divider)`, `deps.setFocusTarget(tab's target)`: `setScope`
  drops both targets, so they come after it (AGENTS.md § A resize target). Taking `chat` keys clears `isAtHub`;
  taking `hub` keys sets it. No other `deps.setScope` call stays in chat-view.
- **A composer part holding the stop** also gets the targets: the holder's `changed(true)` runs after the part's
  own `setScope`, and there chat calls `setResizeTarget` and `setFocusTarget` (not `setScope`). Alt+j/k/l from the
  strip leave the part through `stop.leave()` first, then act as from the transcript (Alt+k: chat keys and
  `entries.latest()`, as `cursorToEntries` does; Alt+j: the box; Alt+l: the hub, which then returns to the transcript
  on Alt+h).
- **Alt+j from the transcript goes to the box** even while a composer part (the agent strip) offers a stop; the strip
  stays reached by `j` on the last stop, as today. Alt+j focuses the box with no `FocusOptions` (its vim mode as left,
  normal after every keyed leave) and logs `focused the box in <name>`, the line `i` logs.
- **Alt+k from the box goes to the transcript**: `box.blur({ toNormal: true })`, chat keys, the entry cursor where it
  was (no `latest()`), log `left the box` (the line Esc logs). Alt+k is a chord, so it fires inside the box in every
  vim mode (AGENTS.md § A key).
- **The box leaves insert mode on every Alt move out of it that chat makes** (Alt+k, Alt+l): `blur({ toNormal: true })`
  first drops the editor to normal mode from insert or visual, as Esc does there, then blurs as `blur()` does now. The
  host implements it through codemirror-vim's exit-insert and exit-visual calls; `blur()` with no options is
  unchanged (a box left in visual mode by a click away still keeps its mode, which the "two sessions" self-test group
  checks). The core's own moves past chat's edge (Alt+h, Alt+j from the box) are Task 01's and leave the mode alone.
- **Alt+l enters the hub only while it is reachable**: `SectionCursor.isReachable()` is true when the hub's holder
  has a layout box (`getClientRects().length > 0`: not hidden by `Space v s`, not hidden by the tab's 640 px
  container query, not hidden for holding no shown section) and at least one drawn section head has a layout box.
  Otherwise `move('right')` returns false and the press goes on to the outer panes and the right bar.
- **Entering the hub** (from the transcript, the box or the strip): leave the box or part as above, take `hub` keys,
  remember where focus came from (`'box'` from the box, `'transcript'` from the transcript or the strip), call
  `side.cursor.enter()`, focus the hub's holder (`.chat-side-parts`, given `tabIndex = -1`; it takes no outline) and
  log `focused the session hub in <name>`.
- **Alt+h from the hub returns to the pane focus came from**, as tmux returns to the most recently used pane beside
  it: the box (focused with no `FocusOptions`, log `focused the box in <name>`) or the transcript (chat keys, entry
  cursor where it was, log `cursor back on the entries in <name>`). Alt+l, Alt+j and Alt+k from the hub return false.
- **Esc in the hub always goes to the transcript** (`chat.leaveHub`), the same as Alt+h's transcript branch. Leaving
  the hub by either route blurs the holder when it holds the DOM focus.
- **`Space v s` while the hub holds the keys** gives them to the transcript: start.ts's `toggleSideParts` runs
  `sideSections.toggleHidden()` then `view.hub.hiddenChanged()`, which leaves the visible tab's hub the Esc way when
  `isAtHub` is set and the hub is no longer reachable. Logs `session hub hidden` (as now) then
  `cursor back on the entries in <name>`.
- **The cursor walks section heads only** (plan.md Decisions): the frames whose layout drew a head (`kit.head`) and
  whose head has a layout box, in hub order. A section whose part draws nothing is hidden by chat.css and skipped.
  `Frame` keeps its head element; a frame redrawn (a summary, a collapse, a layout change) while holding the cursor
  draws its new head with `is-cursor`.
- **The cursor is per tab, kept by part id** in `OpenTab`. `enter()` keeps the last cursor when its section is still
  shown, else puts it on the first shown head. A removed or hidden cursor section moves the cursor to the first shown
  head at the next `enter`, `move` or `toEdge`. `j`/`k` stop at the ends (no wrap); `gg`/`G` go to the first and last
  shown head. Each returns the cursor section's title; chat-view logs `hub cursor on <title>`.
- **Enter and `l` fold or unfold the cursor's section** through the existing `toggleCollapsed`, which already logs
  `section <title> collapsed` / `section <title> expanded` and applies to every tab; the cursor stays on that head.
- **Ctrl+j/k and Ctrl+Shift+j/k scroll the cursor's section body.** The hub column does not scroll: each section's
  `.chat-side-section-body` scrolls in its own box (chat.css), so the cursor's body is the hub content the keys move.
  The step is `scrollContent(body, step, direction, textLineHeightPx(body))`; chat-view logs
  `scrollText(\`the ${title} section\`, step, direction, scroll)`, e.g. `scrolled the Session section down a line` or
  `the Session section did not scroll down` (a collapsed or fitting body).
- **The hub divider is the resize target of all three panes** (and the strip): it is the transcript's and the box's
  right divider and the hub's left one, so Alt+Shift+h widens the hub by 24 px and Alt+Shift+l narrows it, through
  the existing `createSplitDivider` (`sizedPane: 'end'`). A hidden hub's handle has no layout box, so `nudge` returns
  false and the press passes on (AGENTS.md § A resize target). Each nudge logs `session hub width <n>` through the
  shared width state, as a drag does. The divider now names `deps.kit.keys.anchor` in place of `NO_ANCHOR`, and
  chat.css drops `.chat-side-handle > .ui-split-prompt { display: none; }`, rewriting the comment above
  `.chat-side-handle` that says no key resizes the hub: the handle's prompt shows on hover, during a drag and for a
  moment after a nudge, as every split's does (DESIGN.md § Keys and focus, Edge prompt).
- **The cursor uses the focus ring**: `.chat-tab.is-at-hub .chat-side-section-head.is-cursor` takes
  `box-shadow: inset 0 0 0 1px var(--wg-focus-border)` (DESIGN.md § Keys and focus: an inset ring on a row). The
  root carries `is-at-hub` exactly while the tab is visible, `isAtHub` is set and the scope in force is `chat.hub`;
  chat-view sets it in `onScopeChanged` from the scope value. A pushed scope over the hub (help) hides the ring, and
  its pop shows it again. The transcript's left bar hides under `is-at-hub` as it does under `is-at-stop` (the three
  rules at chat.css 216-221 and the `hr` rule at 241), so one cursor shows at a time.
- **A tab no longer visible leaves the hub**: in `onScopeChanged`, a tab whose `handle.isVisible()` is false clears
  `isAtHub`, as `stop.scopeChanged` leaves a part. `shown` takes `chat` keys, so a tab shown again (including through
  a mode's `focusMain` that re-runs `shown`) starts on the transcript.
- **AGENTS.md's "a side part takes no key scope and no stop" stays true**: `chat.hub` is chat's own scope over the
  frames chat draws; no side part's build sees it.
- **Hub commands live in start.ts's `commands`** next to `toggleSideParts`, each calling `view.hub`:
  `nextSection` → `move(1)`, `prevSection` → `move(-1)`, `firstSection` → `toEdge('first')`, `lastSection` →
  `toEdge('last')`, `toggleSection` → `toggle()`, `leaveHub` → `leave()`, `hubLineDown` → `scroll('line', 1)`,
  `hubLineUp` → `scroll('line', -1)`, `hubHalfPageDown` → `scroll('halfPage', 1)`, `hubHalfPageUp` →
  `scroll('halfPage', -1)`. `chatCommandHandlers`' `Omit` list and its comment name all ten. With no visible Chat tab
  each logs `no Chat tab shown`, the line chat's other commands log.
- **start.ts wiring**: `setFocusTarget: (target) => api.panes.setFocusTarget(target)`,
  `setResizeTarget: (target) => api.panes.setResizeTarget(target)`, and `onScopeChanged` passes the slot's value.

Keys (`src/plugins/keymap.ts`, a new banner section `── Session hub ──` after the chat section; all are vim's own
keys, so none needs an anchor):

| keys | scope | command |
|---|---|---|
| `j` | `chat.hub` | `chat.nextSection` |
| `k` | `chat.hub` | `chat.prevSection` |
| `gg` | `chat.hub` | `chat.firstSection` |
| `G` | `chat.hub` | `chat.lastSection` |
| `<CR>` | `chat.hub` | `chat.toggleSection` |
| `l` | `chat.hub` | `chat.toggleSection` |
| `<Esc>` | `chat.hub` | `chat.leaveHub` |
| `<C-j>` | `chat.hub` | `chat.hubLineDown` |
| `<C-k>` | `chat.hub` | `chat.hubLineUp` |
| `<C-S-j>` | `chat.hub` | `chat.hubHalfPageDown` |
| `<C-S-k>` | `chat.hub` | `chat.hubHalfPageUp` |

The per-scope `<C-n>` list (`chat.startNewSession`, keymap.ts ~207) gains `'chat.hub'` after `'chat.chat'`. No view
binds Alt+hjkl.

GIVEN the transcript has the keys and the hub shows WHEN Alt+l THEN the scope is `chat.hub`, the cursor ring marks a
section head and `[chat] focused the session hub in <name>` logs
GIVEN the box in insert mode WHEN Alt+k THEN the transcript has the keys, the box is in normal mode and blurred, and
one Esc after Alt+j logs `[chat] left the box`
GIVEN the hub entered from the box WHEN Alt+h THEN the box has focus and `[chat] focused the box in <name>` logs
GIVEN the hub hidden by `Space v s` WHEN Alt+l from the transcript THEN chat's target returns false and the core's
chain goes on
GIVEN the hub has the keys WHEN Alt+Shift+h THEN the hub widens 24 px and `[chat] session hub width <n>` logs

Tests:
- `chat-view.test.ts` — `chatView_FocusMove_MovesBetweenTheTabsPanes`, one `it.each` table over
  (where focus is, direction, hub reachable) → (returned, where focus is after, the scope set, the log line, the box
  call: `focus()` with no options, `blur({ toNormal: true })` or none). Rows: transcript right reachable → true, hub;
  transcript right unreachable → false, nothing set; transcript down → true, box focus; transcript left, up → false;
  box up → true, transcript, blur toNormal; box right reachable → true, hub, blur toNormal; box down, left → false;
  hub left entered from the box → true, box focus; hub left entered from the transcript → true, transcript; hub
  right, up, down → false; strip (a test composer part with a stop holding) down → true, box, the part's `leave`
  called; strip up → true, transcript, `leave` called. Break: a flipped direction, the toNormal dropped, the came-from
  pane ignored, a hidden hub entered. The `mounted()` harness gains recording `setFocusTarget` / `setResizeTarget`
  deps and a fake box recording `focus` / `blur` options; the hub's reachability comes from the fake holder's
  `getClientRects`.
- `chat-view.test.ts` — `chatView_TakingKeys_HandsBothTargetsAfterTheScope`, a table over the ways chat takes keys
  (tab shown, Esc from the hub, a stop exit `toEntries`, a stop exit `toBox`, entering the hub, a part taking the
  stop): the recorded calls end `setScope(<scope>)` (absent for the part row), `setResizeTarget(<the tab's divider>)`,
  `setFocusTarget(<the tab's target>)`, in that order. Break: targets set before `setScope`, or a site missed.
- `chat-view.test.ts` — `chatView_HubRing_FollowsTheScopeInForce`: `is-at-hub` on the visible tab's root after
  entering the hub and a `chat.hub` scope report; off on a pushed scope's report (`keys.help`), on again on
  `chat.hub`; off and `isAtHub` cleared when the tab stops being visible (Alt+h afterwards does not return to the
  hub's came-from pane). Break: the ring kept under another scope, the hub kept by a hidden tab.
- `side-sections.test.ts` — `sectionCursor_Walk_StopsAtEndsAndSkipsHiddenSections`, a table over four parts, one
  drawing nothing (no layout box), with `enter`, `move(1)`, `move(-1)`, `toEdge('first')`, `toEdge('last')` from given
  cursors → the title returned and the one head carrying `is-cursor`. Rows include `move(1)` on the last (stays),
  `move(-1)` on the first (stays), `enter` with the kept cursor's section removed (first shown head).
- `side-sections.test.ts` — `sectionCursor_Toggle_FoldsTheCursorsSectionAndKeepsTheMark`: `toggle()` writes the
  part's id to `collapsed-sections`, logs `section <title> collapsed`, and the redrawn head still carries
  `is-cursor`; a second `toggle()` logs `expanded`.
- `side-sections.test.ts` — `sectionCursor_IsReachable` table: hub hidden (`hub-hidden` true) → false; holder with no
  layout box → false; no part drawing a head → false; one shown head → true.
- `side-sections.test.ts` — `sectionCursor_ScrollBy_ScrollsTheCursorsBody`: a body taller than its box scrolls by
  its line height and reports `moved`; returns the cursor's title.
- No test for the CSS, the keymap rows or the anchor swap (copy, styling and declarations; the compiler and the
  self-test's placement check carry them). No test of the host's `toNormal` beyond the self-test step below: the host
  is codemirror-vim's own mode change, checked live.

Self-test (`src/plugins/chat/main/selftest-script.ts`): a new group `pane keys`, placed in `GROUPS` right after
`transcript scroll`, whose last step leaves chat-selftest's transcript holding the keys with the box blurred in
normal mode, the hub shown at its old width and every section expanded, as `session controls` expects. Steps, in
order (`expect` lines exact):

| keys | expect | alsoExpect | why |
|---|---|---|---|
| `<A-l>` | `[chat] focused the session hub in chat-selftest` | | Alt+l from the transcript enters the hub |
| `G` | `[chat] hub cursor on Session` | | G goes to the last section, chat's Session (order 40) |
| `j` | `[chat] hub cursor on Session` | | j on the last section stays |
| `k`, `j` | `[chat] hub cursor on Session` | `/^\[chat\] hub cursor on (?!Session$)/` | k leaves Session for the section above it, j comes back |
| `Enter` | `[chat] section Session collapsed` | | Enter folds the cursor's section |
| `l` | `[chat] section Session expanded` | | l unfolds it again |
| `<C-j>` | `[page] <C-j> ran chat.hubLineDown` | `/^\[chat\] (scrolled )?the Session section (did not scroll )?down/` | Ctrl+j scrolls the cursor's section in the hub's scope |
| `<A-S-h>` | `[page] <A-S-h> ran panes.resizePaneLeft` | `/^\[chat\] session hub width \d+$/` | the hub's divider is the resize target |
| `<A-S-l>` | `[page] <A-S-l> ran panes.resizePaneRight` | `/^\[chat\] session hub width \d+$/` | and back to its width |
| `<A-h>` | `[chat] cursor back on the entries in chat-selftest` | | Alt+h returns to the transcript it came from |
| `<A-j>` | `[chat] focused the box in chat-selftest` | | Alt+j from the transcript goes to the box |
| `<A-k>` | `[chat] left the box` | | Alt+k from the box goes to the transcript |
| `i`, `<A-k>` | `[chat] left the box` | `/^\[chat\] focused the box in chat-selftest$/` | i enters insert mode, Alt+k leaves from it |
| `<A-j>`, `Escape` | `[chat] left the box` | `/^\[chat\] focused the box in chat-selftest$/` | one Esc leaves the box, so Alt+k had left insert mode |
| `<A-j>`, `<A-l>` | `[chat] focused the session hub in chat-selftest` | `/^\[chat\] focused the box in chat-selftest$/` | Alt+l from the box enters the hub |
| `<A-h>` | `[chat] focused the box in chat-selftest` | | Alt+h returns to the box it came from |
| `Escape`, `<A-l>`, `Escape` | `[chat] cursor back on the entries in chat-selftest` | `/^\[chat\] left the box$/`, `/^\[chat\] focused the session hub in chat-selftest$/` | Esc in the hub always goes to the transcript |
| `<A-l>`, ` `, `v`, `s` | `[chat] session hub hidden` | `/^\[chat\] cursor back on the entries in chat-selftest$/` | hiding the hub hands its keys to the transcript |
| ` `, `v`, `s` | `[chat] session hub shown` | | the hub shows again for the groups after |

The group's `why`: "Alt+l and Alt+h move between the transcript or the box and the session hub, returning to the pane
they came from; Alt+j and Alt+k move between the transcript and the box, the box leaving insert mode; in the hub
G, j and k walk the section heads, Enter and l fold and unfold one, Ctrl+j scrolls it, Alt+Shift+h and l resize the
hub, Esc goes back to the transcript, and Space v s hiding the hub hands the keys back."

Done when: `npm run typecheck` and `npm run lint` pass; `npm test -- src/plugins/chat/page/chat-view.test.ts
src/plugins/chat/page/side-sections.test.ts` passes; `npm run selftest -- --plugin chat` passes with the `pane keys`
group (a filtered run skips the placement check, which Task 10's whole run carries); `grep -n "deps.setScope"
src/plugins/chat/page/chat-view.ts` finds only the one helper's call.
Commit:    one commit for the group

## Proof

