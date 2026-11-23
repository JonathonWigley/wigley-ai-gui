# 07 — Session parts: the row line, the `building` activity, the hub section and the offer card

Status: not started
Type: Task
Rung: hard · many parts on the sessions and chat seams (row part, activity, side part, composer part with a stop), each following a named pattern
Wave: 3 · Depends on: 03 (shared path `src/plugins/builds/main/start.ts`), 06
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/builds/page/session-parts.ts` — the row part, the activity, the hub side part, the offer composer part and its stop
- create `src/plugins/builds/page/session-parts-model.ts` — the pure rules below
- create `src/plugins/builds/main/session-demo-step.ts` — the main half of the Session builds demo step
- modify `src/plugins/builds/main/start.ts` — register that main half; register the layout contract text
- modify `src/plugins/builds/page/start.ts` — start the session parts; one demo source for the view and the parts
- modify `src/plugins/builds/page/demo-sample.ts` — the sample session's builds and offer
- modify `src/plugins/builds/page/demo-steps.ts` — the page half of step `builds.session`
- modify `src/plugins/builds/manifest.ts` — the commands and scope below
- modify `src/plugins/builds/layouts/layout.d.ts` — the parts below
- modify `src/plugins/builds/layouts/default/layout.js`, `src/plugins/builds/layouts/default/layout.css`
- modify `src/plugins/builds/page/layout/read-builds-layout.ts` — the new parts in `LAYOUT_PARTS`
- modify `src/plugins/keymap.ts` — the binds below
- modify `docs/features/layouts/design.md` — the `builds` row in § Adopters names the new surfaces
- test `src/plugins/builds/page/session-parts-model.test.ts`
- test `src/plugins/builds/page/start.test.ts` (modify)

Patterns: the row part and the activity follow `src/plugins/chatroom/page/start.ts` (`addRowPart` with a held
wrapper per session, `setActivity` per row, `followRows`, a log line per change); the hub section follows
`src/plugins/agent-skills/page/start.ts` and `src/plugins/live-view/page/live-section.ts` (`chat.addSidePart`); the
offer card and its stop follow `src/plugins/agent-strip/page/agent-strip.ts` (`chat.addComposerPart` with `stop`,
`ComposerStopExits`) and its binds in `keymap.ts` (`agent-strip.strip`). The main demo half follows
`src/plugins/unity-pool/main/demo-steps.ts`.

Consumes:
- `buildsSessionsSlot`, `buildsSnapshotSlot`, `SessionBuilds`, `BuildOffer`, `BuildRef`, `BuildRecord` ← 02
- `kindLabel(game, kind)` and `shortRevision(sha)` in `src/plugins/builds/builds-model.ts` ← 02
- `BuildsChannel` methods `queueOffer(sessionId)` and `dismissOffer(sessionId)`, called as
  `api.channel.invoke('queueOffer', sessionId)` and `api.channel.invoke('dismissOffer', sessionId)` ← 02
- `buildRecord(overrides?)`, `gameEntry(overrides?)` in `src/plugins/builds/contract.test-support.ts` ← 02
- the builds main part's `start` in `src/plugins/builds/main/start.ts` ← 03
- `buildsPagePart`, `BuildsLayout`, `readBuildsLayout`, `linkedBuilds`, the page's demo sample and step
  `builds.mode` ← 06
- `sessionsPageKey` (`addRowPart`, `setActivity`, `shownSessionId`, `activate`), `sessionsRowsSlot`, `followRows`,
  `RowActivity` (`src/plugins/sessions/contract.ts`, in the tree)
- `chatPageKey` (`addSidePart`, `addComposerPart`, `showHubForNow`), `ChatSidePart`, `ChatComposerPart`,
  `ComposerStop`, `ComposerStopExits` (`src/plugins/chat/contract.ts`, in the tree)

Produces:
- in `src/plugins/builds/page/session-parts-model.ts`:
  - `export const BUILDING_ACTIVITY: RowActivity = { word: 'building', tone: 'running', rank: 18 }`
  - `export function rowLineInput(builds: SessionBuilds | undefined, snapshot: BuildsSnapshot): RowLineInput | null`
  - `export function isBuilding(builds: SessionBuilds | undefined, snapshot: BuildsSnapshot): boolean`
  - `export function hubBuildInputs(builds: SessionBuilds | undefined, snapshot: BuildsSnapshot): HubBuildInput[]`
  - `export function offerCardInput(sessionId: string, offer: BuildOffer, snapshot: BuildsSnapshot): OfferCardInput`
  - `export function findRecord(snapshot: BuildsSnapshot, ref: BuildRef): { record: BuildRecord; view: GameView } | null`
- `export function startSessionParts(deps: SessionPartsDeps): SessionParts` in `src/plugins/builds/page/session-parts.ts`,
  where `SessionParts` has `changed(): void` (redraw every held part and set every activity), `queueOffer(): void`,
  `dismissOffer(): void`, `queueSessionOffer(sessionId: string): void`, `dismissSessionOffer(sessionId: string): void`,
  `leaveOffer(): void`, `offerToBox(how: 'insert' | 'append'): void`, `dispose(): void`
- `export function registerSessionDemoStep(services: MainServices): Disposable` in
  `src/plugins/builds/main/session-demo-step.ts`
- step `builds.session`, page half in `src/plugins/builds/page/demo-steps.ts`, main half in
  `src/plugins/builds/main/session-demo-step.ts`
- in `src/plugins/builds/layouts/layout.d.ts`:

```ts
export interface RowLineInput {
  gameLabel: string; kindLabel: string; number: string | null;
  state: 'queued' | 'running' | 'finished'; result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null; leftMs: number | null;
}
export interface HubBuildInput {
  gameLabel: string; kindLabel: string; number: string | null;
  branch: string; shortRevision: string | null;
  state: 'queued' | 'running' | 'finished'; result: 'success' | 'failure' | 'cancelled' | null;
  jobs: BuildDetailInput['jobs']; links: { label: string; url: string }[];
}
export interface OfferCardInput {
  sessionId: string; gameLabel: string; choiceLabel: string;
  branch: string; shortRevision: string | null; subject: string | null;
}
// added to BuildsLayout:
  rowLine?(parent: HTMLElement, input: RowLineInput, kit: BaseKit): HTMLElement;
  hubBuild?(parent: HTMLElement, input: HubBuildInput, kit: BaseKit): HTMLElement;
  offerCard?(parent: HTMLElement, input: OfferCardInput, kit: BaseKit): HTMLElement;
