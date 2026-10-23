# Slash completion — plan

Feature: agent chat (plan D) · Implements: none · Ticket: none
Target: main · Written: 2026-10-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The Chat box's `/` completion offers every command and skill the session has from the moment the session starts —
`/wigley:feature` included — matched fuzzily by name or alias (`/feature` offers `/wigley:feature`), each row showing
its description behind a setting, with a hook any plugin uses to draw a completion row. The same fzf matcher ranks
every list picker and filters the Settings, keymap and Docs `/` filters.

**The bug.** Claude Code sends `system/init`, the only source of the command list today
(`src/main/claude-code/stream-decoder.ts`, `commandNames`), after the first user message. Until then the box offers
only the app's own slash commands, so a new or resumed session's first `/wigley:feature` finds nothing. The completion
also matches only names that start with the typed text, so `/feature` finds nothing at any time.

## Architecture

```
claude process ──initialize control_response (0.45 s)──► Claude adapter ──commands(AgentCommand[])──► chat main
               ──system/init (each turn)───────────────►   merge by name/alias                        │ channel 'commands'
                                                                                                       ▼
FuzzyMatcher (fzf adapter, src/renderer/fzf/) ◄── page services ── chat page: chat-view builds CompletionItems
     ▲            ▲                ▲                                     (app commands + agent records)
     │            │                │                                       │ EditorCompletions { items, drawRow }
     │   list pickers,      editor adapter: CodeMirror completion ◄────────┘
     │   Settings/keymap    ranks items by name + aliases, draws each row,
     │   rows, Docs tree    hands the row to drawRow
     │                                          │
     └──────────────────────────────────────────┘    chat completion rows registry: addCompletionRow(draw) export;
                                                      chat's own draw writes the description while
                                                      chat.completionDescriptions is on
```

Systems touched: the Claude adapter and the fake harness (`src/main/claude-code/`, `src/shared/fake-agent-harness.ts`),
the agent contract, chat main and page, the editor contract and the CodeMirror adapter, a new fzf adapter and page
service, the shared list picker, the Settings and Docs filters, the layer check.

## Preconditions

Each re-run by `wigley:make` before the first dispatch.

- The installed CLI answers `initialize` at process start with `commands` records — measured on `2.1.309` at plan
  time; re-run the probe in `docs/features/agent-chat/claude-stream.md` § Initialize (stdin the one
  `control_request` line, read stdout until the `control_response`) and check its `response.response.commands[0]`
  has `name`, `description`, `argumentHint`. `claude --version` at plan time: `2.1.309 (Claude Code)`.
- `fzf` (npm) is not installed: `npm list fzf` → `(empty)` at plan time. **The user approved installing `fzf@0.5.2`
  (fzf-for-js, BSD-3-Clause, no dependencies) as a dependency in interview round 4, 2026-10-23**; task 01 installs it
  with `npm install fzf@0.5.2`. No other package is approved.
- `@codemirror/autocomplete` is `6.20.3` in `package.json`: `grep autocomplete package.json`.
- Node `24.22.1` (`.nvmrc`).
- **Overlap with the step-1 bug sweep** (`docs/features/followup-sweep/plan-bug-sweep/`, a peer session's plan, not
  yet committed at plan time): it also edits `src/contracts/plugin.ts`, `src/plugins/chat/contract.ts` and
  `src/plugins/docs/page/docs-state.ts` (and `docs-state.test.ts`). Run this plan after that plan lands, or confirm
  `git log -- <those files>` shows no change since `c401792` before dispatching tasks 01, 02 and 04.

## Docs written ahead

Commit `c401792`: `docs/features/agent-chat/claude-stream.md` (§ Init, § Initialize),
`docs/features/agent-chat/design.md` (§ Agent harness seam Commands, § Chat plugin App slash commands, Slash
completion, Completion rows, § Plans), `AGENTS.md` (the `fzf/` adapter line, the editor adapter line, § Architecture
"A third-party tool"), `docs/features/settings/design.md` (§ The mode, the `/` filter), `docs/features/docs-browser/design.md`
(Tree), `docs/features/followups.md`, `docs/features/master-plan.md` (step 8).

## Mandatory Reads

- `AGENTS.md` — the layers, plugins, settings, page services, third-party tool rule, self-test and drive run
- `DESIGN.md` — every view rule; task 05 draws the description column in the popup
- `docs/features/agent-chat/design.md` and `docs/features/agent-chat/claude-stream.md` § Init, § Initialize
- `.agents/skills/drive/SKILL.md` — task 07's drive run
- No `CLAUDE*.md` and no `.claude/rules/` exist in this repo (`ls -a .claude` holds `skills` only).

## Design Overview

**After-state flow.** A session starts → the Claude adapter writes the `initialize` control request as its first
stdin line → the answer's `commands` become `AgentCommand` records → `events.commands(records)` → chat main stores
them in `ChatSessionState.commands` and sends them to the page → typing `/` in the box asks the editor completion for
items: the app's slash commands, then the agent's records the app does not hold → the editor adapter ranks the items
by the typed word against each name and its aliases through `FuzzyMatcher`, best first → each popup row shows
`/<name>` and hands its element to `drawRow`, where chat's completion rows registry runs the newest draw first →
chat's own draw adds the description while `chat.completionDescriptions` is on → Tab inserts `/<name> `.

Every later `init` replaces the list: an init name matching an earlier record's `name` or one of its `aliases` keeps
that record (once); an init name matching none becomes `{ name, description: '', argumentHint: '', aliases: [] }`;
a record no init name matches drops.

