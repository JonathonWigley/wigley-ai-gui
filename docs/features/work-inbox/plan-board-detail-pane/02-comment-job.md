# 02 — Comment job

Status: done
Type: Task
Rung: deep · adds a stored `work.json` card field, a persisted queue job kind, a restart-time stale-mark rule and a job-end write to stored detail; it follows the Move job at each place a job kind is listed, and adds the comment contract that 03 consumes
Wave: 2 · Depends on: 01 (shares contract.ts, store.ts, work-tools.ts, job-text.ts, manifest.ts, main/start.ts)
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/src/plugins/` unless the path starts with `wigley-ai-gui/`.

Files:
- modify `work/contract.ts` — the `comment` job, `commenting`, `WorkCommentArg`, `workCommentCommand`, the channel method, `KIND_WORDS`
- modify `work/manifest.ts` — the `comment` command
- modify `work/main/store.ts` — `JOB_KINDS`, the `commenting` validator
- modify `work/main/job-queue.ts` — `isWorkJob`
- modify `work/main/job-runner.ts` — `rowTitle`
- modify `work/main/job-text.ts` — `commentMessage`, `jobMessage`
- modify `work/main/work-tools.ts` — `jobView`, `mergedCard`
- modify `work/main/actions.ts` — `comment`, `jobEnded`, `clearStaleMarks`
- modify `work/main/start.ts` — the `comment` handler, the caps passed to `jobEnded`
- modify `work/page/start.ts` — the `comment` command
- modify `work/main/selftest-fixture.ts` · `work/main/selftest-script.ts` · `work/contract.test-support.ts` · `work-board/page/sample-state.ts` · `work-board/page/board-view.test.ts` — `commenting: []` on each Jira card they build, and the self-test binds. Grep `kind: 'jira'` under `wigley-ai-gui/src` for any other literal Jira card builder and add it here too: typecheck must pass at this task's end
- test `work/main/actions.test.ts` · `work/main/job-queue.test.ts` · `work/main/job-text.test.ts` · `work/main/work-tools.test.ts` · `work/main/store.test.ts` · `work/main/start.test.ts` · `work/page/start.test.ts`

Consumes:
- `TicketDetail`, `DetailMessage` ← 01 (`work/contract.ts`)
- `WorkFile.details`, `DetailCaps`, `detailCaps(settings)`, `newestMessages(messages, cap)` ← 01 (`work/main/store.ts`)

Produces, in `work/contract.ts`:
- `WorkJobKind` gains `'comment'`.
- `WorkJob` gains `| { kind: 'comment'; key: string; text: string }`.
- The Jira arm of `WorkCard` gains `commenting: readonly string[]` — the texts of queued or running comments on the
  card, oldest first; `[]` when none. A local card has no such field.
- `export interface WorkCommentArg { readonly cardId: string; readonly text: string }`
- `export const workCommentCommand: CommandKey<WorkCommentArg, 'work.comment'> = { id: 'work.comment' };`
- `WorkChannel.invoke` gains `comment(arg: WorkCommentArg): Promise<void>;`, after `moveCard`.

Produces, in `work/main/actions.ts`:
- `export function comment(file: WorkFile, arg: WorkCommentArg): ActionResult | Refusal`
- `jobEnded` becomes `export function jobEnded(file: WorkFile, job: WorkJob, end: JobEnd, now: number, caps: DetailCaps): WorkFile`.

Pinned values:
- Manifest command `comment`, after `moveCard`: `label: 'post a comment on the Jira ticket'`, `group: 'work'`,
  `runsIn: 'page'`, `arg: { cardId: 'string', text: 'string' }`.
- `KIND_WORDS.comment` is `'Comment'`, so the status line reads `Comment queued`, `Comment running · …`.
- `rowTitle` for a comment: `` `Work comment ${job.key}` ``.
- Refusals, in this order: `` `No card ${arg.cardId}` `` · `Only a Jira ticket takes a comment` · `Nothing to post`.
- Press log line: `` `comment queued ${card.key}` ``.
- Failure note: `` `Comment failed: ${end.note}` ``, or `Comment failed` when `end.note` is null.
- Lost-job note: `` `Comment failed: ${LOST_JOB_NOTE}` ``.
- Posted comment author: `You`.
- `commentMessage(card, text)` returns these lines joined with `\n`:
  1. `` `COMMENT. The user wrote a comment in the app on Jira ticket ${card.key} ("${card.title}").` ``
  2. `` `Add exactly the text below once, as the user, as one new comment on ${card.key}. The text is markdown: where your Jira tool takes another format, convert the formatting only and keep every word.` ``
  3. `''`
  4. `text`
  5. `''`
  6. `` `Make no other comment, transition or field change in Jira, and change nothing in Slack. Then call ${REPORT}: ok true once it is posted, or ok false with what stopped it.` ``
- Self-test: `COMMENT_TEXT = 'Picked this up today.'`; binds `c` → `work.comment` `{ cardId: 'WRK-1', text: COMMENT_TEXT }`
  and `C` → `work.comment` `{ cardId: FIXTURE_TASK_ID, text: COMMENT_TEXT }`.

Decisions:
- **`comment` refusals.** It finds the card by `arg.cardId`. No card refuses. A local card refuses: a local task
  has no Jira ticket. Text that is empty after `trim()` refuses. The text goes to the job as given, untrimmed, as
  `send` does.
- **A card in Other takes a comment.** Move refuses only a move *to* Other, since Other has no Jira status. A card in
  Other is still a Jira ticket, so Jira takes a comment on it.
- **A moving card takes a comment.** `movingTo` does not block a comment. Each job carries its own one write, and the
  queue runs them one at a time.
- **On press.** `comment` returns the card with `commenting: [...card.commenting, arg.text]` and `note: null`, the
  job `{ kind: 'comment', key: card.key, text: arg.text }`, and the log line.
- **Queue.** A comment never replaces a queued job. `isSamePressTarget` stays false for every comment: two comments
  on one key both queue, in press order. A comment takes the place every non-sweep press takes today: ahead of the
  first queued sweep. `isWorkJob` accepts `comment` when `key` and `text` are strings.
- **`jobMessage`.** A comment whose key has no Jira card in the file returns null, so the runner fails it. Else it
  returns `commentMessage(card, job.text)`. The comment job calls no record tool: main updates the stored detail
  itself (next decision). `WORKER_INSTRUCTIONS` does not change: its one-write rule covers the comment.
- **`jobEnded` for a comment.** It finds the Jira card by `job.key`. With no card it returns the same object. Else
  it removes the first `commenting` entry equal to `job.text`; when no entry equals it, the list stays. In run order
  that entry is the head.
  - On success: `note: null`. When `file.details[job.key]` is a `TicketDetail`, it appends
    `{ author: 'You', at: new Date(now).toISOString(), text: job.text }` to its `comments` and applies
    `newestMessages(…, caps.comments)`. `fetchedAt` and `stamp` stay, so the next sweep sees Jira's new `updated`
    time and replaces the record with Jira's own copy. With no stored record, `details` stays as it is.
  - On failure: the failure note, and `details` stays as it is.
- **The `caps` parameter.** Only a comment reads it. `start.ts` passes `detailCaps(api.settings())` at both calls:
  in `onJobEnded` and in the `enqueue` catch. A comment that is not queued so fails with `Comment failed: Not queued: …`.
- **`clearStaleMarks`.** For each Jira card, each `commenting` entry needs its own pending comment job with the same
  key and text. Count the jobs, so two equal texts need two jobs. It drops each entry without a job and keeps the
  rest in order. A card that drops an entry gets the lost-job note. When a card has a stale move as well, the
  comment's note is set last and wins. When no card or item has a stale mark, it returns the same object.
- **`jobView`.** `case 'comment'` returns `{ kind: job.kind, key: job.key }`. The text stays out, as for a send.
- **`mergedCard`.** A new card gets `commenting: []`. A stored card keeps `stored.commenting`.
- **Stored cards from before this task.** `isWorkCard` accepts a Jira card with no `commenting`, and
  `parseWorkFile` reads it as `[]`. A present `commenting` must be a string list. Reason: the user's live `work.json`
  has no `commenting`, and a refused file stops every save for the run. This follows the `MaybeWithoutRowId`
  precedent in the same file.
- **`JOB_KINDS`** in `store.ts` gains `'comment'`, so a `job.running` or `job.last` of a comment parses.
- **Handlers.** `start.ts`: `channel.handle('comment', (arg) => press('comment', (file) => comment(file, arg)))`,
  after the `moveCard` handler. `page/start.ts`: `comment: ({ arg }) => channel.invoke('comment', arg)`.
- **Self-test.** In the `board` group of `selftest-script.ts`, after `press('y', 'moving WRK-3 to In QA')`, add
  `press('c', 'comment queued WRK-1')` and
  `press('C', 'refused comment: Only a Jira ticket takes a comment')`. Both run before `x` deletes the task. The
  self-test runner never starts, so `WRK-1`'s `commenting` stays set for the rest of the group. Update the group's
  `why` to name the comment.
- **Docs.** `AGENTS.md`'s `work` file list changes. Task 06 writes it. Do not edit it.

GIVEN `WRK-1` has `commenting: ['A']` and a stored ticket detail with 10 comments, cap 10, WHEN its comment job `A`
ends ok THEN `commenting` is `[]`, `note` is null, and the detail holds the 9 newest old comments, then
`{ author: 'You', at: <end time>, text: 'A' }`.
GIVEN a queued comment on `WS-1` WHEN the user presses a second comment on `WS-1` THEN the queue holds both, in
press order.
GIVEN `WS-1` has `commenting: ['A', 'B']` and only job `B` pending WHEN `clearStaleMarks` runs THEN `commenting` is
`['B']` and `note` is `Comment failed: Its job was lost in a restart.`

Tests:
- `work/main/actions.test.ts`
  - New `describe('comment')` table: ok on a Jira card (marks `commenting`, clears `note`, queues the job, logs);
    ok on a card in Other; ok on a moving card; refusal rows for no card, a local card, and text `'  \n'`.
  - `jobEnded` table gains rows: comment ok appends to the stored detail and trims to cap 2; comment ok with no
    stored detail leaves `details`; comment ok with `commenting: ['A', 'B']` and job `B` removes `B` only; comment
    failed with a note; comment failed with a null note. The same-object table gains a comment for a gone card.
    Pass a `DetailCaps` to every existing call.
  - `clearStaleMarks` table gains rows: a stale comment; one of two equal texts with one job; a pending comment for
    its key and text (same object); a card with both a stale move and a stale comment, whose `note` is the comment's
    lost-job note.
  - `never mutates its input` covers `comment`.
- `work/main/job-queue.test.ts`: the `nextJobQueue` table gains rows: a comment behind a queued comment on the same
  key keeps both; a comment does not replace a queued move on the same key; a comment goes ahead of a queued sweep.
  The `parseJobQueue` refusal table gains a comment job with no `text`.
- `work/main/job-text.test.ts`: new `comment_postsTextOnce` — the message starts with `COMMENT. `, names the key and
  title, and contains `` `\n\n${TEXT}\n\n` ``. `jobMessage_gone` gains row `a comment for a key with no Jira card`.
- `work/main/work-tools.test.ts`: new `readState_commentJob_leavesTextOut` — with a running comment job,
  `read_work_state`'s `job` is `{ kind: 'comment', key }`. `mergeRecordedTickets` gains row: a recorded ticket keeps
  the stored `commenting`.
- `work/main/store.test.ts`: the round-trip file holds a card with `commenting: ['A']` and a `job.last` of kind
  `comment`. New `parse_savedWithoutCommenting_readsEmpty`: a Jira card saved with no `commenting` parses with `[]`.
  The invalid-file table gains a Jira card whose `commenting` is a string.
- `work/main/start.test.ts`: the refusal table gains `{ method: 'comment', arg: { cardId: 'nope', text: 'Hi' }, refused: 'No card nope' }`.
  New row on the `enqueue` catch path, modelled on the existing not-queued test for a move or send: a comment whose
  enqueue throws leaves `commenting` without its text and sets `note` to `Comment failed: Not queued: <error>`.
- `work/page/start.test.ts`: the command table gains `comment` with arg `{ cardId: 'WS-1', text: 'Hi' }`.
- No new test for `rowTitle`, `KIND_WORDS` or the manifest entry: each is copy, and the exhaustive switches and the
  `Record<WorkJobKind, …>` fail the typecheck when a case is missing.

Done when: `npm run typecheck` passes; the seven test files above pass; `npm run selftest -- --plugin work` passes.
Commit: one commit for the group.

## Proof

Commit eda7d05b · proof: diff read: every Produces signature present (comment job, commenting, WorkCommentArg, workCommentCommand, WorkChannel.comment, actions.comment, jobEnded caps); wave typecheck clean after one test-file compile fix on the same rung · concerns: commentMessage kept private like sibling builders; clearStaleMarks rewritten to build lists first and return the same object when unchanged; Jira card saved without commenting parses as []
