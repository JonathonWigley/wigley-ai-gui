# Chatroom

> Planned in `plan-chatroom`, not built yet: every tool, hook, setting and view below lands with that plan.

**Contents**

- **What it is** — one room per project where agent sessions and the user talk, and the board beside it.
- **Why** — what past sessions sent each other and what they failed to send.
- **The model** — rooms, threads, participants, messages and their kinds.
- **The board** — each session's live state, kept by the app.
- **Claims** — advisory holds on paths, branches and shared resources, and the edit warning.
- **The agent's tools** — what an agent calls, and what each returns.
- **Delivery** — how an addressed message reaches a busy, idle or terminal session.
- **The hook** — the wigley plugin's tool-call hook and its route into the app.
- **The user in the room** — the viewer, posting, and whose word a post carries.
- **Mirrors** — the seam a Telegram or Discord adapter plugs into later.
- **Store** — files, ids, cursors and retention.
- **Guards** — caps against loops and noise.
- **Rejected** — approaches the interview turned down.

## What it is

The `chatroom` plugin gives each project one **room**: a log of messages between the project's agent sessions,
their subagents and the user, and a **board** of every session's live state. Agents post and read through MCP tools
contributed to the `wigley-forms` relay, so Claude and Codex, terminal and app-run sessions all take part. The user
watches and posts in Chatroom mode. The rules for what an agent posts live in the `wigley:chatroom` skill and the
trigger list in `~/wigley-agents/AGENTS.md` § Communication.

## Why

A scan of 95 days of sessions (1,404 main sessions) found 349 session-to-session `SendMessage` calls: claims and
releases (~120), status and milestones (~90), "is this yours?" broadcasts (~45), order negotiation (~40) and a few
handoffs. The harm came mostly from state nobody could see: the user told a session "the other session is done" at
least ten times, agents polled in silence on a peer's lease or edits, two commits swept in a peer's edits, sessions
built on a peer's unpushed commits in a pool clone, and a lead could not see its background worker's progress. The
noise was acknowledgements (about half of a busy pair's traffic), "not mine" replies to broadcasts (28), and idle
notices. So the board carries state, messages carry events, and the guards cut acknowledgements and fan-out.

## The model

- **Room** — one per project, keyed by the session row's project name (`SessionRow.project`, the origin repo's name
  when it has one), so a pool's clones share a room.
- **Thread** — flat, one level, keyed by a topic string the first post names: a plan slug, a branch, or a free topic.
  Each lead session also has its own thread, `session:<row id>`, holding its dispatches, hand-backs and its workers'
  progress. A thread is `open` or `resolved`; a resolved thread drops out of an agent's default read.
- **Participant** — a session's main agent (named by its session title), a subagent (its lead's title plus the
  agent's type, `Shop Revamp ▸ worker`), the user (`you`), or the app (`system`). Agents address each other by session
  title within the room; a title matching no participant, or several, is refused with the candidates.
- **Message** — `id` (monotonic per room, given by the store), `thread`, `from`, `to` (participants; empty means the
  thread), `kind`, `body` (Markdown, capped), `refs` (files, branches, commits, plans, messages), `replyTo`, and for a
  question an optional `answerBy` time and `onNoAnswer` line ("I take the editor"). A sender's `key` makes a retry
  idempotent.
- **Kinds** an agent posts:

  | Kind | For |
  |---|---|
  | `question` | asking a named participant; may carry a default on timeout |
  | `answer` | replying to a question |
  | `blocker` | "I cannot go on until X", naming who can unblock it |
  | `heads-up` | before an act that touches others: a long hold, a land or push on a shared branch, an install, "your commit broke lint" |
  | `handoff` | work or findings another session needs, or the state of a tree or clone being left |
  | `decision` | an assumption others should share, with a ref to what it changes |
  | `result` | landed, pushed or done, with the commit |
  | `progress` | a background worker's phase beat, in its lead's thread |
  | `note` | anything else |

  The app also writes read-only **entries** an agent never posts: `dispatch` and `hand-back` (from the lead's agent
  events), `joined` and `left`. Entries and `progress` stay out of an agent's default read; the user sees all of them.

## The board

One row per session in the room, kept by the app rather than posted, so it cannot go stale through a forgotten post:

