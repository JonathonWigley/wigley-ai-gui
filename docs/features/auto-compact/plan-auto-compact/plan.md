# Auto-compact — plan

Feature: auto-compact · Implements: none · Ticket: none
Target: main · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

When the user sends a message to an idle session whose prompt cache is cold and whose context is above
`auto-compact.minTokens` (default 150000), the app compacts the session first, holds the message as a pending row,
and writes it when the compaction ends. Every compaction shows while it runs and after it ends, whatever started it
(the app, the user's `/compact`, the harness's autocompact): in the activity dock, in the session's usage line, and
as a divider entry in the transcript.

## Architecture

Systems touched, all in this repo:

- **Harness contract** (`src/contracts/agent.ts`) — new `CompactionTrigger`, `compactionStarted` and
  `compactionEnded` agent events (replacing `compacted`), the `compaction` chat entry kind, `AgentProcess.compact()`.
- **Claude adapter** (`src/main/claude-code/`) — decodes Claude's compaction lines into the events and the entry,
  live and from a saved transcript; implements `compact()`; guarantees one end per start.
- **Fake harness** (`src/shared/fake-agent-harness.ts`) — the same contract, scriptable for tests, self-test and drive.
- **Chat plugin** (`src/plugins/chat/`) — main: the send gate extension point, the hold, the session's compaction
  state, skip on interrupt or send-now. Page and default layout: the dock's `compacting` state, the held row label,
  the divider entry.
- **Usage plugin** (`src/plugins/usage/`) — folds the compaction events; the session line's `compacting` chip and
  pulsing meter.
- **Auto-compact plugin** (`src/plugins/auto-compact/`, new) — main only: keeps each session's latest main-agent
  usage and registers the send gate; its setting `auto-compact.minTokens`.
- **Agents roster** (`src/plugins/agents/roster.ts`) — the exhaustive event switch.

## Preconditions

Re-run each before the first dispatch.

- Claude Code is installed at 2.1.317: `claude --version` → `2.1.317 (Claude Code)`. Task 01 measures this version.
- `main` is checked out and holds the docs commit: `git -C <repo> log --oneline -1 -- docs/features/auto-compact/design.md`
  → `32113b66`.
- `origin/main` freshness: `git fetch origin` failed at plan time with `Permission denied (publickey)` through the
  `github-personal` alias (the 1Password SSH agent). Re-run it. When it succeeds and `main` is behind, bring `main` up
  to date first.
- No user layout overrides the chat or usage contracts: `ls ~/.config/wigley-ai-gui/layouts/chat ~/.config/wigley-ai-gui/layouts/usage`
  → `layout.d.ts` alone in each.
- Peer plans touch the same files. At plan time three were written and not yet run:
  - `docs/features/chat-bar/plan-agent-cards/` — `src/contracts/agent.ts` (`agentReplied`, `agentLaunched`), the
    Claude adapter, the fake harness, `src/plugins/agents/roster.ts` (overlaps tasks 02 and 03)
  - `docs/features/session-clock/plan-row-clock/` — `chat-sessions.ts`, `open-sessions.ts`, the usage row parts
    (overlaps tasks 04 and 05)
  - `docs/features/session-groups/plan-session-groups/` — the sessions layouts (no overlap)

  Check each with `ls docs/features/chat-bar/plan-agent-cards docs/features/session-clock/plan-row-clock` (a plan
  folder still present is a run not yet closed). Run this plan after a peer run that touches the same file has
  landed, or ask the user for the order. Each task reads its files at the tip it starts from, never from this plan's
  line numbers. Leave every peer's uncommitted file alone.

- Typecheck breaks between waves. `npm test` (Vitest) does not type-check. From task 02 until task 06 lands,
  `npm run typecheck` fails in files a later task owns: the fake harness's missing `compact()` (03), and the page's
  entry-kind sets (`read-chat-layout.ts`, `entry-list.ts`, `chat-layouts.ts`) until `layout.d.ts` gains `compaction`
  (06). Each task's proof filters typecheck output to its own files; task 09 runs the whole typecheck. The series
  lands together, so a mid-series commit that does not type-check is accepted.

