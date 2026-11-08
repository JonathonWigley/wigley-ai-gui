# 07 — Sessions queries, close seams and forms knowledge

Status: in progress
Type: Task
Wave: 4 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)

Files:
- modify, sessions: `src/plugins/sessions/contract.ts` · `page/start.ts` · `page/tabs.ts` · `page/session-tabs-view.ts` · `page/sessions-view.ts` · `page/sidebar-view.ts` · `page/preview.ts` · `main/session-list.ts` · `main/start.ts` · `main/relay/relay-server.ts` · `main/selftest-script.ts` · `layouts/layout.d.ts` · `layouts/default/layout.js` (each under `src/plugins/sessions/`)
- modify, shared: `src/contracts/agent-forms.ts` · `src/shared/agent-forms/channel-presenter.ts` · `src/shared/agent-forms/scripted-presenter.ts` · `src/shared/agent-forms/form-service.ts` · `src/shared/agent-forms/drive-actions.ts` · `src/shared/page/session-form-tabs.ts` · `src/shared/page/session-forms.ts` · `src/plugins/agent-form-fakes.test-support.ts`
- modify, forms and primer: `src/plugins/forms/page/forms-commands.ts` · `forms/page/start.ts` · `forms/page/forms-view.ts` · `forms/main/start.ts` · `forms/main/selftest-script.ts` · `forms/main/preview/layout-preview.ts` · `src/plugins/primer/page/primer-commands.ts` · `primer/page/start.ts` · `primer/page/primer-view.ts` · `primer/main/start.ts` · `primer/main/selftest-script.ts` · `primer/main/preview/primer-preview.ts` · `forms/layouts/layout.d.ts` and any layout `grep confirmClosesSession` finds · `src/plugins/chat/page/chat-view.ts`
- modify, callers of `deadlineSeconds: null` or `mark`: `src/plugins/chat/main/chat-sessions.ts` · `chat/main/fixtures.ts` · `chat/main/preview/chat-preview.ts` · `chat/main/selftest-script.ts` · `src/plugins/agents/main/preview.ts` · `src/plugins/docs/main/selftest-script.ts` · `src/plugins/notes/main/selftest-script.ts`
- test `src/plugins/sessions/page/tabs.test.ts` · `sessions/page/session-tabs-view.test.ts` · `sessions/page/start.test.ts` · `sessions/page/sessions-view.test.ts` · `sessions/page/preview.test.ts` · `sessions/main/session-list.test.ts` · `sessions/main/relay/relay-server.test.ts` · `src/shared/agent-forms/channel-presenter.test.ts` · `src/shared/page/session-form-tabs.test.ts` · `src/shared/page/session-forms.test.ts` · `src/plugins/forms/page/forms-commands.test.ts` · `primer/page/primer-commands.test.ts` · `forms/page/form-state.test.ts` · `primer/page/primer-state.test.ts` · `src/plugins/chat/page/chat-view.test.ts` · `src/plugins/chat/main/chat-sessions.test.ts` · `primer/main/preview/primer-preview.test.ts`

Consumes:
- `api.commands`, `api.state`, `api.events` as the landed tree holds them. No new core signature.
- `plan-commands-and-state` tasks 11 and 14 rewrote `sessions/page/start.ts` and `main/session-list.ts`, and this document measured both before that landing. Rows moved to `sessionsRowsSlot`. `activeChanged`, `stateChanged` and `selected` went. `sessions.active` became a slot. `publishFocused` and `checkVisible` run in a microtask. Before the first edit, re-measure `publishFocused`, `checkVisible`, `lastVisible`, `rowOf`, `mark` and `activateRow` in the landed files, and apply each decision below at the landed site.
- The `rows` and `sessions` slots of `plan-commands-and-state` task 11 stay as landed. This task adds no query. The row's new field below travels in them.
- `SessionPart`, `addRowPart`, `setActivity`, `RowActivity`, `NEEDS_YOU_ACTIVITY` (in the tree).

