# 07 — Sessions queries, close seams and forms knowledge

Status: not started
Type: Task
Wave: 4 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)

Files:
- modify, sessions: `src/plugins/sessions/contract.ts` · `page/start.ts` · `page/tabs.ts` · `page/session-tabs-view.ts` · `page/sessions-view.ts` · `page/sidebar-view.ts` · `page/preview.ts` · `main/session-list.ts` · `main/start.ts` · `main/relay/relay-server.ts` · `main/selftest-script.ts` · `layouts/layout.d.ts` · `layouts/default/layout.js` (each under `src/plugins/sessions/`)
- modify, shared: `src/contracts/agent-forms.ts` · `src/shared/agent-forms/channel-presenter.ts` · `src/shared/agent-forms/form-service.ts` · `src/shared/agent-forms/drive-actions.ts` · `src/shared/page/session-form-tabs.ts` · `src/shared/page/session-forms.ts` · `src/plugins/agent-form-fakes.test-support.ts`
- modify, forms and primer: `src/plugins/forms/page/forms-commands.ts` · `forms/page/start.ts` · `forms/page/forms-view.ts` · `forms/main/start.ts` · `forms/main/selftest-script.ts` · `forms/main/preview/layout-preview.ts` · `src/plugins/primer/page/primer-commands.ts` · `primer/page/start.ts` · `primer/page/primer-view.ts` · `primer/main/start.ts` · `primer/main/selftest-script.ts` · `primer/main/preview/primer-preview.ts`
- modify, callers of `deadlineSeconds: null` or `mark`: `src/plugins/chat/main/chat-sessions.ts` · `chat/main/fixtures.ts` · `chat/main/preview/chat-preview.ts` · `chat/main/selftest-script.ts` · `src/plugins/agents/main/preview.ts` · `src/plugins/docs/main/selftest-script.ts` · `src/plugins/notes/main/selftest-script.ts`
- test `src/plugins/sessions/page/tabs.test.ts` · `sessions/page/start.test.ts` · `sessions/page/sessions-view.test.ts` · `sessions/page/preview.test.ts` · `sessions/main/session-list.test.ts` · `sessions/main/relay/relay-server.test.ts` · `src/shared/agent-forms/channel-presenter.test.ts` · `src/shared/page/session-form-tabs.test.ts` · `src/shared/page/session-forms.test.ts` · `src/plugins/forms/page/forms-commands.test.ts` · `primer/page/primer-commands.test.ts` · `primer/main/preview/primer-preview.test.ts`

Consumes:
- `api.commands`, `api.events` as the tree holds them. No new core signature.
- The `rows` and `sessions` slots of `plan-commands-and-state` task 11 stay as landed. This task adds no query. The row's new field below travels in them.
- `SessionPart`, `addRowPart`, `setActivity`, `RowActivity`, `NEEDS_YOU_ACTIVITY` (in the tree).

Produces, in `src/plugins/sessions/contract.ts` unless named:
- Close guard: `addCloseGuard(mayClose: (sessionId: string) => string | null): Disposable`. A string refuses, and it is the toast sessions shows. `AgentFormSessions.addCloseGuard` in `src/contracts/agent-forms.ts` takes the same signature.
- Channel: `closeSession(sessionId: string): string | null`: the first refusal's reason; null when the row closed, was already closed, or main knows no such session. The contract comment changes with it.
- Page event: `SessionsPageEvents.tabShown: { sessionId: string; tabId: string }`, emitted after the tab's `shown()`.
- `SessionTabView.hidden?(): void`. **Added beyond plan.md's text:** optional, as `Mode.sideBarHidden?` is, since no tab needs it yet.
- `SessionPart.tooltip?(sessionId: string): string | null`. **Added beyond plan.md.** See the question under Decisions.
- `export interface MarkOptions { text: string; action: string }`. `SessionsMainExports.mark(sessionId: string, options: MarkOptions): void`, and `AgentFormSessions.mark` the same. `SessionRow.markToast: MarkOptions | null`.
- `SessionInfo.host?: Readonly<Record<string, unknown>>` replaces `deadlineSeconds`. `SessionInfo.label?: string`.
- In `src/contracts/agent-forms.ts`: `AgentFormOwnerInfo.host?: Readonly<Record<string, unknown>>` replaces `deadlineSeconds`; `export const HOST_DEADLINE_FIELD = 'deadline_seconds'`; `AgentFormSessions.label(sessionId: string): string | null`.
- In `src/plugins/sessions/page/tabs.ts`: `takeOversAfterRelease(live: readonly TakeOver[], released: TakeOver): TakeOver[]`; `isMarkToast` replaces `isRoundToast` with the same parameters; `markToastText(mark: MarkOptions, keys: string | null): string` replaces `roundToastText`. `rowStatus` goes.
- In `src/shared/page/session-forms.ts`: `askSessionClose` replaces `guardSessionClose`. `askClose` replaces `guardClose` in `forms-commands.ts` and `primer-commands.ts`.
- Removed: `SessionTabHandle.setStatus`, `FormTabHandle.setStatus`, `SessionTabsView.statusesOf`, `Tab.status`, `RowState.status`, `SessionRowInput.status`, `DRIVE_SESSION_DEFAULTS.deadlineSeconds`, `RelayHello.deadline_seconds`.

