# 08 — Card actions, clearing and spin-up

Status: not started
Type: Task
Rung: hard · every press as a pure change of the work file, the job each press queues, spin-up, and chat's `newSessionWithDraft` page export
Wave: 2 · Depends on: 03 (both edit `src/plugins/chat/contract.ts`), 04
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`.

Files:
- create `src/plugins/work/main/actions.ts` · test `src/plugins/work/main/actions.test.ts`
- create `src/plugins/work/main/spin-up.ts` · test `src/plugins/work/main/spin-up.test.ts`
- modify `src/plugins/work/contract.ts`: `WorkStartResult`, `WorkLinkArg`, and the channel's `startSession` and
  `linkSession` (Contract additions)
- modify `src/plugins/work/manifest.ts`: `dependsOn.page: ['chat']`
- modify `src/plugins/work/page/start.ts` · test `src/plugins/work/page/start.test.ts`: the `startSession` handler
- modify `src/plugins/chat/contract.ts`: `ChatPageExports.newSessionWithDraft`
- modify `src/plugins/chat/page/start-prompt.ts` · test `src/plugins/chat/page/start-prompt.test.ts`
- modify `src/plugins/chat/page/start.ts`: the export

Three parts:
- `actions.ts` holds every press as a pure change of the store's `WorkFile`, with the job the press queues.
- `spin-up.ts` builds the launch message and starts a session from a card or an item.
- Chat gains one page export, so the fallback opens the new-session prompt with the message waiting in the new
  session's box.

Task 09 wires `actions.ts` and spin-up's main side to the channel and the runner. The spec is `design.md` § Inbox,
§ Board and § Spin-up.

Consumes:
- `WorkItem`, `WorkCard`, `WorkSuggestion`, `WorkJob`, `WorkColumnSetting`, `WorkProjectSetting`, `WorkSendArg`,
  `WorkMoveArg`, `WorkStartArg`, `WorkChannel`, `OTHER_COLUMN`, `columnForStatus` in `src/plugins/work/contract.ts` ← 04
- `WorkFile`, `WorkNotYet` in `src/plugins/work/main/store.ts` ← 04
- `workManifest` and `workPagePart` (`src/plugins/work/manifest.ts`, `src/plugins/work/page/start.ts`) and the
  page part's `command_invokesChannel` test (`src/plugins/work/page/start.test.ts`) ← 04, which this task extends
- From the tree:
  - `ChatMainExports.launch`, `projects()`, `defaultProfile`, plus `ChatProject`, `LaunchRequest`,
    `ChatPageExports` and `chatPageKey` (`src/plugins/chat/contract.ts`)
  - the start prompt's `openForNewSession` path and `fillComposer` (`src/plugins/chat/page/start-prompt.ts`,
    `chat-commands.ts`)
  - notes' visible launch, the pattern spin-up follows (`src/plugins/notes/main/note-sender.ts`, `toSession`)
  - `PageServices.toast`, `ToastTone` (`src/contracts/plugin.ts`), `PluginLog`, `errorText`

Produces:

`src/plugins/work/main/actions.ts` (pure)
```ts
export interface ActionResult { file: WorkFile; job: WorkJob | null; log: string }
export interface Refusal { refused: string }
export interface JobEnd { ok: boolean; note: string | null }   // structurally 05's JobOutcome, so 09 passes it whole

export function dismiss(file: WorkFile, itemId: string): ActionResult | Refusal
export function restore(file: WorkFile, itemId: string): ActionResult | Refusal
export function snooze(file: WorkFile, itemId: string, now: number): ActionResult | Refusal
export function expireSnoozes(file: WorkFile, now: number): WorkFile        // the same object when none expired
export function nextSnoozeEnd(file: WorkFile): number | null                // epoch ms, for 09's timer
export function send(file: WorkFile, arg: WorkSendArg): ActionResult | Refusal
export function addToBoard(file: WorkFile, itemId: string, newId: string,
  columns: readonly WorkColumnSetting[]): ActionResult | Refusal
export function moveCard(file: WorkFile, arg: WorkMoveArg, columns: readonly WorkColumnSetting[],
  now: number): ActionResult | Refusal
export function acceptSuggestion(file: WorkFile, cardId: string, columns: readonly WorkColumnSetting[],
  now: number): ActionResult | Refusal
