# 01 — Detail records, slot and sweep

Status: not started
Type: Task
Rung: deep · adds a `work.json` section, a keyed slot and two tool schemas, and 02, 03 and 04 consume them
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/src/plugins/work/`.

Files:
- modify `contract.ts` — the detail types and `workDetailsSlot`
- modify `manifest.ts` — the two settings
- modify `main/store.ts` — `WorkFile.details`, its validator, `detailCaps`, `newestMessages`
- modify `main/work-tools.ts` — the `detail` and `thread` inputs, the merges, the stamps in `read_work_state`, the tool descriptions
- modify `main/job-text.ts` — the two settings in `JobTextSettings`, the sweep text
- modify `main/start.ts` — the slot publish, the caps for the tools, the seed count
- modify `main/selftest-fixture.ts` — four detail records
- test `main/store.test.ts` · `main/work-tools.test.ts` · `main/job-text.test.ts` · `main/start.test.ts`

Consumes: `KeyedSlotKey<V, P, Plugin>` and `KeyedSlotWriter<V>` in `src/contracts/state.ts` (the tree holds them).
`api.state.publish(key: KeyedSlotKey<…>)` returns a `KeyedSlotWriter<V>` (`src/contracts/plugin.ts`).

Produces:
- In `contract.ts`, verbatim from plan.md § File Structure: `interface DetailMessage`, `interface LinkedIssue`,
  `interface TicketDetail`, `interface ThreadDetail`, `type WorkDetail = TicketDetail | ThreadDetail`, and
  `export const workDetailsSlot: KeyedSlotKey<WorkDetail, 'main', 'work'> = { id: 'work.details', process: 'main', kind: 'keyed' }`.
  Import `KeyedSlotKey` beside `SlotKey` from `../../contracts/state`.
- In `main/store.ts`:
  - `WorkFile` gains `details: Record<string, WorkDetail>`. `EMPTY_WORK_FILE.details` is `{}`.
  - `export interface DetailCaps { readonly comments: number; readonly replies: number }`
  - `export const DEFAULT_DETAIL_CAPS: DetailCaps = { comments: 10, replies: 5 }`
  - `export function detailCaps(settings: { readonly detailComments: unknown; readonly threadReplies: unknown }): DetailCaps`
  - `export function newestMessages(messages: readonly DetailMessage[], cap: number): DetailMessage[]`
- In `main/work-tools.ts`:
  - `WorkToolsDeps` gains `caps(): DetailCaps`.
  - `export interface RecordedTicketDetail { type: string | null; assignee: string | null; reporter: string | null; updated: string; description: string; comments: DetailMessage[]; subtasks: LinkedIssue[]; links: LinkedIssue[] }`
  - `RecordedTicket` gains `detail: RecordedTicketDetail | null`.
  - `export interface RecordedThread { root: DetailMessage; replies: DetailMessage[]; replyCount: number; latestTs: string }`
  - `RecordedItem` gains `thread: RecordedThread | null`.
  - `mergeRecordedTickets` and `mergeRecordedItems` keep their signatures.
- In `main/job-text.ts`: `JobTextSettings` gains `detailComments: number` and `threadReplies: number`.

Pinned values:
- `manifest.ts` `settings`: `detailComments: 10`, `threadReplies: 5`, after `stallHours`.
- `settingInfo.detailComments`: label `Ticket comments`, description `How many of the newest Jira comments a ticket's detail keeps.`
- `settingInfo.threadReplies`: label `Thread replies`, description `How many of the newest Slack replies a thread's detail keeps under its root message.`
- Slot id `work.details`, process `main`, kind `keyed`. The key of each entry is the record's `id`.

Decisions:
- **Store section.** `work.json` holds `details` as a JSON object. Each key is a Jira key or a `WorkItem` id. Each
  value is a `WorkDetail` whose `id` equals its key. `parseWorkFile` refuses the whole file (`work.json is not a work
  file`) for a value that fails `isWorkDetail` or whose `id` differs from its key.
- **A file saved before this task has no `details`.** `parseWorkFile` reads an absent `details` as `{}`. This follows
  the `MaybeWithoutRowId` precedent in the same file. Reason: the user's live `work.json` has no `details`, and a
  refused file stops every save for the run.
- **`isWorkDetail`.** A ticket: `kind` `'ticket'`; strings `id`, `fetchedAt`, `stamp`, `status`, `updated`,
  `description`; nullable strings `type`, `priority`, `assignee`, `reporter`; `comments` a list of messages;
  `subtasks` and `links` lists of issues. A message has strings `author`, `at`, `text`. An issue has strings `key`,
  `title`, `status`, `url` and a nullable string `relation`. A thread: `kind` `'thread'`; strings `id`, `fetchedAt`,
  `stamp`; `root` a message; `replies` a list of messages; `replyCount` a number.
- **`work.state` carries no detail.** `buildWorkState` does not read `details`.
- **Slot publish.** `start.ts` publishes `workDetailsSlot` beside `workStateSlot`. The same `publish()` runs both. For
  the details, `publish()` sets each entry of `file.details` whose JSON differs from `writer.get(key)` (`isSameJson`),
  and deletes each key of `writer.all()` that `file.details` does not hold. So a store change sends only the entries
  that changed. The slot stays unset until the load ends, as `work.state` does.