Decisions:

**Close seams, after the task:**

```
 sessions.closeSession(id), from the key or a plugin
   │ each tab's beforeClose, in tab order
   │   chat: busy session ─► its end-session confirm, false
   │   docs: unsaved edits ─► toast, false
   │   forms, primer: askClose ─► cancel confirm or sending toast, false
   ▼ every tab true
 main closeSession ─► every close guard ─► string: row stays
   ▼                                          ▼
 row closes                         page logs and toasts the reason
```

- **Question for the user (report):** the design says main's guard "alone holds" the open round, and that `beforeClose` stays "for what the page knows or must ask". `design.md` § Sessions says Cmd+W opens the cancel-round confirmation. A guard in main cannot open a page dialog. This task pins the flow below, which keeps the confirm. A different answer changes this section only.
- **The hold is main's. The ask is the page's.** `createAgentFormChannelPresenter`'s guard refuses while its session holds an open form, with the reason `Finish or cancel <form.label>'s <noun> first`. That is today's page toast text. The presenter gains `noun: string`: `'round'` in forms, `'primer'` in primer, from today's `ROUND_WORDS.noun` and `PRIMER_WORDS.noun`.
- **`askSessionClose` keeps two of `guardSessionClose`'s branches:**
  - No form, or a form that is not the active form: returns true. Main then refuses a background form with the reason.
  - A form sending: logs `session close kept: <label> is sending`, toasts `Sending <label>'s <noun>…`, returns false. Only the page knows a send is in flight.
  - The active form: `showForm`, dispatches `askClose`, logs `closing the session asks to cancel <label>`, returns false. Today's text and order.
- Forms' and primer's `guardClose` wrappers and their `activate` dep go.
- **Confirming still closes.** `confirmCancel` finishes the form with `closesSession` true. Main closes the form before the page hears `formClosed`, so the follow-up `sessions.closeSession` passes `askClose` and every guard. No change to that path.
- **One visible change, and report it:** a form in the background used to select its session as well as toast. The toast stays and the selection goes. The key always closes the focused session, so only another plugin's `closeSession` call reaches this path.
- `session-list.ts`: `everyGuardAllows` becomes `firstRefusal(sessionId): string | null`. `release` and `closeSession` keep their log lines. The page keeps `session close kept by main: <label>` and adds `api.services.toast(reason, 'info')`.
- `consumer-view.ts` needs no change: it passes `mayClose` through.

**Take-over release.** The session's frame holds `takeOvers: TakeOver[]`, its live take overs. `takeOversAfterRelease` removes `released`, and gives each live take over whose `previousTabId` equals `released.tabId` the `previousTabId` of `released`. `tabsAfterRelease` keeps its signature. The handle's `release` reads the current record from the frame, applies `tabsAfterRelease`, then stores `takeOversAfterRelease`. So: chat selected, form takes over, docs takes over, form releases, docs releases: chat shows. The contract comment on `takeOver` says this.

**`tabShown` and `hidden`.** `checkVisible` in `sessions/page/start.ts` does both. When `lastVisible` was a tab and `next` differs, it finds that tab by id with `view.tabs.tabsOf` and calls `hidden?.()` before anything else; a tab already gone gets no call. A mode hide counts. After `tab?.shown()`, it emits `tabShown`. `isShownAgain` emits `tabShown` again and calls no `hidden`, since the tab never left. No plugin consumes either yet; the follow-up asks for the seam.

