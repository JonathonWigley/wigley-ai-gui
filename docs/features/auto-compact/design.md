# Auto-compact — settled design

**Contents**

- **Intent** — why a cold-cache send compacts first, and why every compaction shows.
- **Vocabulary** — compaction, trigger, auto-compact, send gate, hold, compaction entry.
- **Flow** — from a send to the held row's release, and from the harness to the three surfaces.
- **Records** — the harness-neutral shapes that cross each seam.
- **Rules** — when the gate holds a send, what a skip does, and what each surface shows.
- **Decisions** — what the user settled on 2026-11-03, with the reason for each.
- **Rejected** — the alternatives weighed and why each lost.

The decisions from the 2026-11-03 interview, kept so a later change does not reopen them. How Claude prints a
compaction is in `docs/features/agent-chat/claude-stream.md` § Compaction; how each surface looks is in `DESIGN.md`.

## Intent

A message sent to a session whose prompt cache went cold re-reads the whole context uncached. Above about 150k
tokens the turns that follow also carry that large context. The user wants such a send to compact first, so the
message and every turn after it run on the small context. The user also wants to see every compaction while it runs
and after it ends, whatever started it: the user's `/compact`, the harness's own autocompact, or this feature.

## Vocabulary

- **Compaction** — the harness replaces the conversation with a summary. It has a start, an end and a trigger.
- **Trigger** — what started a compaction: `app` (the app called `AgentProcess.compact()`), `manual` (the user sent
  `/compact`), `harness` (the harness compacted on its own; Claude's autocompact).
- **Auto-compact** — the `auto-compact` plugin. It registers a send gate that holds a send to a session whose cache
  is cold and whose context is above its `minTokens` setting (`"auto-compact": { "minTokens": … }` in
  `settings.json`).
- **Send gate** — a function a plugin registers through chat main's `addSendGate`. Chat asks every gate before it
  writes a message to an idle session. A gate answers a hold or nothing.
- **Hold** — chat keeps the message as a pending row, compacts the session, and writes the row when the compaction
  ends. The row carries the gate's reason.
- **Compaction entry** — the `compaction` chat entry kind: the transcript's `Compacted 182k → 24k · auto · 9s` divider.
  The adapter makes it, live and from a saved transcript.

## Flow

```
user sends ─▶ chat main sendMessage ─▶ session idle? ── no ──▶ queue as today
                                          │ yes
                                          ▼
                              ask each send gate (auto-compact's)
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

## Records

- `CompactionTrigger = 'app' | 'manual' | 'harness'` in `src/contracts/agent.ts`.
- `AgentEvent` members `compactionStarted { at, trigger }` and
  `compactionEnded { at, trigger, outcome: 'done' | 'failed' | 'interrupted', beforeTokens, durationMs }`. They
  replace `compacted`. The adapter sends exactly one `compactionEnded` for each `compactionStarted`: on the
  harness's end line, on a failed result, on an interrupt, and before `sessionEnded` when the process ends mid-way.
- `ChatEntry` kind `compaction { id, at, trigger, beforeTokens, afterTokens, durationMs, raw }`. `afterTokens` is null
  until the next main reply's context is known; the adapter then emits the same entry id again with it set.
- `AgentProcess.compact()` starts a compaction with trigger `app`. It throws after `end` and while a turn runs. It
  makes no user entry.
- Chat main's export `addSendGate(gate: SendGate): () => void`, with
  `SendGate = (input: SendGateInput) => SendGateVerdict | null`, `SendGateInput { sessionId, profileDir, now }`, and
  `SendGateVerdict { action: 'compact'; reason: string }`.
- `ChatSessionState.compaction: { trigger, reason, startedAt } | null` and `QueuedMessage.holdReason: string | null`.
- The usage snapshot's `SessionUsage.compaction: { trigger, startedAt } | null`, and the session line input's
  `compacting: string | null`.

## Rules

- The gate holds a send only when all hold: the session is idle; the plugin has a main-agent `usage` event for it;
  that event's `cacheExpiresAt` is not null and is at or before now; its `contextTokens` is above
  `minTokens`; and `minTokens` is not 0. Its reason reads
  `auto · cache cold · <tokens>`, the tokens in the usage plugin's `182k` format.
- A message sent while the hold is up queues behind the held row, in order.
- Interrupt (`chat.interrupt`, `⌃C`) or send-now (`⌘↩`) on a held row skips the compaction. Chat interrupts the
  process and writes the held row when `compactionEnded` arrives. The adapter's interrupt grace makes that arrive
  within 5 s.
- The process ending during a hold returns the held row to the box, as every pending row is returned today.
- Labels by trigger:

  | Trigger | Dock (`Compacting…` then) | Usage chip | Divider |
  |---|---|---|---|
  | `app` | the gate's reason (`auto · cache cold · 182k`) | `compacting · auto` | `auto` |
  | `manual` | `/compact` | `compacting` | `manual` |
  | `harness` | `autocompact` | `compacting · autocompact` | `autocompact` |

- The held row reads `sends after compaction · <interrupt key> skips`, its key taken from the interrupt bind.

## Decisions

- **Status on three surfaces** — the dock while it runs, the usage line chip, and the divider after. The dock is
  where the user waits on a send; the chip shows on panes the user is not typing in; the divider explains the drop
  in context.
- **The trigger is named** — an unexplained pause before a send reads as the app hanging.
- **The threshold is a setting** (`auto-compact.minTokens`, default 150000; 0 turns it off,
  and so does disabling the plugin; a plugin setting with a number default cannot be null) — a value the
  user may tune lives in config, and the same key is the off switch.
- **Interrupt skips the compaction and sends the message** — a user who interrupts wants the reply now.
- **Auto-compact is its own plugin behind chat's send gate** — everything is a plugin and hookable; the next
  pre-send rule registers the same way.
- **`⌃C` skips, not `Esc`** — `Esc` in the box already leaves the box.
- **The divider is its own entry kind from the adapter** — structured fields let a layout draw it and fill the
  after-size later, and resumed history shows past compactions.
- **The after-size comes from the next main reply** — Claude's `post_tokens` leaves out the system prompt and tools.
- **The app holds the message itself** rather than writing it behind `/compact` into Claude's input queue.

- **One threshold with Claude's idle compaction** (round 3) — Claude Code 2.1.317 compacts an idle 1-hour-cache
  session before its cache expires (`idleCompaction`, on by default). The app passes `minTokens` to it as
  `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` at each process start, through `AgentStart.idleCompactMinTokens`. The app's gate
  still covers what Claude's misses: a session whose process ended, and a 5-minute-cache session.

## Rejected

- **The check inline in chat's `sendMessage`** — a hardcoded branch, and a second copy of the usage fold in chat.
- **Relying on Claude's idle compaction alone** — it never runs for a session whose process ended, which this app
  restores often, nor on the 5-minute cache.
- **An app-made info notice for the divider** — unstructured, drawn as a notice, and absent from resumed history.
- **A new `Esc` bind on the held row** — two meanings for one key in the box.