export function notYet(file: WorkFile, cardId: string): ActionResult | Refusal
export function deleteTask(file: WorkFile, cardId: string): ActionResult | Refusal
export function jobEnded(file: WorkFile, job: WorkJob, end: JobEnd, now: number): WorkFile   // the same object when nothing changes
export function isRefusal(result: ActionResult | Refusal): result is Refusal
export const SNOOZE_MS = 24 * 60 * 60 * 1000
export const LOCAL_START_COLUMN = 'Todo'
```

`src/plugins/work/main/spin-up.ts`
```ts
export type SpinUpResult =
  | { kind: 'launched'; rowId: string; toast: string; cardIds: string[] }
  | { kind: 'prompt'; message: string; cardIds: string[] };
export interface SpinUpDeps {
  chat: Pick<ChatMainExports, 'launch' | 'projects' | 'defaultProfile'>;
  projects(): readonly WorkProjectSetting[];   // work.projects, read at each start
  log: PluginLog;
}
export function spinUpMessage(target: WorkCard | WorkItem, items: readonly WorkItem[]): string
export function spinUpCardIds(target: WorkCard | WorkItem, cards: readonly WorkCard[]): string[]
export function startFromWork(deps: SpinUpDeps, file: WorkFile, arg: WorkStartArg): Promise<SpinUpResult | Refusal>
export function linkSession(file: WorkFile, arg: WorkLinkArg): WorkFile
export const SPIN_UP_THREADS = 5
```

Contract additions to `src/plugins/work/contract.ts` (04's file; this task owns them):
```ts
export type WorkStartResult =
  | { kind: 'launched'; toast: string }
  | { kind: 'prompt'; message: string; cardIds: string[] };
