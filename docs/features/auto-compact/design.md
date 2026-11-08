# Auto-compact — settled design

**Contents**

- **Intent** — why a cold-cache send compacts first, why an agent wait compacts, and why every compaction shows.
- **Vocabulary** — compaction, trigger, auto-compact, send gate, hold, agent wait, compaction entry.
- **Flow** — from a send to the held row's release, from a turn's end during an agent wait to its compaction, and
  from the harness to the three surfaces.
- **Records** — the harness-neutral shapes that cross each seam.
- **Rules** — when the gate holds a send, when an agent wait compacts, what a skip does, and what each surface shows.
- **Decisions** — what the user settled on 2026-11-03 and 2026-11-08, with the reason for each.
- **Rejected** — the alternatives weighed and why each lost.

The decisions from the 2026-11-03 and 2026-11-08 interviews, kept so a later change does not reopen them. How Claude prints a
compaction is in `docs/features/agent-chat/claude-stream.md` § Compaction; how each surface looks is in `DESIGN.md`.

## Intent

A message sent to a session whose prompt cache went cold re-reads the whole context uncached. Above about 150k
tokens the turns that follow also carry that large context. The user wants such a send to compact first, so the
message and every turn after it run on the small context. A main agent whose turn ends while its subagents still
run sits idle until their results come back, and each result lands on the large context: the user wants that wait
spent compacting. The user also wants to see every compaction while it runs
and after it ends, whatever started it: the user's `/compact`, the harness's own autocompact, or this feature.

## Vocabulary

- **Compaction** — the harness replaces the conversation with a summary. It has a start, an end and a trigger.
- **Trigger** — what started a compaction: `app` (the app called `AgentProcess.compact()`), `manual` (the user sent
  `/compact`), `harness` (the harness compacted on its own; Claude's autocompact).
- **Auto-compact** — the `auto-compact` plugin. It registers a send gate that holds a send to a session whose cache
  is cold and whose context is above its `minTokens` setting (`"auto-compact": { "minTokens": … }` in
  `settings.json`).
- **Send gate** — a function a plugin registers through chat main's `addSendGate`. Chat asks the gates in
  registration order before it writes a message to an idle session; the first hold wins and no later gate is asked.
  A gate answers a hold or nothing.
- **Hold** — chat keeps the message as a pending row, compacts the session, and writes the row when the compaction
  ends. The row carries the gate's reason.
- **Agent wait** — an idle stretch of a session at a workflow level (`SessionFlow.workflow` not null) whose main
  turn has ended (`turnRunning` false) while a subagent the main agent spawned still runs (`runningSubagents` not
  empty). Background shell tasks do not count. Auto-compact compacts at most once per agent wait, through chat main's
  `compact`, when the context is above its `agentWaitMinTokens` setting.
- **Compaction entry** — the `compaction` chat entry kind: the transcript's `Compacted 182k → 24k · auto · 9s` divider.
  The adapter makes it, live and from a saved transcript.

## Flow

```
user sends ─▶ chat main sendMessage ─▶ session idle? ── no ──▶ queue as today
                                          │ yes
                                          ▼
                              ask the send gates (auto-compact's)
                                │ null                 │ { action: 'compact', reason }
                                ▼                      ▼
                         write as today        pending row (holdReason = reason)
                                               process.compact()
                                                       │
harness ─▶ adapter ─▶ compactionStarted{trigger} ──────┤──▶ chat main: ChatSessionState.compaction ─▶ dock
                                                       │──▶ chat.agentEvent ─▶ usage main ─▶ session line chip
           adapter ─▶ compaction entry (after-size later) ─▶ transcript divider
           adapter ─▶ compactionEnded{trigger,…} ──────┴──▶ chat main: clear compaction, write the held row
```

```
harness turn ends ─▶ chat.agentEvent turnEnded ─▶ workflow folds the flow (a microtask later) ─▶ workflow.flows
                     chat main: activity idle ─▶ chat.turnFinished
auto-compact, at each workflow.flows change and each chat.turnFinished (idle):
  agentWaitReason(flow, last main usage, agentWaitMinTokens, wait phase)
    │ null ─▶ nothing          │ 'auto · agents running · 214k'
                               ▼
                    chat main compact(sessionId, reason) ── false ─▶ nothing; asked again at the next change
                               │ true: ChatSessionState.compaction { app, reason } at once
                               ▼
                    process.compact() ─▶ the same compactionStarted / compactionEnded path as a hold's
```

## Records

- `CompactionTrigger = 'app' | 'manual' | 'harness'` in `src/contracts/agent.ts`.
- `AgentEvent` members `compactionStarted { at, trigger }` and
  `compactionEnded { at, trigger, outcome: 'done' | 'failed' | 'interrupted', beforeTokens, durationMs }`. They
  replace `compacted`. The adapter sends exactly one `compactionEnded` for each `compactionStarted`: on the
  harness's end line, on a failed result, on an interrupt, and before `sessionEnded` when the process ends mid-way.
  Chat main drops the events of a process it let go, so on a `/clear` or a failed attach during a compaction it emits
  that end on `chat.agentEvent` itself: outcome `interrupted`, `beforeTokens` and `durationMs` null.
- `ChatEntry` kind `compaction { id, at, trigger, beforeTokens, afterTokens, durationMs, raw }`. `afterTokens` is null
  until the size the compaction left is known; the adapter then emits the same entry id again with it set.
- `AgentProcess.compact()` starts a compaction with trigger `app`. It throws after `end` and while the session is not idle. It
  makes no user entry.
- Chat main's export `addSendGate(gate: SendGate): Disposable`, with
  `SendGate = (input: SendGateInput) => SendGateVerdict | null`, `SendGateInput { sessionId, hostSessionId, text, now }`, and
  `SendGateVerdict { action: 'compact'; reason: string }`.
- Chat main's export `compact(sessionId: string, reason: string): boolean`: true when it started an app compaction;
  false, logged, starting nothing, otherwise (Rules).
- `ChatSessionState.compaction: { trigger, reason, startedAt } | null` and `QueuedMessage.holdReason: string | null`.
  `reason` is a hold's gate reason or `compact`'s caller's.
- Auto-compact's settings `minTokens` (the send gate, default 150000) and `agentWaitMinTokens` (the agent wait,
  default 200000); 0 turns either off.
