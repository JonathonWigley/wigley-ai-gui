# Subagent lines — plan

Feature: agent tower · Implements: none · Ticket: none
Target: main · Written: 2026-10-30

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Each Chat-tab session's running subagents show as lines under its row in the Sessions side bar — a working dot, the
agent type, the description, the elapsed time and the tool-call count — and every agent event a session produces is
logged to a JSON-lines file. Underneath sit the seams the Agent Tower will build on: a harness-neutral `AgentEvent`
record the harness adapter emits, chat main forwarding it on the bus, a new `agents` plugin holding each session's
roster and log, and sessions' `addRowPart` hook.

## Architecture

Systems touched:

- **Contracts** (`src/contracts/agent.ts`, `src/contracts/files.ts`): the usage plan's `AgentEvent` union widened
  with the subagent, tool, session, compaction and user-message members; `Files.append`.
- **Files adapters** (`src/main/files/node-files.ts`, `src/shared/memory-files.ts`, `src/shared/scoped-files.ts`,
  the shared contract suite `src/shared/files-contract.test-support.ts`).
- **Claude adapter** (`src/main/claude-code/`): turns subagent, tool, compaction and user-message lines into agent
  events (the usage plan already emits `usage`), with the clock the activity-line plan wired.
  `docs/features/agent-chat/claude-stream.md` gains the measured subagent and compaction shapes first.
- **Fake harness** (`src/shared/fake-agent-harness.ts`): emits agent events, and `fake: agents` spawns two subagents.
- **Chat main** (`src/plugins/chat/contract.ts`, `src/plugins/chat/main/chat-sessions.ts`): the usage plan's
  `chat.agentEvent` payload gains `hostSessionId`, which keys the log.
- **Sessions** (`src/plugins/sessions/`): the `addRowPart` page export and the row kit's `contributedParts`.
- **New `agents` plugin** (`src/plugins/agents/`): roster reducer, main part (roster, log, channel, preview), page
  part (row part, lines), layouts.
- **Registration** (`src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`,
  `src/plugins/keymap.ts`, `scripts/check-layers.mts`).

## Preconditions

Each was run at plan time from `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`. `wigley:make` runs them
again before the first dispatch.

| Claim | Command | Result at plan time |
| --- | --- | --- |
| The target branch is `main` | `git rev-parse --abbrev-ref HEAD` | `main` |
| `main` is not behind origin | `git fetch -q origin && git rev-list --left-right --count main...origin/main` | `5 0` (local commits, unpushed) |
| The activity-line plan, which edits `fake-agent-harness.ts` and chat's `selftest-script.ts`, has landed: its plan folder is gone | `ls docs/features/agent-chat/plan-activity-line` | present, not yet run — **this plan waits for it**; tasks 04 and 10 assume its fake-harness and self-test changes are in the tree |
| The usage plan, which builds `AgentEvent` with its `usage` member, `AgentProcessEvents.agentEvent` and `chat.agentEvent`, has landed: its plan folder is gone and the union exists | `test ! -d docs/features/usage/plan-usage && grep -n 'UsageAgentEvent' src/contracts/agent.ts` | plan folder present, not yet run — **this plan waits for it**; 02–05 extend its seam |
| The chat-panes plan, which restructures the sessions side bar and edits `keymap.ts`, has landed: its plan folder is gone. 06 and 09 re-read the sessions files it changed | `test ! -d docs/features/chat-panes/plan-chat-panes` | plan folder present, not started — **this plan waits for it** |
| The usage plan's task documents exist, and 02–05's if/else branches on its choices (`recordingEvents`, the `isLive` guard on forwarding, a `DecodedLine` agent-event field, a `switch` on `event.type`) are collapsed to the branch it took, before the first dispatch | `ls docs/features/usage/plan-usage/` and read its 03 and 04 | only `plan.md` and `08-doc-re-read.md` at plan time — **re-read 02–05 against them at preflight** |
| The installed Claude CLI is the one claude-stream.md was measured on or newer | `claude --version` | `2.1.314 (Claude Code)` |
| `Files` has no `append` | `grep -n append src/contracts/files.ts` | no match |
| `Space z l a` is unbound (previews sit at `<Leader>zl` + o, p, s, c) | `grep -n "<Leader>zla" src/plugins/keymap.ts` | no match |
| claude-stream.md records no subagent turn | `grep -n -i subagent docs/features/agent-chat/claude-stream.md` | only the `parent_tool_use_id` notes (§ Stream events, § Other events) |

