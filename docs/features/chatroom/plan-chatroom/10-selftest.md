# 10 — Self-test script and drive fixture

Status: not started
Type: Task
Rung: standard · follows `src/plugins/unity-pool/main/selftest-script.ts` and `selftest-fixture.ts`, and practice's `writeFixture` drive action; it adds nothing another task consumes
Wave: 5 · Depends on: 08, 09
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chatroom/main/selftest-fixture.ts` · create `src/plugins/chatroom/main/selftest-script.ts` · modify `src/plugins/chatroom/main/start.ts`
Consumes:
- the one `RoomService` that 08's `main/start.ts` builds (pass it to the script and the fixture from start), and its
  calls `post(request: PostRequest): Promise<PostResult>` (a `PostRequest` names `from`, `kind`, `body`, `to` as
  names, `thread`, `refs`, `replyTo`) and `claim(request: ClaimRequest): Promise<ClaimResult>` (`room`, `holder`,
  `target`, `reason`, `minutes`) ← 05, 08. `post` refuses a `to` name the room does not hold, so the fixture posts
  to the titles of sessions it started.
- `chatroomRoomsSlot` (`chatroom.rooms`) and `RoomView` ← 08 (read only, to wait for the board)
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
  2. Launch two sessions there through `chat.launch` on profile `work`, with first messages `chatroom lead` and
     `chatroom peer`. A first message gives the row its title, as unity-pool's fixture does.
  3. Read each row's `project` from `sessions.rows`. That is the room name. Both rows share it, because they have
     one folder. If the two rows have different projects, throw `the chatroom fixture's rows are in two rooms`.
  4. Post in thread `plan-demo`, in this order:
     a. lead `heads-up`: `Running the full build until 15:40` (to the thread)
     b. peer `question` to `you`: `Shall I take clone 3 while the build runs?`. Its id is `questionId`.
     c. lead `result`: `Landed the contract`, with a `commit` ref `abc1234`
     d. lead `progress`: `Phase 2: wiring the hook` in thread `session:<lead row id>`
  5. The lead claims paths `['src/**']` with reason `contract work`.
  Agent participants are `{ kind: 'agent', rowId, agentId: null, mirrorId: null, name: <title> }`.
- **Hand-over** (`main/start.ts`, after 08's code): `services.selfTest?.run(chatroomSelfTestScript({...}))` and
  `api.drive?.add('seed', …)`. The `seed` description names what it seeds and returns
  `{ room, rowIds, titles, thread, questionId }`.
- **Script groups** (each with a `why`; the keys use the self-test notation, `' '` for Space):
  1. `open` — `open()` seeds the fixture and activates the peer's row. `shownLine` is
     `[chatroom] badge in <peer row label>: @1`. `alsoShown` is
     `/^\[chatroom\] activity in .+: asks you$/`.
  2. `mode` — keys `[' ', 'k', 'c']`. Expect `[chatroom] shown`, with `checksFit: true` and screenshot
     `mode`.
  3. `thread` — move the side bar cursor to `plan-demo` (`j`/`k` as the fixture's order needs) and press Enter.
     Expect `[chatroom] thread shown: <room>/plan-demo (3 messages)`. `alsoExpect` the peer badge line with
     `none`, because the open marks the thread read. Screenshot `thread`.
  4. `reply` — give the log the keys (`<A-l>`), move to the question (`k` until
     `log cursor on #<questionId> question from chatroom peer`, with `repeat`), then `r`. Expect
     `composer open: answer to #<questionId>`. Type `yes, take it` and press Enter. Expect
     `posted #<n> to <room>/plan-demo` through a pattern. `alsoExpect` the peer row's
     `activity in <peer label>: none`. Screenshot `reply`.
  5. `session thread` — go to the side bar (`<A-h>`), open `session:<lead row id>`. Expect
     `[chatroom] thread shown: <room>/session:<lead row id> (1 messages)`, the count text that 09 pins. This proves that a `progress` post shows in the lead's
     thread.
  6. `leave` — `<A-h>` and `' ', 'k', 's'` back to Sessions, so the next script starts from Sessions mode.
  Steps that wait on text the script cannot know (ids) use `alsoExpect` patterns. Read
  AGENTS.md § Running and testing for `repeat`, `alsoExpect` and `alsoShown`.
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