```

Kit scopes: `rowLine` and `hubBuild` `builds.list`; `offerCard` `builds.offer`. The app sets `is-cursor` on the
`offerCard` root while the card's stop holds the entry cursor.

## Manifest additions

Add to `buildsManifest.commands`, each `runsIn: 'page'`:

| Command | Label | Group | Arg |
|---|---|---|---|
| `queueOffer` | `queue the session's build offer` | `build` | none |
| `dismissOffer` | `dismiss the session's build offer` | `build` | none |
| `queueSessionOffer` | `queue this build offer` | `build` | `'string'` (a session id) |
| `dismissSessionOffer` | `dismiss this build offer` | `build` | `'string'` (a session id) |
| `leaveOffer` | `back to the entries` | `offer` | none |
| `offerFocusBox` | `type a message` | `offer` | none |
| `offerAppendBox` | `append to the message` | `offer` | none |

Add the scope `offer: 'On a build offer card'`. The header comment names the two click commands, which have no key.

## Keymap additions (`src/plugins/keymap.ts`)

- `groups`: `'<Leader>m': 'build'`, after `'<Leader>k'`.
- `{ keys: '<Leader>mm', scope: 'any', command: 'builds.queueOffer' }`,
  `{ keys: '<Leader>mx', scope: 'any', command: 'builds.dismissOffer' }`, beside 06's `<Leader>mq`.
- Scope `builds.offer`: `<CR>` `builds.queueOffer`, `x` `builds.dismissOffer`, `k` `builds.leaveOffer`, `<Esc>`
  `builds.leaveOffer`, `i` `builds.offerFocusBox`, `a` `builds.offerAppendBox`.
