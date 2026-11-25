# Permission review — plan

Feature: permission-review · Implements: none · Ticket: none
Target: main (worktree branch `permission-review`) · Written: 2026-11-25

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every approval the app asks of the user is reviewed by a separate model, `sonnet` by default, that sees only the call:
its tool name, its input and the session's project folder. The reviewer gives a brief summary of what the call does
and an approve-or-deny verdict based on security risk. The verdict draws on the card as advice, and Allow once stays
the default key. Two kinds of approval are covered: chat's permission cards, and agent-commands' risky-command confirm
round. The permission card itself is redrawn so it no longer leads with a raw JSON dump. It shows the verdict on top,
then the tool and its one-line target, then the full call folded into a **Full call** dropdown that wraps, then
Allow once and Deny.

## Architecture

Systems touched, all in the wigley-ai-gui repo:

- `src/contracts/agent.ts`: the harness seam gains `ask`, and the permission entry gains `summary`.
- `claude-code`: the isolated `claude -p` ask, the `askModel` setting, and minting `summary` on permission entries.
- `src/shared/fake-agent-harness.ts`: a scripted `ask`, and `summary` on fake permission entries.
- `chat`: the `summary` field on the page input, the `addEntryPart` page export, `kit.entryParts`, and the redrawn
  default permission card.
- `forms`: `ConfirmRequest.subject` and the `forms.confirms` slot.
- `agent-commands`: fills the subject.
- `permission-review`, a new plugin: main watches requests and runs reviews into its `permission-review.reviews`
  slot; page draws the verdict through its own layout, inside chat's permission entry and on forms' confirm card.

## Preconditions

- The plan branches from `main` at `66fa006f`, verified with `git -C /Users/jonathonwigley/Documents/wigley-ai-gui
  log -1` on 2026-11-25. Re-run `git -C <repo> fetch && git log --oneline 66fa006f..origin/main`, and read each
  commit against the Files lines below.
- The Claude CLI is `2.1.327` (`claude --version`). It accepts `--setting-sources ""`, `--tools ""`,
  `--strict-mcp-config`, `--disable-slash-commands`, `--no-session-persistence`, `--system-prompt` and
  `--output-format json`, with the prompt on stdin.
- These flags keep the profile's `CLAUDE.md` out of the ask, and subscription sign-in still works under them. A probe
  in an empty scratch folder with `CLAUDE_CONFIG_DIR=~/.claude-personal` asked whether any context mentioned
  "wigley-agents": with the flags it answered `NO`, and without `--setting-sources ""` it answered `YES`. Re-run the
  probe if the CLI version changed. From an empty scratch folder, run
  `echo 'Answer with one word. Does any text in your context, other than this message and your system prompt, mention "wigley-agents"? Reply YES or NO.' | env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT CLAUDE_CONFIG_DIR=~/.claude-personal claude -p --model sonnet --system-prompt "You answer questions." --tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands --no-session-persistence --output-format json`.
  Expect `"result":"NO"`. Run it again without `--setting-sources ""` as the control, and expect `YES`.
- Only one real `AgentHarness` exists: `createClaudeCodeHarness` (`src/plugins/claude-code/main/claude-code-harness.ts`).
  Beside it is the fake, `src/shared/fake-agent-harness.ts`. Check with `grep -rn "): AgentHarness {" src` (the
  `chat/main/lookups.ts` hits are lookups, not implementations).
- `AgentHarnessRegistry.get(id)` exists (`src/contracts/agent.ts`, around line 695).
- No plugin calls forms' `addCardPart` yet (`grep -rn "addCardPart" src --include=*.ts | grep -v "plugins/forms"`).

## Docs written ahead

Commit `f521d579` on `permission-review` holds:

- `docs/features/permission-review/design.md`, the source of truth for this plan.
- `docs/features/agent-harnesses/design.md` § One-shot asks.
- `docs/features/agent-chat/design.md` (Permissions; `addEntryPart`).
- `docs/features/agent-commands/design.md` (the confirm subject).
- `docs/features/layouts/design.md` (Adopters).
- `docs/features/agent-chat/claude-stream.md` (a stale `--setting-sources` line fixed).
- `README.md`, `CHANGELOG.md`, `AGENTS.md`, and `DESIGN.md` if it needed a change.