**`setStatus` gives way to a row part.** Forms' and primer's status text is the only status (`Chat and docs set none`, re-verify with `grep -rn 'setStatus' src/plugins src/shared`).

- **Question for the user (report):** the `default` layout draws `status` only in the row's tooltip, so a row part that only draws has no surface with the same look. This task adds `SessionPart.tooltip` to keep that look. The alternative is visible text on the row, which changes the look.
- A row part's `tooltip` is read at each row draw and on each `pointerenter` on the row, so a status change needs no row redraw. `entry.title` is `[title, label, activity word, ...each part's tooltip]`, each only when present, in part order. Two sources no longer overwrite each other.
- `createSessionFormTabs` keeps the last status per session and exposes `statusPart: SessionPart`, with id from a new dep `statusPartId` (`forms.status`, `primer.status`), an empty `build`, and `tooltip` returning the session's status or null. An empty wrapper takes no room. `forms-view.ts` and `primer-view.ts` add it through `addRowPart`; their `sessions` deps widen to include it.
- `SessionRowInput.status` goes from `layout.d.ts`, and its doc line and the tooltip line change. `default/layout.js`'s comment changes. `PREVIEW_STATUSES` in `sessions/page/preview.ts` goes.

**Sessions stops knowing forms.**

- `mark` stores `options` as `row.markToast`. `activateRow` clears it. `rowOf` starts it null.
- `publishFocused` toasts when `isMarkToast(wasPublished, sessionId, isModeShown)` holds and the row's `markToast` is not null. So a session opened with `select: true` while the mode hides no longer toasts `Round from…`. Report this.
- `markToastText`: `keys === null` gives `<text>`; else `<text> — <keys> to <action>`.
- Pinned text. Forms: `{ text: 'Round from <label>', action: 'answer' }`, so forms' toast reads exactly as today. `<label>` is `sessions.label(sessionId) ?? form.label`. Presenter dep `markText(label: string): string` and `markAction: string`.
- **Question for the user (report):** primer and chat both toast `Round from…` today, which is untrue for them. This task words them: primer `{ text: 'Primer from <label>', action: 'answer' }`; chat, in `announceTurnFinished`, `{ text: 'Turn finished in <label>', action: 'read it' }`, with `TURN_FINISHED_TITLE`.
- `NOTHING_OPEN_TEXT` becomes `Nothing open in this session yet`. `EMPTY_TEXT` names the relay, which sessions owns, and stays.
- Comments go generic: `SessionRow` (`marked` is attention a plugin asked for with `mark` and the user has not answered; a connected session's row exists while marked, activated or kept by a close guard), `NEEDS_YOU_ACTIVITY` (something waiting on the user), `layout.d.ts`'s `marked` line, `default/layout.js`'s line, `isMarkToast`, `SessionInfo`'s "What a form source knows" comment.
- **Opaque host record.** `sessionInfo(hello)` puts every hello field outside `protocol`, `session_id`, `project_dir`, `harness` and `config_dir` into `host`, or leaves `host` out when none. `RelayHello` gains an index signature and loses `deadline_seconds`; the wire stays, so `relay.py` in wigley-ai-marketplace needs no change. `mistypedHelloField` loses its row. `form-service.ts`'s `deadlineSeconds` reads `info.host?.[HOST_DEADLINE_FIELD]`, takes it only as a number, and keeps today's range check: a non-number now means the default, where the relay used to refuse the hello.
- Every `deadlineSeconds: null` line goes (`chat-sessions.ts`, `chat/main/fixtures.ts`, `chat-preview.ts`, `chat/main/selftest-script.ts`, `agents/main/preview.ts`, `docs/main/selftest-script.ts`, `notes/main/selftest-script.ts`, both previews). `deadlineSeconds: 120` becomes `host: { [HOST_DEADLINE_FIELD]: 120 }` (`forms/main/selftest-script.ts`, `primer/main/selftest-script.ts`). Sites measured at plan time, re-verify with `grep -rn 'deadlineSeconds' src`; forms' and primer's `deadlineSeconds` setting and `form-service.ts`'s own local field stay.
- Drive: `driveSessionInfo` in `sessions/main/start.ts` reads an object arg `host` in place of `deadlineSeconds`, and its schema string changes. `sessions/main/selftest-script.ts` follows. `drive-actions.ts`'s `connect` type and `sessionDefaults` lose the field.
- **Preview label.** `groupOf` returns `info.label` first. Both previews pass `projectDir: null, label: 'Layout preview'` and `label: 'Primer preview'`. Their title bars lose the detail line, which repeated the name. Report this.

GIVEN an open round active in the focused session WHEN Cmd+W runs THEN the Form tab selects and the cancel confirm opens; no toast shows, and main is not asked.
GIVEN that confirm WHEN the user confirms THEN the round ends cancelled and the session closes.
GIVEN a round open in a session that is not focused WHEN another plugin calls `closeSession` THEN main refuses, the row stays, and the toast reads `Finish or cancel <label>'s round first`.
GIVEN a busy chat session and an open round WHEN Cmd+W runs THEN the first tab in tab order that refuses asks, and later tabs are not asked.
GIVEN chat selected, then form and docs taking over WHEN form releases, then docs releases THEN chat shows.
GIVEN docs then form taking over WHEN form releases, then docs releases THEN chat shows, as today.
GIVEN a visible tab WHEN another tab shows or the mode hides THEN `hidden` runs on the old tab, before `shown` on the new one.
GIVEN a round open WHEN the pointer enters its row THEN the tooltip holds the status today's `<heading> <answered>/<total>` text gives.
GIVEN nothing selected and the mode hidden WHEN a round arrives THEN the toast reads `Round from <label> — <keys> to answer`, or `Round from <label>` with no keys bound.
GIVEN a relay hello with `deadline_seconds: 90` WHEN a round opens THEN its soft deadline is 90 s. GIVEN no such field THEN the setting's default applies.