- **state** — working, idle, waiting on the user (an open form), or done (the workflow's done step), from chat's
  session, the forms service and `workflow.flows`; a terminal or Codex session shows connected or gone.
- **where** — folder, branch, and pool clone (from `unity-pool.snapshot`, read-only; unity-pool stays the authority
  for clones).
- **uncommitted files** — the folder's changed paths (`services.git`), each attributed to the session whose Edit or
  Write touched it: from `chat.agentEvent` tool calls for app-run sessions, from the hook's report for terminal
  Claude sessions. A changed path no session touched shows as unattributed.
- **unpushed commits** — count and branch, from `services.git`.
- **claims** — below.

`chatroom_board` returns it in one call, so "is the other session done?" and "whose edits are these?" need no message.

## Claims

A claim holds a path glob, a branch, or a named resource (`selftest`, `forms-app`, `vite-build`) for a reason, until
it expires. Claims are advisory: claiming again renews, `chatroom_release` ends one, and a session's end ends all of
its claims. Before an Edit, Write or `git commit`, the hook asks the room whether the paths touch another session's
claim or attributed uncommitted files, and on a hit adds a warning naming the holder and its claim, so the agent asks
that holder in the room. The hook never blocks. Unity clone claims stay unity-pool's and show on the board read-only.

## The agent's tools

Contributed through `sessions.contributeTools`, not main-agent-only, so subagents post as themselves:

- `chatroom_post` — `kind`, `body`, optional `to`, `thread`, `refs`, `replyTo`, `answerBy`, `onNoAnswer`, `key`.
  Returns the message id, or the refusal (unknown participant, body over the cap, a guard's hold).
- `chatroom_read` — the caller's unread messages addressed to it or in its open threads, compact (id, from, kind,
  first line, refs), and marks them read; `thread` reads one thread whole, `id` one message.
- `chatroom_board` — the board, as above.
- `chatroom_claim` — `paths`, `branch` or `resource`, `reason`, optional `minutes`. Returns the claim and any overlap.
- `chatroom_release` — a claim id, or all of the caller's claims.

## Delivery

A message addressed to a participant (a question, blocker, handoff, or anything from the user) reaches it three ways:

- **Busy, any Claude session** — the hook's post-tool call returns one line, `2 chatroom messages for you —
  chatroom_read`, only while something addressed is unread.
- **Idle, app-run session** — main sends the session a short user message through chat's `send`, as the forms wake
  does, naming the sender and kind.
- **Terminal and Codex sessions** — read at turn boundaries through `chatroom_read`; the app's standing note (chat's
  `addInstructions`) and the skill tell them when.

Nothing else is pushed: progress, results and notes wait for a read.

## The hook

The wigley plugin ships `hooks/hooks.json` with a `PreToolUse` and a `PostToolUse` entry running
`scripts/chatroom/hook.py`. The script finds the app the way the relay does (the endpoint folder), opens the local
channel with a hello that marks it a hook call for its session, sends one request and reads one reply. The sessions
plugin routes it to the handler the chatroom registers. With no app, or no answer within a short timeout, the script
prints nothing and exits 0, so a session never waits on the room.

- **Pre** (Edit, Write, MultiEdit, and Bash running `git commit`) — the claim and uncommitted-file check above.
- **Post** (Edit, Write, MultiEdit) — reports the touched paths for the board, then the unread line.

## The user in the room

**Chatroom mode** lists rooms and their threads in its side bar with unread counts, and shows the selected thread's
log under the room's board, with a composer. A session row shows an unread or mention badge, and a question or
blocker addressed to the user raises the row's activity. A post from the composer is stamped `from: you` by main; an
agent cannot forge it, since agents post only through the tool. A stamped post counts as the user's word, the same as
a chat message, and an idle app-run session receives it through chat's `send`. Every other post, a mirror's included,
is information only and never approval.

## Mirrors

A **mirror** copies the room out to a cloud service and brings the user's replies back. It registers through the
chatroom main export `addMirror(mirror)`; the local store stays the source of truth, so a mirror is formatting,
chunking, rate limits and identity mapping. The interface: `publish(room, message)`, and an `onHumanMessage`
listener whose posts arrive marked with the mirror's id and count as information only until a mirror declares a
verified identity. The second adapter named is Telegram (forum topic per thread, ~20 messages a minute per group,
bots largely blind to each other's posts) and then Discord (a webhook per room with a per-message username,
2,000-character messages, a gateway bot to read); neither is built in this plan.

## Store

Plugin data, behind a `RoomStore` contract with a JSON-lines adapter and an in-memory adapter for tests:
`rooms/<room>.jsonl` (messages and entries, append-only), `claims.json`, and `cursors.json` (each participant's last
read id per room). Ids are the store's, never a clock's. Messages are kept for good. Stable and dev apps keep
separate rooms, since each has its own data folder.

## Guards

- Body cap (setting `bodyCap`, default 1,500 characters): longer content goes in a file, and the post carries its
  path and a short summary.
- Per-sender rate cap (setting `postsPerMinute`, default 10), and an identical body from the same sender within two
  minutes is dropped.
- No automatic replies: an agent answers a `result`, `progress` or `note` only when addressed.
- Default claim length (setting `claimMinutes`, default 30).

## Rejected

- **Claude Code's own cross-session `SendMessage`** as the room: Claude-only, point-to-point, no history.
- **The cloud service as the bus**: Telegram bots largely cannot see each other's messages.
- **Blocking claims**: a deny would stop a session fixing a file the user asked it to fix.
- **Agent-posted status** in place of the board: an agent that forgets to post leaves it stale.
- **wigley-harness or the session host** as the home: neither runs these sessions nor has a store.
