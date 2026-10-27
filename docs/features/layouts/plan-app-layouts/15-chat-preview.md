# 15 — Chat layout preview on Space z l c

Status: not started
Type: Task
Wave: 4 · Depends on: 14, 10 (`src/plugins/keymap.ts`); 05 also edits `keymap.ts` in an earlier wave
Plan: [plan.md](plan.md)

`Space z l c` (`<Leader>zlc`) opens a sample chat session: a session row with a Chat tab holding every entry kind,
and a composer holding every control chip. The user iterates a chat layout on it in place. It runs no agent, sends
nothing, and raises no notification, attention mark or badge (layouts design § Previews).

Files:
- create `src/plugins/chat/main/preview/preview-session.ts` — the sample's session info, entries and controls
- create `src/plugins/chat/main/preview/chat-preview.ts` · test `src/plugins/chat/main/preview/chat-preview.test.ts`
- modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start.test.ts`
- modify `src/plugins/chat/contract.ts` — `ChatChannel.invoke.openPreview`
- modify `src/plugins/chat/manifest.ts` — command `openPreview`
- modify `src/plugins/chat/page/chat-commands.ts` · test `src/plugins/chat/page/chat-commands.test.ts`
- modify `src/plugins/keymap.ts` — the `<Leader>zlc` bind
- modify `src/plugins/chat/main/selftest-script.ts` — a `layout preview` group
- modify `docs/keymap.md` — the `zl` row gains `zlc`

Consumes:
- ← 04: `ChatLayout`'s `entries`, one builder per `EntryKind` in the form `(parent, input, kit)`, which draw the
  sample's entries. ← 14: `ChatLayout`'s `composer` and `composerBar` parts, which draw the composer and a chip per
  control (`ComposerControlInput`). The preview adds no layout code and names no layout type: it hands the existing
  page a session state, and the page draws it as any session.
- ← 05: the `<Leader>zl` group in `keymap.ts` `groups` named `layout previews`. ← 10: the `<Leader>zls` bind beside
  which this bind goes.
- Tree: `SessionsMainExports.open(info: SessionInfo, options?: OpenOptions): OwnedSession` and `activate(sessionId)`
  (`src/plugins/sessions/contract.ts`); `FAKE_HISTORY_IMAGES` (`src/shared/fake-agent-harness.ts`); the page's
  existing reaction to a rejected `send` in `chat-commands.ts` `send` (logs `send failed: <error>`, toasts
  `Message not sent: <error>`, puts the text and images back in the box).

Produces:
- `src/plugins/chat/main/preview/preview-session.ts`:
  `export const PREVIEW_HOST_ID = 'chat-layout-preview'`, `export const PREVIEW_PROJECT_DIR = 'Chat preview'`,
  `export const PREVIEW_PROFILE = 'preview'`, `export function previewEntries(): ChatEntry[]`,
  `export function previewControls(): SessionControl[]` (both return fresh objects on each call).
- `src/plugins/chat/main/preview/chat-preview.ts`:

  ```ts
  export interface ChatPreviewDeps {
    sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
    send: MainChannel<ChatChannel>['send'];
    log: Log;
  }
  export interface ChatPreview {
    open(): void;
    holds(sessionId: string): boolean;
    // The preview's state while it is open; [] while closed.
    states(): ChatSessionState[];
    send(): Promise<void>;                 // always rejects
    setControl(): void;                    // always throws
    notice(text: string, tone: 'info' | 'error'): void;
    closed(sessionId: string): void;
  }
  export function createChatPreview(deps: ChatPreviewDeps): ChatPreview;
  ```
- `ChatChannel.invoke.openPreview(): void` in `src/plugins/chat/contract.ts`.
- Manifest command `openPreview: { label: 'open the chat layout preview', group: 'debug', runsIn: 'page' }`.
- Bind in `keymap.ts`, § Debug and testing, after the other `<Leader>zl…` binds:
  `{ keys: '<Leader>zlc', scope: 'any', command: 'chat.openPreview', where: 'page' }`.
- Page handler `openPreview` in `chatCommandHandlers` (`chat-commands.ts`): invokes `openPreview`; a rejection logs
  `chat preview not opened: <error>` and toasts `Chat preview not opened: <error>` in the error tone.
- `docs/keymap.md`: the `zl` row's binds column gains `` `zlc` chat preview `` after the binds tasks 05 and 10 left
  there; its group name follows the `groups` entry task 05 set.

Decisions:
- **No agent, no harness.** The live app holds only the Claude adapter; the fake harness runs only in the self-test
  and drive runs, and a fake process would answer a send. So the preview is a held state in chat main with no
  process, outside `createChatSessions`. It reuses only the fake harness's `FAKE_HISTORY_IMAGES` for the user entry's
  two thumbnails.
- **First press:** `sessions.open({ sessionId: PREVIEW_HOST_ID, projectDir: PREVIEW_PROJECT_DIR, deadlineSeconds:
  null, harness: null }, { select: true })`, then `activate` the row, then send `sessionStarted` with the state below.
  Logs `chat preview opened`. **A later press while open:** `activate` the row again, change nothing, log
  `chat preview shown`. The row's name in the side bar and the Chat tab's name is `Chat preview`.
- **State:** `{ sessionId: <row id>, projectDir: PREVIEW_PROJECT_DIR, profile: PREVIEW_PROFILE, entries:
  previewEntries(), controls: previewControls(), activity: 'idle', commands: [], running: true }`. `running: true`
  enables the chips, so they draw in their live look and their pickers open; `activity: 'idle'` keeps the row's
  status empty and lets the row close with no end-session confirmation.
- **Not saved.** The preview never reaches `open-sessions.json` or the recent folders. A relaunch has no preview row.
- **Routing in `start.ts`:** the `sessions` handler returns `[...chat.sessions(), ...preview.states()]`, so a page
  reload draws the preview again. `send`, `setControl` and `notice` go to the preview when `preview.holds(sessionId)`,
  else to `chat`. `interrupt`, `answerPermission` and `loadHistory` for the preview id do nothing and log
  `<method> in the chat preview ignored`. The `sessions.closed` event calls `preview.closed(sessionId)` beside
  `chat.closed(sessionId)`.
- **Sends nothing:** `send` rejects with `the chat preview sends nothing`, so the page keeps the message in the box.
  `setControl` throws `the chat preview changes no control`. A `notice` (from an app slash command such as `/status`)
  adds a notice entry `preview-app-notice-<n>` and sends it as `entry`.
- **No alert:** `ChatPreviewDeps` holds no `alerts`, no `window` and no `mark`, so the compiler keeps the preview from
  raising a notification, a Dock bounce, a badge or an attention mark. The row's tab status stays empty.
- **Close:** `closed(sessionId)` for the preview row ends the owned session and drops the state; the next press opens
  a new row.
- **The sample**, in this order, each `raw` `[{ preview: '<kind>' }]`, ids `preview-1` … `preview-14`:
  1. `user`: `Draw this chat in your layout.`, images: copies of `FAKE_HISTORY_IMAGES`
  2. `thinking`: `Weighing how the entries should look.`, `streaming: false`
  3. `assistant`: ``The sample holds **every entry kind**.\n\n- a list item\n- `inline code`\n\n```ts\nconst layout = 'default';\n``` ``,
     `streaming: false`
  4. `tool`: `Read`, summary `src/app.ts`, input `{ file_path: 'src/app.ts' }`, result
     `{ text: 'export const app = 1;', isError: false }`
  5. `tool`: `Bash`, summary `false`, input `{ command: 'false' }`, result `{ text: 'exit code 1', isError: true }`
  6. `tool`: `Bash`, summary `npm test`, input `{ command: 'npm test' }`, result `null` (running)
  7. `permission`: `Edit`, input `{ file_path: 'src/app.ts' }`, answer `{ allowed: true, reason: null }`
  8. `permission`: `Bash`, input `{ command: 'rm -rf build' }`, answer
     `{ allowed: false, reason: 'Keep the build folder.' }`
  9. `permission`: `Write`, input `{ file_path: 'notes.md' }`, answer `null` (waiting)
  10. `result`: `end_turn`, `costUsd: 0.0123`, `durationMs: 4200`
  11. `notice`: `A notice in the info tone.`, `info`
  12. `notice`: `A notice in the error tone.`, `error`
  13. `raw`: no other field
  14. `assistant`: `Still writing…`, `streaming: true`
  Each tool entry's `toolUseId` is `preview-tool-<n>`, `<n>` the entry's number: `preview-tool-4`, `preview-tool-5`,
  `preview-tool-6`.
- **The controls**, which give every chip state the bar draws: `mode` `Mode` (`default` Manual, `auto` Auto, `plan`
  Plan; value `auto`); `effort` `Effort` (`low` Low, `medium` Medium, `high` High; value `null`, the unset state);
  `model` `Model` (`sonnet` Sonnet, `opus` Opus; value `opus`); `verbosity` `Verbosity` (`brief` Brief, `full` Full;
  value `brief`), the control no pick key reaches, so the `c` keys sit in its chip.

GIVEN no preview row WHEN the user presses `Space z l c` THEN a `Chat preview` row opens selected, its Chat tab shows
the 14 sample entries and the Mode, Effort, Model and Verbosity chips, and no process starts

GIVEN the preview open WHEN the user types `hi` and sends THEN the box still holds `hi`, the toast reads
`Message not sent: the chat preview sends nothing`, and no entry is added

GIVEN the preview open WHEN the window is not focused and nothing changes THEN no notification, badge or row mark
appears (nothing in the preview calls them)

GIVEN the preview open WHEN the page reloads THEN the preview's Chat tab draws again with the same entries

GIVEN the preview open WHEN the user closes its row THEN it closes with no confirmation, and the next `Space z l c`
opens a fresh row

Tests:
- `chat-preview.test.ts` `open_FirstPress_OpensSelectedRowWithEveryKindAndControl` — `sessions.open` called once with
  `PREVIEW_HOST_ID` and `{ select: true }`; the `sessionStarted` state's entry kinds, as a set, equal `user`,
  `assistant`, `thinking`, `tool`, `permission`, `result`, `notice`, `raw`; its control ids hold `mode`, `effort`,
  `model` and one id outside them; `running` true, `activity` `idle`. Catches a kind dropped from the sample.
- `chat-preview.test.ts` `open_SecondPress_ActivatesTheSameRow` — two presses: `open` once, `activate` twice, one
  `sessionStarted`. Catches a second row per press.
- `chat-preview.test.ts` `refusals_PreviewSession_SendNothing` — table: `send` rejects with an error whose text holds
  `sends nothing`; `setControl` throws holding `changes no control`; no `entry` message is sent for either. Catches a
  send that resolves (the page would clear the box) and a send that reaches a harness.
- `chat-preview.test.ts` `closed_PreviewRow_EndsItAndAllowsANewOne` — after `closed(<row id>)`: the owned session's
  `end` ran, `states()` is `[]`, and the next `open` calls `sessions.open` again; `closed` for another id changes
  nothing.
- `chat-preview.test.ts` `notice_Preview_AddsANoticeEntry` — the `entry` message carries a `notice` entry with the
  text and tone given.
- `start.test.ts`, in `describe('chat main part')`: `sessions_PreviewOpen_ListsItAfterChatSessions` and
  `send_PreviewSession_RejectsAndSkipsChat` — prove the routing once.
- `chat-commands.test.ts` `openPreview_Rejects_ToastsError` — the toast text and tone. Catches a rejection swallowed in
  silence.
- Self-test group `layout preview` in `selftest-script.ts`, last in `GROUPS`, why `Space z l c opens the sample
  session with no agent, and a send there sends nothing.`:
  `{ keys: [' ', 'z', 'l', 'c'], expect: '[chat] Chat tab shown in Chat preview', screenshot: 'chat-preview' }`;
  `{ keys: sendKeys('hi'), expect: '[chat] send failed: the chat preview sends nothing' }`;
  `{ keys: ['Escape', ' ', ';'], expect: '[chat] session closed: Chat preview' }` (Esc leaves the box, then
  `<Leader>;` runs `sessions.closeSession`). The script's
  existing fake-harness call checks must still pass, which proves the preview started no process.

Done when: the code compiles and `npm run lint` passes; the test gate runs the tests above; `npm run selftest` passes
with the new group and no `[keys] unplaced` line. The preview's look under `default` and under a user layout is
checked live in task 17 (Final verification).

Commit: one commit for the group: the chat layout preview on `Space z l c`, its sample session and its key.

## Proof

