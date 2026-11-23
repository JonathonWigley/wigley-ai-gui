# 06 — Worker tools and job text

Status: not started
Type: Task
Rung: hard · adds the worker's tool contract and its merge rules into the store, which 09 wires and the worker's text names
Wave: 2 · Depends on: 04
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`.

Files:
- create `src/plugins/work/main/work-tools.ts` · test `src/plugins/work/main/work-tools.test.ts`
- create `src/plugins/work/main/job-text.ts` · test `src/plugins/work/main/job-text.test.ts`

Consumes:
- `WorkItem`, `WorkCard`, `WorkJob`, `WorkSection`, `WORK_SECTIONS`, `WorkColumnSetting`, `ticketKeysIn`, `columnForStatus` in `src/plugins/work/contract.ts` ← 04. The `columns` this task receives (`WorkToolsDeps.columns()`, `JobTextSettings.columns`) are already read through 04's `readColumns`; 09 wires that.
- `WorkStore` (`file`, `update`), `WorkFile` in `src/plugins/work/main/store.ts` ← 04
- From the tree: `ToolDefinition`, `ToolSession`, `AgentSession`, `textResult`, `errorResult` (`src/plugins/sessions/contract.ts`), `Clock`, `isJsonObject`, `isStringArray`

Produces:

`src/plugins/work/main/work-tools.ts`
```ts
export const READ_WORK_STATE_TOOL: ToolDefinition
export const RECORD_WORK_ITEMS_TOOL: ToolDefinition
export const RECORD_WORK_TICKETS_TOOL: ToolDefinition
export const REPORT_WORK_JOB_TOOL: ToolDefinition
export const WORK_TOOLS: ToolDefinition[]          // the four, in the order above
export interface WorkToolsDeps {
  jobOf(session: AgentSession): WorkJob | null;    // 05's JobRunner.jobOf
  report(session: AgentSession, result: { ok: boolean; note: string | null }): boolean;  // 05's JobRunner.report
  store: Pick<WorkStore, 'file' | 'update'>;
  columns(): readonly WorkColumnSetting[];         // work.columns, read at each call
  clock: Clock;
}
export function startWorkTools(deps: WorkToolsDeps): (session: AgentSession) => ToolSession
export function mergeRecordedItems(file: WorkFile, items: readonly RecordedItem[], clear: readonly string[], now: string): WorkFile
export function mergeRecordedTickets(file: WorkFile, tickets: readonly RecordedTicket[], replace: boolean, now: string): WorkFile
export interface RecordedItem { id: string; section: WorkSection; channel: string; author: string; at: string;
  title: string | null; summary: string; latest: string | null; participants: string[]; url: string;
  ticketKeys: string[]; linkReason: string | null; why: string | null; draft: string | null }
export interface RecordedTicket { key: string; title: string; url: string; status: string;
  priority: string | null; reachableStatuses: string[] | null }
