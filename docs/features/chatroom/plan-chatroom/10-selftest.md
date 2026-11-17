# 10 — Self-test script and drive fixture

Status: not started
Type: Task
Rung: hard · adds the `chatroom.seed` drive action and its result, which 12 drives; the fixture waits on rows, titles and the board, which settle asynchronously. It follows `src/plugins/unity-pool/main/selftest-script.ts` and `selftest-fixture.ts`, and practice's `writeFixture` drive action
Wave: 5 · Depends on: 08, 09
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chatroom/main/selftest-fixture.ts` · create `src/plugins/chatroom/main/selftest-script.ts` · modify `src/plugins/chatroom/main/start.ts`
Consumes:
- the one `RoomService` that 08's `main/start.ts` builds (pass it to the script and the fixture from start), and its
  calls `post(request: PostRequest): Promise<PostResult>` (a `PostRequest` names `room`, `from`, `kind`, `body`, `to` as
  names, `thread`, `refs`, `replyTo`, `answerBy`, `onNoAnswer`, `key`; the fixture passes null for the last three) and `claim(request: ClaimRequest): Promise<ClaimResult>` (`room`, `holder`,
  `target`, `reason`, `minutes`) ← 05, 08. `post` refuses a `to` name the room does not hold, so the fixture posts
  to the titles of sessions it started.
- `chatroomRoomsSlot` (`chatroom.rooms`) and `RoomView` ← 08 (read only: the fixture waits until the room's value holds
  both board rows)
- the page log lines, scopes and keys of 09: `[chatroom] shown`, `badge in …`, `activity in …`,
  `thread shown: …`, `list cursor on …`, `log cursor on …`, `composer open: …`, `posted #<id> to …`;
  `<Leader>kc`; scopes `threads`, `log`, `composer` ← 09
- `ChatMainExports.launch` (`src/plugins/chat/contract.ts`), `SessionsMainExports.activate`, `sessionsRowsSlot`
  (`SessionRow.project`, `SessionRow.label`) — in the tree
- `SelfTestScript`, `SelfTestGroup`, `DriveHost` (`src/contracts/plugin.ts`) — in the tree
Produces:
- `export function chatroomSelfTestScript(deps: ChatroomSelfTestDeps): SelfTestScript` in `main/selftest-script.ts`
- `export async function seedChatroomFixture(deps: ChatroomFixtureDeps, projectDir: string): Promise<ChatroomFixture>`
  in `main/selftest-fixture.ts`, with `ChatroomFixture { room: string; rowIds: readonly [string, string];
  titles: readonly [string, string]; thread: string; questionId: number }`
- the drive action `chatroom.seed` (args `{ projectDir?: string }`), registered in `main/start.ts` through
  `api.drive?.add('seed', …)`
Decisions:
- **Fixture** (one module, which the script and the drive action share):
  1. Make `projectDir` (`<home>/chatroom-selftest` for the self-test, `<home>/dev/chatroom-drive` by default for
     a drive run).
  2. Launch the lead through `chat.launch` on profile `work`, first message `chatroom lead`. Wait for its launch to
     resolve. Then launch the peer the same way, first message `chatroom peer`. A first message gives the row its
     title, as unity-pool's self-test script does (`unity-pool/main/selftest-script.ts`, its `open`). The launch order fixes the row labels: both rows share one folder, and
     `SessionRow.label` is the folder's last segment with a counter. Pin them as constants:
     `LEAD_LABEL = 'chatroom-selftest'` and `PEER_LABEL = 'chatroom-selftest 2'`. Every `badge in` and `activity in`
     line below names the peer by `PEER_LABEL`, not by its title.
  3. Wait until all of these hold, in this order, and fail with a named error after the step wait:
     (1) both rows are in `sessions.rows`, with equal `project`; (2) both titles are set (`chatroom lead`,
     `chatroom peer`); (3) the room's `chatroom.rooms` value holds both board rows. The room name is that
     `project`. Take `titles` from those rows. If the two rows have different projects, throw `the chatroom
     fixture's rows are in two rooms`.
  4. Post in thread `plan-demo`, in this order. Every `post` and `claim` call that returns `ok: false` makes the
     fixture throw `fixture post refused: <reason>` (`fixture claim refused: <reason>` for a claim), so a drive run
     never reports success on a refused post:
     a. lead `heads-up`: `Running the full build until 15:40` (to the thread)
     b. peer `question` to `you`: `Shall I take clone 3 while the build runs?`. Its returned id is `questionId`.
     c. lead `result`: `Landed the contract`, with a `commit` ref `abc1234`
     d. lead `progress`: `Phase 2: wiring the hook` in thread `session:<lead row id>`
  5. The lead claims paths `['src/**']` with reason `contract work`.
  Agent participants are `{ kind: 'agent', rowId, agentId: null, mirrorId: null, name: <title> }`.
