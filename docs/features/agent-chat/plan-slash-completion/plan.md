# Slash completion — plan

Feature: agent chat (plan D) · Implements: none · Ticket: none
Target: main · Written: 2026-10-23 · Updated for main: 2026-11-04 (`aa23f975`)

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the run lands, and the bug behind it.
- **Architecture** — the flow from the CLI to the popup, and the systems touched.
- **Preconditions** — the state the plan rests on, with the commands that check it.
- **Docs written ahead** — what is already in the docs, and what task 06 writes.
- **Mandatory Reads** — what every implementer reads first.
- **Design Overview** — the after-state flow, decisions, scope and boundaries.
- **File Structure** — every file by task.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

The Chat box's `/` completion offers every command and skill of the session from the moment the session starts —
`/wigley:feature` included. It matches fuzzily by name or alias (`/feature` offers `/wigley:feature`). Each row shows
its description behind a setting, and any plugin can draw a completion row through a hook. The same fzf matcher ranks
every list picker, with a row's name ahead of its path. It also filters the Settings, keymap, Docs and Backlog `/`
filters.

**The bug.** Claude Code sends `system/init`, the only source of the command list today (`commandNames` in
`src/main/claude-code/stream-decoder.ts`), after the first user message. Until then the box offers only the app's own
slash commands, so the first `/wigley:feature` of a new or resumed session finds nothing. The completion also matches
only names that start with the typed text, so `/feature` finds nothing at any time.

## Architecture

```
claude process ──initialize control_response (0.3 s)──► session fold ──'commands' effect──► harness ──commands(AgentCommand[])──► chat main
               ──system/init (each turn)──────────────►  merge by name/alias                                                       │ channel 'commands'
session host pipe log ──replay on re-attach───────────►  (same fold, same records)                                                 ▼
FuzzyMatcher (fzf adapter, src/renderer/fzf/) ◄── page services ── chat page: chat-view builds CompletionItems
     ▲            ▲                ▲                                     (app commands + agent records)
     │            │                │                                       │ EditorCompletions { items, drawRow }
     │   list pickers,      editor adapter: CodeMirror completion ◄────────┘
     │   Settings, keymap,  ranks items by name + aliases, draws each row,
     │   Docs, Backlog      hands the row to drawRow
     │                                          │
     └──────────────────────────────────────────┘    chat completion rows registry: addCompletionRow(draw) export;
                                                      chat's own draw draws the `completionDescription` layout part
                                                      while chat.completionDescriptions is on
```

Systems touched: the Claude adapter (the session fold and the harness) and the fake harness, the agent contract, chat
main and page, the chat layout contract and default layout, the editor contract and the CodeMirror adapter, a new fzf
adapter and page service, the shared list picker, the Settings, Docs and Backlog filters, the Notes target picker, the
layer check.

## Preconditions

`wigley:make` re-runs each of these before the first dispatch.

- **Foundation sweeps first.** The `foundation-sweeps` branch has every box ticked but has not merged, and its worktree
  was mid-merge at this update. Check: `git merge-base --is-ancestor foundation-sweeps main`. Run this plan after that
  check passes. The branch changes two things this plan touches:
  - `ListPickerDeps` drops `logSource` and `log` becomes `PluginLog`. This plan only adds `matcher`, so its caller edits
    keep their sense.
  - `scripts/check-layers.mts` derives plugin layers from `layer-rules.mts`. The `src/renderer/*` entries stay explicit
    on the branch, so the entry in task 01 keeps its shape.

  After the merge, re-check the signatures this plan names in `src/contracts/plugin.ts`, `src/contracts/editor.ts` and
  `src/shared/page/list-picker.ts`. If the user drops or delays the branch, ask before this plan runs.
