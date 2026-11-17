# Chatroom — plan

Feature: chatroom · Implements: none · Ticket: none
Target: main (the `ai` repo) · Written: 2026-11-17

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Agent sessions talk to each other and to the user through one room per project, and read a board of every
session's live state, so a session no longer needs the user to carry "the other session is done", no longer polls
in silence on a peer, and no longer sweeps a peer's edits into its commit. The user watches and posts in a Chatroom
mode. A Telegram or Discord mirror can plug in later through one registration.

## Architecture

- **wigley-ai-gui** — a new built-in plugin `chatroom` (`src/plugins/chatroom/`): the store, the room service, the
  board, five MCP tools, the hook handlers, delivery, the agent-event entries, the mirror registry (main); Chatroom
  mode, the row badge and activity (page); its layouts. The `sessions` plugin gains a hook route on its relay
  server. Fixes to two stale doc passages.
- **wigley-ai-marketplace** — the wigley plugin gains `hooks/hooks.json` and `scripts/chatroom/hook.py`; the relay
  gives a Codex session a stable id; the endpoint lookup moves to a module both scripts import.
- **wigley-agents** — the trigger lines in `AGENTS.md` (written ahead).

The full design is `wigley-ai-gui/docs/features/chatroom/design.md`. Read it before any task.

## Preconditions

Re-run each before the first dispatch; a different result stops the run for the lead.

- `git -C /Users/jonathonwigley/Documents/ai rev-parse --verify d5074678f` — the docs-ahead commit exists (it was `35f0b1524` before the rebase onto Lane H).
- `test ! -e /Users/jonathonwigley/Documents/ai/wigley-ai-gui/src/plugins/chatroom` — no chatroom plugin yet.
- `test ! -e /Users/jonathonwigley/Documents/ai/wigley-ai-marketplace/plugins/wigley/hooks` — the wigley plugin has
  no hooks yet.
- `grep -n "contributeTools\|addToolCallGuard" /Users/jonathonwigley/Documents/ai/wigley-ai-gui/src/plugins/sessions/contract.ts`
  — prints lines 233 and 311 (re-measured after Lane H).
- `grep -n "CLAUDE_CODE_SESSION_ID" /Users/jonathonwigley/Documents/ai/wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py`
  — the hello reads the session id at about line 230 (measured at plan time, re-verify).
- `test -e /Users/jonathonwigley/Documents/ai/wigley-ai-gui/src/plugins/claude-code` — Lane H moved the Claude adapter
  into the `claude-code` plugin (task 04 was struck for it).

## Docs written ahead

Commit `d5074678f` (was `35f0b1524`; now on main) on branch `chatroom` (worktree `/Users/jonathonwigley/Documents/.worktrees/ai-chatroom`):

- `wigley-ai-gui/docs/features/chatroom/design.md`
- `wigley-ai-marketplace/plugins/wigley/skills/chatroom/SKILL.md`
- `wigley-agents/AGENTS.md` § Subagents (progress posts) and § Communication (the chatroom pointer)
- wigley plugin version 2.13.0 in both manifests (main has since pushed 2.16.0; task 03 bumps this run's series past origin/main's version)

Each marks its behaviour "planned in `plan-chatroom`, not built yet". Task 11 drops those marks.

## Mandatory Reads

- `wigley-ai-gui/AGENTS.md` — § Architecture: A plugin, A registration, A plugin talks, A slot, A mode, A session
  part, A row activity, An MCP tool, An ambient service, Plugin data, A layout, the layer check; § Running and
  testing: the self-test and the drive run. The file is over 100,000 bytes: read it with `offset`/`limit`.
- `wigley-ai-gui/DESIGN.md` — for task 09.
- `wigley-ai-gui/docs/features/chatroom/design.md`
- `wigley-ai-marketplace/AGENTS.md` — for tasks 03 and 07.
- `wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md` — § The relay, for tasks 02, 03 and 07.

## Design Overview

