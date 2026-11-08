# Forms rundown — plan

Feature: Forms rundown (question summary, label-free question cards, one notices page) · Implements: none · Ticket: none
Target: branch `forms-rundown` in wigley-ai-gui, wigley-ai-marketplace and wigley-agents · Written: 2026-11-08

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user reads a forms question as a rundown, not as a set of labelled sections:

- A question carries a required `summary` that replaces its `question` field. The card draws the summary as
  its headline.
- The question card draws no section labels. It drops Question, Context, Why recommended and Your answer.
  Finding cards keep all their labels.
- All the notices of a round draw on one compact page, the last stop after every finding and question. Each
  notice is one line (badge and title) that opens to its context and its comment box. Findings keep their
  full cards.
- Agents read how to word every round item in `~/wigley-agents/forms.md`. The tool's schema descriptions
  point there and keep a short backstop of the summary and context rules.

## Architecture

Systems touched:

- **wigley-ai-gui, forms plugin, main process** (`src/plugins/forms/main/`): the question format module
  (schema, parse, fingerprint), the notice and finding format descriptions, the `ask_round` tool description,
  the preview round and the forms self-test script.
- **wigley-ai-gui, forms plugin, page** (`src/plugins/forms/page/`): the round state (rail stops, notice open
  state, notice line cursor), boxes, commands, view model, round view, and the layout tables, panes and kits.
- **wigley-ai-gui, forms layout contract** (`src/plugins/forms/layouts/layout.d.ts`, `layouts/default/`): the
  public contract that user layouts implement, and the built-in `default` layout.
- **wigley-ai-gui, shared page UI** (`src/shared/page/ui/card.ts`): the collapsible row.
- **wigley-ai-gui, chat self-test** (`src/plugins/chat/main/selftest-script.ts`): one raw question argument.
- **wigley-ai-gui, keymap** (`src/plugins/keymap.ts`): the forms binds.
- **wigley-ai-marketplace**: the plugin version in both manifests. The docs there are written ahead.
- **wigley-agents**: `forms.md` and the `AGENTS.md` pointer, written ahead.

## Preconditions

`wigley:make` re-runs each command before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| A worktree on branch `forms-rundown` exists for each of the three repos, with `node_modules` linked in the gui one | `git -C /Users/jonathonwigley/Documents/ai-dev/.worktrees/<repo>-forms-rundown branch --show-current` for `wigley-agents`, `wigley-ai-gui`, `wigley-ai-marketplace`; `test -L /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown/node_modules` | `forms-rundown` ×3; link present |
| The docs-written-ahead commits (below) are on each worktree's branch | `git -C <worktree> merge-base --is-ancestor <commit> HEAD` in each worktree | exit 0 ×3 (the gui branch also holds the plan-folder commit after them) |
| No user forms layout exists, so no user `cards.notice` or rail breaks | `ls ~/.config/wigley-ai-gui/layouts/forms/` | only `layout.d.ts` |
| The user sets no `forms.layout` | `grep -n '"forms' ~/.config/wigley-ai-gui/settings.json` | no match |
| Notices are first in the rail today | `grep -n 'RAIL_ORDER' src/plugins/forms/page/form-state.ts` | `RAIL_ORDER: ItemKind[] = ['notice', 'finding', 'question']` at line 137 (measured at plan time, re-verify) |
| `j`/`k` and `Ctrl+l`/`Ctrl+h` share `forms.nextItem`/`forms.prevItem`; `a` is `forms.editNotes`; `<CR>` is `forms.acceptRecommendation`; `o` and `za` are unbound in `forms.forms` | `grep -n "forms.forms" src/plugins/keymap.ts` | as stated (measured at plan time, re-verify) |
| The plugin version is 1.20.1 in both manifests | `grep -n '"version"' /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-forms-rundown/plugins/wigley/.claude-plugin/plugin.json /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-forms-rundown/plugins/wigley/.codex-plugin/plugin.json` | `1.20.1` ×2 |

The gui commands run from `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown`.

## Docs written ahead

Each is a hypothesis until task 09 re-reads it against the landed code.

| Repo | Commit | Files |
|---|---|---|
| wigley-agents | `64ba2e3` | `forms.md` (new), `AGENTS.md` § Communication |
| wigley-ai-marketplace | `3689c72` | `plugins/wigley/skills/feature/SKILL.md` § Question format, `plugins/wigley/skills/review/triage.md`, `plugins/wigley/scripts/forms/README.md` |
| wigley-ai-gui | `4d679c5c` | `AGENTS.md` (forms layout bullet), `docs/features/layouts/design.md` (forms row) |