- `'builds.offer'` joins the `<C-n>` `chat.startNewSession` scope list, after `'builds.list'`.

Decisions:
- Row line, through sessions' `addRowPart`, part id `builds.row`: the session's newest build (the first ref of
  its `SessionBuilds.builds`) — game, kind, number, a progress bar and time left while it runs, its result after it
  ends — until the session's next build replaces it (design.md § Sessions). A newest ref that the snapshot does not
  hold draws nothing; a session with no builds draws nothing, and its wrapper takes no room. The default
  `layout.css` sets `order: 2; flex: 0 1 auto; min-width: 0` on `.session-row-part[data-part='builds.row']`, so the
  line draws on its own line under the row (sessions contract, `addRowPart`).
- The kind text: task 02's `kindLabel(game, kind)` when `kind` names a kind of the game, else the set's
  `label` when `kind` names a set, else the id. A game missing from the snapshot gives `gameLabel` the
  game id. The short revision is task 02's `shortRevision(sha)`; define neither rule here.
- Activity, source id `builds`: `BUILDING_ACTIVITY` (`building`, tone `running`, rank 18) while a build linked to
  the session is not `finished`, null otherwise (design.md § Sessions). Rank 18 sits over a workflow stage (15) and
  `done` (10) and under chat's `working` (20), so a session that works shows `working` and a session that waits on its
  build shows `building`. Decided. The page sets each activity on every change of `buildsSessionsSlot`,
  `buildsSnapshotSlot` and `sessionsRowsSlot`, clears the activity of a session that left `buildsSessionsSlot`, and
  logs `activity in <row label>: building` or `: none` on each change, as chatroom logs.
- Hub section, through chat's `addSidePart`: `{ id: 'builds.hub', title: 'Builds', order: 20 }`, after Live (15)
  and before Skills (30). It draws one `hubBuild` per linked build, newest first: branch, short revision, per-job
  progress, links (design.md § Sessions). A session with no linked build draws no child, so its section hides. It
  sets no summary. Decided.
- Offer card, through chat's `addComposerPart`, part id `builds.offer`: the game, the kind or set, the branch, the
  branch's origin head (`offer.revision`, short) and its subject, a `Queue` button
  (`kit.button(parent, 'Queue', 'builds.queueSessionOffer', { arg: sessionId })`) and a `Dismiss` button
  (`builds.dismissSessionOffer`, same arg) (design.md § Offers). A session with no offer draws nothing.
- The card's stop: `enter(sessionId, exits)` returns false while the session has no offer; else it holds
  `{ sessionId, exits }`, sets the base scope `offer` through `api.keys.setScope`, marks the card `is-cursor` and
  returns true. `leave(sessionId)` drops the hold and the mark and sets no scope. `leaveOffer` runs
  `exits.toEntries()`, `offerFocusBox` `exits.toBox('insert')`, `offerAppendBox` `exits.toBox('append')`, as the
  agent strip does.
- Two composer stops share one cursor. Chat offers the entry cursor to each part with a `stop` in add order, and
  `src/plugins/page.ts` adds `buildsPagePart` (after `unityPoolPagePart`) before `agentStripPagePart`. So while an
  offer shows, the offer card's stop takes `j` from the last entry, and `j` does not reach the agent strip's stop.
  Once the offer is queued or dismissed, `j` from the last entry reaches the agent strip's stop again. Decided:
  an offer is short-lived and sits at the end of a workflow, so the strip loses its stop only for that short time.
- The hold ends when the held session's offer ends, whatever ends it. On each change of `buildsSessionsSlot` where
  the held session's `offer` becomes null, the stop drops the hold and runs `exits.toEntries()`. This covers `Enter`
  and `x` on the stop, `<Leader>mm` and `<Leader>mx`, a click on the card's `Queue` or `Dismiss` button, and main
  dropping the offer (an offer replaced, a restart). Decided: otherwise the user's cursor stays on a card that is
  gone.
- A `{ problem }` answer keeps the hold, since the card still shows. A rejected `channel.invoke` also keeps the
  hold: it toasts the error text (tone `error`) and logs `<command> failed: <error text>`.