Produces, in `src/plugins/sessions/contract.ts` unless named:
- Close guard: `addCloseGuard(mayClose: (sessionId: string) => string | null, cancelHold?: (sessionId: string) => void): Disposable`. A string refuses, and it is the toast sessions shows. `cancelHold` ends the hold when the user's close key asks. `AgentFormSessions.addCloseGuard` in `src/contracts/agent-forms.ts` takes the same signature.
- Channel: `closeSession(sessionId: string, atOnce: boolean): string | null`: the first refusal's reason; null when the row closed, was already closed, or main knows no such session. The contract comment changes with it.
- `SessionTabView.closesAtOnce?(): boolean`, and `SessionTabView.beforeClose(atOnce: boolean): boolean`. `AgentFormListener.cancel(): void` in `src/contracts/agent-forms.ts`.
- Page event: `SessionsPageEvents.tabShown: { sessionId: string; tabId: string }`, emitted after the tab's `shown()`.
- `SessionTabView.hidden?(): void`. **Added beyond plan.md's text:** optional, as `Mode.sideBarHidden?` is, since no tab needs it yet.
- `SessionPart.tooltip?(sessionId: string): string | null`. **Added beyond plan.md,** to keep the status's look. See `setStatus` under Decisions.
- `export interface MarkOptions { text: string; action: string }`. `SessionsMainExports.mark(sessionId: string, options: MarkOptions): void`, and `AgentFormSessions.mark` the same. `SessionRow.markToast: MarkOptions | null`.
- `SessionInfo.host?: Readonly<Record<string, unknown>>` replaces `deadlineSeconds`. `SessionInfo.label?: string`.
- In `src/contracts/agent-forms.ts`: `AgentFormOwnerInfo.host?: Readonly<Record<string, unknown>>` replaces `deadlineSeconds`; `export const HOST_DEADLINE_FIELD = 'deadline_seconds'`; `AgentFormSessions.label(sessionId: string): string | null`.
- In `src/plugins/sessions/page/tabs.ts`: `takeOversAfterRelease(live: readonly TakeOver[], released: TakeOver): TakeOver[]`; `isMarkToast` replaces `isRoundToast` with the same parameters; `markToastText(mark: MarkOptions, keys: string | null): string` replaces `roundToastText`. `mayClose(views, atOnce: boolean)` passes `atOnce` to each `beforeClose`, and keeps stopping at the first refusal. `rowStatus` goes.
- In `src/shared/page/session-forms.ts`: `mayCloseSessionForm` replaces `guardSessionClose`, and `formClosesAtOnce` is new. `mayCloseRound` and `mayClosePrimer` replace `guardClose` in `forms-commands.ts` and `primer-commands.ts`.
- Removed: `SessionTabHandle.setStatus`, `FormTabHandle.setStatus`, `SessionTabsView.statusesOf`, `Tab.status`, `RowState.status`, `SessionRowInput.status`, `DRIVE_SESSION_DEFAULTS.deadlineSeconds`, `RelayHello.deadline_seconds`.

Decisions:

