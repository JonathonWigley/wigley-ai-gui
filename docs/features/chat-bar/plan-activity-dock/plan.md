# Activity dock — plan

Feature: chat bar (`docs/features/chat-bar/design.md`) · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the user sees when the plan lands.
- **Architecture** — the systems the plan touches.
- **Preconditions** — the repository facts the plan rests on, each with its command.
- **Docs written ahead** — the docs already changed to the after-state.
- **Mandatory Reads** — the rule files every task reads first.
- **Design Overview** — the after-state flow, out of scope, the decisions and the drafter's decisions.
- **File Structure** — every file the plan changes or adds, and every shared name, signature and type.
- **Tasks** — the checklist by wave.
- **Run log** — written by `wigley:make`.

## Goal

The Chat transcript shows messages only. The live activity moves into one row inside the floating composer: the
**activity dock**. While a turn runs, the dock shows the turn time `m:ss` and the state word, the main agent's
latest 3 tool calls and the main agent's tool counts. When the turn ends, the dock shrinks to one dim line, such as
`Done · 1m 05s · $0.57 · Bash 6 · Read 2`, and keeps it until the user sends the next message. Idle with no finished
turn, the dock takes no space. The transcript no longer draws activity lines, their step rows or `result` entries,
and those rows are no cursor stops. This is the default look of every chat session; a user chat layout that sets
`activityInTranscript: true` gets the activity lines and result rows back.

## Architecture

- **Agent contract and adapters** — `src/contracts/agent.ts` (`ChatEntry` `tool` gains `agentId`), the Claude
  decoder and transcript reader (`src/main/claude-code/`), the fake harness (`src/shared/fake-agent-harness.ts`),
  the chat preview session.
- **Chat layout contract and default layout** — `src/plugins/chat/layouts/layout.d.ts`, `default/layout.js`: the
  `done` state of `WorkingInput`, `ComposerKit.working`, the `activityInTranscript` flag.
- **Chat page** — `chat-layouts.ts` and `read-chat-layout.ts` (the flag), `working-turn.ts` and a new
  `activity-dock.ts` (the dock's data), `composer-kit.ts` (the working slot and the dock's draws), `entry-list.ts`
  (hiding rows, the working block gone), `chat-view.ts` (wiring), `chat.css`.
- **Self-test scripts** — chat's, and the comments in agent-strip's and agent-lines'.

## Preconditions

Each was run at plan time from the repo root (`/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`).
`wigley:make` runs each again before the first dispatch.

1. A peer has uncommitted edits in `AGENTS.md` only: one new paragraph near the top (the user-layout paragraph,
   after "the rule for which key an action takes."). No task edits that paragraph. Command: `git status --short` —
   lists ` M AGENTS.md` and this plan folder (`?? docs/features/chat-bar/plan-activity-dock/`, until the lead
   commits it); `git diff -U0 AGENTS.md` shows one hunk, `@@ -18,0 +19,9 @@`. **Peer hunks rule:** when a task's
   commit touches a file that holds a peer's uncommitted edits (`AGENTS.md` in task 08, or any file the preflight
   re-run finds dirty), the task stages only its own hunks (`git diff <file>` cut to the task's hunks, then
   `git apply --cached <patch>`) and never stages the peer's. When the task's hunk and the peer's hunk overlap so
   that they cannot be cut apart, the task leaves its own edit in that file uncommitted and names it in its report.
2. Chat entries are not persisted by the app. `open-sessions.json` holds each row's `hostSessionId`, `projectDir`,
   `profile`, `sent`, `busy` and `titles` only; a restored session's entries come again from Claude's own transcript
   (`loadHistory` → `transcriptEntries`), and main holds live entries in memory. So `agentId` needs no shim for older
   data. Command: `grep -n "interface SavedSession" -A 11 src/plugins/chat/main/open-sessions.ts` — no `entries`
   field.
3. The transcript reader skips a subagent's lines, so every tool entry it builds is the main agent's. Command:
   `grep -n "isSidechain" src/main/claude-code/transcripts.ts` — line 157 skips `line.isSidechain === true`.
