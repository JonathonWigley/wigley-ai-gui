# 06 — Shared modules take a plugin log and dispose

Status: not started
Type: Batch
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Two parts, one commit. Part A moves every shared helper that a plugin's log reaches from `Log` (plus a `logSource`
or an `owner` it logs under) to one `log: PluginLog`. Part B gives the shared modules that hold listeners, timers,
editors or form sessions a way to be undone. Plugin tasks 08–10 cannot edit `src/shared`, so both parts land here.
Callers in plugins change only as far as they must to compile: a caller that ignores a new `Disposable` return stays
as it is, and tasks 08–10 wire the disposal.

Files:
- modify (shared, Part A): `src/shared/page/autosave.ts`, `src/shared/page/confirm-prompt.ts`,
  `src/shared/page/list-picker.ts`, `src/shared/page/editor-boxes.ts`, `src/shared/page/session-forms.ts`,
  `src/shared/page/markdown-mount.ts`, `src/shared/page/contributed-parts.ts`,
  `src/shared/page/layout-host/draw-part.ts`, `src/shared/page/layout-host/layout-parts.ts`,
  `src/shared/page/layout-host/base-kit.ts`, `src/shared/agent-forms/form-store.ts`,
  `src/shared/agent-forms/channel-presenter.ts`, `src/shared/agent-forms/agent-form-preview.ts`,
  `src/shared/agent-forms/chat-wake.ts`
- modify (shared, Part B): `src/shared/page/reducer-store.ts`, `src/shared/page/autosave.ts`,
  `src/shared/page/editor-boxes.ts`, `src/shared/agent-forms/form-service.ts`,
  `src/shared/agent-forms/channel-presenter.ts`, `src/shared/agent-forms/agent-form-preview.ts`
- modify (core caller): `src/renderer/shell/shell-chrome.ts`
- modify (plugin callers): the files in the caller table below, and each plugin-side declaration the typechecker
  names (rule in Approach)
- test: `src/shared/page/reducer-store.test.ts`, `src/plugins/forms/page/autosave.test.ts`,
  `src/shared/page/editor-boxes.test.ts`, `src/shared/agent-forms/form-service.test.ts`,
  `src/shared/agent-forms/channel-presenter.test.ts`, `src/shared/agent-forms/agent-form-preview.test.ts`, and the
  log fakes and assertions of `src/shared/agent-forms/chat-wake.test.ts`, `form-store.test.ts`,
  `src/shared/page/confirm-prompt.test.ts`, `list-picker.test.ts`, `markdown-mount.test.ts`,
  `src/shared/page/layout-host/draw-part.test.ts`, `layout-parts.test.ts`,
  `src/plugins/forms/main/round-type.test.ts`, `src/plugins/forms/page/forms-commands.test.ts`,
  `src/plugins/forms/page/forms-events.test.ts`, `src/plugins/forms/page/forms-view.test.ts`,
  `src/plugins/forms/page/round-view.test.ts`, `src/plugins/primer/page/primer-commands.test.ts`,
  `src/plugins/primer/page/primer-view.test.ts`, `src/plugins/sessions/page/layout/sessions-parts.test.ts`

Consumes:
- `PluginLog` in `src/contracts/log.ts` ← 04 (until task 11 an interface with the call signatures
  `(message: string): void` and a deprecated `(source: string, message: string): void`)
- `MainServices.log` and `PageServices.log` typed `PluginLog`, scoped to the plugin's id ← 04
- `MainChannel.handle` returns `Disposable` ← 04
- `AgentFormSessions.addCloseGuard` (in `src/contracts/agent-forms.ts`) returns `Disposable` ← 05. Do not change its
  shape: task 05 owns it.
- `Disposable` in `src/contracts/disposable.ts` (in the tree)

Produces:
- `ReducerStore.subscribe(listener: () => void): Disposable` in `src/shared/page/reducer-store.ts`
- `AutosaveDeps.subscribe(listener: () => void): Disposable` and
  `startAutosave<Draft, Body>(deps: AutosaveDeps<Draft, Body>): Disposable` in `src/shared/page/autosave.ts`
- `startRoundAutosave(deps: RoundAutosaveDeps): Disposable` in `src/plugins/forms/page/autosave.ts`
- `EditorBoxes<Box>.dispose(): void` in `src/shared/page/editor-boxes.ts`
- `createAgentFormService<Form, Body, Payload>(deps): AgentFormService<Payload> & Disposable` in
  `src/shared/agent-forms/form-service.ts`