- **`detailCaps`.** Each setting that is a finite number gives `Math.max(0, Math.floor(value))`. Any other value
  gives its `DEFAULT_DETAIL_CAPS` value. `start.ts` passes `caps: () => detailCaps(api.settings())` to the tools, so
  a changed setting applies at the next record.
- **`newestMessages`.** It sorts a copy by `Date.parse(at)` ascending. The sort is stable, so equal times keep their
  input order. It returns the last `cap` entries, oldest first. Cap `0` returns `[]`.
- **Tool input, `record_work_tickets`.** Each ticket object gains an optional `detail` object:
  `type`, `assignee`, `reporter` (optional strings), `updated` (required, ISO), `description` (required string, `""`
  for none), `comments` (required list of `{ author, at, text }`), `subtasks` (required list of
  `{ key, title, status, url }`), `links` (required list of `{ key, title, status, relation, url }`). Every new object
  schema has `additionalProperties: false` and lists its required fields.
- **Tool input, `record_work_items`.** Each item object gains an optional `thread` object: `root` (required
  `{ author, at, text }`), `replies` (required list of the same), `reply_count` (required integer, minimum 0),
  `latest_ts` (required string: the Slack ts of the thread's newest message, the root's when it has no reply).
- **Reading the input.** `readTicket` and `readItem` read the new objects with the existing helpers and refusal paths,
  for example `tickets[0].detail.comments[1].at must be an ISO time`. Absent or null reads as null. A value that is
  no object refuses with `must be an object`. A message `at` uses `isoTime`. An issue `key` uses `jiraKey`. A subtask's
  `relation` reads as null. A link's `relation` is a required string. `reply_count` that is not a whole number of 0 or
  more refuses with `must be a whole number`. The reader caps the lists: `comments` through
  `newestMessages(…, caps.comments)`, `replies` through `newestMessages(…, caps.replies)`. `replyCount` is the larger
  of `reply_count` and the number of replies given, read before the cap.
- **Ticket merge.** A ticket with a `detail` sets `details[key]` to a `TicketDetail`: `kind: 'ticket'`, `id: key`,
  `fetchedAt: now`, `stamp: detail.updated`, `status: ticket.status`, `priority: ticket.priority`, and the other
  fields from the detail. A ticket with no `detail` keeps the stored record and rewrites only its `status` and
  `priority` from the ticket. Reason: a Move records the new status with no detail, and the pane must not show the old
  status. With no stored record, nothing is added. A Jira card that `replace: true` drops also loses its
  `details` entry. `replace: false` never removes an entry. Local tasks have no entry of their own.
- **Item merge.** An item with a `thread` sets `details[id]` to a `ThreadDetail`: `kind: 'thread'`, `id`,
  `fetchedAt: now`, `stamp: thread.latestTs`, `root`, `replies`, `replyCount`. An item with no `thread` keeps the
  stored record. An item the 90-day prune removes also loses its `details` entry. `clear` does not touch `details`.
- **Stamps in `read_work_state`.** Each item entry gains `stamp`, and each Jira card entry gains `stamp`: the stored
  record's `stamp`, else `null`. A local card entry stays as it is: a local task has no detail of its own.
- **Tool descriptions.** The worker reads these, so pin them verbatim:
  - `read_work_state`: `Read what the app's Inbox and Board hold now: the running job, the last sweep's time, the Board columns with their Jira statuses, each inbox item's id, section, state, title, time and detail stamp (cleared and dismissed items only from the last 7 days), and every card, each Jira card with its detail stamp. A stamp is null when the app holds no detail. Only the running work job's session may call it.`
  - `record_work_tickets`: keep the current text, and put this sentence before `Only the running…`:
    `Give a ticket's detail only when Jira's updated time differs from its stamp in read_work_state; a ticket given without detail keeps its stored detail.`
  - `record_work_items`: keep the current text, and put this sentence before `Only the running…`:
    `Give an item's thread only when the Slack ts of its newest message differs from its stamp in read_work_state; an item given without thread keeps its stored thread.`
  - Write `read_work_state` in these sentences through `READ_WORK_STATE_TOOL.name`, as `job-text.ts` names tools.
- **Sweep text** (`sweepMessage`, `job-text.ts`). Add these lines verbatim. Keep every other line as it is.
  - After `- Board columns: …`: `- Detail: the newest ${detailComments} comments of a ticket, the newest ${threadReplies} replies of a thread`
  - In step 2, replace `For each ticket, read its status and the statuses its transitions reach now.` with
    `For each ticket, read its status, the statuses its transitions reach now, and its updated time. When the updated time differs from the ticket's stamp in ${READ}, or it has no stamp, also read its type, assignee, reporter, description, newest comments, subtasks and linked issues, and give them as its detail; else leave detail out.`
  - After step 3's line that starts `   Give each item a two-sentence summary`, add
    `   For each item you record, read the Slack ts of its newest message. When it differs from the item's stamp in ${READ}, or it has no stamp, read the root message and the newest replies, each with author, time and text, and give them as its thread with latest_ts and the thread's reply count; else leave thread out.`
  - After that line, add
    `   Write each description, comment and message text as markdown: convert Jira markup and Slack formatting to markdown, and keep every word.`