4. Every tool entry the app builds comes from one of these sites (measured at plan time, re-verify):
   `toolUseEntry` in `src/main/claude-code/tool-entries.ts` (called by `stream-decoder.ts` `toolEntry` and by
   `transcripts.ts`), the `kind: 'tool'` literals in `src/shared/fake-agent-harness.ts` (6) and in
   `src/plugins/chat/main/preview/preview-session.ts` (3). Command:
   `grep -rn "toolUseEntry(\|kind: 'tool'," src --include='*.ts' | grep -v '\.test\.ts'`.
5. The Claude decoder already names a line's agent: `agentOf(event)` in `src/main/claude-code/stream-decoder.ts`
   returns `parent_tool_use_id` when it is a string, else `MAIN_AGENT_ID`. Command:
   `grep -n "function agentOf" -A 5 src/main/claude-code/stream-decoder.ts`.
6. The agent-strip and agent-lines self-tests select `.chat-working-action` (their `scrollsItself` lists). Command:
   `grep -n "chat-working-action" src/plugins/*/main/selftest-script.ts`.
7. No layout contract in the repo has a non-function member yet, so `activityInTranscript` is the first; the reader
   (`requireLayoutParts`) rejects any non-function part. Command:
   `grep -n "is not a function" src/shared/page/layout-host/read-layout-module.ts`.
8. `ChatPartName` is `Exclude<keyof ChatLayout, 'entries'>` and drives `PART_SET`, `chatPartDraws` and
   `dialog-kits.ts`'s `DialogPartName`. Command: `grep -rn "ChatPartName" src --include='*.ts'`.
9. The fake harness's interrupt emits a `notice` and no `result`. Command:
   `grep -n "fake: 'interrupt'" src/shared/fake-agent-harness.ts`.

## Docs written ahead

Written to the after-state before the code, uncommitted when this plan was drafted (the lead commits them with the
plan; commit: `498e4358`):