## Docs written ahead

Commit `fd57454` (on `main`): `docs/features/agent-tower/design.md` (the whole feature: agent events, the agents
plugin, the tower phases), `AGENTS.md` (§ Architecture tree: `agents/` and sessions' row parts; bullets "A row part"
and "An agent event"), `docs/features/layouts/design.md` (the `agents` owner row and the `Space z l a` preview row).

## Mandatory Reads

- `AGENTS.md` (the repo holds no `CLAUDE*.md`, no other `AGENTS*.md` and no `.claude/rules/`; check with
  `find . -name 'AGENTS*.md' -not -path './node_modules/*'` and `ls .claude/rules` before the first dispatch)
- `DESIGN.md` — every task that draws (06, 09)
- `docs/keymap.md` — task 09 (the preview key)
- `docs/features/agent-tower/design.md`
- `docs/features/agent-chat/claude-stream.md` — tasks 01 and 03
- `docs/features/layouts/design.md` — tasks 06 and 09

## Design Overview

### After-state flow

```
 claude stdout ─► stream-decoder / claude-code-harness ──► AgentProcessEvents.entry(ChatEntry)      (unchanged)
                  (the only reader of Claude JSON)     └─► AgentProcessEvents.agentEvent(AgentEvent) (new)
 fake harness  ───────────────────────────────────────────► same two callbacks
                                                                │
                                          chat main (chat-sessions.ts) ── api.events.emit('agentEvent',
                                                                │          { sessionId, hostSessionId, event })
                                                                ▼
                                          agents main ── foldAgentEvent(running, event) ──► roster per sessionId
                                             │  │                                              │
                                             │  └─ api.data.append('logs/<hostSessionId>.jsonl', JSON + '\n')
                                             │       (one promise chain per log file, so lines keep event order)
                                             └─ channel message rosterChanged { sessionId, running } ─┐
                                                                                                       ▼
 sessions page ─ addRowPart(part) ─► each row draw: wrapper where the row kit's contributedParts is called
                                                    (else the row's end) ─► part.build(wrapper, sessionId)
                                                                                                       │
                                          agents page ── row part: lines for that session's running list ◄┘
                                             └─ agents layout `line` part per subagent; 1 s ticker while any line shows
```

### Decisions (from the interview)

- Only Chat-tab (owned) sessions produce agent events in this change; a hooks or transcript source is later work
  that emits the same `chat.agentEvent` payload.
- The contract covers what the Claude stream produces today. Plan, plan step, retry and watcher events are left out
  until a producer exists (`agent-tower/design.md` § Agent events).
- A new `agents` plugin holds the roster, the log and the lines; sessions gains a generic `addRowPart` hook shaped
  like forms' `addCardPart`; the lines draw through the `agents` layout.
- A line per running subagent: dot, type, description, elapsed, tool-call count. It goes when the subagent finishes.
- One JSON-lines log per host session id in the agents plugin's data folder; no replay view, no pruning.
- The design doc lives in-repo at `docs/features/agent-tower/design.md`.
- One union of event records sent through one new callback; `Space z l a` opens the agents layout preview.
- Decided notices: only the adapter reads Claude JSON; the fake harness emits the same events; the CLI probe opens
  the plan; tower floors are "plan steps"; chat forwards on the bus; the adapter stamps `at` from the injected
  clock; `sessionEnded` finishes every listed subagent; the log is keyed by host session id; lines take no keys or
  focus and a click selects the session; the 1 s ticker runs only while a line shows.
