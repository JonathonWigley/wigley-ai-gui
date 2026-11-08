# 07 — Open work answers `mayStop`

Status: done
Type: Batch
Wave: 4 · Depends on: 02, 05
Plan: [plan.md](plan.md)

Files:
- modify `src/shared/agent-forms/channel-presenter.ts` · test `src/shared/agent-forms/channel-presenter.test.ts`
- modify `src/plugins/forms/main/start.ts` · test `src/plugins/forms/main/start.test.ts`
- modify `src/plugins/primer/main/start.ts` · test `src/plugins/primer/main/start.test.ts`
- modify `src/plugins/docs/page/start.ts` · test `src/plugins/docs/page/start.test.ts`
- modify `src/plugins/notes/page/start.ts` and `src/plugins/notes/page/popup.ts` · test `src/plugins/notes/page/start.test.ts`
- modify `src/plugins/backlog/page/start.ts` and `src/plugins/backlog/page/backlog-view.ts` · test `src/plugins/backlog/page/start.test.ts`
- modify `src/plugins/chat/page/start.ts` and `src/plugins/chat/page/chat-view.ts` · test `src/plugins/chat/page/chat-view.test.ts`

Consumes:
- `MainStart<M>.mayStop?(): string | null` and `PageStart<M>.mayStop?(): string | null` in `src/contracts/plugin.ts`: a reason the part must not stop now, in words the user reads, or null; the switch asks it before a switch-off; a restart and quit do not ask ← 02.
- `PluginHost.mayStop(pluginIds)` returns `"<id>: <reason>"` for the first part that gives one ← 02. So a part's reason does not name its plugin.
- `docs/page/start.ts` returns `ready()` ← 05. This task adds `mayStop` beside it.
- Wave 3 task 07's presenter ← Wave 3 (re-verify): `createAgentFormChannelPresenter` takes `noun: string` (`'round'` in forms, `'primer'` in primer), and its close guard refuses with `Finish or cancel <form.label>'s <noun> first`, where `form.label` is `PresentedAgentForm.label` (`project · heading`, or the heading alone).
- Wave 3 task 08's docs place ← Wave 3 (re-verify): `docsPlaceSlot` (`docs.place`, keyed by view id) holds `edits: { path; text; baseText } | null`, and a restored `edits` reads as unsaved edits; `sessionIdOfSource(viewId: string): string | null` in `src/plugins/docs/contract.ts`.
- `sessionsRowsSlot` and `SessionRow.label` (`gamma 2`) in `src/plugins/sessions/contract.ts`; `Paths.base(path)` in `src/contracts/paths.ts`; `DocsView.unsavedPath(): string | null` in `src/plugins/docs/page/docs-view.ts` (all in the tree).

Produces:
- `AgentFormChannelPresenter<Form, Body>.mayStop(): string | null` in `src/shared/agent-forms/channel-presenter.ts`. **Added beyond plan.md.**
- `formsMainPart.start` returns `mayStop: () => presenter.mayStop()`. `createForms` returns the agents' `presenter` beside `forms` and `preview`.
- `primerMainPart.start` returns `mayStop: () => presenter.mayStop()`.
- `docsPagePart.start` returns `mayStop()`, per the rule below.
- `notes`, `backlog` and `chat` page parts each return `mayStop()`, per § Notes, backlog and chat below. **Added by the lead after drafting.**

Decisions:

**Forms and primer: an open form holds the plugin.**
- The presenter already knows each open form, in `open`, in the order each was shown. `mayStop()` returns the reason of the first open form that is not quiet, or null.
- The reason is the close guard's reason, word for word: `Finish or cancel <form.label>'s <noun> first`. Build both from one helper in `channel-presenter.ts`, so the user reads one wording on a refused close and on a refused switch-off. Forms reads, for example, `Finish or cancel wigley-ai-gui · Plan review's round first`; primer reads `Finish or cancel wigley-ai-gui · Hot reload's primer first`. The host then puts `forms: ` or `primer: ` in front.
- A quiet form does not hold the plugin. Quiet forms are the layout preview's samples, in a memory store, with no agent call waiting, so a switch-off loses nothing. The close guard keeps counting them, as Wave 3 left it.
- A form whose agent call already returned (the soft deadline passed) still counts: the user's answers in it are still open work.
- The preview service shares the same presenter, through `presenter.quiet`, so one `mayStop` covers both services.
- `mayStop` only reads. It logs nothing, toasts nothing and changes no state. The switch logs the refusal (`[plugin-switch] refused <id>: <reason>`, task 08).