- **The CLI answers `initialize`.** Measured on `2.1.318` at this update: a success answer in 0.31 s, with 101
  `commands` records. Each record has `name`, `description` and `argumentHint`; 52 records have no `aliases`; no name has
  a leading `/`. Re-run the probe in `docs/features/agent-chat/claude-stream.md` § Initialize: stdin the one
  `control_request` line, read stdout until the `control_response`, and check `response.response.commands[0]`.
- **`fzf` is not installed.** `npm list fzf` → `(empty)`. **The user approved installing `fzf@0.5.2` (fzf-for-js,
  BSD-3-Clause, no dependencies) as a dependency in interview round 4, 2026-10-23.** `npm view fzf version` still gave
  `0.5.2` at this update. Task 01 installs it with `npm install fzf@0.5.2`. No other package is approved. If the
  approved version is no longer available, stop and ask.
- `@codemirror/autocomplete` is `6.20.3` in `package.json`: `grep autocomplete package.json`.
- Node `24.22.1` (`.nvmrc`).

## Docs written ahead

Commit `c4017923` wrote ahead: `docs/features/agent-chat/claude-stream.md` (§ Initialize),
`docs/features/agent-chat/design.md` (Slash completion, Completion rows, § Plans), `AGENTS.md` (the `fzf/` line, the
editor line, § Architecture "A third-party tool"), `docs/features/settings/design.md` (the `/` filter) and
`docs/features/docs-browser/design.md` (Tree).

Later edits changed that set. `design.md` § Agent harness seam, Commands again describes today's names-only list
(`3ef8d66e`), so task 06 writes that paragraph from the landed code. The name-over-path rule, the Backlog filter and the
`completionDescription` layout part are in no doc yet; task 06 writes them too.

## Mandatory Reads

- `AGENTS.md` — the layers, plugins, settings, page services, third-party tool rule, "Everything draws through a
  layout", self-test and drive run
- `DESIGN.md` — every view rule; task 05 draws the description column in the popup
- `docs/features/agent-chat/design.md` and `docs/features/agent-chat/claude-stream.md` § Init, § Initialize
- `docs/features/session-host/design.md` § Re-attach — tasks 02 and 05 rely on replay
- `docs/features/layouts/design.md` — task 05 adds a layout part
- `.agents/skills/drive/SKILL.md` — task 07's drive run
- This repo has no `CLAUDE*.md` and no `.claude/rules/`.

## Design Overview

**After-state flow.** A session starts. The Claude session's `open()` writes the `initialize` control request as its
first stdin line, ahead of the `get_context_usage` request. The session fold reads the answer's `commands` as
`AgentCommand` records and emits them. Chat main stores them in `ChatSessionState.commands` and sends them to the page.
Typing `/` in the box asks the editor completion for items: the app's slash commands, then the agent's records the app
does not hold. The editor adapter ranks the items by the typed word against each name and its aliases through
`FuzzyMatcher`, best first. Each popup row shows `/<name>` and hands its element to `drawRow`, where chat's completion
rows registry runs the newest draw first. Chat's own draw adds the description through its layout part while
`chat.completionDescriptions` is on. Tab inserts `/<name> `.

Every later `init` replaces the list. An init name that matches an earlier record's `name` or one of its `aliases` keeps
that record, once. An init name that matches no record becomes
`{ name, description: '', argumentHint: '', aliases: [] }`. A record that no init name matches drops.

**Re-attach.** The fold is a pure function of the pipe log, so a re-attach rebuilds the records from the logged
`initialize` line and answer. A re-attach writes no `initialize`. A process that started before this plan landed has no
such line: its list comes from `init`, as today.

**Decisions** (round numbers are the original interview's; "2026-11-04" marks this update's round):

- The command list at start comes from Claude's `initialize` control request (round 1); `init` still updates it
  (Decided). A failed `initialize` answer is logged and leaves the list to `init` (Decided).
- The records and the merge live in the session fold, because the fold owns stdin and control replies since the session
  host landed (Decided 2026-11-04).