- Design review (Decided): the roster reducer is pure and shared by live sessions and later replay; `Files` gains
  `append` rather than the log rewriting its file per event; the Agent tool call is reported as `agentSpawned` /
  `agentFinished` only, never also as `toolStarted` / `toolFinished`; a subagent's own tool calls count toward its
  line; the agents plugin exports nothing yet (the tower names the first consumer of an export); a background
  subagent (`run_in_background`) is finished by its own end event, never by the Agent call's launch result, unless
  that launch result is an error (03).
- Cold read (Decided): a turn's `result` finishes every foreground subagent still pending as `failed`, since an
  interrupt sends no `tool_result` for it (03, probed in 01); `sessionEnded` stays the fallback for an exit or crash.

### Out of scope

- Terminal (relay-only) sessions' subagents; replay; the tower view; plan, plan step, retry and watcher events.
- The main agent's context fill on screen: `usage` and `compacted` are emitted and logged only.
- Nested subagents: Claude subagents cannot spawn subagents, so lines are flat; `parentAgentId` is still carried.

## File Structure

### Names more than one task uses

```ts
// src/contracts/agent.ts  (02) — widens the usage plan's `AgentEvent = UsageAgentEvent`; `UsageAgentEvent` and
// `AgentProcessEvents.agentEvent(event: AgentEvent): void` come from that plan unchanged.
export const MAIN_AGENT_ID = 'main';
// One thing an agent did. `at` is epoch milliseconds from the adapter's clock. `agentId` is MAIN_AGENT_ID or a
// subagent's id (Claude: the Agent tool call's id).
export type AgentEvent =
  | UsageAgentEvent
  | { type: 'sessionStarted'; at: number }
  | { type: 'sessionEnded'; at: number }
  | { type: 'agentSpawned'; at: number; agentId: string; parentAgentId: string; agentType: string; description: string }
  | { type: 'agentFinished'; at: number; agentId: string; outcome: 'done' | 'failed' }
  | { type: 'toolStarted'; at: number; agentId: string; toolUseId: string; tool: string }
  | { type: 'toolFinished'; at: number; agentId: string; toolUseId: string; ok: boolean }
  | { type: 'compacted'; at: number; beforeTokens: number; afterTokens: number | null }
  | { type: 'userMessage'; at: number };
export type AgentEventType = AgentEvent['type'];

// src/main/claude-code/stream-decoder.ts  (03) — internal; reuses the usage plan's DecodedLine field if it made one
DecodedLine.agentEvents: AgentEventDraft[]   // each AgentEvent member without `at`; the harness stamps it

// src/contracts/files.ts  (02)
// Appends `text` to the file, creating it (and its folders, as `write` does) when missing.
append(path: string, text: string): Promise<void>;

// src/shared/fake-agent-harness.ts  (04)
export const FAKE_AGENTS_TEXT = 'fake: agents';

// src/plugins/chat/contract.ts  (05) — names and widens the usage plan's `chat.agentEvent` payload
export interface ChatAgentEvent { sessionId: string; profileDir: string | null; hostSessionId: string; event: AgentEvent }
// ChatMainEvents.agentEvent: ChatAgentEvent

// src/plugins/sessions/contract.ts  (06)
// A part another plugin draws under every session row. `build` draws into `parent`, its own wrapper in the row;
// the returned `dispose` runs before the row draws again and when the row leaves. A part that throws is logged and
// draws nothing; the row still draws.
export interface SessionRowPart {
  id: string;
  build(parent: HTMLElement, sessionId: string): { dispose?(): void };
}
// SessionsPageExports gains (throws on an id already added; the Disposable removes the part and redraws the rows):
addRowPart(part: SessionRowPart): Disposable;
// src/plugins/sessions/layouts/layout.d.ts — the row's kit gains (forms' name for the same slot):
contributedParts(parent: HTMLElement): HTMLElement;

// src/plugins/agents/contract.ts  (07)
export interface RunningAgent {
  agentId: string;
  agentType: string;
  description: string;
  startedAt: number;
  toolCalls: number;
}
export interface AgentsChannel extends ChannelShape {
  invoke: { rosters(): Record<string, RunningAgent[]>;     // keyed by the app's sessionId
            openPreview(): void };                          // added by 09, as chat's preview command does
  messages: { rosterChanged: { sessionId: string; running: RunningAgent[] } };
}

// src/plugins/agents/roster.ts  (07) — pure; `running` in spawn order. Returns `running` itself when the event
// changes nothing, so main sends only real changes.
export function foldAgentEvent(running: readonly RunningAgent[], event: AgentEvent): readonly RunningAgent[];

// src/plugins/agents/layouts/layout.d.ts  (09)
export interface SubagentLineInput { agentType: string; description: string; elapsed: string; toolCalls: number }
export interface Layout { line?(parent: HTMLElement, input: SubagentLineInput, kit: AgentsKit): AgentsPart }
```