- **Hand-over** (`main/start.ts`, after 08's code): `services.selfTest?.run(chatroomSelfTestScript({...}))` and
  `api.drive?.add('seed', …)`. The `seed` description names what it seeds and returns
  `{ room, rowIds, titles, thread, questionId }`.
- **Script groups** (each with a `why`; the keys use the self-test notation, `' '` for Space):
  The side bar sorts threads by `lastId`, newest first (09). The fixture posts through `RoomService`, so no
  session makes a `chatroom_*` or hook call and 08 writes no `joined` entry. The room's posts get ids in this
  order: the three `plan-demo` posts, then the lead's `progress`. So at group 3 the order is `session:<lead>`,
  `plan-demo`. After the reply in group 4 it is `plan-demo`, `session:<lead>`. The log cursor starts on the newest message of
  an opened thread (09), so `plan-demo` opens on `Landed the contract`.
  A step's `expect` is one plain line. A line that holds an id the script cannot know goes in `alsoExpect` as a
  pattern. A `repeat` step takes no `alsoExpect`. A key step's plain line is `[page] <key> ran <command>` (as
  forms' script has it).
  1. `open` — `open()` seeds the fixture and activates the peer's row. `shownLine` is
     `[chatroom] badge in chatroom-selftest 2: @1`. `alsoShown` is
     `/^\[chatroom\] activity in chatroom-selftest 2: asks you$/`.
  2. `mode` — keys `[' ', 'k', 'c']`. Expect `[chatroom] shown`, with `checksFit: true` and screenshot
     `mode`.
  3. `thread` — step 1: keys `['j']`, expect `[page] j ran chatroom.listDown`, `repeat` until
     `[chatroom] list cursor on <room>/plan-demo` (with `max` 4), so the script does not count presses. Step 2:
     keys `['Enter']`, expect `[chatroom] thread shown: <room>/plan-demo (3 messages)`, with `alsoExpect` the peer
     badge line `[chatroom] badge in chatroom-selftest 2: none`, because the open marks the thread read. Screenshot
     `thread`.
  4. `reply` — step 1: keys `['<A-l>']` give the log the keys. Expect `[page] <A-l> ran panes.focusRight`. Step 2: keys `['k']`, expect
     `[page] k ran chatroom.logUp`, `alsoExpect` `/^\[chatroom\] log cursor on #\d+ question from chatroom peer$/`.
     Step 3: keys `['r']`, expect `[page] r ran chatroom.reply`, `alsoExpect`
     `/^\[chatroom\] composer open: answer to #\d+$/`. Step 4: each character of `yes, take it` as one key, then
     `'Enter'` last. Expect `[chatroom] activity in chatroom-selftest 2: none`, `alsoExpect`
     `/^\[chatroom\] posted #\d+ to .+\/plan-demo$/`. Screenshot `reply`.
  5. `session thread` — step 1: keys `['<A-h>']` go to the side bar, expect `[page] <A-h> ran panes.focusLeft`. Step 2: keys `['j']`, expect
     `[page] j ran chatroom.listDown`, `alsoExpect` `/^\[chatroom\] list cursor on .+\/session:.+$/` (one press
     from `plan-demo` reaches `session:<lead>`). Step 3: keys `['Enter']`, expect `[page] Enter ran
     chatroom.openThread`, `alsoExpect` `/^\[chatroom\] thread shown: .+\/session:.+ \(\d+ messages\)$/` and
     `/^\[chatroom\] log cursor on #\d+ progress from chatroom lead$/`. The second pattern proves that the
     lead's `progress` post shows in its thread. The script pins no message count for this thread.
  6. `leave` — keys `['<A-h>']` (expect `[page] <A-h> ran panes.focusLeft`), then `[' ', 'k', 's']` with expect `[page] showed Sessions mode`, so the next
     script starts from Sessions mode.
  Read AGENTS.md § Running and testing for `repeat`, `alsoExpect` and `alsoShown`.
- `pageBinds: []`, `settings: {}`, `scrollsItself: []`, `problems: () => []`, as unity-pool's script has them.
- The script and the fixture post as agents through `RoomService`. That is the same path as the tools, and the
  store stays behind it. No test-only write path.
GIVEN the self-test on a temp home WHEN `npm run selftest -- --plugin chatroom` runs THEN every group passes, and
  the screenshots `chatroom-mode`, `chatroom-thread` and `chatroom-reply` are saved
GIVEN a drive run WHEN the agent runs `npm run drive -- chatroom.seed` (see `npm run drive -- help` for the exact
  verb) THEN two rows and the room with its four posts and one claim exist, and the result names them
Tests:     none in Vitest: the script is the test, and the rules it drives are pinned by 05, 06, 08 and 09's tests.
Done when: compiles; `npm run lint` passes; `npm run selftest -- --plugin chatroom` passes. The lead runs that
           command at the test gate, and 12 repeats it.
Commit:    one commit for the group

## Proof