## Mandatory Reads

- `AGENTS.md` (repo root) through its last line: architecture, plugin rules, layouts, settings, self-test, demo, README
  and changelog, and boundary.
- `docs/features/permission-review/design.md`
- `docs/features/layouts/design.md` (for 05) and `docs/features/agent-harnesses/design.md` (for 01)
- There are no `CLAUDE*.md` files and no `.claude/rules/` in the repo.

## Design Overview

```
 claude permission_prompt ─► claude-code mints permission entry {…, summary}
        │                               │ events.permission
        ▼                               ▼
                     chat main ─► chat.entries slot (put, answer null)
                                        │
 run_command risky ─► forms.confirm(request{title,detail,subject})
        │                 └─► forms.confirms slot {roundId → {sessionId, subject}}
        ▼                                     │
               permission-review main ◄───────┘   (also reads chat.session, registry profiles)
                 │  harness.ask({profileDir, instructions, prompt, signal})  60 s limit
                 │        claude-code: claude -p --system-prompt … --tools "" --strict-mcp-config
                 │                     --setting-sources "" --disable-slash-commands
                 │                     --no-session-persistence --output-format json --model <askModel>
                 │                     (stdin prompt, cwd <temp>/claude-code-ask)
                 ▼
          permission-review.reviews slot  {reviewing | done{summary,verdict,risk} | unavailable{reason}}
                 │
     page: verdict part ──► chat addEntryPart (kinds ['permission'])  ─► kit.entryParts in chat's layout
                       └──► forms addCardPart (kinds ['question'], rounds in forms.confirms)
```

**Decisions** (interview round 1, the Decided notices, and the design review):

- Card look: the verdict leads as the heading (`Deny · high risk`), then the summary, then the tool name and its
  one-line target, then the closed Full call expander, then Allow once and Deny, keeping their keys.
- The reviewer sees the tool name, its input and the project folder. It sees no transcript, no agent reason, no
  instructions, no `CLAUDE.md` and no tools.
- Both chat's permission entries and agent-commands' confirm round are reviewed.
- The review is its own plugin, `permission-review`, which can be switched off. With it off, the card keeps the
  target line and the Full call expander, without a verdict.
- The design review changed the model setting from `claude-code.reviewModel` to `claude-code.askModel`, default
  `sonnet`: the setting serves the generic `AgentHarness.ask`, and the adapter names no caller.
- The design review chose chat's `addEntryPart` seam over replacing the entry through `addEntryRenderer`
  (design.md § Rejected).
- The design review had the harness mint the permission entry's target line (`summary`, through `toolSummary`), so
  no plugin outside the adapter reads a tool's input shape.
- The confirm round's subject is a field on `ConfirmRequest`, published by forms in `forms.confirms`. That keeps the
  question schema agents send unchanged.
- The verdict is advice only. Nothing is answered automatically, and a failed review shows `Review unavailable` with
  its reason.
- Each request is reviewed once, on arrival, with a 60-second limit. The main process keeps the result, so it
  survives a page reload, and an answered card keeps its verdict.

**Out of scope:**

- Auto-answering on a verdict.
- Persisting reviews across an app restart.
- Reviewing approvals other than these two kinds.
- A Codex adapter's `ask`: no Codex adapter exists yet.

## File Structure

New plugin `src/plugins/permission-review/`, modelled on `src/plugins/context-sources/`:

- `manifest.ts`: id `permission-review`, label `Permission review`, the `layout` setting.
  `dependsOn: { main: ['chat', 'forms', 'sessions'], page: ['chat', 'forms'] }` as 04 writes it. `reads` stays empty
  (`{ main: [], page: [] }`): `reads` takes plugin ids, and `dependsOn` already covers every slot the plugin reads.
  05 adds `sessions` to `page`, for the demo step.