- The `initialize` answer stays out of the chat entries, as the `get_context_usage` answer does: it carries about 100
  records and the user cannot act on them (Decided 2026-11-04).
- A typed word matches by name or any alias, and the row shows and inserts the full name (round 1). The match is fuzzy,
  not prefix (round 1 note).
- Descriptions show in a dim column, behind the chat setting `completionDescriptions`, default on (round 2). They draw
  through a new `completionDescription` part of the chat layout, because every surface draws through a layout (Decided
  2026-11-04, `AGENTS.md`).
- The row hook lands now (round 2 note), and a plugin gets the command and the row's DOM element (round 3). The newest
  draw goes first; the first that returns `true` ends the row; disposing a draw restores the one before (Decided). Chat's
  own description draw goes through the same hook (Decided).
- Fuzzy matching goes through the `fzf` npm package (round 4), behind a `FuzzyMatcher` contract with one adapter folder
  (Decided). It ranks by fzf's score, and the list's own order breaks ties (Decided).
- `rank` takes each item's texts as **tiers**: a match in an earlier tier always outranks a match in a later tier, and
  inside a tier an item takes its best text's score, the shorter text then input order breaking ties. The slash completion puts name and aliases in one tier (Decided).
- **A row's name outranks its path** in the pickers whose labels hold a name and a path: the Notes target, chat's Folder
  step, and Docs' place and `Load states for` pickers (the user, 2026-11-04, from `followups.md`). With a filter typed, a
  picker's cursor goes to the first ranked row, so Enter picks the best match (Decided 2026-11-04). Recency stays a follow-up: `NoteHome` has no updated time, and "updated"
  has no definition yet.