The three branches stay off `main` until they land together at close, after `wigley:make` step 9 (the steps are in task 10 § Landing). `forms.md` names a `summary` field, and an
agent on `main` would read it before the app has that field.

## Mandatory Reads

- `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown/AGENTS.md`, through its last line
- `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown/docs/keymap.md` (tasks 04, 07)
- `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-forms-rundown/AGENTS.md` (task 08)
- `~/wigley-agents/WigleyRepos.md` § Landing (task 10)
- `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-agents-forms-rundown/forms.md` (tasks 01, 06)
- No `CLAUDE*.md`, `AGENTS.local.md` or `.claude/rules/*.md` exists in the gui repo.

## Design Overview

After-state flow of one round:

```
agent ── ask_round {questions[ title, summary, context, choices, recommend, rationale ], findings[], notices[]}
          │  schema descriptions: pointer to ~/wigley-agents/forms.md + summary/context backstop
          ▼
main: parseQuestion ── summary required; a saved file's `question` reads as summary
          │  fingerprint hashes summary (key `summary`)
          ▼
page: railItems(round) = findings…, questions…, {kind:'notices'} (only when the round has a notice)
          │
          ├─ finding stop  → cards.finding   (labels kept)
          ├─ question stop → cards.question  (summary headline · context · choices · unlabelled rationale)
          └─ notices stop  → notices pane (pane chain)
                               └─ kit.line(i) per notice: head = layout's badge + title
                                    body = cards.notice for notice i (item chain), built up front, hidden while closed
                                    open state: RoundState.openNotices[i-1]; cursor: RoundState.noticeLine
answers: unchanged, index-parallel per kind (notice_comments by notice index)
```