- While the stop holds a session, each draw of that session's card sets `is-cursor` on the new card root.
- `queueOffer` and `dismissOffer` (`<Leader>mm`, `<Leader>mx`, and `Enter` / `x` on the stop) act on the stop's
  held session, else on `sessions.shownSessionId()` (the focused session). No session, or a session with no offer,
  toasts `No build offer in this session` (tone `warning`) and invokes nothing (design.md § Commands, § Offers).
  `queueOffer` invokes `channel.invoke('queueOffer', sessionId)`: `{ problem }` toasts the problem (tone `error`),
  `{ ok: true }` logs `queued the build offer in <row label>`. `dismissOffer` invokes
  `channel.invoke('dismissOffer', sessionId)`. Neither runs `exits.toEntries()` itself: the stop runs it when main
  drops the offer and `buildsSessionsSlot` changes (the hold decision above).
- Each part redraws into its own wrapper on each change of `buildsSessionsSlot` (the key of its session),
  `buildsSnapshotSlot` and the layout set, since sessions and chat build a part only at their own draws.
- One demo source: `page/start.ts` holds the demo sample as `{ snapshot, sessions } | null`; 06's view and these
  parts read the snapshot and the session builds through it, so both steps draw sample data and real state stays
  untouched (docs/features/demo/design.md § Real state stays untouched).
- Activity is page-wide state that sessions keeps. While the demo sample shows, the page sets activity only for the
  demo session. It leaves the activity of every other session as it was. When the sample drops, the page sets every
  activity from real state again. Decided: the demo must not change what a real session shows
  (docs/features/demo/design.md § Real state stays untouched).
- Demo step `builds.session`: section `sessions`, order 190 (170 is `usage.meters` and 180 is `usage-tab-line`;
  a tie leaves the catalog order to registration order), title `Session builds`, caption `A session shows the
  builds it queued on its row and in its hub, and offers a build above its composer.`, files
  `src/plugins/builds/page/session-parts.ts`, `src/plugins/builds/page/start.ts`,
  `src/plugins/builds/main/start.ts`, `src/plugins/builds/layouts/default/layout.js`. The main half launches
  `context.launchSession('Fix the jump arc')` and returns `{ sessions: { build: rowId }, dispose() {} }`. The page
  half reads `context.sessions.build` (throws `builds.session: no demo session` when absent), sets the sample: that
  session links a running build (Dev, 60 %, 7 min left) and a finished `success` build, and holds an offer (Release on
  `protos/game`). One beat (`session`) runs `sessions.activate(rowId)` and holds `chat.showHubForNow('builds.hub')`.
  While the sample shows, queueing or dismissing the demo session's offer invokes nothing and logs
  `demo: <command> does nothing`. The stage's dispose drops the sample and the hub hold.
- `main/start.ts`: `registerSessionDemoStep(api.services)` with its Disposable undone at stop; and
  `api.layouts.register({ layoutTypes })`. 03 registers no layout contract, so 07 always adds this call. Write it with `import layoutTypes from '../layouts/layout.d.ts?raw'`, as
  `src/plugins/chatroom/main/start.ts` does.
- `docs/features/layouts/design.md` § Adopters: the `builds` row adds `the line under each session row with a build;
  the session hub's Builds section; the build offer card above the Chat composer`.

GIVEN session `s1` links a running build WHEN the build's state moves to `finished` THEN the page sets activity
`building` for `s1`, then null.
GIVEN the offer card's stop holds session `s2` and Sessions mode shows `s1` WHEN `<CR>` runs `builds.queueOffer`
THEN the page invokes `queueOffer` with `s2`.
GIVEN no session is focused WHEN `<Leader>mm` runs THEN nothing is invoked and the toast reads
`No build offer in this session`.
GIVEN a session with no offer WHEN chat offers the card the entry cursor THEN `enter` returns false.