export interface WorkLinkArg { cardIds: string[]; sessionId: string }   // sessionId: the row id, as linkedSessionIds holds
// on WorkChannel.invoke:
//   startSession(arg: WorkStartArg): Promise<WorkStartResult>   — was Promise<void> in 04
//   linkSession(arg: WorkLinkArg): Promise<void>               — new; a channel method with no command
```

On `ChatPageExports` in `src/plugins/chat/contract.ts`:
```ts
newSessionWithDraft(text: string): Promise<string | null>;   // the new row's id; null when no session started
```

Decisions:
- **Refusals reach the page as rejections.** Each action returns a `Refusal` for a press it refuses, and leaves `file`
  untouched. 09's channel handler logs it and rejects with its text. 04's page handler returns that promise, so the
  view's run rejects and the view toasts the text (10, 11).
- **Every action** returns new arrays and objects and never mutates `file`. `log` is the line 09 logs (Pinned values).
  An unknown id refuses with `No item <id>` or `No card <id>`.
- **Jobs are 04's `WorkJob`.** A press that needs a write returns the job in `ActionResult.job`, and 09 enqueues it
  on 05's runner. No other action returns a job. A move job carries no statuses: 06's `jobMessage` reads the column's
  `jiraStatuses` from the settings.

**Inbox items (actions.ts)**
- **`dismiss`** sets `state: 'dismissed'` and `snoozedUntil: null`, from any state but `dismissed`.
- **`restore`** sets `state: 'open'` and `snoozedUntil: null`, from `cleared`, `dismissed` or `snoozed`.
- **`snooze`** sets `state: 'snoozed'` and `snoozedUntil` to the ISO time of `now + SNOOZE_MS`. Only an `open` item
  snoozes.
- **`expireSnoozes`** returns each snoozed item whose `snoozedUntil` is at or before `now` to `open`, with
  `snoozedUntil: null`. 09 runs it through `jobEnded` at each sweep's end, and on a timer armed for `nextSnoozeEnd`.
- **Clearing** of items the user replied to is 06's `mergeRecordedItems` (`clear`). This task has no clear action.
- **`send`**:
  - It is allowed on an `open` item whose `arg.text` is not empty after trimming. The text is kept as given.
  - It sets the item's `draft` and `sending` to `arg.text`, `state: 'cleared'` and `note: null`. The clear is
    optimistic, so the item leaves Needs you, and the Dock badge drops, at the press.
  - Its job is `{ kind: 'nudge', itemId, text }` for an item whose `section` is `waiting`, and
    `{ kind: 'send', itemId, text }` for any other. So `work.send` on a Waiting on others item queues a nudge, as
    10 assumes.

**Board cards (actions.ts)**
- **The card's column** is 04's rule: `columnForStatus(card.jiraStatus, columns)` for a Jira card, and its own
  `column` for a local task.
- **`addToBoard`**:
  - When one of the item's `ticketKeys` names a Jira card already on the board (keys compared upper-cased), it
    refuses with `Already on the board as <KEY>`.
  - When a local task already has the item as its `sourceItemId`, it refuses with `Already on the board`.
  - With no columns, it refuses with `The Board has no columns`.
  - Otherwise it appends `{ kind: 'local', id: newId, title: item.title, url: item.url, column, movingTo: null,
    note: null, linkedSessionIds: [], movedAt: null, sourceItemId: itemId }`.
  - Its `column` is the column named `LOCAL_START_COLUMN` (compared case-insensitively), else the first column.
  - `newId` is 04's local id form, `local-<uuid>`. 09 builds it from `services.randomUuid()`.
- **`moveCard`** takes `arg.cardId` and `arg.column`:
  - **A local task** takes `column` at once, with no job, and sets `movedAt` to the ISO time of `now`. A column not
    in `columns` refuses with `No column <column>`, and its own column with `Already in <column>`.
  - **A Jira card** sets `movingTo: column` and `note: null`, and returns `{ kind: 'move', key: card.key, column }`.
    The worker takes the first of the column's `jiraStatuses` that the ticket can reach (06's move message). It
    refuses, checked in this order:
    1. `Other has no Jira status` for `OTHER_COLUMN`
    2. `No column <column>` for any other name not in `columns`
    3. `Already moving to <movingTo>` while `movingTo` is set
    4. `Already in <column>` for the card's own column
- **`acceptSuggestion`** finds the card's entry in `file.suggestions`. With none, it refuses with
  `No suggestion for <cardId>`. A `done` entry refuses with `Already in <column>`. Otherwise it is `moveCard` to the
  entry's `column`, and it also drops the card's entries from `file.suggestions`, so the block leaves at once.
- **`notYet`** finds the entry the same way, with the same two refusals. It writes the `WorkNotYet`
  `{ cardId, signal, at }` from the entry, replacing any earlier mark of that card, and drops the card's entries from
  `file.suggestions`. 09 then re-runs 07's detection, which keeps it hidden.
- **`deleteTask`** removes a local task with its marks and its entries in `file.suggestions`. A Jira card refuses
  with `Only a local task can be deleted`.

**Job ends (actions.ts)**
- **`jobEnded`** is the store side of each job's end. 09 runs it from 05's `ended(job, outcome)`.
  - **A `send` or `nudge`** sets the item's `sending` to null. When `end.ok` is false, the item goes back to `open`
    with its `draft` kept and `note` set to `Send failed: <end.note>`, or `Send failed` when the note is null.
  - **A `move`** sets the card's `movingTo` to null. Its `note` is null when `end.ok` is true, else `end.note`, or
    `Move failed` when that is null. 06's ticket record has already written the new `jiraStatus` and `movedAt`.
  - **A `sweep`** is `expireSnoozes(file, now)`.
  - An item or card that is gone changes nothing.

**Spin-up (spin-up.ts)**
- **The target** is 04's `WorkStartArg`. `source: 'card'` targets the card whose `id` is `arg.id`, and
  `source: 'item'` the item. Any other source refuses with `No source <source>`.
- **The cards a session links to.** For a card, `spinUpCardIds` gives the card's own id. For an item, it gives the
  Jira cards whose key is in its `ticketKeys`, and the local tasks whose `sourceItemId` is the item.
- **The project key:**
  - A Jira card's is the part of its key before the `-`, upper-cased.
  - An item takes the project key of its first `ticketKeys` entry. An item with no ticket key has none.
  - A local task has none.
- **The launch.** The first `work.projects` entry whose `jiraProject`, trimmed and upper-cased, equals the project key
  names a chat project in its `project`. When `chat.projects()` lists that name, spin-up launches visibly, as notes'
  `toSession` does:
  - `chat.launch({ project: name, profile, message: { text: spinUpMessage(…), images: [] } })`
  - It passes no `owner`, no `unattended`, no `permissions` and no `ephemeral`.
  - `profile` is the project's `profile`, else `chat.defaultProfile(null)`. A null profile refuses with
    `Chat has no profiles`.
  - A launch that rejects refuses with its `errorText`, logged as `session not started: <errorText>`.
  - On success, the result is `{ kind: 'launched', rowId, toast: 'Session started in <project name>', cardIds }`,
    with `cardIds` from `spinUpCardIds`. 09 stores `linkSession({ cardIds, sessionId: rowId })` and returns
    `{ kind: 'launched', toast }` to the page.
- **The fallback.** With no project key, no mapping, or a mapped name chat does not list, spin-up returns
  `{ kind: 'prompt', message, cardIds }`. Nothing launches in main.
- **`linkSession`** appends `arg.sessionId` to each listed card's `linkedSessionIds`, once. An unknown card id is
  skipped. The link is what makes 07 count the session's branch and work as signals.
- **`spinUpMessage`** is harness-neutral text (Pinned values). Its threads are the items whose `ticketKeys` hold the
  card's key (upper-cased), in any state, newest `at` first, at most `SPIN_UP_THREADS`. A local task's thread is its
  source item, when that item still exists.

**The page (`page/start.ts`)**
- The `startSession` handler is the one handler that is not a bare invoke:
  1. It invokes the channel's `startSession` with `context.arg`. A rejection rejects the handler, so the view toasts
     main's refusal.
  2. A `launched` result toasts its `toast` with tone `success`.
  3. A `prompt` result calls chat's `newSessionWithDraft(message)`. When that resolves to a row id and `cardIds` is
     not empty, it invokes the channel's `linkSession({ cardIds, sessionId })`. A null result, meaning no session
     started, links nothing.
- Chat's page exports come through `chatPageKey`. This task adds `chat` to the manifest's `dependsOn.page`, which 04
  left `[]`.
- The `startSession` row of 04's `command_invokesChannel` table moves to its own test (Tests). The other eleven rows
  stay.

**Chat's new export (chat page)**
- `newSessionWithDraft(text)` opens the start prompt as `openForNewSession` does: it lists no resume sections and no
  saved sessions. Once the session it starts is revealed, it puts `text` in that session's box as `fillComposer`
  does. The text is not sent: the user reads it, edits it and sends it.
- The box fills once chat's view holds the new session's tab. A session started through the channel's `start` gets
  its tab once its `chat.session` key reaches the page, so the fill waits for that rather than calling
  `fillComposer` straight after `reveal`. That call would log `fillComposer for unknown session` and drop the text.
- It resolves to the row id once the fill is done. It resolves null when the user leaves the prompt at any step, when
  a start fails, or when the prompt opens again and drops this one ("Opening the prompt again drops the earlier one").
  It never rejects.
- Chat has no other path that opens the prompt with text ready, which is why it is an export. The `chat.newSession`
  command takes no argument, and command args cannot be optional (`checkCommandArg`). This is the one chat change in
  this task.

Pinned values:
- `SNOOZE_MS = 86400000`, `LOCAL_START_COLUMN = 'Todo'`, `SPIN_UP_THREADS = 5`
- `ActionResult.log` lines, which 09 logs under `[work]`:
  - `dismissed <itemId>`
  - `restored <itemId>`
  - `snoozed <itemId> for 1 day`
  - `send queued <itemId>`
  - `nudge queued <itemId>`
  - `added <itemId> to the board`. The new id is random, and 09's self-test matches the line exactly.
  - `moved <cardId> to <column>` (a local task)
  - `moving <key> to <column>` (Jira)
  - `not yet <cardId>`
  - `deleted <cardId>`
- Refusals, besides those quoted in Decisions:
  - `dismiss` of a dismissed item: `<itemId> is already dismissed`
  - `restore` of an open item: `<itemId> is already open`
  - `snooze` of an item that is not open: `Only an open item snoozes`
  - `send` of an item that is not open: `<itemId> is not open`; of blank text: `Nothing to send`
- The spin-up message for a Jira card, with each `<…>` filled in and a blank line before the thread list:

  ```
  Work on <KEY>: <title>
  <url>

  Slack threads about it:
  - <item.title>: <item.summary> (<item.url>)
  ```

  With no threads, the last two lines are left out. A null `url` leaves out its line.
- The spin-up message for a local task: `Work on: <title>`, then `<url>` when not null, then its source thread in the
  item form below.
- The spin-up message for an item with no ticket:

  ```
  Follow up on this Slack thread: <title>
  <url>

  <summary>
  Latest: <latest>
  ```

  An item with tickets uses the Jira card form for its first card, with the item itself listed first among the
  threads.

GIVEN `work.projects` `[{ "jiraProject": "ABC", "project": "gamma" }]` and chat project `gamma` WHEN Session is pressed on `ABC-12` THEN chat launches `{ project: 'gamma' }` visibly with no owner, the page toasts `Session started in gamma`, and `ABC-12`'s `linkedSessionIds` holds the new row id
GIVEN no mapping for `XYZ` WHEN Session is pressed on `XYZ-3` THEN the new-session prompt opens; once the user picks a project, the new session's box holds the message unsent, and the card links to the session
GIVEN a Jira card in Todo WHEN it moves to In QA THEN it shows `movingTo: 'In QA'` and the job is `{ kind: 'move', key, column: 'In QA' }`
GIVEN a `waiting` item WHEN `send` runs THEN the job is a `nudge` with the text, and the item is cleared with `sending` set
GIVEN a send job that failed with note `x` WHEN `jobEnded` runs THEN the item is open, its draft kept, its note `Send failed: x`, and `sending` null
GIVEN a snoozed item WHEN `expireSnoozes` runs 24 h after the snooze THEN it is open again

Tests:
- `actions.test.ts`, one table per action, each row a starting file, an argument and the expected file with its job,
  refusal and log line:
  - `dismiss` / `restore` / `snooze`: each state in, the state out, `snoozedUntil` exact to the ms; the refusal from a
    wrong state
  - `expireSnoozes`: one item before its end, one at it, one after; the same object back when none expired
  - `send`: a `needs_you` item gives a `send` job and a `waiting` item a `nudge` job; `sending` and `draft` set; blank
    text refuses; a cleared item refuses
  - `addToBoard`: a new local task in Todo; the first column when no Todo exists; an existing Jira card refused; a
    second add refused
  - `moveCard`: a local task moves at once and sets `movedAt`; a Jira card gives the move job; Other, an unknown
    column, already moving and the same column each refuse with their text
  - `acceptSuggestion`: forward, the entry dropped; the `done` refusal; none refused
  - `notYet`: the mark written from the entry and replacing an older one, the entry dropped; none refused
  - `deleteTask`: the task, its marks and entries removed; a Jira delete refused
  - `jobEnded`: send ok, send failed, nudge failed with a null note, move ok, move failed, sweep expiring a snooze, and
    a gone item giving the same object
  - `actions — never mutates its input`: deep-frozen files through every action
- `spin-up.test.ts`, over a fake chat:
  - `startFromWork — target table`:

    | target | result |
    |---|---|
    | mapped Jira card | `launched` with the launch request |
    | mapping matched with `jiraProject` ` abc ` | `launched` |
    | unmapped key | `prompt` |
    | mapped name chat does not list | `prompt` |
    | local task | `prompt` |
    | item with a ticket | the first key's project |
    | item with none | `prompt` |
    | source `wave` | refused `No source wave` |
    | no profile | refused `Chat has no profiles` |
    | launch rejects | refused with its error |

    The launch request is asserted exactly: project, profile, text, `images: []`, and no `owner`, `unattended` or
    `permissions` key.
  - `spinUpMessage`: the three forms verbatim; thread order and the five-thread cap
  - `spinUpCardIds`: a card itself; an item's Jira cards and local task
  - `linkSession`: appended once; a second link of the same id is a no-op
- `page/start.test.ts` › `startSession` table, over a fake channel and a fake chat page:
  - `launched` toasts its text with `success` and links nothing
  - `prompt` with a row id from `newSessionWithDraft` invokes `linkSession` with the card ids and the row id
  - `prompt` with null links nothing
  - a rejecting `startSession` rejects the handler
- `start-prompt.test.ts`, rows added to the prompt's existing cases:
  - `newSessionWithDraft — fills the new session's box once its tab exists`
  - `newSessionWithDraft — Esc at the first step resolves null`
  - `newSessionWithDraft — opening the prompt again resolves the earlier one null`
  - `newSessionWithDraft — a failed start resolves null`

Done when: `npm run typecheck` and `npm run lint` pass, the test gate runs the tests above, and runtime checks defer to
task 14 (Final verification), whose fixture run covers Start session from a card.
Commit: one commit for the group.

## Proof