**Docs: unsaved edits hold the plugin.**
- `mayStop()` walks `allViews()` in its order: `machineView` first, then the added views in the order `addView` added them. The first view whose `unsavedPath()` is not null gives the reason. No view with unsaved edits gives null.
- `<name>` is `services.paths.base(path)` of that `unsavedPath()`.
- The words, by view:

  | View | Reason |
  |---|---|
  | `machineView` (Docs mode) | `Save or discard the edits to <name> in Docs mode first` |
  | an added view whose id `sessionIdOfSource` maps to a session | `Save or discard the edits to <name> in <label>'s Docs tab first` |
  | any other added view | `Save or discard the edits to <name> in a Docs view first` |

  `<label>` is `rows.get(sessionId)?.label ?? sessionId`, read from `sessionsRowsSlot` at the time of the ask. To find an added view's id, read the key of `addedViews` that holds it.
- The words differ from the tab's `UNSAVED_TEXT` (`Unsaved changes — :w to save, :q! to discard`) on purpose. That toast shows inside the doc, where the user stands. A switch-off is asked from Settings, so the reason names the file and the place.
- Docs' main part holds no open work: each write goes to disk at once.

**Notes, backlog and chat: typed text not yet kept holds the plugin (lead).** A switch-off clears the plugin's slots and ends its page part, so each of these would lose what the user typed. The user chose a refusal over a lost edit.
- `notes`: the popup's draft is not saved (`saveState(draft)` from `src/shared/page/autosave.ts` is not `'saved'`: unsaved, saving, held back while the popup is locked, or after a failed save). The popup gains `mayStop(): string | null`, and the part returns it. Reason: `Wait for the note to finish saving`. A failed save holds the plugin until it saves or the popup is cleared, since losing the note is what the refusal guards.
- `backlog`: an editor is open (`store.get().editor` not null in `createBacklogView`) and `isDraftChanged(editor)` from `backlog-state.ts` is true, so the title, line and tags boxes all count. The view gains `mayStop(): string | null`, and `start.ts` returns `mayStop: () => view.mayStop()`. Reason: `Save or close the follow-up you are editing first`. An editor opened and left unchanged gives null.
- `chat`: a session's live draft box holds text whose `trim()` is not empty, or the tab holds an attached image. Read the live box and attachments through `chat-view.ts`'s tabs, not the `chat.place` slot, which is a reload mirror that may lag a keystroke. The first such session in `sessionsRowsSlot` order gives the reason `Send or clear the draft in <label>'s chat first`, `<label>` read as docs reads it. The running agent processes do not hold chat: they go on in the session host.
- `settings`: each edit writes its layer file at once, and it holds nothing.
- Every other plugin holds no state the user typed. The implementer adds no other plugin.

GIVEN a round open in a session WHEN the switch asks forms' main part THEN `mayStop()` returns `Finish or cancel <form.label>'s round first`.
GIVEN that round submitted or cancelled WHEN the switch asks again THEN `mayStop()` returns null.
GIVEN only the layout preview's round open WHEN the switch asks THEN `mayStop()` returns null.
GIVEN two rounds open WHEN the switch asks THEN the reason names the round shown first.
GIVEN a follow-up editor with changed text WHEN the switch asks backlog's page part THEN `mayStop()` returns `Save or close the follow-up you are editing first`.
GIVEN a draft typed in session `gamma 2` WHEN the switch asks chat's page part THEN `mayStop()` returns `Send or clear the draft in gamma 2's chat first`.
GIVEN unsaved edits to `plan.md` in session `gamma 2`'s Docs tab WHEN the switch asks docs' page part THEN `mayStop()` returns `Save or discard the edits to plan.md in gamma 2's Docs tab first`.