Tests:
- `session-parts-model.test.ts`, `describe('rowLineInput')`: `it.each` — builds undefined → null; refs `[]` → null;
  newest ref absent from the snapshot → null; newest running, percent 40, `leftSeconds` 300 → `{ gameLabel: 'Rocket
  Run', kindLabel: 'Dev', number: '331', state: 'running', result: null, percent: 40, leftMs: 300000 }`; newest
  finished `failure` over an older running build → `state: 'finished', result: 'failure'`.
- `describe('isBuilding')`: `it.each` — undefined → false; one finished → false; one running → true; one queued →
  true; a ref absent from the snapshot → false.
- `describe('hubBuildInputs')`: refs `[b3, b9, b1]` with `b9` absent → inputs for `b3`, then `b1`.
- `describe('offerCardInput')`: `it.each` — kind `dev` → `choiceLabel` `Dev`; kind `rc` (a set) → `RC set`; game
  absent from the snapshot → `gameLabel` the game id and `choiceLabel` the kind; revision `abcdef1234` →
  `shortRevision` `abcdef12`; revision null → null.
- `start.test.ts`, `describe('buildsPagePart')`, rows added, over the fake `sessions` (records `setActivity`,
  answers `shownSessionId`) and the fake `chat` (records the side and composer parts):
  - `it('sets building while a linked build runs, then clears it')` — `setActivity` calls `('s1', 'builds',
    { word: 'building', tone: 'running', rank: 18 })`, then `('s1', 'builds', null)`.
  - `it.each` `'queueOffer acts on $where'` — the stop holds `s2`, `shownSessionId` `s1` → `queueOffer` `s2`;
    no hold, `shownSessionId` `s1` → `s1`; no hold, `shownSessionId` null → no invoke and the toast.
  - `it('dismisses the focused session's offer')` — `dismissOffer` with `s1`.
  - `it.each` `'the stop with $offer'` — no offer → `enter` returns false; an offer → true.
  - `it('queues nothing for the demo session')` — after `builds.session`'s `enter`, `queueOffer` for the demo
    session invokes nothing and logs `demo: queueOffer does nothing`.
  - `it.each` `'$command leaves the stop through exits'` — the stop holds `s2` with a fake `exits`: `leaveOffer` →
    `toEntries()` once; `offerFocusBox` → `toBox('insert')` once; `offerAppendBox` → `toBox('append')` once.
  - `it('queues and dismisses the session its arg names')` — the stop holds `s2`: `queueSessionOffer('s1')` →
    `queueOffer` invoked with `s1`; `dismissSessionOffer('s1')` → `dismissOffer` invoked with `s1`; `toEntries()`
    is not called.
  - `it('keeps the hold on a problem')` — the stop holds `s2`, and `queueOffer` answers
    `{ problem: 'Local has a problem' }`: the toast reads `Local has a problem` (tone `error`), and `toEntries()` is
    not called.
  - `it('ends the hold when the held offer goes')` — the stop holds `s2`; key `s2` of `buildsSessionsSlot` changes
    to `{ builds: [], offer: null }` → `toEntries()` once; then `<CR>` with `shownSessionId` `s1` → `queueOffer`
    invoked with `s1`.
  - `it('drops the hold on leave')` — `enter('s2', exits)` then `leave('s2')`; then `<CR>` with `shownSessionId`
    `s1` → `queueOffer` invoked with `s1`; the `setScope` calls are `['offer']` only (from `enter`).
  - `it('clears the activity of a session that left the slot')` — `s1` links a running build, then key `s1`
    leaves `buildsSessionsSlot` → the last `setActivity` call is `('s1', 'builds', null)`.
  - `it('sets activity only for the demo session while the sample shows')` — real session `s1` links a running
    build; after `builds.session`'s `enter` with demo row `d1`, `setActivity` gets `('d1', 'builds',
    { word: 'building', tone: 'running', rank: 18 })`, and no `setActivity` call for `s1` follows the `enter`.
- `src/plugins/keymap.test.ts` `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` (existing) runs over the new
  binds.
- The row line's place under the row, the hub section's look and the card's look and cursor mark are no asserts:
  task 10 "Final verification" checks them live.

Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the tests above. Every live, visual and
drive check goes to task 10 "Final verification".
Commit: one commit for the group: `builds: session row line, building activity, hub section and offer card`.

## Proof
