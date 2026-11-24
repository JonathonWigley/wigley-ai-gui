# Board and Inbox detail pane — plan

Feature: work-inbox · Implements: none · Ticket: none
Target: `main` of the `ai` repo (folder `wigley-ai-gui`) · Written: 2026-11-24

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user reads a Jira ticket's and a Slack thread's detail inside the app, and opens Jira or Slack only when they
must. Today `Enter` on a Board card opens Jira in the browser, and `Enter` on an Inbox card opens Slack. After this
plan, `Enter` opens a detail pane beside the cards, the sweep fills that pane's data, the Board pane posts a Jira
comment, every Inbox thread takes a reply, and `gx` opens Jira or Slack.

## Architecture

Systems touched, all inside `wigley-ai-gui`:

- `src/plugins/work` — the data plugin: contract, store (`work.json`), the worker's tools and job text, the job
  queue and runner, actions, settings, the new `work.details` slot and the new Comment job.
- `src/plugins/work-board` — the Board view: a split with a detail pane, its layout contract and default layout,
  place slot, sample state, demo steps.
- `src/plugins/work-inbox` — the Inbox view: the same split and pane, slim cards, the draft box moved into the pane.
- `src/plugins/keymap.ts` and `docs/keymap.md` — the new binds.

Nothing outside `wigley-ai-gui` changes. No third-party package is added.

## Preconditions

- The worktree's base is `main` at `72e8802b2` or later: `git -C /Users/jonathonwigley/Documents/ai log --oneline -1 main`.
- The Board and Inbox have no split today: `grep -n "no split" wigley-ai-gui/src/plugins/work-board/page/board-view.ts wigley-ai-gui/src/plugins/work-inbox/page/inbox-view.ts` prints one line in each file.
- `work.state` is the only `work` slot: `grep -n "SlotKey" wigley-ai-gui/src/plugins/work/contract.ts` prints only the import and `workStateSlot` (lines 3 and 299 at plan time, re-verify).
- No bind uses `gx`, `<C-d>` or `<C-u>`: `grep -n "'gx'\|<C-d>\|<C-u>" wigley-ai-gui/src/plugins/keymap.ts` prints nothing.
- The split primitive exists with `sizedPane`: `grep -n "sizedPane" wigley-ai-gui/src/shared/page/ui/split.ts` prints at least one line.
- Both record tools reject extra fields: `grep -n "additionalProperties: false" wigley-ai-gui/src/plugins/work/main/work-tools.ts` prints at least two lines.

## Docs written ahead

Commit `3e8e1ee15` on branch `board-detail-pane`:

- `wigley-ai-gui/docs/features/work-inbox/design.md` — new § Detail pane, two settings rows, the Keys rows, two
  Decisions lines. Every new line carries "planned in `board-detail-pane`".
- `wigley-ai-gui/DESIGN.md` — the Inbox and Board bullets each gain a "Planned in `board-detail-pane`" sentence.

## Mandatory Reads

- `wigley-ai-gui/AGENTS.md` sections Intent, Architecture, README changelog and boundary, Running and testing.
  The file is about 168k: read those sections by line range (`grep -n "^## " wigley-ai-gui/AGENTS.md`).
- `wigley-ai-gui/DESIGN.md` — the standard for every view, part and key (UI tasks only).
- `wigley-ai-gui/docs/keymap.md` — the rule for which key an action takes (keys task).
- `wigley-ai-gui/docs/features/work-inbox/design.md` — the feature's design, § Detail pane in full.
- `wigley-ai-gui/docs/features/layouts/design.md` — layout contracts and default layouts (UI tasks only).
- The skills `wigley:writing-code`, `wigley:codebase-design` and `wigley:writing-tests`.

## Design Overview

```
sweep worker ──record_work_tickets {…, detail?}──┐
             ──record_work_items   {…, thread?}──┤
                                                 ▼
                         work store: work.json { items, cards, details, … }
                           │                         │
              work.state slot (lists)      work.details keyed slot (one entry per ticket key / thread id)
                           │                         │
              Board columns ─ Inbox cards      Board pane ─ Inbox pane
                                                 │              │
                              Cmd+Enter in box: work.comment   work.send (existing)
                                                 │              │
                                      Comment job (one write)  Send / Nudge job
```

Settled decisions (interview rounds 1–3 and the design review):