```
Task 09 calls `sessions.contributeTools(WORK_TOOLS, startWorkTools(deps))`.

`src/plugins/work/main/job-text.ts`
```ts
export interface JobTextSettings {
  lookbackHours: number; channels: readonly string[]; broadcastChannels: readonly string[];
  keywords: readonly string[]; stallHours: number; jiraQuery: string; columns: readonly WorkColumnSetting[];
}
export const WORKER_INSTRUCTIONS: string
export function jobMessage(job: WorkJob, settings: JobTextSettings, file: Pick<WorkFile, 'items' | 'cards' | 'lastSweepAt'>): string | null
```
Task 09 hands these to 05's runner: `instructions: () => [WORKER_INSTRUCTIONS]` and `message: (job) => jobMessage(job, <settings>, store.file())`.

Decisions:
- **Four tools, the fewest design.md needs.**
  - Promises and waiting items are items with section `promised` or `waiting`, and the item tool's `clear` records clears, so neither needs its own tool.
  - A move's result is a ticket record plus a job report.
  - The worker reads only what the app holds, through `read_work_state`. Slack and Jira come through its own tools.
- **Tool names are the definitions' `name`, as `contributeTools` takes them.** The text interpolates each `*_TOOL.name` and writes no `mcp__` prefix or server name anywhere. The harness lists the tool under its server, and the shareable-app plan renames that server.
- **The session gate** follows `src/plugins/backlog/main/backlog-tools.ts`:
  - Every call first asks `deps.jobOf(session)`. When it answers null, the call returns `errorResult('<tool name> answers only the running work job\'s session.')` and reads and writes nothing.
  - `record_work_tickets` with `replace: true` in a job other than a sweep is refused with `Refused: replace true is only for a sweep job.`
  - An unknown name rejects with `no work tool "<name>"`, as backlog's does.
  - `end` does nothing.
- **Validation.** A call with any bad field is refused whole and writes nothing. The refusal names the first bad field: `Refused: <path> must be <what>.`
  - `<path>` is `items[2].section`-style.
  - `<what>` is one of: `a string`, `a list`, `a list of strings`, `a boolean`, `an ISO time`, `a Jira key like ABC-123`, or `one of needs_you, promised, waiting, my_threads, around, worth_knowing`.
  - An ISO time is a string `Date.parse` reads.
  - A Jira key is a string that `ticketKeysIn` gives back whole.
  - Snake-case input fields map to the camel-case fields of `RecordedItem` and `RecordedTicket`. An optional string field that is absent or `''` reads as null. An optional list (`participants`, `ticket_keys`, `reachable_statuses`) that is absent reads as `[]`, except `reachable_statuses`, which reads as null (the stored list is kept).
  - **Jira keys are normalised before they are checked.** Each `ticket_keys` element and each ticket's `key` is trimmed and upper-cased, then kept only when `ticketKeysIn` gives it back whole. Otherwise the call is refused `Refused: items[i].ticket_keys[j] must be a Jira key like ABC-123.` (or `tickets[i].key`). So `ws-12` and `"WS-12 "` store as `WS-12`, the form card ids and 07's matcher use, and `ws12` is refused.
- **Item merge** (`mergeRecordedItems`, pure; the tool applies it through one `store.update`):
  - **A new id** gets `state: 'open'`, `firstSeen: now`, and `snoozedUntil`, `note` and `sending` all null.
  - **An existing id** takes every recorded field. `firstSeen`, `note`, `sending` and `snoozedUntil` are kept. A null recorded `draft` keeps the stored draft.
  - **The state of an existing id**:
    - A `dismissed` or `cleared` item goes back to `open` when the recorded `at` is later than the stored `at`, since new messages arrived. Otherwise it keeps its state.
    - `at` is compared by `Date.parse`. A stored `at` that does not parse counts as earlier than any recorded one (the recorded `at` always parses: validation checks it).
    - `snoozed` and `open` items keep theirs. The snooze's end is 08's.
  - **The user's own reply does not reopen an item.** The app does not know the user's Slack name, so the worker judges this, and the sweep text tells it to (step 4): a conversation `read_work_state` shows `cleared` or `dismissed` is recorded in `items` only when someone other than the user has posted in it since the stored `at`. A conversation the user has replied or reacted to goes in `clear`, never in `items`. So the user's own Send (08 clears the item) does not bring its card back at the next sweep. A waiting item whose nudge the user sent stays cleared until the other side answers.
  - **Order in one call.** `items` apply first, then `clear`, so an id in both ends cleared.
  - **`title`** is the recorded title, else the summary's first 60 characters.
  - **`ticketKeys`** is the recorded keys, then `ticketKeysIn(summary + '\n' + latest)`, distinct, in that order.
  - **`clear`** sets each listed `open` or `snoozed` item to `cleared` and its `snoozedUntil` to null. An unknown id is counted and skipped.
  - **Items never recorded again** stay as they are. A sweep records only new or changed items.
- **Ticket merge** (`mergeRecordedTickets`, pure):
  - **Each recorded ticket** becomes or updates the card with `kind: 'jira'`, `id` and `key` both set to the key, and the recorded `title`, `url`, `priority` and `status` (as `jiraStatus`).
    - Its `reachableStatuses` is the recorded list, or the stored one when the record gives none.
    - `movingTo`, `note`, `linkedSessionIds` and `column` are kept. The column is derived at slot build (04).
    - A new card gets `movingTo: null`, `note: null`, `linkedSessionIds: []`, `movedAt: null`, `column: ''`.
  - **A changed `jiraStatus`** on an existing card sets `movedAt: now`.
  - **`replace: true`** also drops every Jira card the record leaves out, since the ticket left the query. Local tasks are never touched.
  - **`replace: true` with an empty `tickets` list is refused** `Refused: tickets must not be empty with replace true; call report_work_job with ok false if Jira could not be read.` (the tool name interpolated from `REPORT_WORK_JOB_TOOL.name`). A worker that reads a Jira error as "no tickets" would otherwise wipe every Jira card. The cost: a user whose query truly returns nothing keeps the last cards until a ticket returns; the sweep text tells the worker to skip the call then (step 2).
  - A dropped card loses its `linkedSessionIds`, `movedAt` and `note`. When the ticket returns to the query it comes back as a new card. Keeping a dropped card's links is out of scope.
  - **`replace: false`** updates only the cards given.
- **`report_work_job`** calls `deps.report(session, { ok, note })`. The last report before the row closes is the job's outcome (05). The report tool writes nothing to the store itself.
- **`read_work_state`** answers `textResult(JSON.stringify(view, null, 1))`. The `view` holds:
  - `job`: the running job, as `{ kind, itemId?, key?, column? }`
  - `lastSweepAt`
  - `columns`: `[{ name, jiraStatuses }]`
  - `items`: `[{ id, section, state, title, at }]`: every `open` and `snoozed` item, and the `cleared` and `dismissed` items whose `at` is within `READ_CLOSED_ITEMS_MS` (7 days, `7 * 86_400_000`) of `deps.clock.now()`. An older closed item cannot be touched by a sweep's Slack read unless new messages arrive, and recording it then is right. This bounds each sweep's first tool result however long the store keeps items.
  - `cards`: `[{ kind, id, title, jiraStatus?, column }]`, with a Jira card's column from `columnForStatus`

  It carries no summaries, which keeps the result small. The worker reads Slack for those.
- **Job text** is pure and harness-neutral:
  - It says "your Slack tools" and "your Jira tools", and it never names a harness, a connector or a harness's own tool (no `ToolSearch`).
  - A sweep is read only.
  - A send, nudge or move carries exactly one write, then a record and a report.
  - A move takes the first status in the target column's `jiraStatuses` that the ticket can reach.
- **`jobMessage` returns null** when a send or nudge names an item the file lacks, a move names a key with no `kind: 'jira'` card in `file.cards` (a replace sweep dropped it), or a move names a column `settings.columns` lacks (`Other` included), so the runner fails the job with "gone" (05). The worker never transitions a ticket the Board no longer shows.
- **Store growth.** Cleared and dismissed items stay in `work.json` (design.md: cleared items stay under All), so the file and the slot grow with every conversation ever recorded. This task bounds only what the worker reads (`read_work_state` above), and prunes nothing from the store.

Pinned values:
- Tool names: `read_work_state`, `record_work_items`, `record_work_tickets`, `report_work_job`.
- Descriptions:
  - `read_work_state`: `Read what the app's Inbox and Board hold now: the running job, the last sweep's time, the Board columns with their Jira statuses, every inbox item's id, section, state, title and time, and every card. Only the running work job's session may call it.`
  - `record_work_items`: `Add or update Slack conversations in the app's Inbox by id, and clear the ones the user has since replied or reacted to. An item the user dismissed comes back only when it has newer messages. Only the running work job's session may call it.`
  - `record_work_tickets`: `Record the user's Jira tickets on the app's Board, each with its status and the statuses its transitions reach now. replace true (a sweep only) makes the list the whole set of tickets; false updates only the tickets given. Only the running work job's session may call it.`
  - `report_work_job`: `End the job: whether it did what its message asked, and a one-line note on what it did or what stopped it. Call it once, last. Only the running work job's session may call it.`