**Decisions** (round numbers are the interview's):

- The command list at start comes from Claude's `initialize` control request (round 1); `init` still updates it
  (Decided). A failed or error `initialize` answer is logged under `claude` and leaves the list to `init` (Decided).
- A typed word matches by name or any alias, and the row shows and inserts the full name (round 1); fuzzy, not
  prefix (round 1 note).
- Descriptions show in a dim column, behind the chat setting `completionDescriptions`, default on (round 2).
- The row hook lands now (round 2 note), and a plugin gets the command and the row's DOM element (round 3).
  Newest draw first; the first returning `true` ends the row; disposing a draw restores the one before (Decided).
  Chat's own description draw goes through the same hook (Decided).
- Fuzzy matching through the `fzf` npm package (round 4), behind a `FuzzyMatcher` contract with one adapter folder
  (Decided), ranking by fzf's score with the list's own order breaking ties; an item with several texts takes its
  best text's score (Decided).
- Every list picker ranks with it, best first (rounds 2 and 3). Settings rows, keymap rows and the Docs tree filter
  with it and keep their order; descriptions keep plain substring matching (round 3, Decided).
- The docs path completion (`src/plugins/docs/path-completion.ts`) keeps prefix matching (Decided).
- No match highlighting in this plan (Decided): rows and picker labels draw as today.
- Follow-ups written ahead (round 2): view behaviours as switchable plugins; `initialize`'s `models` and
  `current_permission_mode` for the controls.

**Out of scope.** The docs path box; a per-plugin enable switch; command palette and `Space f f` finders (master
plan step 8, which will reuse `FuzzyMatcher`); reading `models` or the permission mode from `initialize`; showing
argument hints by default (a plugin can draw them through the hook).

**Architecture.** `AgentCommand` crosses the harness seam, so it sits in `src/contracts/agent.ts`; only the Claude
adapter knows `initialize`, `init` and their JSON. `FuzzyMatcher` is a third-party tool contract in
`src/contracts/fuzzy.ts` with its adapter in `src/renderer/fzf/` (the only `fzf` import), handed to plugins as the
page service `fuzzy` and to the editor host and list picker by the renderer composition root. The editor contract
stays harness-free: it offers `CompletionItem`s and a `drawRow` callback; chat maps a row's word back to its command.

## File Structure

Existing files modified:

- `package.json`, `package-lock.json` — `fzf` 0.5.2 dependency (01)
- `scripts/check-layers.mts` — the `src/renderer/fzf` layer, `fzf` package allowed there only; renderer.ts may import it (01)
- `src/contracts/plugin.ts` — `PageServices.fuzzy: FuzzyMatcher` (01)
- `src/renderer/renderer.ts` — builds the fzf matcher once, into services and the editor host (01, 03)
- `src/contracts/agent.ts` — `AgentCommand`, `AgentProcessEvents.commands(commands: AgentCommand[])` (02)
- `src/main/claude-code/stream-decoder.ts`, `claude-code-harness.ts` — `initialize`, records, init merge (02)
- `src/shared/fake-agent-harness.ts` — emits records (02)
- `src/plugins/chat/contract.ts` — `ChatSessionState.commands: AgentCommand[]`, channel `commands` payload (02);
  `CompletionCommand`, `CompletionRowDraw`, `ChatPageExports.addCompletionRow` (05)
- `src/plugins/chat/main/chat-sessions.ts` — stores and sends records (02)
- `src/plugins/chat/page/chat-view.ts`, `slash-commands.ts` — compile-through in 02 and 03; full completion in 05
- `src/contracts/editor.ts` — `CompletionItem`, `EditorCompletions.items`/`drawRow`, `CreateEditorHost` takes the matcher (03)
- `src/renderer/codemirror-vim/prefix-completion.ts`, `codemirror-vim-host.ts` — fuzzy items and row drawing (03)
- `src/shared/page/list-picker-state.ts`, `list-picker.ts`; callers `src/plugins/chat/page/picker.ts`,
  `src/plugins/settings/page/settings-view.ts`, `src/plugins/docs/page/docs-dialogs.ts`, `docs-view.ts`, and the
  three plugins' `page/start.ts`, which read `api.services.fuzzy` (04; chat's `start.ts` again in 05)
- `src/plugins/settings/page/row-filter.ts`, `keymap-view.ts`, `setting-rows-view.ts`; `src/plugins/docs/page/docs-state.ts`,
  `tree-view.ts` (04)
- `src/plugins/chat/page/start.ts`, `src/plugins/chat/manifest.ts`, `src/plugins/chat/page/chat.css`,
  `src/plugins/chat/main/selftest-script.ts` (05)

New files:

- `src/contracts/fuzzy.ts` — the matcher contract; a third-party tool gets a contract (AGENTS.md)
- `src/renderer/fzf/fzf-matcher.ts` + test — the one adapter over `fzf`
- `src/plugins/chat/page/completion-rows.ts` + test — the draw registry behind `addCompletionRow`; its own module so
  the newest-first rule is tested without a DOM

Boundary rules: only `src/renderer/fzf/` imports `fzf`; `src/shared/page/` and plugins reach the matcher through the
contract, handed in; no `initialize`/`init` knowledge outside `src/main/claude-code/`; the editor contract names no
chat or harness type.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Fuzzy matcher contract and fzf adapter](01-fuzzy-matcher.md)
- [ ] [Agent command records from initialize](02-agent-command-records.md)

### Wave 2
- [ ] [Editor completion: fuzzy items and row drawing](03-editor-completion.md) — after 01, 02
- [ ] [Pickers and `/` filters on the matcher](04-pickers-and-filters.md) — after 01

### Wave 3
- [ ] [Chat completion, descriptions setting and row hook](05-chat-completion.md) — after 02, 03, 04

### Wave 4
- [ ] [Doc re-read](06-doc-re-read.md) — after 01, 02, 03, 04, 05

### Wave 5
- [ ] [Final verification](07-final-verification.md) — after 06

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