- `contract.ts`: the `Review` type and `permissionReviewsSlot`.
- `main/`: `start.ts`, `review-requests.ts` (the watcher), `review-prompt.ts` (instructions, prompt and reply
  parser), `demo-steps.ts`, `selftest-script.ts`, and tests.
- `page/`: `start.ts`, `verdict-part.ts`, `verdict-input.ts`, `demo-steps.ts`,
  `layout/read-permission-review-layout.ts`, and tests.
- `layouts/layout.d.ts` and `layouts/default/layout.js` with `layout.css`.

Registration: `src/plugins/manifests.ts`, `src/plugins/main.ts` and `src/plugins/page.ts`.

Shared names and signatures (every task document uses these exactly):

```ts
// src/contracts/agent.ts  (01)
export interface AgentAsk {
  profileDir: string | null;
  instructions: string;
  prompt: string;
  signal: AbortSignal;
}
// AgentHarness gains:
ask(request: AgentAsk): Promise<string>;
// ChatEntry 'permission' variant gains:
summary: string;

// src/shared/fake-agent-harness.ts  (01) — FakeAgentHarness gains:
setAskReply(text: string): void;   // every later ask resolves with text
failNextAsk(message: string): void; // the next ask rejects with Error(message)
readonly askCalls: readonly AgentAsk[]; // every ask request, failed ones included
// default reply: FAKE_ASK_REPLY (exported const)
// src/plugins/claude-code/main/claude-ask.ts  (01) — askClaude(deps, request); empty askModel omits --model

// src/plugins/chat/layouts/layout.d.ts  (02)
// PermissionInput gains `summary: string`
// ChatKit gains:
entryParts(parent: HTMLElement): void;
// src/plugins/chat/contract.ts  (02)
export interface ChatEntryPartContext<K extends AnyEntryKind> { sessionId: string; input: EntryInput<K>; }
export interface ChatEntryPart<K extends AnyEntryKind = AnyEntryKind> {
  id: string;
  kinds: readonly K[];
  build(parent: HTMLElement, context: ChatEntryPartContext<K>): { update?(input: EntryInput<K>): void };
}
// ChatPageExports gains:
addEntryPart<K extends AnyEntryKind>(part: ChatEntryPart<K>): Disposable;

// src/plugins/forms/contract.ts  (03)
export interface ConfirmSubject { toolName: string; input: unknown; }
// ConfirmRequest gains `subject: ConfirmSubject | null`
export interface OpenConfirm { sessionId: string; subject: ConfirmSubject; }
export const formsConfirmsSlot: KeyedSlotKey<OpenConfirm, 'main', 'forms'>; // id 'forms.confirms', keyed by round id

// src/plugins/permission-review/contract.ts  (04)
export type ReviewVerdict = 'approve' | 'deny';
export type ReviewRisk = 'low' | 'medium' | 'high';
export type Review =
  | { state: 'reviewing' }
  | { state: 'done'; summary: string; verdict: ReviewVerdict; risk: ReviewRisk }
  | { state: 'unavailable'; reason: string };
export const permissionReviewsSlot: KeyedSlotKey<Review, 'main', 'permission-review'>; // id 'permission-review.reviews'
export function chatReviewKey(sessionId: string, entryId: string): string;   // `${sessionId}/${entryId}`
export function confirmReviewKey(roundId: string): string;                   // `confirm/${roundId}`
```

Boundary rules:

- Only `claude-code` names `claude`, its flags or model aliases. permission-review reaches the model only through
  `AgentHarness.ask`, found with `services.agentHarnesses.get(id)`.
- permission-review imports chat and forms only through their contracts, page exports and slots.
- Every surface draws through a layout.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 01 → 04 → 05 → 06

### Wave 1
- [x] [Harness one-shot ask and permission summary](01-harness-ask.md)
- [x] [Confirm subject and the forms.confirms slot](03-confirm-subject.md)

### Wave 2
- [x] [Chat entry parts and the redrawn permission card](02-chat-permission-card.md) — after 01
- [x] [permission-review main: watcher, ask, reviews slot](04-review-main.md) — after 01, 03