- Input schemas, each `type: 'object'` with `additionalProperties: false`:
  - `read_work_state`: no properties.
  - `record_work_items`:
    - `items` (required): a list of objects
      - `id` (required): `The Slack permalink of the conversation's root message.`
      - `section` (required): enum of `WORK_SECTIONS`
      - `channel` (required): `"#channel", "DM" or "group DM".`
      - `author` (required): `The root message's author.`
      - `at` (required): `ISO time of the latest message.`
      - `title`: `A few words naming the conversation.`
      - `summary` (required)
      - `latest`: `The latest reply, as "Name: text".`
      - `participants`: list of strings
      - `url` (required): `The permalink to open: the latest reply where possible.`
      - `ticket_keys`: list of strings
      - `link_reason`: `Why a key the conversation does not name is linked.`
      - `why`: `For around and worth_knowing: one line on why it matters to the user.`
      - `draft`: `For needs_you a reply, for waiting a nudge, in the user's voice.`
    - `clear`: a list of strings, `Ids of items the user has since replied or reacted to in Slack.`
  - `record_work_tickets`:
    - `tickets` (required): a list of objects
      - `key` (required)
      - `title` (required)
      - `url` (required)
      - `status` (required): `The ticket's Jira status name now.`
      - `priority`
      - `reachable_statuses`: list of strings, `The status names its transitions reach now.`
    - `replace` (required): boolean
  - `report_work_job`: `ok` (required, boolean) and `note` (required, string).
- Replies:
  - `record_work_items`: `Recorded <n> items (<added> new); cleared <c>; <u> clear ids not found.`
  - `record_work_tickets`: `Recorded <n> tickets.`, followed by ` Dropped <d> tickets no longer in the query.` when `replace` dropped any
  - `report_work_job`: `Recorded.`