Tests:
- `channel-presenter.test.ts`: new `it.each` table titled `mayStop names the first open form that is not quiet: $case`. Each row shows forms through the presenter with `noun: 'round'`, then asserts `presenter.mayStop()`:

  | Case | What the row does | Expected |
  |---|---|---|
  | `nothing open` | shows nothing | `null` |
  | `only a quiet form` | `quiet.show` of a form labelled `proj · Q` | `null` |
  | `two forms` | `show` of `proj · A`, then `show` of `proj · B` | `Finish or cancel proj · A's round first` |
  | `the first one closed` | as `two forms`, then `close` of A | `Finish or cancel proj · B's round first` |

  It catches a quiet form counted, a reason that names the last form shown, and a closed form still counted. A further `it`, `mayStop and the close guard give one wording`, asserts that the guard's reason for A's session equals `mayStop()`'s, which catches the two strings drifting apart.
- `forms/main/start.test.ts`: new `it('mayStop names the open round until it resolves')`. Open a round with the `openRound` drive action, as the file's `openRound` tests do. Read the label from the `formShown` message the harness recorded in `sent`. Assert that `harness.started().mayStop?.()` is `` `Finish or cancel ${label}'s round first` ``. Resolve the round, then assert `null`. It proves the part wires the presenter, once.
- `primer/main/start.test.ts`: the same row through `openPrimer`, with `'s primer first`.
- `docs/page/start.test.ts`: new `it.each` table `mayStop_$case`, in the file's naming style. Each row seeds `docsPlaceSlot` before the start (Wave 3 task 08's reload pattern: publish, set, dispose the writer, then start), with `edits: { path: '/w/plan.md', text: 'new', baseText: 'old' }` for one view id, and a sessions row `s1` labelled `gamma 2`:

  Each row awaits the restore (the file's read and the pane's open) before `mayStop()`, as Wave 3's `restored_edits_refuse_the_close` does; re-check that test's pattern after Wave 3 lands.

  | Case | Seeded view id | Expected |
  |---|---|---|
  | `NoEdits_Null` | none | `null` |
  | `DocsModeEdits_NamesDocsMode` | docs mode's view id (re-measure in Wave 3's landed file) | `Save or discard the edits to plan.md in Docs mode first` |
  | `SessionTabEdits_NamesTheSession` | `sessionSourceId('s1')` | `Save or discard the edits to plan.md in gamma 2's Docs tab first` |

  It catches a view skipped, a session named by its id where a label exists, and the full path in place of the file name.
- `notes/page/start.test.ts`, `backlog/page/start.test.ts` and chat's draft test: one `it.each` table each, rows `nothing typed → null` and `typed and not kept → the reason`; backlog adds `editor open, unchanged → null`, notes adds `saved → null` and `failed save (unsaved, saveError set) → the reason`; chat adds `whitespace only → null` and `an image with no text → the reason`. It catches a reason given for an untouched editor and a saved note still holding the plugin.

Done when: `grep -n 'mayStop' src/plugins/forms/main/start.ts src/plugins/primer/main/start.ts src/plugins/docs/page/start.ts src/plugins/notes/page/start.ts src/plugins/backlog/page/start.ts src/plugins/chat/page/start.ts src/shared/agent-forms/channel-presenter.ts` prints a line in each file; compiles; the test gate runs the tests above. The filtered self-test runs `npm run selftest -- --plugin forms --plugin primer --plugin docs --plugin notes --plugin backlog --plugin chat`. The switch's refusal on screen is task 08's, and its live check is in [13](13-final-verification.md).
Commit: one commit for the group.

## Proof

Commit 810da4d4 · proof: diff read: every Produces present (presenter, forms, primer, docs, notes, backlog, chat mayStop); typecheck and lint clean on the full tree; worker ran the 7 task test files, 156 passed · concerns: docs unsavedPath already refuses while a restore is pending; reloadWith gained an optional rowOf parameter; for review: forms/main/start.ts header comment reads 'That one presenter which owns…' and forms/primer header comment lines run past the wrap width