- **Self-test fixture.** `fixtureFile` gains four records: `TicketDetail`s for `WRK-1` (two comments, one subtask,
  one link with relation `blocks`) and `WRK-3` (a description, no comments), and `ThreadDetail`s for
  `FIXTURE_ITEM_IDS.needsYou` (two replies, `replyCount` 2) and `FIXTURE_ITEM_IDS.around` (one reply, `replyCount` 3).
  Times are `isoBefore(now, …)`. URLs use `https://jira.example/browse/<key>`. No record names a real place.
- **Seed check.** `seed()` in `start.ts` adds `details: 4` to `wanted`, counted as `Object.keys(file.details).length`.
  Its log line `fixture seeded: 7 items, 7 cards, 3 suggestions` stays as it is, so `SEEDED_LINE` in
  `selftest-script.ts` does not change.
- **README.** The `read_work_state`, `record_work_items` and `record_work_tickets` rows in `README.md` change. Task 06
  writes them. Do not edit `README.md`.

GIVEN a stored ticket detail with stamp `S` WHEN the sweep records the ticket with no `detail` THEN the record stays,
its `fetchedAt` stays, and its `status` and `priority` follow the recorded ticket.
GIVEN `work.detailComments` 2 WHEN a ticket records 3 comments out of time order THEN the stored comments are the 2
newest, oldest first.
GIVEN a `replace: true` record that leaves out `WS-2` WHEN it lands THEN `details` loses `WS-2` and the slot deletes
key `WS-2`.

Tests:
- `main/store.test.ts`
  - `roundTrip_savedFile_parsesEqual`: the saved file carries one ticket and one thread record.
  - The invalid-file table (`it.each(['{}', …])`) gains rows: a detail whose `id` differs from its key; a ticket
    detail whose comment has no `at`; a thread detail whose `replyCount` is a string. Each refuses.
  - New `parse_savedWithoutDetails_readsEmptyDetails`: a file with no `details` key parses with `details: {}`. Break:
    the store refuses the user's live file.
  - New `describe('newestMessages')` table: unsorted 3 with cap 2 → the 2 newest, oldest first; cap 0 → `[]`; cap 9
    → all, sorted; two equal times keep input order.
  - New `describe('detailCaps')` table: `{10, 5}` → `{10, 5}`; `{-3, 2.7}` → `{0, 2}`; `{'x', undefined}` → `{10, 5}`.
- `main/work-tools.test.ts`
  - `records_validation` gains rows: `detail.updated` not ISO; `detail.comments[0].at` not ISO; `detail` a string
    (`must be an object`); `thread.reply_count` `-1` (`must be a whole number`); `detail.links[0].key` not a key.
  - `mergeRecordedTickets` table gains rows: a ticket with a detail stores the `TicketDetail` (`fetchedAt` now,
    `stamp` = `updated`, status and priority from the ticket); a ticket with no detail keeps the stored record and
    rewrites status and priority; `replace: true` drops the dropped card's detail; `replace: false` keeps a ticket
    the record leaves out with its detail.
  - `mergeRecordedItems` table gains rows: an item with a thread stores the `ThreadDetail` (`stamp` = `latestTs`);
    an item with no thread keeps the stored record; a pruned item drops its detail.
  - New `recordTickets_detailCapped_keepsNewest` (`it.each`, two rows): through `tools.call` with caps
    `{ comments: 2, replies: 1 }`, 3 comments → the newest 2; 3 replies with `reply_count` 1 → the newest reply and
    `replyCount` 3. Break: the cap is dropped, or `replyCount` counts only the kept replies.
  - `readState_shape`: the expected entries carry `stamp` — a stored stamp on one item and one Jira card, `null` on
    the others, none on the local card.
- `main/job-text.test.ts`
  - `SETTINGS` gains `detailComments: 10, threadReplies: 5`.
  - `sweep_lists` also expects `- Detail: the newest 10 comments of a ticket, the newest 5 replies of a thread\n`.
  - New `sweep_detailOnlyWhenStampMoved`: the message contains `When the updated time differs from the ticket's stamp in read_work_state`,
    `When it differs from the item's stamp in read_work_state` and `convert Jira markup and Slack formatting to markdown`.
    Break: the sweep refetches every ticket or never converts markup.
- `main/start.test.ts`
  - New `start_detailsSlot — publishes each stored detail by id, and deletes one the store drops`: load a file with
    two records; the keyed slot holds both; an update that removes one deletes its key; an update that changes
    nothing else leaves the other entry the same object.
  - `fixture — seed gives 7 items, 7 cards, 3 suggestions and badge 1`: the seeded file holds 4 details, and the
    problems list stays empty.

Done when: `npm run typecheck` passes; the four test files above pass; `npm run selftest -- --plugin work` passes.
Commit: one commit for the group.

## Proof