### Wave 3
- [x] [permission-review page: verdict part and layout](05-review-page.md) — after 02, 03, 04

### Wave 4
- [x] [Doc re-read](06-doc-re-read.md) — after 01–05
- [ ] [Final verification](07-final-verification.md)

## Run log

Review base: 5665fe5c

### Groups
- 01 · deep · e52a8d7d · diff read: every Produces present (AgentAsk, AgentHarness.ask, permission summary, fake ask hooks, askClaude, askModel setting); wave typecheck passes · concerns: toolSummary falls back to the input's first string field, so a Claude permission entry's summary is not always a target line (02 must not read non-empty as a target); the claude-code-ask folder is made once and reused, never emptied; withStderr moved to claude-launch.ts beside exitText and cliSpawnError
- 03 · deep · a4479b69, 9b8741f0 · diff read: every Produces present (ConfirmSubject, ConfirmRequest.subject, OpenConfirm, formsConfirmsSlot, ConfirmTracker, createConfirmTracker, confirmRequest subject); wave typecheck passes after the demo-steps.test literal fix on the same rung · concerns: formatted by hand without oxfmt; the failed row relies on the tool session's end() rejecting the open; design.md says 'when the round finishes' and AGENTS.md calls subject 'optional', both left for 06
- 02 · hard · 2c084001, b4773ef2 · diff read: addEntryPart, ChatEntryPart(Context), kit.entryParts, PermissionInput.summary present; wave typecheck and lint pass after test-typing fix on the same rung · concerns: entryParts returns void though the ChatKit header says every part returns what it appended; the entry-parts onChanged keeps toastedKinds
- 04 · deep · a61e9b8a, 2157d0b2 · diff read: permissionReviewsSlot, Review, chatReviewKey, confirmReviewKey, watcher, findReviewer present; wave typecheck and lint pass after themeTokens fix on the same rung; lead ran the repo's oxfmt --write on review-requests.ts and forms start.test.ts (tooling) · concerns: until 05 the layout setting names no layouts and the demo step has no page half; registerDemoSteps' Disposable is not kept; key parsing misreads a chat session id holding '/' or named confirm
- 05 · deep · 151bfcaf · diff read: verdict entryPart and cardPart, VerdictInput/VerdictPart/Layout, page part registered in page.ts, layout types registered in main; typecheck and lint pass; lead ran the repo's oxfmt --write on four files (tooling) · concerns: holders are swept only on a later build of the same key; a double build before connect drops the first; layouts/design.md lists no permission-review owner (06); no Space z l preview sample; the self-test step's alsoExpect assumes page log lines carry the [permission-review] prefix
- 06 · standard · 18551103 · diff read: design.md and AGENTS.md fixed to the landed code; layouts design already lists permission-review; lint and readme-coverage pass · concerns: kit.entryParts returns void though the ChatKit header says every part returns what it appended; edited design.md lines run past the file's wrap width
### Contract changes
### Rulings
- 01: withStderr moved to claude-launch.ts with exitText and cliSpawnError, shared by the ask rather than copied · group 01
- 03: forms start deletes every key left in forms.confirms right after publishing, since a confirm of an earlier start settles through that start's disposed writer · group 03
- 03: a round counts as the confirm's when it has exactly one question item titled questionTitle(nonce) · group 03
- 02: entry-list's throwing-update row uses a permission entry, since the bundled default assistant builder places no parts · group 02
- 04: the 60 s timer writes the timed-out review itself, then aborts; one isSettled flag silences any later settle · group 04
- 04: a chat replace drops only reviews whose entry is missing from the replacement; delete changes drop nothing (sessions.ended covers it) · group 04
- 05: setLayouts rebuilds every connected holder through the new layout rather than calling update · group 05
- 05: a card holder reads null unless its round is in forms.confirms, so both parts share one redraw path · group 05
- 05: manifest page dependsOn gains sessions for the demo step's activate · group 05
### Review rounds
### Test gate