Keys on the notices stop (user's pick, round 4):

- `j`/`k` move the line cursor through the notices. Past the last line `j` does nothing (the stop is last);
  `k` above the first line moves focus to the item before the stop.
- `Enter` or `za` opens or closes the line under the cursor.
- `a` or `o` opens the line under the cursor and focuses its comment box.
- `Ctrl+h`/`Ctrl+l` still move by item and skip the lines. Number keys do nothing on the stop.

Decisions (round and source):

- `summary` replaces `question`; no field labels and no forced repeats; `title` shows only in the rail (round 1,
  user note).
- The card draws the summary as its headline, through `kit.inlineMarkdown` (round 1).
- The summary joins the fingerprint, so a saved question round from before the change no longer pre-fills a re-send, and the two hashes `round.test.ts` pins are re-pinned. A saved round whose question has `question` and no `summary` parses with
  `question` read as the summary. A call that sends both fails (round 1, Decided).
- Agents reach the guidance by both a pointer and a backstop: `AGENTS.md` § Communication points to `forms.md`;
  the `ask_round` description points there; the `summary` and `context` descriptions keep a short backstop
  (round 1, choice 3).
- Notices fold into one page; findings keep their full cards (round 2, user note).
- The notices page goes last (round 3).
- The notices page is a new layout pane part `notices`, picked by the pane chain; each line's body is that
  notice's `cards.notice`, picked by its own item chain (round 4, Decided).
- Every notice body and comment box is built up front and hidden while closed. `RoundState` holds the open
  state. A notice whose restored comment is non-empty opens on restore. Open state is not saved in the draft
  (round 4, Decided).
- The shared collapsible row gains a keep-body option (round 4, Decided).
- Question cards drop Question, Context, Why recommended and Your answer; finding cards keep theirs (round 4,
  Decided).
- Answers, drafts and comment overrides are unchanged: notices match by index (round 4, Decided).
- Stale "notices first" wording is fixed in the tool descriptions, the forms README and the review triage's
  fallback (round 4, Decided; the docs are done).
- Notices page keys as listed above (round 4, choice 1).

Out of scope:

- Finding cards: no change to their labels, layout or fields.
- The relay (`relay.py`): it serves the app's `tools.json` and holds no schema copy.
- The retro readers (`scripts/retro/answers.py`): they read no question `question` field.
- Saving the notices' open state in the draft.
- Extending `scripts/check_pointers.py` to check `§` pointers into `forms.md`.

Architecture notes:

- One user, no backwards compatibility (gui `AGENTS.md`): the layout contract changes in place. The one
  tolerance is the saved-round parse of `question`, which the user chose.
- Every surface draws through a layout: the notices page is a layout part, never app-drawn DOM.

## File Structure

Paths are relative to the gui worktree unless marked. `F` = `src/plugins/forms`.

Existing files modified:

| File | Tasks |
|---|---|
| `F/contract.ts` (`Question`) | 01 |
| `F/main/kinds/question/question-format.ts` and its test | 01 |
| `F/main/round.test.ts`, `F/main/round-type.test.ts`, `F/main/kinds/fields.test.ts`, `F/main/tool-definitions.test.ts` (raw question args) | 01 |
| `F/page/test-rounds.ts` (`question()` helper) | 01 |
| `F/page/form-state.test.ts` (its own typed `question()` builder) | 01, 04 |
| `F/main/round.ts` (the comment over `fingerprint()` only) | 01 |
| `F/main/preview/preview-round.ts` and its test | 01 (questions), 06 (notices) |
| `src/plugins/chat/main/selftest-script.ts` (one raw question) | 01 |
| `src/shared/page/ui/card.ts` | 03 |
| `F/page/kinds/question/question-card.ts` | 01 (reads `question.summary` so Wave 1 compiles), 02 |
| `F/page/kinds/card-input.test.ts` | 02 |
| `F/page/layout/card-kit.ts`, `F/page/kinds/card-parts.ts`, `F/page/layout/card-kit.test.ts` | 02 |
| `F/layouts/layout.d.ts` | 02 (`QuestionCard`), 04 (`RailEntryInput.kind`), 05 (notices pane) |
| `F/layouts/default/layout.js`, `F/layouts/default/layout.css`, `F/page/forms.css` | 02 (question card), 05 (notices pane, notice card) |
| `F/page/form-state.ts`, `F/page/boxes.ts`, `F/page/view-model.ts`, `F/page/forms-commands.ts` and their tests | 04 |
| `F/page/layout/layout-panes.ts`, `F/page/round-view.ts` | 04 (only the edits the `RailItem` change forces to compile and keep tests green), 05 |
| `src/plugins/keymap.ts`, `F/manifest.ts` (the three new commands) | 04 |
| `F/page/layout/card-kit.ts`, `F/page/layout/layout-cards.ts`, `F/page/kinds/formats.ts`, `F/page/layout/layout-resolver.ts` | 04 (`RoundItem`, `RoundPicks.noticeCards`); card-kit also 02, the others also 05 |
| `docs/keymap.md`, `AGENTS.md` (the `RAIL_ORDER` sentence) | 04, re-read by 09 |
| `F/page/layout/read-layout.ts`, `F/page/layout/layout-resolver.ts`, `F/page/layout/layout-panes.ts`, `F/page/layout/layout-cards.ts`, `F/page/round-view.ts` and their tests | 05 |
| `F/main/kinds/notice/notice-format.ts`, `F/main/kinds/finding/finding-format.ts`, `F/main/tool-definitions.ts` | 06 |
| `F/main/selftest-script.ts` | 07 |
| marketplace `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json` | 08 |

New files: `src/shared/page/ui/card.test.ts` (03): no test owns the collapsible row today. A task that finds a new module earns its place names it in its own document with the
reason.

Shared names. Every task that writes or reads one uses it exactly as written here:

- `Question` (`F/contract.ts`): `summary: string` replaces `question: string`. Field order: `title, summary,
  context, choices, recommend, rationale, layout`.
- `QUESTION_FIELDS` (`question-format.ts`): `['title', 'summary', 'context', 'choices', 'recommend',
  'rationale']`.
- `QuestionCard` (`layout.d.ts`): `summary: string` replaces `question: string`.
- `RailItem` (`F/page/form-state.ts`): `{ kind: AnswerableKind; index: number } | { kind: 'notices' }`. A per-notice
  item for picks and bodies is `RoundItem = { kind: ItemKind; index: number }` (04), which `card-kit.ts`,
  `layout-cards.ts`, `kinds/formats.ts` and `layout-resolver.ts` take where they meant one item.
- `RoundPicks` (`layout-resolver.ts`): `cards: LayoutPick[]` per answerable stop, `noticeCards: LayoutPick[]` by notice
  index − 1 (04), and the `notices` pane pick in `panes` (05).
- `buildNoticesPane(pick, bodyPicks, parent, round, position, deps, cardDeps): ItemCard` in `layout-panes.ts` (05).
- `railItems(round)`: the findings in order, then the questions in order, then `{ kind: 'notices' }` when
  `round.notices.length > 0`.
- `RoundState.openNotices: boolean[]`: one entry per notice, by notice index − 1.
- `RoundState.noticeLine: number`: the 1-based notice index under the line cursor; `1` when the round has
  notices, `0` when it has none.
- Actions: `{ type: 'toggleNotice'; notice: number }` (1-based), `{ type: 'moveNoticeLine'; delta: 1 | -1 }` and
  `{ type: 'focusNotice'; notice: number }` (focuses the stop with the cursor on that line).
- Log lines (04; 07 waits on them): `opened notice <n>`, `closed notice <n>`, `line cursor on notice <n>`,
  `jumped to notices`.
- Commands: `forms.nextLine` and `forms.prevLine` (bound to `j` and `k` in `forms.forms`; on any stop but the
  notices stop they act as `forms.nextItem` and `forms.prevItem`); `forms.toggleNotice` (bound to `za`).
  `<CR>` stays `forms.acceptRecommendation`, which on the notices stop toggles the line under the cursor.
  `o` binds `forms.editNotes`, beside `a`; on the notices stop `forms.editNotes` opens the line under the cursor
  and focuses its comment box.
- `CollapsibleCardOptions` (`card.ts`) gains `keepBody?: boolean` (build the body once, at creation, and hide it
  while closed) and `onToggle?(): void` (a head click calls it in place of toggling, so the caller owns open
  state).
- Layout contract (`layout.d.ts`):
  - `RailEntryInput.kind: 'question' | 'finding' | 'notices'`.
  - `NoticeLineInput { index: number; label: string; title: string; badge: string }` (`layout.d.ts` imports only the shared kit, as `NoticeCard.badge` already shows) (`index` 1-based).
  - `NoticesInput { round: RoundInfo; notices: NoticeLineInput[] }`.
  - `NoticesKit extends FormsBaseKit { line(parent: HTMLElement, index: number): HTMLElement }` — draws the
    line for notice `index` (chevron, open state, the hidden body holding that notice's `cards.notice`, the
    cursor mark) and returns the line's head element for the layout to draw the badge and title into.
  - `Layout.notices?(parent: HTMLElement, input: NoticesInput, kit: NoticesKit): LayoutPane`; required in
    `CompleteLayout`.

Boundary rules:

- `F/main/` imports no `F/page/` module, and the reverse; both read `F/contract.ts`. `npm run lint` checks it.
- A layout reaches the app only through `layout.d.ts` and its kits.
- `src/shared/page/ui/card.ts` knows nothing of forms.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Question summary field](01-question-summary.md)
- [x] [Collapsible keep-body option](03-collapsible-keep-body.md)
- [x] [Marketplace version bump](08-marketplace-version.md)