### Existing files modified

| File | Tasks |
| --- | --- |
| `docs/features/agent-chat/claude-stream.md` | 01 |
| `src/contracts/agent.ts`, `src/contracts/files.ts` | 02 |
| `src/main/files/node-files.ts`, `src/shared/memory-files.ts`, `src/shared/scoped-files.ts`, `src/shared/files-contract.test-support.ts` | 02 |
| `src/main/claude-code/stream-decoder.ts`, `claude-code-harness.ts` and their tests | 03 |
| `src/main/main.ts` | none expected: the activity-line plan already wires `ClaudeCodeHarnessDeps.clock` and `createFakeAgentHarness(clock)`; 03 adds the Claude clock only if its grep finds it missing |
| `src/shared/fake-agent-harness.ts` and its test | 04 |
| `src/plugins/chat/contract.ts`, `src/plugins/chat/main/chat-sessions.ts`, `chat-sessions.test.ts` | 05 |
| `src/plugins/chat/main/start.ts` | 04 (the drive `start` action's list of fake texts gains `fake: agents`) |
| `src/plugins/sessions/contract.ts`, `page/start.ts`, `page/layout/*`, `layouts/layout.d.ts`, `layouts/default/layout.js` | 06 |
| `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`, `scripts/check-layers.mts` | 07 (manifest), 08 (main part), 09 (page part) — sequential waves |
| `src/plugins/keymap.ts` | 09 |

### New files

- `src/plugins/agents/manifest.ts`, `contract.ts`, `roster.ts`, `roster.test.ts` (07) — the plugin and its pure
  reducer, which replay will reuse.
- `src/plugins/agents/main/start.ts`, `agent-log.ts` (+ tests) (08) — roster per session, the log's per-file append
  chain.
- `src/plugins/agents/main/preview.ts` (09), `src/plugins/agents/main/selftest-script.ts` (10).
- `src/plugins/agents/page/start.ts`, `page/subagent-lines.ts`, `page/elapsed.ts` (+ test), `agents.css` (09).
- `src/plugins/agents/layouts/layout.d.ts`, `layouts/default/layout.js`, `page/layout/read-agents-layout.ts` (09) —
  the layout contract, `default` and its reader; tests `page/subagent-lines.test.ts`, `main/preview.test.ts`.
- `src/plugins/sessions/page/row-parts.ts` (+ test) (06) — the row parts' build and dispose bookkeeping. 06 also
  edits `sessions-view.ts`, `sessions-view-fakes.ts` and `sessions.css`, and adds a `RowKit` for the row part only;
  `sidebar-view.ts` stays unchanged, the parts placed inside the row's layout draw so its rollback disposes them.
- 09 also edits `docs/keymap.md` (`zla` in the `zl` row).

### Boundary rules

- Only `src/main/claude-code/` reads Claude's JSON; nothing in `src/plugins/` names `Agent`, `Task`,
  `parent_tool_use_id` or any Claude field.
- `agents` depends on `sessions`, `chat` and `keys` (manifest `dependsOn`; `keys` because its layout kit's prompts
  come from the keys plugin, as every layout owner's do), and imports only their `contract.ts` files.
- Sessions names no agents type: its row part hook is generic.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Probe the CLI's subagent stream](01-probe-subagent-stream.md)
- [x] [Agent event contract and Files.append](02-agent-event-contract.md)
- [x] [Sessions row parts](06-sessions-row-parts.md)

### Wave 2
- [ ] [Claude adapter emits agent events](03-claude-agent-events.md) — after 01, 02
- [x] [Chat forwards agent events](05-chat-forwards-agent-events.md) — after 02
- [x] [Agents plugin: manifest, contract, roster](07-agents-roster.md) — after 02

### Wave 3
- [ ] [Fake harness emits agent events](04-fake-agent-events.md) — after 02, 03
- [ ] [Agents main: rosters, log, channel](08-agents-main.md) — after 02, 05, 07

### Wave 4
- [ ] [Agents page: lines, layout, preview](09-agents-page.md) — after 06, 08

### Wave 5
- [ ] [Agents self-test](10-agents-selftest.md) — after 04, 09

### Wave 6
- [ ] [Doc re-read](11-doc-re-read.md) — after every task above

### Wave 7
- [ ] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: 66fec31

### Groups
- 02 · a9e56d7 · diff read: MAIN_AGENT_ID, widened AgentEvent, AgentEventType, Files.append in node/memory/scoped present; typecheck clean for these files; worker ran the three test files (107 pass) and lint · concerns: usage/main/start.ts:71 still compares agentId to the literal 'main' (outside Files); append comment leaves out the plan's pointer to 08 per writing-code Comments; AGENTS.md files/ line does not list append (doc re-read, 11)
- 06 · f6ec263 · diff read: SessionRowPart, addRowPart, RowKit and Layout.row(kit: RowKit), SessionRowParts/createSessionRowParts present; typecheck clean; row-parts and sessions-parts tests 17 pass · concerns: dispose-failed log and placed-twice throw have no test (not in the Tests list); sessions.css row comment still names the harness, stale only under the uncommitted non-run layout.js edit; layout.js committed with only the worker's two lines, the uncommitted detail:null edit left in the tree
- 05 · 30227b4 · diff read: ChatAgentEvent and ChatMainEvents.agentEvent present, hostSessionId = session.hostId; typecheck clean; worker ran chat-sessions.test.ts (102 pass) and lint · concerns: usage/main/start.test.ts sends chat.agentEvent payloads without hostSessionId (loosely typed emit, outside Files); describe block still named 'usage forwarding'
- 07 · d8856ba · diff read: agentsManifest, RunningAgent, AgentsChannel, foldAgentEvent present; typecheck clean; worker ran roster.test.ts (15 rows) and lint · concerns: agentsManifest is listed before keysManifest, which it depends on; nothing starts a part yet, so 08/09 prove list order does not matter
### Contract changes
### Rulings
- MAIN_AGENT_ID and AgentEventType added (absent before); widening flagged no switch, usage main already narrows on type 'usage' — none — a missed site would fail typecheck · group 02 · group 02
- the end-of-row append calls requireElementIn first, so a row returning no element fails with the draw's own message — only a broken user row's log text changes if wrong · group 06 · group 06
- the view does not keep the rowParts.onChanged handle: view and registry share the page load's lifetime — a listener leaks only if the view outlives its registry · group 06 · group 06
- forwarding was under isLive, so the guard stays for every event but sessionEnded, which is forwarded after the row closes — wrong means a late usage reaches usage, or a closed row's roster never empties · group 05 · group 05
- exhaustiveness is 'return event satisfies never' after a default-less switch — a type outside the union (a hand-edited log in replay) returns the event, not an array · group 07 · group 07
### Review rounds
### Test gate