```
agent session (Claude or Codex, terminal or app-run)
  ├─ MCP tools chatroom_post/read/board/claim/release ── relay.py ──► sessions relay server ──► chatroom main
  └─ hooks (Claude) PreToolUse / PostToolUse ── hook.py ── hook hello ──► sessions hook route ──► chatroom main
chatroom main
  ├─ RoomService ── RoomStore (jsonl in plugin data | memory)
  ├─ Board ◄── sessions.rows, chat.session, workflow.flows, unity-pool.snapshot, services.git, touched paths
  ├─ delivery ── chat.send (idle app-run session)  ·  hook post note (busy Claude session)
  ├─ entries ◄── chat.agentEvent (dispatch, hand-back)
  ├─ mirrors ── addMirror(ChatroomMirror)  (none built in this plan)
  └─ slots chatroom.rooms ──► page: Chatroom mode, row badge, row activity
```

Out of scope: a Telegram or Discord adapter; a hook path for Codex (Codex reads at turn boundaries); blocking
claims; per-session hub panel (the user picked the mode and the row badge).

Decisions settled in the interview (round numbers):

- One room per project, flat threads, addressed messages (1.1).
- Addressed messages: a post-tool hook line for a busy agent, chat's `send` for an idle app-run session, reads
  otherwise (1.2).
- Subagents post as children of their lead; dispatch and hand-back are read-only entries in the lead's thread (1.3).
- Cloud is a mirror; local store is the source of truth (1.4).
- The user posts from the viewer; a post main stamps as the user's is the user's word; all else is information (1.5).
- Chatroom mode plus a row badge (1.6).
- A board the app keeps current (2.1). Advisory claims with a warning hook; unity-pool clone claims read-only (2.2).
- Nine post kinds (2.3). The must-post and must-not rules (2.4), in the skill.
- The room replaces cross-session `SendMessage` and scratchpad progress files (2.5), in the rules.
- Agent-decided: the plugin lives in wigley-ai-gui; jsonl store; tools over the relay, not Claude's socket; a relay
  id for Codex; settings `bodyCap` 1500, `postsPerMinute` 10, `claimMinutes` 30; identical-body drop window 2 minutes.
- Agent-decided while drafting:
  - A post's `to` names only main agents and `you`; a subagent is never a target.
  - Claim paths are repo-relative, so a pool's clones compare the same file.
  - The user's read state is per thread; an agent's is per room.
  - The board shows unpushed paths and the branch, since the Git contract has no commit count.
  - The board takes "waiting on you" from the sessions activity slot, since forms has no main-side state, and "done"
    from the new `stageFinishes`.
  - Edits are attributed from chat's `fileWritten` agent event (app-run sessions) and the post hook (terminal
    Claude sessions).
  - The `ChatroomMirror` interface's `publish` takes only the message, which holds its room.
  - A verified mirror's human post is the user's word.

## File Structure

New plugin `wigley-ai-gui/src/plugins/chatroom/`:

- `manifest.ts` — `definePlugin({ id: 'chatroom', dependsOn: { main: ['sessions', 'chat', 'workflow'], page: ['sessions'] },
  reads: { main: ['unity-pool'], page: [] }, settings: { bodyCap: 1500, postsPerMinute: 10,
  claimMinutes: 30, layout: 'default' } … })`. Task 08 writes it; task 09 adds its page commands and scope.
- `contract.ts` — the shared records and keys below. Task 01 writes it; later tasks add to it only where named.
- `main/` — `room-store.ts`, `jsonl-room-store.ts`, `memory-room-store.ts`, `room-store.test-support.ts` (01);
  `room-service.ts`, `claim-paths.ts` (05); `board.ts` (06); `roster.ts`, `chatroom-tools.ts`, `hook-handlers.ts`,
  `delivery.ts`, `agent-entries.ts`, `room-views.ts`, `board-feed.ts`, `start.ts` (08); `selftest-script.ts`,
  `selftest-fixture.ts` (10).