- `DESIGN.md` — § Chat bullet (the activity dock, activity lines under the flag, the composer's contents).
- `docs/features/agent-chat/design.md` — Vocabulary (Chat entry, Activity line, Activity dock), § Chat plugin (Chat
  tab, Activity line, Activity dock in place of Working block), § Layouts, § Plans.
- `docs/features/chat-bar/design.md` — contents, Intent, Vocabulary, the composer diagram and list, § The activity
  dock (new), Subagent facts › Tool calls, Decisions, and the Rejected note reversed.
- `docs/features/layouts/design.md` — the `chat` adopter row and the `Space z l c` preview row.
- `AGENTS.md` — the chat layout parts paragraph (the `working` part and the flag) only.

## Mandatory Reads

- `AGENTS.md` (repo root) — every task. UI tasks (02, 03, 06) read `DESIGN.md` first, as `AGENTS.md` says.
- `DESIGN.md` — tasks 02, 03, 06, 07.
- No other `AGENTS*.md`, `CLAUDE*.md` or `.claude/rules/*.md` sits under a touched folder (glob at plan time; the
  hits under `.drive/` are drive-run temp homes, not project rules).

## Design Overview

### After-state flow

```
Claude stream line ─► stream-decoder toolEntry ─► ChatEntry tool { agentId: parent_tool_use_id | 'main' }
Claude transcript  ─► transcripts.ts            ─► ChatEntry tool { agentId: 'main' }  (sidechain lines skipped)
fake harness       ─► ChatEntry tool { agentId: 'main' | 'fake-agent-<turn>-<n>' }

chat main ──channel (entry, entries, activity, sessionRunning, sessionRested)──► chat-view HeldTab
   │
   ├─► EntryList.put / rebuild / setWorking / setQueued
   │      reads isActivityInTranscript(layouts.shown()) at each rebuild
   │      false (default): slots + stops for user, assistant, permission, notice; pending rows after them
   │      true           : today's list: + activity lines, step rows, result rows; live run ticks once a second
   │
   └─► ComposerSurface.setTurn(entries, working)
          └─► ActivityDock (clock, timers)
                 working: workingInput(entries, now) — held while the turn holds no entries; ticks 1 s
                 idle   : doneInput(entries) | null
                 └─► changed(WorkingInput | null)
                        null      → working slot hidden, its draw disposed
                        otherwise → `working` part drawn, or updated, in the working slot

composer root (default layout):
   contributedParts (workflow strip, agent strip) · working slot (activity dock) · attachments · box · statusLine
```

### Out of scope

- The "new messages" bubble (`docs/features/followups.md` § Chat holds a scrolled-up position and shows a "new
  messages" bubble) and **One rule for the chat cursor, scroll and keys** (same file). The dock changes the
  composer's height, which the existing `followComposerHeight` already follows; nothing else about following moves.
- A dock that takes the cursor or keys. The dock is display only.
- A compatibility shim for tool entries without `agentId` (precondition 2: none are stored).
- Step and tool-call durations (`followups.md` § Step and tool-call durations in the activity line).

### Decisions

1. **Layout contract — dock slot** (user, round 1): keep the `working` part, its name and its signature
   `(parent, WorkingInput, BaseKit)`. Its slot moves into the composer: `ComposerKit.working(parent)` places a slot
   built once per tab, through `appSlot`, throwing `working placed twice` on a second call. The default composer
   calls it between `contributedParts` and `attachments`. A composer that leaves it out gets the slot as the box's
   previous sibling. The slot is hidden while the dock has nothing to show.
2. **`WorkingInput` gains a finished state** (user, round 1): a `done` state carrying the turn's steps, its times,
   its stop reason and its cost. The default layout draws it as the one dim line.
3. **Finished-line rules** (user, round 2): the turn is every entry since the user's last message. Cost = sum of
   `costUsd` over every `result` entry in it, null costs skipped, null when all are null. Word: `Done` for stop
   reason `end_turn` or `success`, else the stop reason itself. The line updates in place when a later result lands
   before the user sends.
4. **One chat page module owns the dock's data** (user, round 2): `activity-dock.ts` takes entries, the working flag,
   the clock and the timers, and produces `WorkingInput | null`; it owns the 1 s tick and the held rule. The composer
   surface holds it; `ComposerSurfaceDeps` gains `clock` and `timers`. The entry list loses the working block.
5. **Hiding rule lives in the layout** (user, round 2): `ChatLayout.activityInTranscript`, read through the same pick
   chain as a part. The default sets it `false`. False: no slot and no cursor stop for runs, their steps and
   `result` entries. True: today's list. The `result` entry still feeds the turn logic either way.
6. **Agent id on tool entries** (user, round 2): `ChatEntry` `tool` gains `agentId: string` — `MAIN_AGENT_ID` for
   the session's own agent, else the subagent id the agent events use (Claude: `parent_tool_use_id`). `ToolInput`
   carries it. The dock's lines and counts use only main-agent tools. No shim (precondition 2).
7. **Class names kept** (user, round 2): the dock keeps `.chat-working`, `.chat-working-head`, `.chat-working-time`,
   `.chat-working-state`, `.chat-working-box`, `.chat-working-action`, `.chat-working-counts`.
8. **Rejected line reversed** (user, round 2): chat-bar design's "Rejected: Running-action list and tool counts above
   the composer" no longer holds (done in the docs written ahead).
9. **Follow-ups out of scope** (user, round 2): see Out of scope.

### Drafter decisions — for the lead

- **D1 — finished time from `at` stamps; the live timer keeps today's start.** Two rules, one per state:
  - Finished line: the last result's `at` minus the `at` of the user's last message (the first entry's `at` when
    the list holds no user entry). This keeps decision 3's turn ("every entry since the user's last message") for
    the time, the steps and the summed cost alike.
  - Live timer: `now` minus today's turn start in `working-turn.ts` (`turnStart`): the later of the user's last
    message and the first entry after the last result.
  The two differ when the turn holds a result before its last one (Claude's follow-up turns, a turn with no user
  entry): the finished time is then longer than the live timer's last value. That is accepted. Summed `durationMs`
  was weighed and left: it drops the gaps between Claude's own follow-up turns.
- **D2 — the dock module filters subagents' tools.** `WorkingInput.steps` (live and done) leave out every `tool`
  step whose `agentId` is not `MAIN_AGENT_ID`; thinking and raw steps stay (they carry no `agentId`). A layout then
  needs no filter of its own, and the contract states the rule once. `turnState`'s `working` rule (a tool with no
  result) reads only the turn's main-agent tool entries (`agentId === MAIN_AGENT_ID`): a background `Agent` call
  returns its result at once while its subagent keeps emitting tool lines, and such a subagent tool must not set the
  main state word. The other rules (`waiting`, `writing`, else `thinking`) read the turn as today.
- **D3 — no result, no finished line.** Idle with no `result` entry after the user's last message (the fake's
  interrupt, a process that ended without a result), the dock is hidden. The line's data comes from results only.