Tests:
- `tabs.test.ts`, `stacked take overs each give back what they took` (measured at lines 329-350): the `formFirst` assertion changes from `'form'` to `'chat'`, through `takeOversAfterRelease`. It catches the session going back to a taker whose take over ended. Keep the `docsFirst` half unchanged. `isRoundToast`'s and `roundToastText`'s rows rename and gain the `<action>` text.
- `session-forms.test.ts`, or the `guardClose` rows of `forms-commands.test.ts` (measured at lines 600-761) and `primer-commands.test.ts`: the background row now returns true with no toast and no `activate`; the active and sending rows stay. Add a row: `confirming_the_close_prompt_still_closes_the_session`, unless the row at line 658 already holds it after the rename. It catches the confirm lost when `guardClose` went.
- `channel-presenter.test.ts`: `open_form_refuses_with_its_reason_and_closed_form_allows`, which catches a guard that returns the old boolean or a wrong noun. `mark_words_the_toast_with_the_row_label`.
- `session-list.test.ts`: the guard table (measured at lines 1406-1427) returns reasons. `first_refusal_wins_and_row_stays`. `mark_keeps_its_text_until_activate`.
- `sessions/page/start.test.ts`: `refused_close_toasts_the_reason` catches a refusal shown only in the log. `tab_shown_and_hidden_run_on_a_switch_and_on_mode_hide`, which catches a missed `hidden` on a mode hide. `opening_a_selected_session_with_the_mode_hidden_toasts_nothing`.
- `sessions-view.test.ts`: `part_tooltips_join_the_row_tooltip_and_refresh_on_pointerenter`, which catches two parts overwriting each other and a stale tooltip.
- `session-form-tabs.test.ts`: the `setStatus` rows change to `statusPart.tooltip`.
- `relay-server.test.ts`: `hello_fields_sessions_does_not_read_land_in_host`, which catches sessions naming a host field; the `deadline_seconds` mistype row goes.
- `form-service` tests hold the deadline table: its rows read `host`, plus a row for a non-number, which catches a string used as seconds.
- `primer-preview.test.ts`: the `connects` row (measured at line 88-94) changes with the new info.

Done when: `grep -n 'Round from\|first round\|Form tab\|deadline' src/plugins/sessions/page/*.ts src/plugins/sessions/contract.ts src/plugins/sessions/main/session-list.ts` shows only test files or nothing; `grep -rn 'setStatus' src/plugins/sessions src/shared/page/session-form-tabs.ts` prints nothing; compiles; the test gate runs the tests above. Self-test `expect` lines move with any changed log line. The live checks are in [11](11-final-verification.md).
Commit: one commit for the group.

## Proof