- **Pane.** A right-hand pane beside the cards in both views, made with `createSplit` (`sizedPane: 'end'`), hidden
  when closed. It shows the cursor card's detail and follows the cursor. Focus stays on the cards.
- **Keys.** `Enter` opens and closes the pane. `Ctrl+j`/`Ctrl+k` scroll the pane a line, `Ctrl+Shift+j`/`Ctrl+Shift+k`
  half a page (the app's convention, `docs/keymap.md`). `i` enters the pane's comment or reply box, `Cmd+Enter` sends,
  `Esc` leaves the box. `gx` opens the card in Jira or Slack.
- **Pane state.** Open or closed is kept in each view's place slot. The width is the split's own `uiState`
  (`stateKey`), as every split keeps it.
- **Data source.** The sweep stores detail every run and refetches only a ticket or thread whose stamp moved. No job
  fetches detail on open.
- **Jira detail.** Type, priority, status, assignee, reporter, last updated, description, the `work.detailComments`
  most recent comments, subtasks and linked issues.
- **Thread detail.** The root message and the `work.threadReplies` most recent replies, each with author, time and
  text, under the worker's summary.
- **Text format.** Description, comments and messages are markdown. The worker converts Jira markup to markdown when
  it records. The pane draws them with `kit.markdown`.
- **Settings.** `work.detailComments` (default `10`) and `work.threadReplies` (default `5`), beside the other
  `work.*` settings.
- **Data shape.** A separate detail record per ticket and per thread, in its own `details` section of `work.json`,
  published as the keyed slot `work.details`. `work.state` does not carry detail.
- **Freshness.** `read_work_state` gives each card and item the stamp of its stored detail. The pane heads with the
  record's `fetchedAt`.
- **Board pane.** A Jira ticket's fields and text, then each open Inbox thread that names the ticket as its summary and
  latest line (`t` opens them in the Inbox), then a comment box. A local task's pane shows its source thread's detail
  and that thread's reply box, which sends through `work.send`.
- **Comment job.** A new one-write job kind modelled on Move. A second comment on the same ticket queues behind the
  first and never replaces it. The card shows `Posting…` while its comments are queued or running. On success, main
  appends the posted comment to the stored ticket detail so the pane shows it before the next sweep.
- **Inbox pane.** Every open thread has a reply box, filled with the worker's draft where one exists, sent through the
  existing Send job. The draft box moves from the cursor card into the pane. While the pane is open a card shows only
  title, channel, author, age and the latest line; while it is closed the card also shows its summary.
- **Old saved shapes.** `work.json` reads an absent `details` as `{}` and an absent `commenting` as `[]`, since a
  refused store file stops every save for the run. A view's saved place has no such fallback (`AGENTS.md` § Intent,
  one user): a field the place gains reads as its type's empty value only where the task says so.
- **Layouts.** Each view adds its own detail part to its own layout contract and `default` layout. The two views share
  no page code, as today.
- **Demo.** Both views' sample state carries detail records, and their demo steps open the pane.
- **Look sign-off.** The Board pane is the first real render of the new look. After task 03 lands, `wigley:make`
  captures the Board pane with a drive run on sample state and shows it to the user before task 04 starts.

Out of scope:

- Fetching detail on open, or a refresh key for one card.
- A Slack reply box on the Board pane for a linked thread (it sits in the Inbox pane, one `t` away).
- Attachments, labels, sprint, status history and comments past `work.detailComments`.
- Editing or deleting a posted comment.

## File Structure

Existing files modified (paths under `wigley-ai-gui/`):

- `src/plugins/work/contract.ts` — detail types, `work.details` slot key, `comment` job, `commenting` card field,
  `work.comment` command key and channel method.
- `src/plugins/work/manifest.ts` — two settings, the `work.comment` command.
- `src/plugins/work/main/{store.ts,work-tools.ts,job-text.ts,job-queue.ts,job-runner.ts,actions.ts,start.ts}` and
  `src/plugins/work/page/start.ts` — store section and validators, tool schemas, sweep and comment text, the job kind,
  the slot publish.
- `src/plugins/work/main/selftest-fixture.ts` — sample detail records for the self-test seed.
- `src/plugins/work-board/**` and `src/plugins/work-inbox/**` — views, state, layout contracts, default layouts,
  manifests, contracts (place slots), sample state, demo steps.
- `src/plugins/keymap.ts`, `docs/keymap.md`.
- `CHANGELOG.md`, `README.md` (tool table rows for the two record tools).