- **D4 — the done state carries no `now`.** It does not tick; `DoneWorkingInput` has `endedAt` in place of `now`.
- **D5 — the flag is read when the list is created and at each entry-list rebuild.** `createEntryList` reads it
  once, so a list that only `put`s (the tests' `setUpList`) has the flag of the layouts shown at creation. A layout
  change always runs `rebuild` on every tab (`chat-view.ts` `layouts.onChange`), so `put` uses the value the last
  read gave.
- **D6 — `ChatPartName` and the layout test's `SurfacePart` exclude the flag.** `CompleteChatLayout` stays
  `Required<ChatLayout>`, so the default layout must define the flag. `readChatLayout` takes the flag out of the
  parts with `entries`, before `requireLayoutParts`. The checks run in this order: `composerBar`, the parts
  (`requireLayoutParts`), the flag, `entries`. The flag check throws
  `layout <name>: activityInTranscript is not a boolean` for any value that is neither a boolean nor `undefined`.
- **D7 — the chat self-test's activity-line groups follow the new default.** The "transcript focus" and "activity
  line" groups walk the activity lines; under the default those rows are gone. Task 07 rewrites them to walk the
  messages and to screenshot the dock live and finished, rather than installing a user layout in the self-test home.
  The rows under `activityInTranscript: true` stay pinned by `entry-list.test.ts`.
- **D8 — counts in the finished line are always numbered and joined with ` · `**, as the user's example
  (`Bash 6 · Read 2`); the live counts keep today's space-joined form (`Read 3 Bash 2 Edit 1`).
- **D9 — user layouts take the contract change as it is.** A user `working` part receives the `done` input too and
  branches on `input.state`; the app sends it no live-only shim, since the user's own layout takes breaking changes.
  A user layout that wants the activity lines back sets `activityInTranscript: true`. The contract's doc comments
  (task 06) state both; no task writes compatibility code.
- **D10 — a failed default dock draw hides the dock.** The composer follows `entry-list.ts` `drawSlotPart`: it
  catches a throw from the `working` draw, logs `chat` / `default layout working failed: <error>`, and leaves the
  slot empty and hidden (no bare raw line: the dock is chrome, not an entry). A composer redraw disposes the drawn
  part, empties the slot and draws again from `dock.input()`, since the layout may have changed.
- **D11 — the dock does not shrink in a short pane.** `.chat-working-slot` takes `flex-shrink: 0`, as
  `.chat-attachments` does. The composer's existing overflow rule applies unchanged: the composer is `max-height:
  50%`, the composer parts holder gives up height first and scrolls, and the box shrinks and scrolls past three
  `space-8` steps.
- **D12 — layout prose lands with the code that makes it true.** Task 02 adds the `WorkingInput` union with its
  field comments and the flag with its pick sentence only. The sentences that name the dock, the composer's working
  slot, the hidden rows, the filtered steps and the held start, in `layout.d.ts` and in `layout.js`'s comments, land
  in task 06: the dock draws there, and it is the first task after 03, 04 and 05 in a wave where no other group edits
  `layout.d.ts` or `layout.js`. Task 03 writes only `ComposerKit.working`'s comment and the default composer's.

## File Structure

### Existing files modified

| File | Task | Change |
|---|---|---|
| `src/contracts/agent.ts` | 01 | `ChatEntry` `tool` gains `agentId: string` |
| `src/main/claude-code/tool-entries.ts` | 01 | `toolUseEntry` takes the agent id |
| `src/main/claude-code/stream-decoder.ts` | 01 | `toolEntry` passes `agentOf(event)` |
| `src/main/claude-code/transcripts.ts` | 01 | passes `MAIN_AGENT_ID` |
| `src/shared/fake-agent-harness.ts` | 01 | every tool entry carries its agent id |
| `src/plugins/chat/main/preview/preview-session.ts` | 01 | the 3 tool entries carry `MAIN_AGENT_ID` |
| `src/plugins/chat/layouts/layout.d.ts` | 01, 02, 03, 06 | `ToolInput.agentId` (01); `WorkingInput` union, `activityInTranscript` (02); `ComposerKit.working` (03); the dock's prose in the comments (06, D12) |
| `src/plugins/chat/layouts/default/layout.js` | 02, 03, 06 | `working` draws `done`, 3 lines, flag `false` (02); composer places `working` (03); the head, `working` and `WORKING_ACTION_LINES` comments name the dock (06, D12) |
| `src/plugins/chat/page/entry-list.ts` | 02 (only if `tsc` flags it) | the working block's held input typed `LiveWorkingInput` (task 02 § Typecheck) |
| `src/plugins/chat/page/chat-layouts.ts` | 02 | `ChatPartName` excludes the flag; `isActivityInTranscript` |
| `src/plugins/chat/page/read-chat-layout.ts` | 02 | reads and checks the flag |
| `src/plugins/chat/page/composer-kit.ts` | 03, 06 | the working slot (03); the dock and its draws, `setTurn` (06) |
| `src/plugins/chat/page/chat.css` | 03 | the dock's styles in the composer, the done line |
| `src/plugins/chat/page/working-turn.ts` | 04 | main-agent filter, `doneInput` |
| `src/plugins/chat/page/entry-list.ts` | 05 | hides rows under the flag; the working block gone |
| `src/plugins/chat/page/chat-view.ts` | 06 | passes clock and timers; calls `setTurn` |
| `src/plugins/chat/main/selftest-script.ts` | 07 | groups for the new default |
| `src/plugins/agent-strip/main/selftest-script.ts`, `src/plugins/agent-lines/main/selftest-script.ts` | 07 | comments name the dock |

### New files

- `src/plugins/chat/page/activity-dock.ts` (04) — the deep module decision 4 names: the held rule, the tick and the
  live/done/hidden choice behind one small interface, testable with a fake clock and fake timers.
- `src/plugins/chat/page/activity-dock.test.ts` (04).
- `src/plugins/chat/page/chat-layouts.test.ts` (02) — no test file holds `chat-layouts.ts`'s picks yet.

### Shared names, signatures and types

`src/contracts/agent.ts` (01):

```ts
| {
    kind: 'tool';
    id: string;
    at: number;
    // The agent that made the call: MAIN_AGENT_ID for the session's own agent, else the subagent's id the agent
    // events use (Claude: the Agent call's id, the line's `parent_tool_use_id`).
    agentId: string;
    toolUseId: string;
    name: string;
    input: unknown;
    summary: string;
    result: { text: string; isError: boolean } | null;
    raw: unknown[];
  }
```

`src/main/claude-code/tool-entries.ts` (01):

```ts
export function toolUseEntry(id: string, block: Json, raw: unknown, agentId: string): ToolEntry;
```

`src/plugins/chat/layouts/layout.d.ts` (the trailing comments give the after-state meaning; D12 names the task that
writes each comment):

```ts
// 01
export interface ToolInput {
  kind: 'tool';
  id: string;
  agentId: string;
  toolUseId: string;
  name: string;
  input: unknown;
  summary: string;
  result: { text: string; isError: boolean } | null;
  raw: unknown[];
}

// 02 — WorkingState stays 'thinking' | 'writing' | 'working' | 'waiting'.
export interface LiveWorkingInput {
  state: WorkingState;
  steps: StepInput[];   // the turn's steps in entry order, leaving out subagents' tool calls
  startedAt: number;
  now: number;
}
export interface DoneWorkingInput {
  state: 'done';
  steps: StepInput[];   // every step since the user's last message, leaving out subagents' tool calls
  startedAt: number;    // the user's last message's `at`; the first entry's with no user entry
  endedAt: number;      // the last result's `at`
  stopReason: string;   // the last result's
  costUsd: number | null; // the sum of the results' non-null costs; null when none has one
}
export type WorkingInput = LiveWorkingInput | DoneWorkingInput;

// 02 — in ChatLayout, beside the parts:
activityInTranscript?: boolean;

// 03 — in ComposerKit:
working(parent: HTMLElement): HTMLElement;
```

`src/plugins/chat/page/chat-layouts.ts` (02):

```ts
export type ChatPartName = Exclude<keyof ChatLayout, 'entries' | 'activityInTranscript'>;
// Whether the entry list draws runs and result entries: the user's layout's flag when it sets one, else default's.
export function isActivityInTranscript(shown: ShownLayouts<ChatLayout>): boolean;
```

`src/plugins/chat/page/working-turn.ts` (04):

```ts
export function workingInput(entries: readonly ChatEntry[], now: number): LiveWorkingInput; // steps main-only
export function isTurnEmpty(entries: readonly ChatEntry[]): boolean;                        // unchanged
export function doneInput(entries: readonly ChatEntry[]): DoneWorkingInput | null;
```

`src/plugins/chat/page/activity-dock.ts` (04):

```ts
export interface ActivityDockDeps {
  clock: Clock;
  timers: Timers;
  // Runs each time what the dock shows changes, and once a second with a new `now` while the dock is live; null
  // hides the dock.
  changed(input: WorkingInput | null): void;
}
export interface ActivityDock {
  // The session's entries after a change and whether the session works on its turn.
  set(entries: readonly ChatEntry[], working: boolean): void;
  // What the dock shows now; null while hidden.
  input(): WorkingInput | null;
  // Clears the tick.
  dispose(): void;
}
export function createActivityDock(deps: ActivityDockDeps): ActivityDock;
```

`src/plugins/chat/page/composer-kit.ts` (06):

```ts
export interface ComposerSurfaceDeps extends SurfaceKitDeps {
  layouts: ChatLayouts;
  run(command: CommandId): void;
  composerParts: Pick<PartStore<ChatComposerPart>, 'parts'>;
  statusParts: Pick<PartStore<ChatStatusPart>, 'parts'>;
  log: Log;
  clock: Clock;
  timers: Timers;
}
// In ComposerSurface:
setTurn(entries: readonly ChatEntry[], working: boolean): void;
```

### Boundary rules

- Only `activity-dock.ts` decides live, done or hidden; `composer-kit.ts` draws what it hands over and decides
  nothing about turns.
- Only `chat-layouts.ts` picks the flag; `entry-list.ts` calls `isActivityInTranscript` and does not read
  `shown.layouts` itself.
- `layout.d.ts` doc comments change with the code that makes them true (prose inside code lands with the code; D12
  names where each one lands).
- Every wave leaves `npm run typecheck` green: each group lists the minimal edit it makes in a later task's file to
  keep the tree compiling (task 02 § Typecheck), and no two groups in one wave touch the same file.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Tool entries carry the agent's id](01-tool-entry-agent-id.md)

### Wave 2
- [ ] [Working input's done state and the activityInTranscript flag](02-done-state-and-flag.md) — after 01

### Wave 3
- [ ] [The composer's working slot](03-composer-working-slot.md) — after 02
- [ ] [The activity dock module](04-activity-dock-module.md) — after 02
- [ ] [Entry list hides activity rows and drops the working block](05-entry-list-hiding.md) — after 01, 02

### Wave 4
- [ ] [Wire the dock into the composer and the Chat tab](06-dock-wiring.md) — after 03, 04, 05
- [ ] [Self-test scripts follow the dock](07-selftest-scripts.md) — after 05

### Wave 5
- [ ] [Doc re-read](08-doc-re-read.md) — after 06, 07
- [ ] [Final verification](09-final-verification.md) — after 06, 07

## Run log

Review base: 46f417b5

### Groups
- 01 · 91ff7c11 · diff read: all three Produces present; typecheck green · concerns: permission-turn test literal in fake-agent-harness.test.ts gained agentId though tsc did not flag it (runtime toEqual)
### Contract changes
### Rulings
- Preflight: precondition 1's peer AGENTS.md hunk is committed (1b7363b5) and the tree is clean; origin is unreachable from this session (SSH publickey denied), so the run builds on local main at 46f417b5 — lead
- fake-agent-harness.test agents-turn check asserts every tool emit (start and finish) as [id, agentId] — group 01 · group 01
- layout.test.ts imports MAIN_AGENT_ID from src/contracts/agent — group 01 · group 01
### Review rounds
### Test gate