**Close seams, after the task (the user's answer: the close key on an open round is one instant act):**

```
 close key (sessions.closeSession command: <D-w>, Space ;, <Leader>;), on the focused session
   │ atOnce = any tab's closesAtOnce() is true
   │ each tab's beforeClose(atOnce), in tab order
   │   chat: busy session and not atOnce ─► its end-session confirm, false
   │   docs: unsaved edits ─► toast, false
   │   forms, primer: form sending ─► sending toast, false
   ▼ every tab true
 main closeSession(id, atOnce)
   │ atOnce: every guard's cancelHold(id) ─► the round ends cancelled
   │ every close guard ─► string: row stays, page logs and toasts the reason
   ▼ row closes ─► sessions.closed ─► chat ends the process

 exports.closeSession(id), from a plugin: the same path with atOnce false.
```

- **The hold is main's. The page asks only what it alone knows.** `createAgentFormChannelPresenter`'s guard refuses while its session holds an open form, with the reason `Finish or cancel <form.label>'s <noun> first`. That is today's page toast text. The presenter gains `noun: string`: `'round'` in forms, `'primer'` in primer, from today's `ROUND_WORDS.noun` and `PRIMER_WORDS.noun`.
- **Tab seams.** `closesAtOnce?(): boolean`: true means the user's close key ends what this tab holds with no prompt. `beforeClose(atOnce: boolean): boolean`.
- **`formClosesAtOnce(store, sessionId)`** in `session-forms.ts`: true when the session holds a form that is not sending. Forms' and primer's tabs expose it as `closesAtOnce`.
- **`mayCloseSessionForm`** in `session-forms.ts` replaces `guardSessionClose`, and `mayCloseRound` and `mayClosePrimer` replace `guardClose`. It has one branch: a form sending logs `session close kept: <label> is sending`, toasts `Sending <label>'s <noun>…`, returns false. Only the page knows a send is in flight. Any other case returns true, so main decides.
- Forms' and primer's `guardClose` wrappers and their `activate` and `showForm` deps go, when no other caller uses them.
- **Chat.** `mayClose(tab, deps, atOnce)` returns true when `atOnce` is true, before the busy check. A busy session with no open round asks as today. `closeConfirmed` stays for that path.
- **The cancel, in main.** `AgentFormListener` gains `cancel(): void`. `form-service.ts` implements it as `finish` does with `kind: 'cancelled'` and `open.latestBody`, which is always a `Body`, where `draft` may be null. It is a no-op when `open.end !== null || open.closed`. The presenter passes `cancelHold` to `addCloseGuard`: for each open form of the session it calls `entry.listener.cancel()`, then `close(formId)`. `scripted-presenter.ts` and every test double of the listener follow. A waiting `ask_round` call returns `cancelled`.
- **Quiet on the page.** `finishingFormId` stays null during `cancelHold`, so `formClosed` carries `byFinish: false`. The page drops the form with no toast, and its finish event reads `closed`. A `draft` the page sends after the close is ignored, as the presenter's `draft` handler does today. Log in main: `closing the session cancels <label>`.
- **`session-list.ts`.** `everyGuardAllows` becomes `firstRefusal(sessionId): string | null`. Guards hold `{ mayClose, cancelHold }`. `closeSession(sessionId, atOnce: boolean)` runs each `cancelHold` through `callEach` when `atOnce` is true. A throw is logged and the guard then decides. It reads `rowIndex` after the cancels, since a relay row's `release` may already have closed it, which counts as closed. `release` and `closeSession` keep their log lines. The page keeps `session close kept by main: <label>` and adds `api.services.toast(reason, 'info')`.
- **Channel.** `closeSession(sessionId: string, atOnce: boolean): string | null`. `SessionsMainExports.closeSession` takes the same `atOnce`, default false. `AgentFormSessions.addCloseGuard` passes `cancelHold` through. `consumer-view.ts` passes both through.
- **Removed:** the `askClose` action and reducer branch, `SessionFormsState.confirmClosesSession`, `FormSend.closesSession`, `CloseFormFromMainDeps.closeSession` and `closeFormFromMain`'s close, and the `closeSession` deps of `forms/page/start.ts` and `primer/page/start.ts` that only it used. The review's Cancel prompt (`askCancel`, `confirmCancel`) stays and leaves the session open.
- **Limits, and report them:**
  - A relay-connected session's process belongs to its host, not the app. The host hears `cancelled` and the row closes. Only a session the app owns has its process ended, through `sessions.closed`.
  - Docs' unsaved edits still refuse, and the round stays open, because `beforeClose` runs before main is asked.
  - A form already sending still refuses with the sending toast.
  - **One visible change:** a form in the background used to select its session as well as toast. The toast stays and the selection goes. The key always closes the focused session, so only another plugin's `closeSession` call reaches this path.

**Take-over release.** The session's frame holds `takeOvers: TakeOver[]`, its live take overs. This field is new in this task: today only the handle's local `latestTakeOver` exists, and it stays for `dispose`. `takeOver` adds the record. One tab holds one record, by `tabId`, since `session-forms.ts` reads one form per session: a take over by a tab that holds a record keeps the held record. `release` removes the record. Removing a tab removes its record, since the handle's `dispose` releases first. Task 08 saves this field, and drops a saved record whose tab never returns. `takeOversAfterRelease` removes `released`, and gives each live take over whose `previousTabId` equals `released.tabId` the `previousTabId` of `released`. `tabsAfterRelease` keeps its signature. The handle's `release` reads the current record from the frame, applies `tabsAfterRelease`, then stores `takeOversAfterRelease`. So: chat selected, form takes over, docs takes over, form releases, docs releases: chat shows. The contract comment on `takeOver` says this.

**`tabShown` and `hidden`.** `checkVisible` in `sessions/page/start.ts` does both. When `lastVisible` was a tab and `next` differs, it finds that tab by id with `view.tabs.tabsOf` and calls `hidden?.()` before anything else; a tab already gone gets no call. A mode hide counts. After `tab?.shown()`, it emits `tabShown`. `isShownAgain` emits `tabShown` again and calls no `hidden`, since the tab never left. No plugin consumes either yet; the follow-up asks for the seam.

**`setStatus` gives way to a row part.** Forms' and primer's status text is the only status (`Chat and docs set none`, re-verify with `grep -rn 'setStatus' src/plugins src/shared`).

- The `default` layout draws `status` only in the row's tooltip, so a row part that only draws has no surface with the same look. So the status stays a tooltip, through `SessionPart.tooltip` (the user's answer).
- A row part's `tooltip` is read at each row draw and on each `pointerenter` on the row, so a status change needs no row redraw. `entry.title` is `[title, label, activity word, ...each part's tooltip]`, each only when present, in part order. Two sources no longer overwrite each other.
- `createSessionFormTabs` keeps the last status per session and exposes `statusPart: SessionPart`, with id from a new dep `statusPartId` (`forms.status`, `primer.status`), an empty `build`, and `tooltip` returning the session's status or null. An empty wrapper takes no room. `forms-view.ts` and `primer-view.ts` add it through `addRowPart`; their `sessions` deps widen to include it.
- `SessionRowInput.status` goes from `layout.d.ts`, and its doc line and the tooltip line change. `default/layout.js`'s comment changes. `PREVIEW_STATUSES` in `sessions/page/preview.ts` goes.

**Sessions stops knowing forms.**

- `mark` stores `options` as `row.markToast` only while it is null. The first mark wins until `activateRow` clears it, so a chat turn finish after a form's mark leaves `Round from…`. `rowOf` starts it null. `MarkOptions` is plain, so it passes `JsonSafe` in the rows slot.
- `publishFocused` toasts when `isMarkToast(wasPublished, sessionId, isModeShown)` holds and `rows.get(sessionId)?.markToast` reads a value, from the landed `sessionsRowsSlot` reader. So a session opened with `select: true` while the mode hides no longer toasts `Round from…`. Report this.
- `markToastText`: `keys === null` gives `<text>`; else `<text> — <keys> to <action>`.
- Pinned text. Forms: `{ text: 'Round from <label>', action: 'answer' }`, so forms' toast reads exactly as today. `<label>` is `sessions.label(sessionId) ?? form.label`. Presenter dep `markText(label: string): string` and `markAction: string`.
- Primer and chat both toast `Round from…` today, which is untrue for them. The user's wording is final. Primer: `{ text: 'Primer from <label>', action: 'answer' }`, with `<label>` read as forms reads it. Chat, in `announceTurnFinished`, beside the `TURN_FINISHED_TITLE` alert: `{ text: 'Turn finished in <label>', action: 'read it' }`, with `<label>` as `sessions.label(sessionId) ?? path.basename(projectDir)`, the name that alert already shows.
- The text is frozen at `mark`. `mark` runs `lookUpHostName`, so a row's label can change later, and the toast then shows the earlier label. This is accepted, since the page would otherwise have to word another plugin's text.
- `NOTHING_OPEN_TEXT` becomes `Nothing open in this session yet`. `EMPTY_TEXT` names the relay, which sessions owns, and stays.
- Comments go generic: `SessionRow` (`marked` is attention a plugin asked for with `mark` and the user has not answered; a connected session's row exists while marked, activated or kept by a close guard), `NEEDS_YOU_ACTIVITY` (something waiting on the user), `layout.d.ts`'s `marked` line, `default/layout.js`'s line, `isMarkToast`, `SessionInfo`'s "What a form source knows" comment.
- **Opaque host record.** `sessionInfo(hello)` puts every hello field outside `protocol`, `session_id`, `project_dir`, `harness` and `config_dir` into `host`, or leaves `host` out when none. `RelayHello` gains an index signature and loses `deadline_seconds`; the wire stays, so `relay.py` in wigley-ai-marketplace needs no change. `mistypedHelloField` loses its row. `form-service.ts`'s `deadlineSeconds` reads `info.host?.[HOST_DEADLINE_FIELD]`, takes it only as a number, and keeps today's range check: a non-number now means the default, where the relay used to refuse the hello.
- Every `deadlineSeconds: null` line goes (`chat-sessions.ts`, `chat/main/fixtures.ts`, `chat-preview.ts`, `chat/main/selftest-script.ts`, `agents/main/preview.ts`, `docs/main/selftest-script.ts`, `notes/main/selftest-script.ts`, both previews). `deadlineSeconds: 120` becomes `host: { [HOST_DEADLINE_FIELD]: 120 }` (`forms/main/selftest-script.ts`, `primer/main/selftest-script.ts`). Sites measured at plan time, re-verify with `grep -rn 'deadlineSeconds' src`; forms' and primer's `deadlineSeconds` setting and `form-service.ts`'s own local field stay.
- Drive: `driveSessionInfo` in `sessions/main/start.ts` reads an object arg `host` in place of `deadlineSeconds`, and its schema string changes. `sessions/main/selftest-script.ts` follows. `drive-actions.ts`'s `connect` type and `sessionDefaults` lose the field.
- **Preview label.** `groupOf` returns `info.label` first. Both previews pass `projectDir: null, label: 'Layout preview'` and `label: 'Primer preview'`. Their title bars lose the detail line, which repeated the name. Report this.

GIVEN an open round in the focused session WHEN the close key runs THEN no confirm opens, the waiting call returns `cancelled`, and the row closes in the one main call.
GIVEN that session is busy in chat WHEN the close key runs THEN chat's confirm does not open and the session's process ends with the row.
GIVEN that session has unsaved docs edits WHEN the close key runs THEN docs toasts, and the round stays open.
GIVEN a form being sent WHEN the close key runs THEN the sending toast shows, and main is not asked.
GIVEN a busy chat session with no open form WHEN the close key runs THEN chat's end-session confirm opens, as today.
GIVEN the review's Cancel prompt WHEN the user confirms THEN the round ends cancelled and the session stays.
GIVEN a round open in a session that is not focused WHEN another plugin calls `closeSession` THEN main refuses, the row stays, and the toast reads `Finish or cancel <label>'s round first`.
GIVEN two tabs that refuse WHEN a close runs THEN the first in tab order answers, and later tabs are not asked.
GIVEN chat selected, then form and docs taking over WHEN form releases, then docs releases THEN chat shows.
GIVEN docs then form taking over WHEN form releases, then docs releases THEN chat shows, as today.
GIVEN a visible tab WHEN another tab shows or the mode hides THEN `hidden` runs on the old tab, before `shown` on the new one.
GIVEN a round open WHEN the pointer enters its row THEN the tooltip holds the status today's `<heading> <answered>/<total>` text gives.
GIVEN nothing selected and the mode hidden WHEN a round arrives THEN the toast reads `Round from <label> — <keys> to answer`, or `Round from <label>` with no keys bound.
GIVEN a relay hello with `deadline_seconds: 90` WHEN a round opens THEN its soft deadline is 90 s. GIVEN no such field THEN the setting's default applies.