- Refusals are quoted in Decisions.
- `READ_CLOSED_ITEMS_MS` is `7 * 86_400_000`, a module constant in `work-tools.ts`.
- `WORKER_INSTRUCTIONS`, verbatim, `{read}` and the others standing for the interpolated `*_TOOL.name`:

  ```
  You are the Auri work worker: a background session the Auri app runs for the user, one job at a time. Each job arrives as one message from the app. You read the user's Slack through your Slack tools and the user's Jira through your Jira tools, and you record what you find only through the app's work tools: {read} shows what the app holds, {items} records Slack conversations, {tickets} records Jira tickets, and {report} ends the job. You edit no files, start no other sessions, and ask nothing: no one answers this session.

  If your Slack or Jira tools are not loaded yet, find and load them first. If one is missing or not signed in, call {report} with ok false and a note naming which, and stop.

  Writes: a SWEEP job is read only, so post, react, edit, transition and comment nothing in Slack or Jira. Every other job is the user's own press in the app and carries exactly one write: make that write exactly as its message says, and nothing else in Slack or Jira.

  End every job by calling {report} once, last.
  ```
- Sweep message (`<since>` is `the last <lookbackHours> hours` when `lastSweepAt` is null, else `<lastSweepAt> (read a little before it, to catch late replies)`; `<list>` is the names joined with `, `, or `none`; `<columns>` is each `<name> = <status> / <status>`, joined with `; `):

  ```
  SWEEP. Gather the user's Slack since <since>, and the user's Jira tickets. Read only.

  - Watched channels: <channels list>
  - Broadcast channels: <broadcastChannels list>
  - Keywords: <keywords list>
  - Waiting threshold: <stallHours> hours
  - Jira query: <jiraQuery>
  - Board columns: <columns>

  1. Call {read}.
  2. Jira: run the query with your Jira tools. For each ticket, read its status and the statuses its transitions reach now. Call {tickets} with every ticket and replace true. If the query fails, call {report} with ok false and a note on the error, and stop. If it returns no tickets, skip {tickets}.
  3. Slack: read the user's DMs and mentions, the threads the user posted in, the watched and broadcast channels, and search for the open ticket keys and the keywords. An item is one conversation, its id the permalink of its root message. Sort each into one section:
     - needs_you: a DM to the user, or a message that mentions the user or asks the user something directly, not yet answered. Draft a reply in the user's voice, unless it needs facts only the user has; then leave draft empty.
     - promised: something the user said they would do ("I'll send that tomorrow") and has not done yet.
     - waiting: a question the user asked, or a reply owed to the user, with no answer for more than <stallHours> hours. Draft a short nudge in the user's voice.
     - my_threads: a thread the user posted in that has new replies.
     - around: a post in a watched channel, or found by the search, tied to the user's tickets or keywords. Set why to one line on why it matters to the user. Leave out anything unrelated.
     - worth_knowing: an important post in a broadcast channel that matters to anyone on the team, such as a release freeze, a process change or an outage. Set why. Leave out chatter and routine notices.
     Give each item a two-sentence summary, the latest reply as "Name: text", the participants, and every Jira key it names or plainly concerns; set link_reason for a key it does not name.
  4. Call {items} with every new or changed item, and in clear the ids of items the user has since replied or reacted to. An item {read} shows cleared or dismissed goes in items only when someone other than the user has posted in it since its time; a conversation whose newer messages are only the user's own goes in clear, not items.
  5. Call {report} with ok true and a one-line note on what changed.
  ```