## Docs written ahead

Commit `32113b66`:

- `docs/features/auto-compact/design.md` — the settled design: vocabulary, flow, records, rules, label table,
  decisions. Every task reads it.
- `AGENTS.md` § Architecture — the **send gate** bullet.
- `DESIGN.md` — Usage (the `compacting` chip and pulse) and Chat (the dock's `Compacting…` state, the held row, the
  divider).
- `docs/features/agent-tower/design.md` § Agent events — `compactionStarted` and `compactionEnded` rows.
- `docs/features/usage/design.md` § The usage plugin — the line's chip and the compaction fold.

## Mandatory Reads

- `AGENTS.md` (repo root; the only `AGENTS*.md` outside `.drive/` fixtures; no `.claude/rules/`)
- `docs/features/auto-compact/design.md`
- `DESIGN.md` — tasks 04 and 06
- `docs/keymap.md` — task 05
- `docs/features/agent-chat/claude-stream.md` § Compaction, § Interrupt, § Queued messages, § Message lifecycle —
  tasks 01 and 02
- `docs/features/usage/design.md` — task 04

## Design Overview

```
user sends ─▶ chat main sendMessage ─▶ idle? ── no ──▶ queue (as today)
                                         │ yes
                                         ▼
                             each SendGate(input) ◀── auto-compact plugin (latest main usage per session,
                               │ null        │ verdict                    auto-compact.minTokens)     
                               ▼             ▼
                        deliver (today)   pending row { holdReason }, process.compact()

adapter ─▶ compactionStarted{trigger} ─▶ chat main: state.compaction ─▶ page dock `Compacting… <label>`
                                     └─▶ chat.agentEvent ─▶ usage main: SessionUsage.compaction ─▶ line chip
adapter ─▶ ChatEntry compaction (afterTokens filled by a re-emit) ─▶ transcript divider
adapter ─▶ compactionEnded{…} ─▶ chat main: state.compaction = null; write the held row
⌃C / ⌘↩ on a held row ─▶ chat main: process.interrupt(); row written on compactionEnded
```

Claude's own idle compaction (2.1.317, `idleCompaction`, on by default) compacts an idle 1-hour-cache session before
its cache expires. It runs beside this feature: when it fires, the context is small by the time the cache is cold,
so the gate does not hold. The app passes its threshold to it (round 3), and its compactions show as trigger
`harness`.

Out of scope: a compaction status on the agents roster or the Agent Tower (the roster treats both events as no-ops);
the details bar in the right bar; Claude's `/compact <instructions>` argument from the app's own compact.

Decisions (the interview, 2026-11-03): see `design.md` § Decisions. Also:

- Harness-neutral copy: the harness trigger reads `autocompact`, never a harness name, since chat and usage know no
  harness.
- The app's compact makes no user entry; a user-typed `/compact` keeps its user entry and `skillStarted`.
- An unknown cache expiry or no main usage yet never holds a send.

## File Structure

### Shared names and signatures

Every task uses these names verbatim.

`src/contracts/agent.ts` (task 02):

```ts
export type CompactionTrigger = 'app' | 'manual' | 'harness';
// AgentEvent members, replacing `{ type: 'compacted'; … }`:
| { type: 'compactionStarted'; at: number; trigger: CompactionTrigger }
| { type: 'compactionEnded'; at: number; trigger: CompactionTrigger;
    outcome: 'done' | 'failed' | 'interrupted'; beforeTokens: number | null; durationMs: number | null }
// ChatEntry member:
| { kind: 'compaction'; id: string; at: number; trigger: CompactionTrigger;
    beforeTokens: number | null; afterTokens: number | null; durationMs: number | null; raw: unknown[] }
// AgentProcess member:
compact(): void;   // throws after `end`, and while a turn runs (activity not 'idle')
```

Fake harness (task 03), in `src/shared/fake-agent-harness.ts`:

- `FAKE_COMPACT_TEXT = 'fake: compact'` — a turn that runs a compaction with trigger `harness`.
- `FAKE_COLD_TEXT = 'fake: cold'` — an echo turn whose main `usage` event has `contextTokens: 200000` and
  `cacheExpiresAt` equal to its `at` (the cache is cold at once).
- A sent `/compact` runs a compaction with trigger `manual`; `process.compact()` runs one with trigger `app`.
- `FakeAgentHarness.holdCompactions(): void` and `releaseCompactions(): void` — while held, a started compaction
  ends only on release or interrupt.
- `FakeAgentCall` gains `{ method: 'compact' }`.

`src/plugins/chat/contract.ts` (task 05):

```ts
export interface SendGateInput { sessionId: string; hostSessionId: string; profileDir: string; text: string; now: number }
export interface SendGateVerdict { action: 'compact'; reason: string }
export type SendGate = (input: SendGateInput) => SendGateVerdict | null;
export interface SessionCompaction { trigger: CompactionTrigger; reason: string | null; startedAt: number }
// ChatMainExports gains:   addSendGate(gate: SendGate): () => void;
// ChatSessionState gains:  compaction: SessionCompaction | null;
// QueuedMessage gains:     holdReason: string | null;
// ChatChannel message:     'compaction': { sessionId: string; compaction: SessionCompaction | null }
```

`reason` is the gate's reason for trigger `app`, else null. A gate keys its state by `hostSessionId`: `/clear` keeps
the row's `sessionId` and starts a new host session.

`AgentStart.idleCompactMinTokens: number | null` (task 02): the context size above which the harness may compact an
idle session on its own; null leaves the harness default. The Claude adapter passes it as
`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`. `ChatMainExports.addIdleCompactThreshold(read: () => number | null): () => void`
(task 05) fills it at each process start; the auto-compact plugin (task 07) registers `minTokens > 0 ? minTokens : null`.

Drive actions (task 05, consumed by task 09): `chat.holdCompactions` and `chat.releaseCompactions`, over the fake
harness's `holdCompactions` and `releaseCompactions`.

`src/plugins/chat/layouts/layout.d.ts` (task 06):