Tests:
- `tabs.test.ts`, `stacked take overs each give back what they took` (measured at lines 329-350): the `formFirst` assertion changes from `'form'` to `'chat'`, through `takeOversAfterRelease`. It catches the session going back to a taker whose take over ended. Keep the `docsFirst` half unchanged. `isRoundToast`'s and `roundToastText`'s rows rename and gain the `<action>` text. `first_refusing_tab_asks_and_later_tabs_are_not_asked` catches a later tab's prompt or toast opening over the first refusal, with a forms and a chat tab.
- `session-tabs-view.test.ts`: `frame_take_overs_follow_take_over_release_and_tab_removal`, which catches a record left behind that later rewrites another taker's `previousTabId`.
- `session-forms.test.ts`, or the `guardClose` rows of `forms-commands.test.ts` (measured at lines 600-761) and `primer-commands.test.ts`: only the sending row refuses; the active and background rows return true with no prompt, toast or `activate`. The `askClose` and `closesSession` rows go. `review_cancel_leaves_the_session_open` catches a close left on that path.
- `channel-presenter.test.ts`: `open_form_refuses_with_its_reason_and_closed_form_allows`, which catches a guard that returns the old boolean or a wrong noun. `cancel_hold_cancels_the_sessions_form_and_says_not_by_finish`, which catches a page toast on the instant close or another session's form cancelled. `mark_words_the_toast_with_the_row_label`.
- `session-list.test.ts`: the guard table (measured at lines 1406-1427) returns reasons. `first_refusal_wins_and_row_stays`. `at_once_runs_cancel_holds_then_closes_in_one_call`, which catches a row left open after the cancel. `plain_close_never_runs_cancel_holds`, which catches a plugin's call cancelling a round. `cancel_hold_that_throws_leaves_the_row_with_the_reason`. `mark_keeps_its_text_until_activate`. `first_mark_wins_until_activate`, which catches a turn finish replacing `Round from…`.
- `form-service` tests: `cancel_returns_cancelled_to_the_waiting_call_with_the_latest_body`, with a form nobody typed in. It catches a null body.
- `chat-view.test.ts`: `at_once_close_of_a_busy_session_opens_no_confirm`, beside the row where a busy session still asks.
- `chat-sessions.test.ts`: `turn_finished_marks_with_the_folder_name_when_no_label`, which catches `Turn finished in null`.
- `sessions/page/start.test.ts`: `refused_close_toasts_the_reason` catches a refusal shown only in the log. `close_key_passes_at_once_only_when_a_tab_says_so`, which catches chat's confirm firing on an open round. `refusing_tab_stops_main_being_asked`, which catches a round cancelled while docs holds unsaved edits. `tab_shown_and_hidden_run_on_a_switch_and_on_mode_hide`, which catches a missed `hidden` on a mode hide. `opening_a_selected_session_with_the_mode_hidden_toasts_nothing`.
- `sessions-view.test.ts`: `part_tooltips_join_the_row_tooltip_and_refresh_on_pointerenter`, which catches two parts overwriting each other and a stale tooltip.
- `session-form-tabs.test.ts`: the `setStatus` rows change to `statusPart.tooltip`.
- `relay-server.test.ts`: `hello_fields_sessions_does_not_read_land_in_host`, which catches sessions naming a host field; the `deadline_seconds` mistype row goes.
- `form-service` tests hold the deadline table: its rows read `host`, plus a row for a non-number, which catches a string used as seconds.
- `primer-preview.test.ts`: the `connects` row (measured at line 88-94) changes with the new info.

Done when: `grep -rn 'confirmClosesSession\|closesSession\|asks to cancel' src` prints nothing, layouts and self-test scripts included; `grep -n 'Round from\|first round\|Form tab\|deadline' src/plugins/sessions/page/*.ts src/plugins/sessions/contract.ts src/plugins/sessions/main/session-list.ts` shows only test files or nothing; `grep -rn 'setStatus' src/plugins/sessions src/shared/page/session-form-tabs.ts` prints nothing; compiles; the test gate runs the tests above. Self-test `expect` lines move with any changed log line. The live checks are in [11](11-final-verification.md).
Commit: one commit for the group.

## Proof