- Send and nudge message (`<Label>` is `SEND` and `a reply`, or `NUDGE` and `a nudge`; `<text>` is the job's text unchanged):

  ```
  <SEND|NUDGE>. The user pressed Send in the app on <a reply|a nudge> for "<item.title>" (<item.channel>).
  Post exactly the text below once, as the user, in the conversation <item.url>: as a reply in its thread for a channel message, or in the DM. Change nothing in it.

  <text>

  Make no other post, reaction or edit in Slack, and change nothing in Jira. Then call {report}: ok true once it is posted, or ok false with what stopped it.
  ```
- Move message (`<statuses>` is the column's `jiraStatuses` joined with `, `):

  ```
  MOVE. The user moved Jira ticket <key> to the <column> column in the app.
  Read the transitions <key> can take now, and take the first status in this list that one reaches: <statuses>.
  Make that one transition and nothing else: no comment and no other field. If none of those statuses is reachable, change nothing.
  Then call {tickets} with <key>'s status now and the statuses it can reach, replace false, and call {report}: ok true once it moved, or ok false with a note naming the statuses it can reach.
  ```

GIVEN a session that is not the running job's WHEN it calls any work tool THEN it gets the refusal and the store is unchanged
GIVEN a dismissed item WHEN a sweep records it with a later `at` THEN it is open again, its `firstSeen` kept; with the same `at` it stays dismissed
GIVEN a move job WHEN the worker calls `record_work_tickets` with `replace: true` THEN it is refused and no card changes
GIVEN a sweep WHEN the worker calls `record_work_tickets` with `replace: true` and no tickets THEN it is refused and no card changes
GIVEN one call naming an id in both `items` and `clear` WHEN it merges THEN the item ends cleared
GIVEN a ticket key `ws-12 ` WHEN an item records it THEN it is stored as `WS-12`
GIVEN a move whose Jira card is gone from the file WHEN `jobMessage` builds it THEN it returns null
GIVEN a sweep that records tickets A and B over stored Jira cards A and C and a local task WHEN replace is true THEN the cards are A, B and the local task
GIVEN the default settings WHEN `jobMessage` builds a move to `In QA` THEN the message lists `In QA, QA, In Review, Ready for QA` in that order
GIVEN any job WHEN its message or the standing instructions are built THEN neither holds `mcp__`, `ToolSearch`, `claude` or `Atlassian`

Tests:
- `work-tools.test.ts`:
  - `gate_otherSession_refusesEveryTool` — a table of the four tools, each refused with its own name in the text, the store fake showing no update.
  - `records_validation` table, each refused with its exact text: an item missing `id`; section `later`; `at` of `yesterday`; `participants` not a list of strings; `clear` given as a string; a ticket key `ws12`; an item `ticket_keys` element `WS 12`; `replace` given as a string; `replace: true` with `tickets: []`.
  - `records_normalised` table, each accepted: item `ticket_keys` `['ws-12', ' AB-3 ']` stores `['WS-12', 'AB-3']`; ticket `key` `ws-12` stores card `WS-12`; an item with no `participants` and no `ticket_keys` stores `[]` for both.
  - `mergeRecordedItems` table: a new item; an existing item updated with its draft kept on a null draft; dismissed with a later `at` going open; dismissed with the same `at` staying dismissed; cleared with a stored `at` that does not parse going open; snoozed with a later `at` staying snoozed; clear on open, on snoozed and on an unknown id; an id in both `items` (later `at`) and `clear` ending cleared; a title falling back to the summary's first 60 characters; keys from the summary merged and deduped.
  - `mergeRecordedTickets` table: a new card's defaults; a status change setting `movedAt`; an unchanged status keeping `movedAt`; reachable statuses kept on a null record; replace dropping a missing Jira card and keeping a local task; no-replace keeping the missing card.
  - `recordTickets_replaceOutsideSweep_refused`.
  - `report_passesResult` — the `deps.report` fake receives `{ ok: false, note: 'x' }` and the reply is `Recorded.`.
  - `readState_shape` — the JSON's keys and a Jira card's derived column.
  - `readState_closedItemsBounded` — an open item 30 days old, a cleared item 2 days old and a dismissed item 8 days old: the first two are listed, the third is not.
- `job-text.test.ts`:
  - `sweep_since` table: a null `lastSweepAt` with 48 hours gives `the last 48 hours`, and a set one gives its time with the late-replies clause.
  - `sweep_lists` — empty lists read `none`, and the columns line holds `Todo = To Do / Selected for Development / Open`.
  - `send_and_nudge` — the job's text appears verbatim between blank lines, and the label is `SEND` or `NUDGE`.
  - `move_statusesInOrder`.
  - `jobMessage_gone` table: a send for a missing item, a move for a key with no Jira card in the file, a move to `Other`, and a move to an unknown column each give null.
  - `sweep_guardsJiraAndOwnReplies` — the sweep message holds the step 2 failure and no-tickets lines and the step 4 own-reply line.
  - `text_isHarnessNeutral` — no `mcp__`, `ToolSearch`, `claude` or `Atlassian` (case-insensitive) in the instructions or in any job kind's message. The instructions hold both `your Slack tools` and `your Jira tools`, and the sweep message holds `your Jira tools`.
  - `text_namesToolsByDefinition` — the instructions hold all four `WORK_TOOLS[i].name`, each message holds `REPORT_WORK_JOB_TOOL.name`, and no text holds a `*_work_*` word that is no definition's name.

Done when: `npm run typecheck` and `npm run lint` pass, the test gate runs the tests above, and runtime checks defer to task 14 (Final verification).
Commit: one commit for the group.

## Proof

