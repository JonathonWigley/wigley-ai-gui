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

- `git -C /Users/jonathonwigley/Documents/ai rev-parse --verify 35f0b1524` — the docs-ahead commit exists.
- `test ! -e /Users/jonathonwigley/Documents/ai/wigley-ai-gui/src/plugins/chatroom` — no chatroom plugin yet.
- `test ! -e /Users/jonathonwigley/Documents/ai/wigley-ai-marketplace/plugins/wigley/hooks` — the wigley plugin has
  no hooks yet.
- `grep -n "contributeTools\|addToolCallGuard" /Users/jonathonwigley/Documents/ai/wigley-ai-gui/src/plugins/sessions/contract.ts`
  — prints lines 238 and 310 (measured at plan time, re-verify).
- `grep -n "CLAUDE_CODE_SESSION_ID" /Users/jonathonwigley/Documents/ai/wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py`
  — the hello reads the session id at about line 230 (measured at plan time, re-verify).
- `test ! -e /Users/jonathonwigley/Documents/ai/wigley-ai-gui/src/plugins/claude-code` — the Claude adapter lives in
  `src/main/claude-code/`, which task 04's doc fix rests on.

## Docs written ahead

Commit `35f0b1524` on branch `chatroom` (worktree `/Users/jonathonwigley/Documents/.worktrees/ai-chatroom`):

- `wigley-ai-gui/docs/features/chatroom/design.md`
- `wigley-ai-marketplace/plugins/wigley/skills/chatroom/SKILL.md`
- `wigley-agents/AGENTS.md` § Subagents (progress posts) and § Communication (the chatroom pointer)
- wigley plugin version 2.13.0 in both manifests

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

- `manifest.ts` — `definePlugin({ id: 'chatroom', dependsOn: { main: ['sessions', 'chat'], page: ['sessions'] },
  reads: { main: ['workflow', 'unity-pool'], page: [] }, settings: { bodyCap: 1500, postsPerMinute: 10,
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
`src/main/claude-code/` names Claude's hook or env fields; the hook's request carries neutral fields (`tool`,
`paths`, `agentId`).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Contract and room store](01-contract-and-store.md)
- [ ] [Sessions hook route](02-sessions-hook-route.md)
- [ ] [Relay endpoint module and Codex id](03-relay-endpoint-and-codex-id.md)
- [x] ~~[Stale harness doc lines](04-stale-harness-docs.md)~~ — dropped: Lane H (plan-lane-h-harness-seams) is running, at task 10 of 17 on branch lane-h-harness-seams; its landing makes the AGENTS.md passages true and its task 16 re-reads them, so a rewrite to today's shape would be undone and conflict at merge

### Wave 2
- [ ] [Room service](05-room-service.md) — after 01
- [ ] [Board](06-board.md) — after 01
- [ ] [Hook script and hooks.json](07-hook-script.md) — after 02, 03

### Wave 3
- [ ] [Main part: tools, hooks, delivery, entries](08-main-part.md) — after 01, 02, 05, 06

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
### Contract changes
### Rulings
- Task 04 struck: its cause (Lane H not started) no longer holds; Lane H runs and rewrites the same passages — a stale-doc window stays until Lane H lands — lead
### Review rounds
### Test gate