- `AgentFormChannelPresenter<Form, Body>.dispose(): void` in `src/shared/agent-forms/channel-presenter.ts`
- `AgentFormPreview.dispose(): void` in `src/shared/agent-forms/agent-form-preview.ts`
- The Part A signatures in the table below

Decisions:
- Shared helpers take the plugin's `log` in place of `log` plus `logSource` (plan.md Decisions, round 2). This task
  applies the rule to every shared helper a plugin's log reaches, also those that take a bare `Log` and pick their
  own source (`owner`, or the literal `'markdown'`): after task 11 a `PluginLog` still compiles where a `Log` is
  expected, since a one-parameter function fits a two-parameter type, and each two-argument call then logs its
  source as the message (agent, from this task's design).
- Every `logSource` and `owner` a plugin passes today equals that plugin's id (measured: `forms`, `primer`, `chat`,
  `backlog`, `notes`, `docs`, `settings`, `sessions` and each `createLayoutParts` owner), so those log lines keep
  their source. The two `markdown-mount` lines move from `[markdown]` to the calling plugin's id. No self-test
  `expect`, `alsoExpect` or `until` line matches `[markdown]` (measured at plan time, re-verify with
  `grep -rn "markdown\]" src --include='*.ts'`), so no self-test line moves (plan.md Decisions: self-test expect
  lines move with any log source that changes).