No new file outside the test files and each view's own new state module if its task chooses one.

Shared names (every task uses them exactly, in `src/plugins/work/contract.ts`: task 01 produces the detail types and
the slot key, task 02 the comment job, `commenting` on the Jira arm of `WorkCard` only, `WorkCommentArg`,
`workCommentCommand` (`{ id: 'work.comment' }`, the other keys' shape) and `WorkChannel.comment(arg): Promise<void>`):

```ts
export interface DetailMessage {
  readonly author: string;
  readonly at: string; // ISO time
  readonly text: string; // markdown
}

export interface LinkedIssue {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly relation: string | null; // "blocks", "is blocked by", … ; null for a subtask
  readonly url: string;
}

export interface TicketDetail {
  readonly kind: 'ticket';
  readonly id: string; // the Jira key, same as the card id
  readonly fetchedAt: string; // ISO, set by main when the record lands
  readonly stamp: string; // Jira's `updated` value; the sweep's skip key
  readonly type: string | null;
  readonly priority: string | null;
  readonly status: string;
  readonly assignee: string | null;
  readonly reporter: string | null;
  readonly updated: string; // ISO
  readonly description: string; // markdown; '' for none
  readonly comments: readonly DetailMessage[]; // oldest first, at most work.detailComments
  readonly subtasks: readonly LinkedIssue[];
  readonly links: readonly LinkedIssue[];
}

export interface ThreadDetail {
  readonly kind: 'thread';
  readonly id: string; // the WorkItem id (root permalink)
  readonly fetchedAt: string;
  readonly stamp: string; // the latest reply's Slack ts; the sweep's skip key
  readonly root: DetailMessage;
  readonly replies: readonly DetailMessage[]; // oldest first, at most work.threadReplies
  readonly replyCount: number; // every reply in the thread, shown or not
}

export type WorkDetail = TicketDetail | ThreadDetail;

export const workDetailsSlot: KeyedSlotKey<WorkDetail, 'main', 'work'> = {
  id: 'work.details',
  process: 'main',
  kind: 'keyed',
};

// WorkJob gains:   { kind: 'comment'; key: string; text: string }
// WorkCard (jira) gains: commenting: readonly string[]  — texts queued or posting, oldest first; [] when none
export interface WorkCommentArg { readonly cardId: string; readonly text: string }
export const workCommentCommand: CommandKey<WorkCommentArg, 'work.comment'>; // shape as the other work command keys
```

Boundary rules:

- `work-board` and `work-inbox` read `work.details` with `api.state.read(workDetailsSlot)` and act only through
  `work.*` commands. Neither imports the other.
- Only `work` main writes `work.details`. Detail records leave `work.state`.
- The worker writes detail only through `record_work_tickets` (`detail`) and `record_work_items` (`thread`).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 01 → 02 → 03 → 04 → 05 → 06

### Wave 1
- [x] [Detail records, slot and sweep](01-detail-data.md)

### Wave 2
- [x] [Comment job](02-comment-job.md) — after 01

### Wave 3
- [x] [Board detail pane](03-board-pane.md) — after 01, 02

### Wave 4
- [x] [Inbox detail pane](04-inbox-pane.md) — after 01, 03 (look sign-off)

### Wave 5
- [x] [Pane keys](05-pane-keys.md) — after 03, 04

### Wave 6
- [x] [Doc re-read, changelog and README](06-doc-re-read.md) — after 05
- [ ] [Final verification](07-final-verification.md)

## Run log

Review base: 0eab07e6

### Groups
- 01 · deep · 648283a9 · diff read: every Produces present; tsc --noEmit clean; oxfmt applied · concerns: README coverage test fails until 06 adds the two settings; AGENTS.md work entry and design.md line 32 name only work.state (06 fixes); ticketDetail/threadDetail builders added to contract.test-support.ts outside Files
- 02 · deep · eda7d05b · diff read: every Produces signature present (comment job, commenting, WorkCommentArg, workCommentCommand, WorkChannel.comment, actions.comment, jobEnded caps); wave typecheck clean after one test-file compile fix on the same rung · concerns: commentMessage kept private like sibling builders; clearStaleMarks rewritten to build lists first and return the same object when unchanged; Jira card saved without commenting parses as []
- 03 · hard · 83922156 · diff read: every Produces signature present; typecheck clean; work-board tests 115/115 and keymap-checks pass (worker run plus lead); drive capture board-detail-pane.png shows columns left and ABC-12 pane right with fields, description, comments, subtasks, links, thread, comment box and Posting block · concerns: LIVE: .work-board-detail grows to content and its parent .ui-split-end scrolls, so the pane scroll commands and the scrollTop reset on a cursor move hit a non-scrolling element (tests faked scroll sizes on .work-board-detail) -- determined fix for review; send sends untrimmed text as the Inbox does; selectCard keep-box branch unreachable by a real click
- 04 · hard · 3e97b718 · diff read: every Produces signature present; typecheck clean; work-inbox tests 95/95; demo selftest passes; drive captures (inbox-*.png) show slim cards and the pane, and eval proves .work-inbox-detail scrolls while .ui-split-end does not, with scrollTop reset on a cursor move · concerns: card-click pane-button row passes trivially (fake DOM events don't bubble); togglePane-from-box test proves no held editor by the destroy, not a blur; sendItem label still 'send this card's draft'; empty-box placeholder sits under the editor as before
- 05 · standard · 79d48a57 · Diff read: Board <CR>→togglePane, gx→openCard, C-j/k, C-S-j/k, i, box scope with D-Enter/Esc; Inbox <CR>→togglePane, gx→openSlack, four pane scrolls. typecheck clean; vitest shared+keymap+work 4500 passed; selftest --plugin work all PASS; grep prints only the two gx lines. · concerns: Inbox keys steps start with the pane already open (opened by the earlier i step), so the steps read Enter→pane closed, Enter→pane open, C-S-j, Enter→pane closed. Board box needs two Escapes to log 'board focused' (first leaves the box input, as in the Inbox); unverified whether leaveBox on the first Escape is swallowed.
- 06 · standard · e3c584d4 · Diff read of the six docs; grep board-detail-pane prints only plan-folder lines; npm run lint passes (changelog included); npm test passes on rerun (first run: 2 tests timed out at 5000ms, unidentified, treated as flake); readme coverage passes. · concerns: docs/keymap.md: the 'Inbox's and the Board's own keys' paragraph still runs to ~160 columns after the reflow ask. npm test first run had 2 timeouts in 1 file, not identified.
### Contract changes
### Rulings
- Plan runs in the new app repo JonathonWigley/wigley-ai-gui (worktree ~/Documents/.worktrees/wigley-ai-gui-board-detail-pane, branch board-detail-pane off main eb81b65a): the app moved out of ai after the plan was written; its 3 ai commits were ported with git am -p2. Every plan path's leading `wigley-ai-gui/` reads as the repo root; ai's precondition sha 72e8802b2 maps to eb81b65a (the split tip) — the tree is the same, preconditions re-checked — the user's move, not ours — lead
- Sweep text's Detail numbers come from detailCaps, matching what the reader keeps — one truth — a raw setting would disagree with the stored cap · group 01 · group 01
- A detail-less ticket whose status and priority are unchanged keeps its stored record by reference, so the slot's identity skip holds — avoids resending — none · group 01 · group 01
- 03: restore takes the whole WorkBoardPlace; a click-out returns DOM focus to the board pane only when focus has not gone elsewhere; the sample end forces focus board; the start test restores paneOpen but no draft (board-state rows cover drafts) · group 03
- 03 follow-on (837887fa, user's look sign-off): the Board scrolls the cursor card into view on every board-pane resize (pane open/close, divider drag, window resize), and its end cell is a one-cell grid so .work-board-detail scrolls; verified live (card fully left of the pane with the demo panel open; detail scrollHeight 919 > clientHeight 813, end cell does not scroll) · group 04
- 04: detailInput.draft follows the old card rule; showSample closes the pane and restores focus to what it was (the Board's forces board); detail padding space-2 space-4 per the doc (Board's space-3 space-4); detailEmpty uses kit.emptyState · group 04
- 05 self-test: Inbox steps reordered to start from an open pane; Board box leave presses Escape twice, matching the Inbox box. · group 05
- 06 docs vs code: reply box only on open Inbox threads (and on the Board for a local task whose thread is not open); Inbox card carries no Buttons or draft in any state, summary hides while the pane is open; Posting… shows on the Board card and in the pane; design.md documents the Fetched-age head and the No-detail-yet line. · group 06
### Review rounds
### Test gate