### Wave 2
- [x] [Label-free question card](02-label-free-question-card.md) — after 01
- [x] [Item descriptions and preview notices](06-descriptions-preview.md) — after 01

### Wave 3
- [x] [Notices stop, state and keys](04-notices-state-keys.md) — after 01, 02 (both edit `layout.d.ts`)

### Wave 4
- [x] [Notices pane](05-notices-pane.md) — after 02, 03, 04

### Wave 5
- [x] [Forms self-test](07-forms-selftest.md) — after 01, 02, 04, 05, 06

### Wave 6
- [ ] [Doc re-read](09-doc-re-read.md) — after 07, 08

### Wave 7
- [ ] [Final verification](10-final-verification.md) — after 09; its § Landing runs at close

## Run log

Review base: 21b036cb

### Groups
- 08 · marketplace 44d083c · diff read: both manifests 1.20.1→1.20.2 only; every Done command passes, check_manifests --against origin/main passes after commit · concerns: none
- 03 · 31cacc80 · diff read: keepBody and onToggle in CollapsibleCardOptions as Produces pins, default path unchanged; worker typecheck, lint (own files), card and chat-kit tests pass · concerns: worker ran oxfmt on its two files to pass the format check
- 01 · a46256e6 · diff read: Question.summary, QUESTION_FIELDS, fingerprint key summary, schema requires summary with no question property, test-rounds summary all present; typecheck passes; worker lint and named tests pass · concerns: worker ran oxfmt on its three edited files; forms selftest-script still sends question (legacy path parses it) until task 07
- 06 · a9f2adb2 · diff read: NOTICES_DESCRIPTION, FINDINGS_DESCRIPTION, ASK_ROUND_DESCRIPTION pinned text, three preview notices one per badge, test checks every badge; worker typecheck, lint, named tests pass; order grep leaves only 04's two hits · concerns: none
- 02 · 5766ea22 · diff read: QuestionCard.summary, buildChoiceReason(label|null), appendAnswerArea/appendChoiceReason with null label, .item-summary and .answer-head CSS as pinned, finding card keeps labels; typecheck passes; worker lint and named tests pass · concerns: forms selftest-script SELFTEST_LAYOUT string still reads input.question (typecheck cannot see it) — task 07 owns it; choiceReason test asserts labels-per-reason rather than exactly one reason on the question row
- 04 · 29df4efc · diff read: RoundItem, RailItem union, railItems, openNotices/noticeLine, the three actions, railEntryLabel/Title, noticeToggledLine, lineCursorLine, RoundPicks.noticeCards, RailEntryInput.kind, the three commands and binds all present; worker full npm test (10156), typecheck, lint pass · concerns: forms selftest-script expects j ran forms.nextItem in many rows — task 07 owns it; za is not a vim key, so the placement check wants an anchor for forms.toggleNotice — task 05's notices pane must draw it; interim notice cards use the stop's rail position
- 05 · 2871e979 · diff read: buildNoticesPane, NoticeLineInput, NoticesInput, NoticesKit.line, Layout.notices, PANES/read-layout notices, buildLayoutCard rollback, default notices pane and headless notice card, interim removed, za anchor on cursor line all present; typecheck passes; worker full npm test (10176) and lint pass · concerns: Enter on the notices stop also toggles the cursor line (from 04; vim key, no anchor); live look unchecked (head inside collapsible button, hidden empty summary, prompt position, editors in hidden bodies) — task 10
- 07 · a0475c08 · diff read: summary renames incl. SELFTEST_LAYOUT input.summary, j/k expects now nextLine/prevLine (only PAGE_BINDS keeps nextItem), preview walk with preview-question, finding picks and round layouts re-walks, NOTICE_COMMENT_STEPS group, reconsider payload check all present; typecheck passes; worker lint passes · concerns: finding picks step 1 (Space k k) logs k ran forms.prevLine twice in one step — the race the task doc warns of; watch in task 10's self-test run; round layouts last step's why now names the notice comments group
### Contract changes
### Rulings
- Rebased the gui and agents branches onto main at preflight (9 and 1 commits behind); the docs-written-ahead commits are now gui 3c06d4c3 (was 4d679c5c) and agents 67c4697 (was 64ba2e3); review bases: gui 21b036cb, marketplace 3689c72, agents 67c4697 — work builds on origin's latest — a stale sha in a later brief would mislead a re-read · lead
- Kept body starts hidden and the constructor's setOpen(true) reveals it for open:true — one opening path — nothing visible if wrong · group 03 · group 03
- Summary description is its own constant QUESTION_SUMMARY_DESCRIPTION beside the context one — matches the file's pattern — cosmetic if wrong · group 01 · group 01
- choiceReason_LabelByCardKind uses one assertion shape (labels = reasons × 0 or 1) for both rows — one table shape — a question card drawing several rationales would pass · group 02 · group 02
- RailItem written AnswerableItem | { kind: 'notices' } — same type as pinned — none · group 04
- noticesStop(state) helper gates every notice-key path to the forms view showing the stop, so review or sending never toggles — matches 'item actions' — a toggle while sending logs nothing · group 04
- Fixed stale docs outside the list: key-hints design example now primer.nextRow, followups.md names ANSWERABLE_ORDER — docs kept true — none · group 04
- Task 05's notices pane anchors forms.toggleNotice (za) on the cursor line, through the kit's key-anchor parts — za is not one of vim's own keys, so the end-of-run placement check fails without an anchor and no task drew one — the self-test's placement check fails if missed · lead
- za prompt is one span.notice-line-prompt per pane draw, made through recordingDeps and moved to the cursor line's head on every update, so a user layout cannot drop it — mirrors the review's jump prompt — placement check fails if missed · group 05
- Prompt label is 'toggle' rather than the command label — keeps the line short — copy only · group 05
- Head click compares the line's open state before and after its dispatches and logs only on change — no double log — a click logs nothing if wrong · group 05
### Review rounds
### Test gate