- `WorkingState` gains `'compacting'`; `LiveWorkingInput` gains `compaction: string | null` (the dock's trigger label).
- `QueuedMessageInput` gains `holdReason: string | null` and `skipKey: string` (the interrupt bind's label).
- `EntryKind` gains `compaction`; its input `CompactionInput { kind: 'compaction'; id; at; trigger: CompactionTrigger;
  beforeTokens; afterTokens; durationMs; raw }`. `CompactionTrigger` is declared again in `layout.d.ts`, since a layout
  contract imports only the kit.
- `ChatKit.tokens(count: number): string` — tokens in the shared format (`182k`).

`src/shared/format-tokens.ts` (task 04): `export function formatTokens(tokens: number): string`, moved without change
from `src/plugins/usage/page/usage-format.ts`. Chat's page (06) and the auto-compact gate (07) use it.

`src/plugins/usage/` (task 04): `SessionUsage.compaction: { trigger: CompactionTrigger; startedAt: number } | null`;
`SessionLineInput.compacting: string | null`.

`src/plugins/auto-compact/` (task 07): manifest id `auto-compact`, setting `minTokens: number` (default 150000; 0 is off)
read as `api.settings().minTokens` at each ask; the user writes `"auto-compact": { "minTokens": … }`;
`dependsOn: ['chat']`. The gate takes its time from `SendGateInput.now`, no clock.

### Existing files modified

- `src/contracts/agent.ts`, `src/main/claude-code/{stream-decoder,claude-code-harness,turn-tracker,transcripts,claude-launch}.ts`
  and their tests — task 02
- `src/plugins/agents/roster.ts`, `roster.test.ts` — task 02
- `docs/features/agent-chat/claude-stream.md` — task 01
- `src/shared/fake-agent-harness.ts`, `fake-agent-harness.test.ts` — task 03
- `src/plugins/usage/{contract.ts,main/*,page/*,layouts/*}` — task 04
- `src/plugins/chat/{contract.ts,main/*}`, `src/plugins/chat/page/chat-commands.ts`, and one `QueuedMessage` literal
  in `src/plugins/chat/page/entry-list.test.ts` — task 05
- `src/plugins/chat/page/*` (but `chat-commands.ts`), `src/plugins/chat/layouts/*`,
  `src/plugins/chat/main/preview/preview-session.ts`, `chat-preview.test.ts`, and one step in
  `src/plugins/chat/main/selftest-script.ts` — task 06 (after 05, so no wave shares a file)
- `src/plugins/manifests.ts`, `src/plugins/main.ts` — task 07

### New files

- `src/shared/format-tokens.ts` and its test — task 04: the token format moves out of the usage page, since chat's
  page and the auto-compact plugin cannot import usage (usage depends on chat).
- `src/plugins/auto-compact/manifest.ts`, `main/start.ts`, `main/send-gate.ts` and tests — task 07: a plugin, so the
  gate registers through chat's extension point and turns off with `plugins.disabled`.

### Boundary rules

- Only `src/main/claude-code/` knows `/compact`, `system/status`, `compact_boundary` or `compact_metadata`.
- Chat main and the usage plugin read only `AgentEvent`s and chat entries. The page reads only chat state and entries.
- The auto-compact plugin reaches chat only through `ChatMainExports.addSendGate` and the `chat.agentEvent` bus event.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Probe Claude's compaction lines](01-probe-claude-compaction.md)

### Wave 2
- [x] [Compaction contract and Claude adapter](02-compaction-contract-and-claude-adapter.md) — after 01

### Wave 3
- [x] [Fake harness compaction](03-fake-harness-compaction.md) — after 02

### Wave 4
- [x] [Usage line compacting chip](04-usage-compacting-chip.md) — after 02, 03
- [x] [Chat send gate and hold](05-chat-send-gate-and-hold.md) — after 02, 03

### Wave 5
- [x] [Chat page: dock, held row, divider](06-chat-page-dock-row-divider.md) — after 04, 05
- [x] [Auto-compact plugin](07-auto-compact-plugin.md) — after 04, 05

### Wave 6
- [ ] [Doc re-read](08-doc-re-read.md)

### Wave 7
- [ ] [Final verification](09-final-verification.md)

## Run log

Review base: 693cb8d04eb48c87e6cba0406a0e2d850f90db54

### Groups
- 01 · 30dee62d · diff read: five subsections and Idle compaction setup present, version lines and Not measured updated; doc only; probe F still running detached · concerns: settings.json env sets the autocompact override past the app's strip; idle compaction may be silent under -p; an automatic attempt can fail at once with too_few_groups
- 02 · ae15b8b7 · diff read, every Produces found by search; typecheck errors only in tasks 03, 05, 06's files plus activity-runs.test.ts and working-turn.test.ts, given to 06; worker's Vitest and lint green · concerns: refused /compact draws its reason twice; interrupted compact() draws Interrupted and Compaction canceled on a skip; a queued typed /compact behind an interrupted turn gets a false interrupted end; settings.json env may override the idle threshold; interim undefined env until 05
- 03 · 7fdb2af9 · diff read, every Produces found by search; typecheck has no fake-agent-harness errors; worker's file 108/108 · concerns: compact() does not refuse during a fake workflow turn, which never sets isTurnOpen, so the fake is looser than the contract there; a late-permission guard was added beyond the plan
- 04 · 0a250f53 · diff read, every Produces found by search; typecheck clean in usage and format-tokens; worker's 191 usage tests green; self-test and capture deferred to the lead's run after 05 · concerns: the compacting step pins cache 42m, so a run reaching it 30 s after the seed reads 41m; start.ts compactions wiring has no unit test and the self-test settles it; box focus after the narrow group is assumed
- 05 · 763eeea0 · Diff read against Produces: addSendGate, addIdleCompactThreshold, SendGate types, SessionCompaction, holdReason, compaction channel event, holdCompactions and releaseCompactions drive actions, ChatDriveDeps.harnesses; typecheck errors left only in task 06's page files; chat vitest green per worker · concerns: Refused /compact draws its reason twice; pull-back window between compact() and compactionStarted; Turn finished alert can fire for a compaction whose row was pulled back; start.ts compactions wiring has no unit test
- 07 · 6522eec6 · Diff read: manifest, send-gate fold and verdict, start wiring, layer rules, plugin lists; lead reran auto-compact tests, 30 pass; app start with the plugin is proven at the lead's self-test after wave 5 · concerns: A compaction's result line may refill the dropped usage with pre-compaction tokens; lastUsage re-emitted at restore may predate a compaction; each costs one needless compaction
- 06 · 23e805df · Diff read against Produces: dock compacting state, bar, held row label with skip key, divider entry, ChatKit.tokens, compactionLabel, composerInputOf, preview entry; lead reran whole-tree typecheck, clean; worker ran 919 chat tests and lint, clean · concerns: chat-view compaction handler and the divider cursor stop have no unit test; a long gate reason may overflow the dock head; bar look is unseen until task 09
### Contract changes
- Compaction state and events: claude-code-harness.ts handleLine → session-fold.ts SessionFoldState.compaction, with new exports foldProcessClosed and nextFoldDeadline, plus compact() writing under appCommandUuid so a replay reads it as the app's · why: at the tip the line logic lives in the fold the session host extracted, and an attach replays it · consumers: none outside the adapter · group 02
### Rulings
- Worktree run on branch auto-compact from main 693cb8d0, at the user's word, driven by absolute paths since EnterWorktree needs a consent dialog this session cannot show; node_modules is a symlink to the main clone's, as foundation-sweeps does; the Unity boundary in worktree-runs.md does not apply, so typecheck, Vitest and the drive run here — wrong only if a test needs the main tree · lead
- Probes measure the installed Claude 2.1.318, not the plan's 2.1.317: the auto-updater moved it, the app launches what is installed, and every lever the plan names is in the 2.1.318 binary — a 2.1.317-only behaviour would go unmeasured · lead
- Wave 2 does not wait for probe F's 65 minutes: task 02 ships the env pass-through and reads idle compaction as trigger harness whatever F shows, so F's result rewords docs only and lands when it ends — task 02 would need a change if F shows a line shape A did not · lead
- Decoder drops the Compaction failed notice for compact_error API Error: Request was aborted. (the plan's row for a distinct interrupt text) and for too_few_groups (probe A: a routine automatic attempt that fails at once while the turn goes on), since an error notice there reports nothing wrong — other errors keep it · lead · group 01
- Task 01 no-compaction branch stays as a guard though probe E shows a refused /compact prints compacting then a failed status: that path is what the table names, and the terminal-frame path still covers a command that never compacts — dead code if Claude never does this · lead
- Missed consumers activity-runs.test.ts and working-turn.test.ts go to task 06 with the other page entry-kind tables — the same switch, and 06 owns that folder — none if 06 misses them, since task 09's whole typecheck names them · lead
- A compact(); interrupt() in one tick still emits compactionStarted, paired with the interrupter's end, since the row requires exactly one of each · group 03 · group 03
- writeNextQueued refuses whenever any hold is up; gates are asked before the unsent-rows-first branch; replayed compaction events update state.compaction; profileDir also set in attachProcess; an attach carries idleCompactMinTokens null; restAfterFailedAttach clears compaction · group 05
- Self-test runs by the lead only after wave 5: workers share .selftest/ and the page needs task 06's compaction kind first. chat-view.test.ts stateOf literal, activity-runs.test.ts and working-turn.test.ts go to task 06.
- sendGateVerdict(usage, minTokens, text, now); the fold takes replayed events so a re-attach rebuilds the map · group 07
- The compacting log line is alsoExpect on the after cold step, not its own step: it is logged once during that step, and a later step's mark would miss it · group 06
### Review rounds
### Test gate