- `src/shared/layouts/layout-registry.ts` (`LayoutRegistryDeps.log` and `logSource`) and
  `src/main/layouts/layout-service.ts` (`logSource: owner`) do not change. The core builds them with its own `Log`
  and the owner id it holds, no plugin log reaches them, and the registry's `layouts/<logSource>/default is ignored`
  line uses the owner as a folder name too. `src/shared/page/layout-host/show-layouts.ts` does not change for the
  same reason (the core's `PageLayouts.show` supplies its log).
- `src/shared/event-bus.ts` `pluginEvents(bus, pluginId, log: Log)` does not change: the APIs hand it the core
  `Log` (plan.md File Structure: the deps of `createMainApi` / `createPageApi` keep the core `Log`).
- `ContributedPartsPlace.owner` goes: its only use is the log source (agent, from this task's design).
- The shell passes `(message) => log('shell', message)` to `createLayoutParts`: the shell's layout lines keep the
  `shell` source (agent, from this task's design).
- The channel presenter keeps `source`: it still names the alert open count (`alerts.setOpenCount(source, n)`).

### Part A — log signatures

| Member | Now | After |
|---|---|---|
| `AutosaveDeps` (`src/shared/page/autosave.ts`) | `log: Log; logSource: string` | `log: PluginLog` |
| `ConfirmPromptDeps` (`confirm-prompt.ts`) | `log: Log; logSource: string` | `log: PluginLog` |
| `ListPickerDeps` (`list-picker.ts`) | `log: Log; logSource: string` | `log: PluginLog` |
| `createEditorBoxes(host, events, log, identity)` (`editor-boxes.ts`) | `log: Log`; `BoxIdentity.logSource: string` | `log: PluginLog`; `BoxIdentity` loses `logSource` |
| `BoxDropDeps` (`editor-boxes.ts`) | `log: Log; logSource: string` | `log: PluginLog` |
| `SessionFormWords` / `SessionFormCommandDeps` (`session-forms.ts`) | `SessionFormWords.logSource: string`; `log: Log` | `SessionFormWords` loses `logSource`; `log: PluginLog` |
| `createMarkdownMount(fences, log)` (`markdown-mount.ts`) | `log: Log`, logs under `'markdown'` | `log: PluginLog` |
| `placeContributedParts(parent, sessionId, parts, place, log, rollback)` (`contributed-parts.ts`) | `log: Log`, logs under `place.owner` | `log: PluginLog`; `ContributedPartsPlace` loses `owner` |
| `DrawPartOptions` (`layout-host/draw-part.ts`) | `log: Log; logSource: string` | `log: PluginLog` |
| `LayoutPartsDeps` (`layout-host/layout-parts.ts`) | `log: Log`, hands `drawPart` `logSource: deps.owner` | `log: PluginLog`, hands `drawPart` `log: deps.log`; `owner` stays for `data-layout-owner` |
| `BaseKitDeps.log`, `OwnerKitServices.log`, `NO_LOG` (`layout-host/base-kit.ts`) | `Log` | `PluginLog` |
| `createFolderFormStore(deps)` (`agent-forms/form-store.ts`), and its helpers `writeRecordOrLog`, `pruneOlderThan` | `log: Log; logSource: string` | `log: PluginLog` |
| `createAgentFormChannelPresenter(deps)` (`agent-forms/channel-presenter.ts`) | `log: Log`, logs under `source` | `log: PluginLog` |
| `AgentFormPreviewDeps` (`agent-forms/agent-form-preview.ts`) | `log: Log; logSource: string` | `log: PluginLog` |
| `createChatFormWake(chat, log, source)` (`agent-forms/chat-wake.ts`) | `log: (source, message) => void`, `source: string` | `createChatFormWake(chat: ChatFormWakeTarget, log: PluginLog): AgentFormWake` |

Each changed helper calls `log(message)` with today's message text, unchanged.

Callers (non-test, measured at plan time, re-verify with `grep -rn` on each member name):

| Shared member | Callers that change |
|---|---|
| `startAutosave` | `src/plugins/primer/page/start.ts`, `src/plugins/notes/page/popup.ts`, `src/plugins/forms/page/autosave.ts` |
| `createConfirmPrompt` | `src/plugins/forms/page/forms-view.ts`, `src/plugins/primer/page/primer-view.ts`, `src/plugins/backlog/page/backlog-view.ts` (2) |
| `createListPicker` | `src/plugins/settings/page/settings-view.ts`, `src/plugins/chat/page/picker.ts`, `src/plugins/backlog/page/backlog-view.ts`, `src/plugins/docs/page/docs-dialogs.ts`, `src/plugins/sessions/page/start.ts`, `src/plugins/notes/page/popup.ts` |
| `createEditorBoxes`, `BoxIdentity` | `src/plugins/forms/page/start.ts`, `src/plugins/forms/page/boxes.ts` (`FORMS_BOX_IDENTITY`), `src/plugins/primer/page/start.ts`, `src/plugins/primer/page/boxes.ts`, `src/plugins/backlog/page/followup-editor.ts` |
| `boxDropTake` | `src/plugins/forms/page/forms-view.ts`, `src/plugins/primer/page/primer-view.ts`, `src/plugins/backlog/page/followup-editor.ts` |
| `SessionFormWords` | `src/plugins/forms/page/forms-commands.ts` (`ROUND_WORDS`), `src/plugins/primer/page/primer-commands.ts` (`PRIMER_WORDS`) |
| `createMarkdownMount` | `src/plugins/forms/page/layout/card-kit.ts`, `src/plugins/forms/page/layout/layout-panes.ts`, `src/plugins/backlog/page/backlog-view.ts`, `src/plugins/docs/page/doc-view.ts` |
| `placeContributedParts`, `ContributedPartsPlace` | `src/plugins/chat/page/composer-kit.ts` (`COMPOSER_PARTS`, `STATUS_PARTS`), `src/plugins/sessions/page/layout/sessions-parts.ts` (`ROW_PARTS`, `BAR_PARTS`) |
| `drawPart` | `src/plugins/forms/page/layout/layout-cards.ts`, `src/plugins/forms/page/layout/layout-panes.ts` (2), `src/plugins/primer/page/primer-view.ts` (4), `src/plugins/chat/page/entry-list.ts` |
| `createLayoutParts` | 13 plugin files (`grep -rln "createLayoutParts<" src/plugins`): `src/plugins/{docs,gallery,keys,notes,sessions,usage,visual,workflow}/page/layout/*-parts.ts`, `src/plugins/settings/page/settings-view.ts`, `src/plugins/agent-strip/page/agent-strip.ts`, `src/plugins/agent-lines/page/working-lines.ts`, `src/plugins/backlog/page/backlog-view.ts`, `src/plugins/chat/page/chat-layouts.ts`; and `src/renderer/shell/shell-chrome.ts` |
| `createBaseKit`, `ownerBaseKitDeps` | 16 plugin files (`grep -rln "createBaseKit(\|ownerBaseKitDeps(" src/plugins`); `shell-chrome.ts` passes no log and does not change there |
| `createFolderFormStore`, `createAgentFormChannelPresenter`, `createChatFormWake` | `src/plugins/forms/main/start.ts`, `src/plugins/primer/main/start.ts` |
| `createAgentFormPreview` | `src/plugins/forms/main/preview/layout-preview.ts`, `src/plugins/primer/main/preview/primer-preview.ts` |

### Part B — disposal

GIVEN a reducer store with listeners A and B WHEN A's subscription is disposed and an action changes the state THEN
B runs and A does not.
GIVEN a dispatch running its listeners WHEN an earlier listener disposes a later one's subscription THEN the later
one does not run in that dispatch.
GIVEN a dispatch running its listeners WHEN a listener disposes its own subscription THEN every other listener still
runs once in that dispatch.
GIVEN one function subscribed twice WHEN the first subscription is disposed twice THEN the second subscription stays
and the function runs once per dispatch.
GIVEN a subscription disposed once WHEN it is disposed again THEN nothing happens.
GIVEN autosave with a save scheduled WHEN its `Disposable` is disposed THEN the timer is cleared, the store
subscription is disposed, and a later edit schedules no save.
GIVEN a save in flight WHEN autosave is disposed and the save then settles THEN neither `saveFinished` nor `log` runs.
GIVEN editor boxes with boxes mounted and one focused WHEN `dispose` runs THEN every mounted editor is destroyed,
`active()` is null, no box is mounted, and no `onChange` listener runs, during `dispose` or after.
GIVEN an agent form service with live sessions WHEN `dispose` runs THEN each session not yet ended ends as `end()`
ends it: its open form closes in the window, each waiting call answers, and no deadline timer stays.
GIVEN a session ended before `dispose` WHEN `dispose` runs THEN it is not ended again.
GIVEN a channel presenter WHEN `dispose` runs THEN it disposes its three channel handles (`openForms`, `draft`,
`finish`) and its close guard, each once; a second `dispose` does nothing.
GIVEN a preview that is shown WHEN `dispose` runs THEN it aborts the last ask, ends its form session and ends its
connection, as `end` does today; a preview never shown, or disposed already, does nothing.

Members after this part:
- `createReducerStore`'s `subscribe` returns a `Disposable` that removes that one subscription. Each subscription is
  an entry object `{ listener, active }`. Its `Disposable` sets `active = false` and nothing else, so a second dispose
  does nothing. `dispatch` skips an entry whose `active` is false, and after the last listener ran it removes the
  inactive entries from the array. It never removes an entry during the walk, so no listener is skipped. Subscribing
  one function twice still runs it twice per dispatch, and each `Disposable` removes only its own entry. A listener
  subscribed during a dispatch still runs in that dispatch, as today.
- `startAutosave` keeps the `Disposable` from `deps.subscribe` and returns a `Disposable` that clears every
  `pending` timer handle, empties `pending`, disposes the subscription, and makes a save that settles later return
  before `saveFinished` and `log`. `startRoundAutosave` returns that `Disposable`. Callers in `notes`, `primer` and
  `forms/page/start.ts` ignore it.
- `EditorBoxes.dispose()`: empties the `onChange` listeners first, then destroys every mounted editor, then clears
  `mounted`, `modes` and `activeKey`. `lastActivated` and `firstMounts` are cleared too.
- `createAgentFormService` keeps a `Set` of the `SessionContext`s it started; a session's `end()` removes its own.
  `dispose()` ends every session still in the set as `end()` does (`ended = true`, `closeOpenForm`). The contract
  `AgentFormService` in `src/contracts/agent-forms.ts` does not change. `withKnownLayouts` in forms main and the
  callers in forms and primer ignore `dispose`.
- `createAgentFormChannelPresenter` keeps the `Disposable` from each `channel.handle` call and from
  `sessions.addCloseGuard`. `dispose()` disposes them. `quiet` gets no `dispose`.
- `createAgentFormPreview`: `dispose()` runs, for an open preview, `preview.asking.abort()` then today's `end(preview)`.
  The abort makes `settle` ignore the answer.

Tests:
- `it.each` `'stops telling a listener whose subscription was disposed $when'` in
  `src/shared/page/reducer-store.test.ts`, rows `when: 'before the dispatch'` (A disposed, then `dispatch(1)`) and
  `when: 'by an earlier listener in the same dispatch'` (listener 1 disposes listener 2's subscription, then
  `dispatch(1)`) and `when: 'by itself in the same dispatch'` (listener 1 disposes its own subscription, then
  `dispatch(1)`; listener 2 runs once). Each asserts the disposed listener's call count and the other's: the disposed
  listener `toBe(0)` and the other `toBe(1)`, except in the `by itself` row, where listener 1 ran once (it disposed
  itself while it ran) and listener 2 `toBe(1)`. Each also asserts that a second `dispose()` does not throw.
- `it('disposes only its own subscription when one function is subscribed twice')` in the same file: subscribe one
  function twice, dispose the first handle twice, `dispatch(1)`; the function's call count is `1`, not `0`.
- `it('cancels every pending save and schedules none once disposed')` in `src/plugins/forms/page/autosave.test.ts`:
  after one edit `scheduled.size` is `1`; after `dispose()` it is `0`; after a second edit it stays `0`.
- `it('drops the result of a save still in flight when disposed')` in the same file: the save rejects with
  `disk full` after `dispose()`; `logs` equals `[]` and the round's `saveError` stays `null`.
- `it('destroys every mounted editor on dispose and tells no listener')` in `src/shared/page/editor-boxes.test.ts`:
  with `setup()` (three boxes) and `notes` focused, `dispose()` leaves `created.every((made) =>
  made.editor.isDestroyed)` `true`, `boxes.active()` `null`, `boxes.isMounted(notes)` `false`, and an `onChange`
  counter at `0`.
- `it('ends every live session once disposed, answering each waiting call with its draft')` in a new
  `describe('a disposed service')` in `src/shared/agent-forms/form-service.test.ts`: one service, three sessions
  (`app-1`, `app-2`, `app-3`) each open one form, and `app-3` calls `end()` before `dispose()`. After `dispose()`:
  `presenter.closed` equals `[app-3's form id, app-1's form id, app-2's form id]`, each once; the `app-1` and `app-2`
  open calls resolve with `outcome` `'draft'`;
  `vi.getTimerCount()` is `0`; a new `open` on `app-1` rejects with `The session ended before this`.
- `it('stops serving the page and guarding session rows once disposed')` in
  `src/shared/agent-forms/channel-presenter.test.ts`: the fake channel's `handle` returns a `Disposable` that deletes
  its handler and the fake `addCloseGuard` returns one that removes its guard. With a form shown on `s1`,
  `dispose()` leaves `Object.keys(handlers)` `[]` and `mayClose('s1')` `true`; a second `dispose()` leaves both the
  same. Each fake handle counts its `dispose` calls; after the two `dispose()` calls every one of the four handles
  (three channel handles and the close guard) counts exactly `1`.
- `it.each` `'dispose_$case'` in `src/shared/agent-forms/agent-form-preview.test.ts`, rows
  `WhileShown_AbortsTheAskAndEndsTheSession` (`asked()` then `dispose()`: `[formEnds, connectedEnds]` `[1, 1]`,
  `calls[0].signal.aborted` `true`), `NeverShown_EndsNothing` (`[0, 0]`) and `Twice_EndsOnce` (`[1, 1]`).
- Part A changes no behaviour a test owns except the source. Each existing assertion on a `[source, message]` pair
  or `[source] message` line asserts the message alone: `confirm-prompt.test.ts` `toHaveBeenCalledWith(DISMISSED)`;
  `draw-part.test.ts` `'layout fancy rail failed: boom'`; `layout-parts.test.ts` `'layout mine rail failed: boom'`;
  `markdown-mount.test.ts` `expect(logs).toEqual([line])`; `chat-wake.test.ts` `logged` holds one message containing
  `s1` and `process gone`; `agent-form-preview.test.ts` `/store write failed/`. Every `logSource: '…'` in a test goes.

Approach:
- A plugin-side declaration that carries the plugin's log into a changed helper (a `log: Log` member of a plugin's
  own `…Deps` interface, or a `Pick<…, 'log'>` of one) becomes `log: PluginLog`. Run `npm run typecheck` and change
  only the declarations it names. Leave that file's other two-argument `log('<id>', …)` calls as they are: they
  compile through the deprecated signature until task 11, and tasks 08–10 move them.
- A test fake that such a declaration reaches: when the code under test makes only one-argument calls through it, the
  fake takes `(message: string)`. When the code under test still makes two-argument calls through it
  (`forms-commands.test.ts`, `primer-commands.test.ts`, `primer-view.test.ts`, measured at plan time), the fake takes
  `(...parts: string[])` and records `parts.at(-1)`, so it records the message in both forms.
- `src/plugins/forms/page/forms-events.test.ts` builds a fake store whose `subscribe` returns `listeners.push(…)`:
  it returns `{ dispose: () => undefined }` after the push.
- Each changed helper's doc comment changes with its signature. A comment that names `logSource`, `source` as the log
  source, `owner` as the log source, or "the plugin its log lines name" is rewritten to the new `log` parameter. This
  covers `autosave.ts`, `editor-boxes.ts`, `form-store.ts`, `agent-form-preview.ts`, `contributed-parts.ts` and
  `channel-presenter.ts`. In `channel-presenter.ts` the comment "Registers its channel handlers and close guard once,
  so it lives as long as the app" becomes "until `dispose`", and the comment on `source` says it names only the alert
  open count.
- `shell-chrome.ts`: `mountShellChrome` hands `createLayoutParts` `log: (message) => log('shell', message)`.

Done when: compiles (`npm run typecheck`); the test gate runs the tests above and every test file in Files; `npm run
lint` passes
Commit: one commit for the group

## Proof