- Auto-compact's `AgentWaits`, by chat row id: `compacting` from a `compact` that returned true to the next
  `compactionEnded`, then `spent`; a `sessionEnded` re-arms either; absent is armed. A flow's `sessionId` is the chat row id, and
  the part maps it to the usage's host session id through the `hostSessionId` each `chat.agentEvent` but a `sessionEnded` carries, since a let-go process's end
  still arrives under its old host id.
- The usage snapshot's `SessionUsage.compaction: { trigger, startedAt } | null`, and the session line input's
  `compacting: string | null`.

## Rules

- The gate holds a send only when all hold: the session is idle; the message is not a slash command (its trimmed
  text does not start with `/`; a `/compact` is the user's own instruction and would compact twice); the plugin has a main-agent `usage` event for it;
  that event's `cacheExpiresAt` is not null and is at or before now; its `contextTokens` is above
  `minTokens`; and `minTokens` is not 0. Its reason reads
  `auto · cache cold · <tokens>`, the tokens in the usage plugin's `182k` format.
- A message sent while the hold is up queues behind the held row, in order.
- An agent wait compacts when all hold: `agentWaitMinTokens` is not 0; the flow has a workflow; its turn is not
  running and `runningSubagents` is not empty; the plugin has a main-agent `usage` for the session's current host id;
  its `contextTokens` is above `agentWaitMinTokens`; and the wait is armed. Its reason reads
  `auto · agents running · <tokens>`, in the same `214k` format. It is asked at each `workflow.flows` change and each
  `chat.turnFinished` with `how: 'idle'`: the flow's turn end folds a microtask after chat's idle, and an idle can come
  after the flow's last change (a permission answered).
- Chat's `compact` starts nothing and returns false for a session chat does not hold, one with no running process
  or still attaching, one with a hold up, one with a compaction running, one whose shown activity is not idle, or
  when the harness's `compact()` throws. Otherwise it sets `ChatSessionState.compaction` at once, so a message sent
  before the harness reports the start queues behind it, as during any compaction.
- Once per wait: a `compact` that returned true makes the wait `compacting`. The compaction's own `turnStarted` and a
  subagent finishing during it re-arm nothing; its `compactionEnded`, whatever the outcome, spends the wait. A spent
  wait re-arms on the next main `turnStarted`, on `runningSubagents` emptying, or on the flow going; a `sessionEnded`
  re-arms any. A main turn that ends with subagents still running after a re-arm may compact again, the threshold
  keeping a small context from it. What Claude does when a background subagent finishes mid-compaction is in
  `docs/features/agent-chat/claude-stream.md` § Compaction › Compaction with a background subagent: its
  `agentFinished` can reach the flow while the compaction runs, and the notification turn's model call starts after
  the compaction ends.
- Interrupt (`chat.interrupt`, `⌃C`) or send-now (`⌘↩`) on a held row skips the compaction. Chat interrupts the
  process and writes the held row when `compactionEnded` arrives. The adapter's interrupt grace makes that arrive
  within 5 s.
- The process ending during a hold returns the held row to the box, as every pending row is returned today.
- A held row across a relaunch is saved as a plain pending row, and its reason is not kept.
- A hold whose process goes from working to idle with no compaction running has no end coming: chat logs it, releases
  the held row and writes it. A `compactionEnded` after that finds no hold.
- The `Turn finished` alert skips an idle while a hold is up, and the end of a working stretch that ran only an app
  compaction, a hold's or `compact`'s.
- Labels by trigger:

  | Trigger | Dock (`Compacting…` then) | Usage chip | Divider |
  |---|---|---|---|
  | `app` | the reason (`auto · cache cold · 182k`, `auto · agents running · 214k`; `auto` when the compaction has none) | `compacting · auto` | `auto` |
  | `manual` | `/compact` | `compacting` | `manual` |
  | `harness` | `autocompact` | `compacting · autocompact` | `autocompact` |

- The held row reads `sends after compaction · <interrupt key> skips`, its key taken from the interrupt bind.

## Decisions

- **Status on three surfaces** — the dock while it runs, the usage line chip, and the divider after. The dock is
  where the user waits on a send; the chip shows on panes the user is not typing in; the divider explains the drop
  in context.
- **The trigger is named** — an unexplained pause before a send reads as the app hanging.
- **The threshold is a setting** (`auto-compact.minTokens`, default 150000; 0 turns the gate off, and so does disabling
  the plugin; a plugin setting with a number default cannot be null) — a value the user may tune lives in config, and
  the same key is the gate's off switch. Claude's idle compaction stays on at its own default either way.
- **Interrupt skips the compaction and sends the message** — a user who interrupts wants the reply now.
- **Auto-compact is its own plugin behind chat's send gate** — everything is a plugin and hookable; the next
  pre-send rule registers the same way.
- **`⌃C` skips, not `Esc`** — `Esc` in the box already leaves the box.
- **The divider is its own entry kind from the adapter** — structured fields let a layout draw it and fill the
  after-size later, and resumed history shows past compactions.
- **The after-size comes from `get_context_usage`, or the next main reply when a reply comes first** — Claude's
  `post_tokens` leaves out the system prompt and tools, and the control request answers with no model call, so the
  usage line and the divider update as soon as a compaction's turn ends. A saved transcript has only the next main
  reply, so a resumed divider can read slightly higher.
- **A compaction's first `usage` has no cache expiry** — the next reply rebuilds the cache, and the gate must not read
  the expiry from before the compaction as cold and compact the session again.
- **The app holds the message itself** rather than writing it behind `/compact` into Claude's input queue.

- **One threshold with Claude's idle compaction** (round 3) — by the code of the Claude Code 2.1.317 binary, not by
  measurement, Claude compacts an idle 1-hour-cache session before its cache expires (`idleCompaction`, on by default).
  The app passes `minTokens` to it as `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` at each process start, through
  `AgentStart.idleCompactMinTokens`. A `minTokens` of 0 passes nothing, so Claude's own default stays on: 200k by the
  binary's code, which also floors the value at 100k. The app's gate still covers what Claude's misses: a session whose
  process ended, and a 5-minute-cache session. Measured on 2.1.318, two idle processes under stream-json did not compact
  in 65 minutes, one with the user's settings excluded (`docs/features/agent-chat/claude-stream.md` § Idle compaction),
  the cause unsettled, so the gate may be all that compacts a cold session; the threshold is passed in case Claude's runs.

- **Compact during an agent wait** (2026-11-08) — the main agent sits idle while its subagents run, and every result
  they return lands on its context; compacting then costs the user no wait. It fires at once when the turn ends, with
  no delay.
- **Only sessions at a workflow level** (2026-11-08) — Light, Medium and Heavy alike; the trigger reads the
  workflow engine's flow, which tracks the main agent's subagents. Background shell tasks do not count.
- **Its own threshold** (2026-11-08) — `agentWaitMinTokens`, default 200000, 0 off, independent of `minTokens`, so
  either rule can be off while the other is on.
- **In the auto-compact plugin, through a chat export** (2026-11-08) — the rule sits beside the send gate, reading
  `workflow.flows` as a slot; chat's `compact` keeps chat the only owner of processes, and returns whether it started
  one so the rule spends the wait only on a real start.
- **Once per wait** (2026-11-08) — at most one compaction per idle stretch with subagents running, re-armed when a
  main turn starts again or the subagent list empties, so a failed compaction cannot loop.
- **The existing app surfaces** (2026-11-08) — the dock shows the reason, the chip `compacting · auto` and the divider
  `auto`, as for a hold's compaction, since both have trigger `app`.

## Rejected

- **The check inline in chat's `sendMessage`** — a hardcoded branch, and a second copy of the usage fold in chat.
- **Relying on Claude's idle compaction alone** — it never runs for a session whose process ended, which this app
  restores often, nor on the 5-minute cache.
- **An app-made info notice for the divider** — unstructured, drawn as a notice, and absent from resumed history.
- **A new `Esc` bind on the held row** — two meanings for one key in the box.