- Every list picker ranks with the matcher, best first (rounds 2 and 3), so all six `createListPicker` callers take it
  (Decided 2026-11-04). Settings rows, keymap rows, the Docs tree and Backlog rows filter with it and keep their order.
  A setting's description, a Backlog item's one-line summary and a Docs entry's path keep plain substring matching
  (round 3; the user for Backlog, 2026-11-04; the Docs path from task 07's drive run), because a fuzzy match over a
  sentence or a full path matches almost any query.
- The docs path completion (`src/plugins/docs/path-completion.ts`) keeps prefix matching (Decided).
- This plan draws no match highlighting (Decided): rows and picker labels draw as today.

**Out of scope.** The docs path box; a per-plugin enable switch; the command palette and `Space f f` finders
(`docs/features/intent-alignment/master-plan.md` Lane E, which will reuse `FuzzyMatcher`); reading `models` or the
permission mode from `initialize`; showing argument hints by default (a plugin can draw them through the hook); ranking
by recency.

**Architecture.** `AgentCommand` crosses the harness seam, so it sits in `src/contracts/agent.ts`. Only
`src/main/claude-code/` knows `initialize`, `init` and their JSON. `FuzzyMatcher` is a third-party tool contract in
`src/contracts/fuzzy.ts`, with its adapter in `src/renderer/fzf/` (the only `fzf` import). Plugins get it as the page
service `fuzzy`; the editor host gets it from the renderer composition root. The editor contract stays harness-free: it
offers `CompletionItem`s and a `drawRow` callback, and chat maps a row's word back to its command.

## File Structure

Existing files modified:

- `package.json`, `package-lock.json` — `fzf` 0.5.2 dependency (01)
- `scripts/check-layers.mts` — the `src/renderer/fzf` layer, `fzf` package allowed there only; `renderer.ts` may import it (01)
- `src/contracts/plugin.ts` — `PageServices.fuzzy: FuzzyMatcher` (01)
- `src/renderer/renderer.ts` — builds the fzf matcher once, into services and the editor host (01, 03)
- `src/contracts/agent.ts` — `AgentCommand`, `AgentProcessEvents.commands(commands: AgentCommand[])` (02)
- `src/main/claude-code/session-fold.ts`, `claude-code-harness.ts` — `initialize`, records, init merge (02)
- `src/shared/fake-agent-harness.ts` — emits records (02)
- `src/plugins/chat/contract.ts` — `ChatSessionState.commands: AgentCommand[]`, channel `commands` payload (02);
  `CompletionCommand`, `CompletionRowDraw`, `ChatPageExports.addCompletionRow` (05)
- `src/plugins/chat/main/chat-sessions.ts` — stores and sends records (02)
- `src/plugins/chat/page/chat-view.ts`, `slash-commands.ts` — compile-through in 02 and 03; full completion in 05
- `src/contracts/editor.ts` — `CompletionItem`, `EditorCompletions.items`/`drawRow`, `CreateEditorHost` takes the matcher (03)
- `src/renderer/codemirror-vim/prefix-completion.ts`, `codemirror-vim-host.ts` — fuzzy items and row drawing (03)
- `src/shared/page/list-picker-state.ts`, `list-picker.ts`; callers `src/plugins/chat/page/picker.ts`,
  `chat/page/start-prompt.ts`, `start-prompt-items.ts`, `settings/page/settings-view.ts`, `docs/contract.ts`,
  `docs/kinds.ts`, `docs/page/docs-dialogs.ts`, `docs/page/docs-view.ts`, `backlog/page/backlog-view.ts`, `sessions/page/start.ts`, `notes/page/popup.ts`, and the plugins' `page/start.ts` that
  read `api.services.fuzzy` (04; chat's `start.ts` again in 05)
- `src/plugins/settings/page/row-filter.ts`, `keymap-view.ts`, `setting-rows-view.ts`;
  `src/plugins/docs/page/docs-state.ts`, `tree-view.ts`; `src/plugins/backlog/page/backlog-state.ts` (04)
- `src/plugins/chat/page/start.ts`, `src/plugins/chat/manifest.ts`, `src/plugins/chat/layouts/layout.d.ts`,
  `layouts/default/layout.js`, `layout.css`, `layout.test.ts`, `src/plugins/chat/page/read-chat-layout.ts`,
  `src/plugins/chat/main/selftest-script.ts` (05)

New files:

- `src/contracts/fuzzy.ts` — the matcher contract; a third-party tool gets a contract (`AGENTS.md`)
- `src/renderer/fzf/fzf-matcher.ts` + test — the one adapter over `fzf`
- `src/main/claude-code/claude-commands.ts` + test — reads `initialize` records and merges an `init` into them, pure, so
  the fold stays a sequencer
- `src/plugins/chat/page/completion-rows.ts` + test — the draw registry behind `addCompletionRow`; its own module so the
  newest-first rule is tested without a DOM

Boundary rules: only `src/renderer/fzf/` imports `fzf`. `src/shared/page/` and plugins reach the matcher through the
contract, handed in. `src/main/claude-code/` alone knows `initialize` and `init`. The editor contract names no chat or
harness type.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Fuzzy matcher contract and fzf adapter](01-fuzzy-matcher.md)
- [x] [Agent command records from initialize](02-agent-command-records.md)

### Wave 2
- [x] [Editor completion: fuzzy items and row drawing](03-editor-completion.md) — after 01, 02
- [x] [Pickers and `/` filters on the matcher](04-pickers-and-filters.md) — after 01

### Wave 3
- [x] [Chat completion, descriptions setting and row hook](05-chat-completion.md) — after 02, 03, 04

### Wave 4
- [x] [Doc re-read](06-doc-re-read.md) — after 01, 02, 03, 04, 05

### Wave 5
- [x] [Final verification](07-final-verification.md) — after 06

## Run log

Review base: b05f0e7fa4316350df34560fcfcebfa982326d2e

### Groups
- 02 · 44850dec · cherry-pick of 0640436c from the stopped worktree run onto main; session-fold auto-merged; diff read in the earlier run; typecheck exit 0; the five touched test files pass, 679 · concerns: isKeptOut is the decoder's parameter, not a fold name; an init with no names now emits nothing; alias match on an earlier record beats an exact name on a later one, as pinned, untested; initialize listing more than init drops records at the first init, check live in 07; leading-slash regex in both commandNames and withoutSlash
- 01 · e25dcac6 · diff read; every Produces present; typecheck exit 0 with no errors; lint clean per worker; fzf-matcher tests 17 pass; npm list shows fzf@0.5.2 · concerns: tests beyond the named list for trim and case; notes popup and start tests cast their service fakes so typecheck does not name them; harness fuzzy is notFaked so tasks 04 and 05 need a fake or replacement slot there
- 03 · 2f5e9016 · diff read; every Produces present; typecheck no errors; lint exit 0 per worker; prefix-completion tests pass · concerns: one added test pins the single tier and matcher order; drawRow runs per list rebuild and only for rendered rows, so task 05 must not assume one call per word; a selection the user moved down follows its word as ranks change, check live in 07; row drawing has no automated test, checked in 07
- 04 · 33d71b2a · diff read; every Produces present; typecheck no errors; plugin and picker tests 1414 pass; filtered selftest docs,settings,backlog,notes 328 pass per worker; full selftest 949 pass, 1 fail in session-row fit, attributed to a peer's staged Sessions layout edit, re-checked at the test gate · concerns: self-test in a shared tree spoiled by peer page reloads; session-row fit failure unconfirmed as the peer's; Load states names the home folder by base, check live in 07; docs selftest commit split from a peer's staged line
- 05 · d907ce67 · diff read; every Produces present; typecheck no errors; lint exit 0 per worker; five test files 133 pass; selftest --plugin chat 195 pass, no fail · concerns: one full selftest run had three unexplained chat close failures that did not reproduce; agent-lines session-row fit failure, same as task 04, unconfirmed as the peer's; descriptions follow each name so do not line up as a column; DESIGN.md has no line for completion descriptions; the long-description ellipsis was not seen on screen, check in 07; drawRow rebuilds the command list per row
- 06 · 0f106a88 · diff read against the landed code; each listed check reported; docs only · concerns: DESIGN.md has no line for the description, left while a peer holds edits there; init.slash_commands holding the same 101 entries is unverified on 2.1.318; design.md still says the row's element holds the drawn name
- 07 · 04bc4ebf · Live drive against real Claude, reports 07-1 and 07-fix-1. Checks 1, 3, 4, 5, 6 pass and the added merge check passes (110 to 117 commands, none lost). Check 2 and three extra bugs failed, were fixed in 04bc4ebf and re-checked: long-name rows, Ctrl+n and Ctrl+p with the popup open, /feature Tab, Docs path over-match. Notes Target exact-word case not reachable; substitute query tes put the name match first. · concerns: A worker's stray keys sent one real Claude message in the temp home, 0.32 dollars; byLengthAsc changes rank's tie rule for every picker; a name that alone fills the row not seen on screen; Ctrl+n before the popup opens still starts a new session; literal &lt; entities in some descriptions, source unconfirmed
### Contract changes
### Rulings
- sameNames replaced by the existing isSameJson — compares all four fields with no new helper — a reordered alias list sends one extra message · group 02 · group 02
- commandRecordsOf drops an item with no string name — an empty name would draw a blank row — a nameless item goes missing, none measured · group 02 · group 02
- Leading slash stripped from aliases as well as names — merge and alias matching need both bare — an alias really spelled with a slash loses it · group 02 · group 02
- A success answer with commands [] empties the list — the zero-names guard covers init only — an empty answer clears the list until the next init · group 02 · group 02
- stringItems moved from stream-decoder.ts to json-fields.ts, outside the Files line — shared rather than copied — revert the move if unwanted · group 02 · group 02
- This run works in the main tree, not the stopped .claude/worktrees/slash-completion run: this invocation asked for no worktree; 0640436c cherry-picked as 44850dec and the worktree left untouched — costs nothing but the leftover worktree to remove · lead
- foundation-sweeps precondition met though the ref is gone: its merges are in main and ListPickerDeps already has log: PluginLog with no logSource — if wrong, callers fail typecheck · lead
- A peer has uncommitted workflow-plugin edits in this tree: every commit is pathspec-scoped and the review range an explicit commit list · lead
- An item's identity in rank is its input index, so the same value listed twice stays two rows — appears once dedups an item's own texts — a caller wanting duplicates merged gets both · group 01 · group 01
- No index tiebreaker: fzf 0.5.2 keeps list order inside a score — rank_EqualScores_KeepInputOrder pins it — an fzf upgrade that changes this turns that test red · group 01 · group 01
- matches has no empty-query branch: fzf's find('') returns the whole list — matches_EmptyQuery_True pins it — only a swapped adapter would need one · group 01 · group 01
- The harness PageServices fake is notFaked fuzzy, as markup and visualFrames are — a part test reaching it throws until replaced · group 01 · group 01
- The drawRow element is a span, as CodeMirror's label and detail are — the row flows inline — task 05's description column styles it if it needs more · group 03 · group 03
- Shared fakeFuzzyMatcher in src/shared/fake-fuzzy-matcher.test-support.ts rather than one per test — about 15 test files need it — inline per test if wrong · group 04 · group 04
- visibleIndexes and Backlog visibleRows skip the matcher on an empty filter; the Settings matchers call it with an empty query — each settings draw makes one Fzf per text with no filter open · group 04 · group 04
- filterPicker with an empty filter and cursor -1 moves to the first row — stays where it is cannot hold with no row under it — pinned by a test · group 04 · group 04
- A spaces-only filter keeps its text in Settings and Backlog but counts as no filter — only the reopened box shows it · group 04 · group 04
- Self-test filters lengthened: neat to rulesneat, style to rulesstyle, help to togglehelp — claims kept · group 04 · group 04
- Row lookup in a module-level boxCompletions helper in chat-view.ts — two callers of the list — moving it back costs nothing · group 05 · group 05
- Description draws in font-ui at text-ui inside a mono popup — DESIGN.md keeps mono to code-like content — two CSS lines if the user wants mono · group 05 · group 05
- The ellipsis uses inline-block with a max-width of 14 space-8 — an inline span cuts nothing — a very wide window still cuts there · group 05 · group 05
- A draw that throws after appending leaves what it appended, and the next draw adds to it — stated in the CompletionRows comment — a plugin's bug can leave stray row content · group 05 · group 05
- Each add is its own holder, so one function added twice is two draws · group 05 · group 05
- AGENTS.md allows a whole self-test run only when the user asks, so the plan's npm run selftest lines run as the touched plugins' groups; tasks 04 and 05 had each run it whole before this was caught — costs nothing a filtered run proves · lead
- fake-fuzzy-matcher.test-support.ts added to AGENTS.md's src/shared line beside the fake agent harness · group 06 · group 06
- design.md says the description follows the name in a dim box, not a column — it does not line up across rows · group 06 · group 06
### Review rounds
### Test gate
- Picks: typecheck, lint, npm test, and the touched plugins' self-test groups (chat, settings, docs, backlog, notes, sessions, agent-lines), since AGENTS.md keeps the whole self-test for the user's ask in that turn · typecheck 0, lint 0, npm test 463 files 8309 pass; self-test 582 PASS, 1 FAIL (Escape␣zla fits the held width: session-row 156px in 149px), no page reload lines; the failure sits in the Sessions row layout, which this run's commits do not touch
- After task 07's fixes (04bc4ebf), in the worktree: typecheck 0, lint 0, npm test 8366 pass; self-test chat, docs, notes, settings, backlog, forms, primer 816 PASS, 0 FAIL, no page reload lines; forms and primer added because page-keys changed