- Data files in plugin data: `rooms/<room>.jsonl` (01); `cursors.json` (agents' cursor per room),
  `user-cursors.json` (the user's cursor per thread), `threads.json` (resolved threads), `claims.json` (05).
- `page/` — `start.ts`, the mode view, the row part, `layout/` reader (09).
- `layouts/layout.d.ts` and `layouts/default/` (09).

Shared names (every task uses these words exactly):

```ts
// src/plugins/chatroom/contract.ts — task 01
export type PostKind = 'question' | 'answer' | 'blocker' | 'heads-up' | 'handoff' | 'decision' | 'result' | 'progress' | 'note';
export type EntryKind = 'dispatch' | 'hand-back' | 'joined' | 'left';
export interface Participant {
  readonly kind: 'agent' | 'human' | 'system' | 'mirror';
  readonly rowId: string | null;      // the session row, for an agent
  readonly agentId: string | null;    // null for a main agent, the subagent's id otherwise
  readonly mirrorId: string | null;
  readonly name: string;              // the session title, `Title ▸ type` for a subagent, `you`, `system`
}
export interface MessageRef { readonly type: 'file' | 'branch' | 'commit' | 'plan' | 'message'; readonly value: string }
export interface RoomMessage {
  readonly id: number;                // given by the store, monotonic per room
  readonly room: string;
  readonly thread: string;
  readonly from: Participant;
  readonly to: readonly Participant[];
  readonly kind: PostKind | EntryKind;
  readonly body: string;
  readonly refs: readonly MessageRef[];
  readonly replyTo: number | null;
  readonly answerBy: number | null;   // epoch ms
  readonly onNoAnswer: string | null;
  readonly key: string | null;
  readonly at: number;                // epoch ms, from the injected clock
  readonly userWord: boolean;         // true only for a post main stamped from the viewer
}
export type NewMessage = Omit<RoomMessage, 'id'>;
export interface RoomStore {
  append(message: NewMessage): Promise<RoomMessage>;
  read(room: string, afterId: number): Promise<RoomMessage[]>;
  rooms(): Promise<string[]>;
}
export type ClaimTarget = { readonly paths: readonly string[] } | { readonly branch: string } | { readonly resource: string };
export interface Claim { readonly id: string; readonly room: string; readonly holder: Participant; readonly target: ClaimTarget; readonly reason: string; readonly expiresAt: number }
export interface ChatroomMirror {
  readonly id: string;
  readonly verified: boolean;
  publish(message: RoomMessage): Promise<void>;
  onHumanMessage(listener: (room: string, thread: string, body: string) => void): Disposable;
}
export interface ChatroomMainExports { addMirror(mirror: ChatroomMirror): Disposable }
export const chatroomMainKey: DependencyKey<ChatroomMainExports, 'main', 'chatroom'>;
// Task 01 also adds POST_KINDS, ENTRY_KINDS, USER_PARTICIPANT, SYSTEM_PARTICIPANT and participantKey.
// Task 06 adds BoardState, BoardClone, BoardFile and BoardRow (see 06).
// Task 08 adds ChatroomHookRequest, ThreadView, RowUnread, RoomView, chatroomRoomsSlot (`chatroom.rooms`),
//   UserPost, UserPostResult, ChatroomChannel (readThread, postAsUser, markUserRead), HOOK_PRE, HOOK_POST (see 08).
// Task 09 adds ChatroomPlace and chatroomPlaceSlot (`chatroom.place`, the page's reload restore).
```

The room service (task 05, `main/room-service.ts`) and the board (task 06, `main/board.ts`) name their own types in
their documents; task 08 consumes them word for word and adds `main/board-feed.ts`, which gathers the board's
inputs so `buildBoard` stays pure.

Sessions hook route (task 02), in `src/plugins/sessions/contract.ts`:

```ts
// JsonSafe<T> in src/contracts/state.ts is generic and cannot type a parsed line, so the request is unknown.
export type HookHandler = (session: AgentSession, request: unknown) => Promise<Record<string, unknown>>;
export type HookReply = { ok: true; reply: Record<string, unknown> } | { ok: false; error: string };
// on SessionsMainExports:
addHookHandler(name: string, handler: HookHandler): Disposable;
project(sessionId: string): string | null;   // the room of a session with or without a row
```

Other contract additions: `ChatMainExports.toolCaller(sessionId, toolUseId): Promise<string | null>` (task 08, chat),
which names the agent of a tool call; `WorkflowMainExports.stageFinishes(flow: SessionFlow): boolean` (task 08,
workflow), which gives the board its `done` state.

Wire: `hook.py` sends the relay hello with an added `"hook": "<name>"` field, then one JSON line, and reads one JSON
line back. Hook names: `chatroom.pre`, `chatroom.post`.

Endpoint module (task 03): `wigley-ai-marketplace/plugins/wigley/scripts/forms/endpoint.py`, holding the endpoint
lookup and channel open that `relay.py` has today, imported by `relay.py` and `hook.py`.

Boundary rules: `chatroom` reaches other plugins only through `dependsOn`/`reads` contracts (the layer check). Only
`room-service.ts` writes through `RoomStore`. Only `sessions` touches the relay socket. No code outside
`src/plugins/claude-code/` names Claude's hook or env fields; the hook's request carries neutral fields (`tool`,
`paths`, `agentId`).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Contract and room store](01-contract-and-store.md)
- [x] [Sessions hook route](02-sessions-hook-route.md)
- [x] [Relay endpoint module and Codex id](03-relay-endpoint-and-codex-id.md)
- [x] ~~[Stale harness doc lines](04-stale-harness-docs.md)~~ — dropped: Lane H (plan-lane-h-harness-seams) is running, at task 10 of 17 on branch lane-h-harness-seams; its landing makes the AGENTS.md passages true and its task 16 re-reads them, so a rewrite to today's shape would be undone and conflict at merge

### Wave 2
- [x] [Room service](05-room-service.md) — after 01
- [x] [Board](06-board.md) — after 01
- [x] [Hook script and hooks.json](07-hook-script.md) — after 02, 03

### Wave 3
- [x] [Main part: tools, hooks, delivery, entries](08-main-part.md) — after 01, 02, 05, 06

### Wave 4
- [ ] [Chatroom mode, row badge and layouts](09-page-mode.md) — after 08

### Wave 5
- [ ] [Self-test script and drive fixture](10-selftest.md) — after 08, 09

### Wave 6
- [ ] [Doc re-read](11-doc-re-read.md) — after 01–10

### Wave 7
- [ ] [Final verification](12-final-verification.md) — after 01–11

## Run log

Review base: 7c3eb9665

### Groups
- 01 · deep · bed909cf0 · diff read: every Produces present; typecheck passes; oxfmt clean; layer check waits on 08's manifest · concerns: layer check needs 08's manifest; read('') rejects in jsonl, [] in memory; lone-surrogate room names; a line's room field not checked against its file
- 05 · deep · e467c8144 · diff read: every Produces export present; typecheck passes; oxfmt applied (7ae838a7a) · concerns: isParticipant and ref types copied from jsonl-room-store.ts (private there); a store.read rejection inside post/unread rejects rather than returning ok:false; it.each tables mixing row shapes
- 02 · deep · 3df0458c1 · diff read: every Produces present (addHookHandler, project, HookHandler, HookReply, RelayHello.hook, createHookRoutes, SessionList.sessionOf); wave typecheck passes; oxfmt, oxlint, check-styles clean; layer check waits on 08's manifest · concerns: sessionOf_ConnectOrder's 'owned over connected with one host id' row cannot be built (open/connect/setHostSessionId keep host ids unique), so the owned-first branch is untested; the client-left test leans on two 20 ms real-time pauses
- 03 · hard · e4d5ff8bc · diff read: endpoint.py holds RELAY_PROTOCOL, HELLO_TIMEOUT_SECONDS, READ_SIZE, both channels with timeout and set_timeout, open_channel, channel_path; relay hello sends codex- id only with WIGLEY_SESSION_ROW unset; manifests 2.17.0; unittests wait for the test gate · concerns: PipeChannel's timeout now also bounds writes before hello_done, untested (Windows only); the forms README names the chatroom hook script before 07 adds it
- 06 · hard · b94a871b2 · diff read: BoardState, BoardClone, BoardFile, BoardRow in contract.ts; BoardSession, GitFolderState, Touch, BoardInputs, buildBoard, readGitFolder, TouchTracker, createTouchTracker in board.ts; wave typecheck passes; oxfmt applied · concerns: the stale-touch test copies 08's forgetting rule (a staleTouchPaths export would be the deeper seam); the spec's 'other root' touch /r/o/d.ts sat under root /r, so the test uses /o/d.ts
- 07 · deep · d8a9fe6e7 · diff read: every Produces present in hook.py (HOOK_DEADLINE_SECONDS, GIT_TIMEOUT_SECONDS, git_runner, request_from_input, commit_paths, ask_app, output_for, main); hooks.json parses; py_compile passes; unittests and plugin validate wait for the test gate · concerns: the Bash matcher also fires on Monitor commands and starts python3 on every Bash call; python3 may be missing on Windows; a git add -A earlier on the line adds no paths; AGENTS.md wording differs slightly from the spec's dictated text; low-confidence (a) MultiEdit, (a2) notebook_path, (a4) additionalContext delivery, (b), (c) still need task 12's live probe
- 08 · deep · f53249933 · diff read: every Produces present (manifest, chatroomMainPart, roster, tools, hook handlers, delivery, agent entries, room views, board feed, contract additions, chat.toolCaller, workflow.stageFinishes); typecheck passes; layer check now passes; oxfmt applied; oxlint one warning (no-useless-spread, board-feed.ts:400) · concerns: rebuilds_InOrder passes without the per-room chain (loads cached); 01/05 keep private ref-type lists beside MESSAGE_REF_TYPES; stale-touch rule sits in board-feed.ts, not board.ts; board-feed.test copies board.test fixtures; AGENTS.md plugin folder map lacks chatroom/; a repeated sessions.connected for a tracked row does not refresh; oxlint no-useless-spread warning
### Contract changes
- room-store.test-support.ts: describeRoomStoreContract only → also newMessage(room, body) and messageWithEveryField(room, body) · why: the jsonl test and the shared suite share fixtures · consumers: 05, 06, 08 may use them · group 01
- 02 Produces: SessionList.sessionOfHost(hostId) → sessionOf(info: SessionInfo); createHookRoutes takes sessionOf · why: row-id-first lookup (Lane H's connect order) · consumers: 02 only (08 consumes the routes, not the lookup) · lead, before dispatch
- 06 BoardRow.harness / BoardSession.harness and 08 RosterSession.harness: Harness | null → string | null · why: Lane H removed the Harness type; the field holds the harness id · consumers: 08, 09 · lead, before dispatch
- createHookRoutes(sessionOf) → createHookRoutes(sessionOf, log: PluginLog) · why: the route logs 'hook <name> failed: <text>' · consumers: sessions start.ts only · group 02
- ChatroomChannel.messages: {} → Record<never, never> · why: the codebase's empty message map; {} is lint-banned · consumers: 09 · group 08
- contract.ts gains MESSAGE_REF_TYPES (file, branch, commit, plan, message) and start.ts exports STANDING_NOTE, pure additions · why: the tools' arg check and schema enum; start.test asserts the note · consumers: 08 · group 08
### Rulings
- Task 04 struck: its cause (Lane H not started) no longer holds; Lane H runs and rewrites the same passages — a stale-doc window stays until Lane H lands — lead
- Order agreed with the Lane H session: Lane H lands on main first (several hours; it bumps wigley to 2.13.1 and adds row_id to relay.py's hello); this run builds only new files (01, 05, 06) until Lane H's landed-sha notice, then rebases onto main and re-checks 02, 03, 07 and 08 against Lane H's code before dispatch — a wrong order would mean merge conflicts across sessions, relay and chat — lead
- roomFileName_EmptyRoom_Throws sits in main/room-store.test.ts, not contract.test.ts: the root layer may not import main/ — group 01 · group 01
- jsonl read() and rooms() run through the room's serial queue, so a read waits for earlier appends — group 01 · group 01
- Task 06 held with 02, 03, 07, 08: it consumes sessions' Harness and chat's ChatSessionInfo, which Lane H changes (Harness list removed, ChatSessionInfo gains harness) — dispatching it now would build on types about to change — lead
- Character counts (body cap, thread 1-80, entry cut, read line 200) use code points — group 05 · group 05
- unreadAddressed returns the user's word to a thread only while that thread is open, so it stays a subset of unread — group 05 · group 05
- An expired claim drops in memory; claims.json is rewritten only when a claim changes; a state file read failing for any reason but missing rejects and caches nothing — group 05 · group 05
- Lane H landed on main (e23142c0e); chatroom rebased onto it cleanly; two readers rechecked 02, 03, 06–12 and plan.md against Lane H's code, and every stale line was edited (reports recheck-A.md, recheck-B.md) — lead
- 02's hook route finds its session in connect's order (row id first, then host id): a host-id-only lookup misses an app-run row before chat adopts the host id and after /clear or resume — lead
- 03 sends the relay's codex- id only when WIGLEY_SESSION_ROW is unset: an app-run Codex row joins by row_id, and a codex- host id would lose its tools at the adapter's first host-id move; no change for terminal Codex today — lead
- Version: main pushed 2.16.0 since the docs-ahead commit, so 03 bumps both wigley manifests one minor past origin/main (2.17.0 today) and 07/11 ride that series; re-checked at landing — lead
- 08's manifest moves workflow from reads to dependsOn.main: 08 calls workflow exports (flowOf, flows, stageFinishes) and api.dependency takes only dependsOn ids; chatroom now needs the workflow plugin enabled (on by default) — lead
- 09's mode icon is 'organization', not 'comment-discussion', which the Sessions mode already uses — lead
- 06 released from its hold and dispatched with 02 and 03: it now consumes SessionInfo.harness as string | null, and ChatSessionInfo as Lane H left it — lead
- createHookRoutes takes the plugin log as a second parameter, for the spec's 'hook <name> failed' line — a hook route with no log would fail silently — group 02 · group 02
- After the request line the hook socket is resumed, so a client that leaves is seen and a late reply is not written (destroyed || writableEnded checked) — group 02 · group 02
- The hook handler timeout runs on Node's global setTimeout, since RelayServerDeps has no timers dep — group 02 · group 02
- PipeChannel applies its timeout to writes as well as reads until hello_done, matching SocketChannel and the Produces line — group 03 · group 03
- BoardInputs.chat and .flows are keyed by row id; 08 must key flows by row id or the flow-driven working and done states never fire — group 06 · group 06
- A resting row with a finishing flow shows done, not idle — group 06 · group 06
- A failed git call stops the remaining git reads, but the pathspecs already found are still sent — group 07 · group 07
- git commit -o drops an earlier git add's pathspec; each git add pathspec resolves against that add's own -C folder — group 07 · group 07
- A hook input with no cwd sends nothing — group 07 · group 07
- Vendor docs checked (code.claude.com): hooks/hooks.json loads with no manifest field, closing (a3); matcher semantics, agent_id on subagent tool calls, quoted CLAUDE_PLUGIN_ROOT shell form, timeout and exit-0 handling confirmed — group 07 · group 07
- Dispatch entry body is 'dispatched <agentSpawned.name> (<agentType>): <description>' — the roster name would repeat the type — group 08 · group 08
- A user-word question/blocker/handoff to the main agent matching wake rules (a) and (b) sends one wake with (b)'s text — group 08 · group 08
- A rested turnFinished keeps a row's pending wakes until a later idle finish — group 08 · group 08
- Arg error texts the spec left open are written in chatroom-tools.ts (report 08-1.md); null counts as absent; an empty thread read succeeds with 'No messages in thread <thread>.' — group 08 · group 08
- Dispose: stopped flag, boardFeed.stop, delivery.dispose, then awaits rebuild chains and room.settled() so queued cursor and claim writes finish — group 08 · group 08
### Review rounds
### Test gate
