# 02 — The cancel prompt leaves with its view, and a background round's close says why

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/page/forms-view.ts` · `src/plugins/forms/page/forms-commands.ts` ·
           `src/plugins/forms/page/start.ts` · `src/plugins/forms/main/selftest-script.ts` ·
           test `src/plugins/forms/page/forms-commands.test.ts`
Consumes:  `PushedScope` (`pop`, `onBaseChanged`) in `src/contracts/plugin.ts` (tree) · `api.keys.setScope`,
           `api.keys.pushScope` (tree) · `SessionsPageExports.activate(sessionId: string): void` (tree) ·
           01's reducer rule that ignores `dismissConfirm` while the active round is sending
Produces:  `FormsViewDeps.setScope(view: FormsState['view']): void` in `src/plugins/forms/page/forms-view.ts`
           `FormsViewDeps.pushConfirmScope(): PushedScope` in `src/plugins/forms/page/forms-view.ts`
           (`FormsViewDeps.formShown(): void` is removed)
           `GuardCloseDeps` gains `toast(text: string, tone: ToastTone): void` (picked from `FormsCommandDeps`) and
           `activate(sessionId: string): void`, in `src/plugins/forms/page/forms-commands.ts`
Decisions: the cancel prompt pushes its own key scope and dismisses on `onBaseChanged` (Decided notice; the pattern of
           `chat/page/chat-dialogs.ts`) · closing a background round's session toasts
           `Finish or cancel <label>'s round first` in the `info` tone and selects that session (interview) · the
           scope that follows the forms view moves from `start.ts` into `forms-view.ts`, so one `render` orders the
           base change and the push

## Behaviour

GIVEN the cancel prompt is open WHEN another view sets the base scope (`Space k d` shows Docs mode, another tab or
session shows) THEN the prompt is dismissed, as `n` does, and the log reads `cancel prompt dismissed: the view moved
on`.
GIVEN the cancel prompt is open WHEN the user answers it, a session switch dismisses it, or its round closes THEN the
pushed scope is popped exactly once.
GIVEN a cancel is sending (task 01) WHEN the base scope changes THEN the dismiss is refused by the store, nothing is
logged, and the prompt and its scope stay until `roundClosed`; after a failed send the view is still `confirm`, so they stay
until the next base change dismisses them.
GIVEN a session whose round is open in the background WHEN the user closes that session THEN the session stays, the
toast `Finish or cancel <label>'s round first` shows in the `info` tone, the session is selected, and the refusal is
logged as now.

## Approach

1. **Scope in `forms-view.ts`**:
   - `FormsViewDeps` drops `formShown` and gains `setScope(view)` and `pushConfirmScope()`. The Form tab's `shown`
     callback calls `deps.setScope(deps.store.get().view)`.
   - `render` orders the scope work after the round views and before the status line:
     1. when the view is not `confirm` and the prompt is held: hide the dialog, pop its scope, clear the hold;
     2. when a Form tab is shown (`isFormShown`): `deps.setScope(view)`;
     3. when the view is `confirm` and the prompt is not held: show the dialog, push the confirm scope, hold it, and
        register its `onBaseChanged` listener.

     Popping before the base change keeps forms' own view change from reaching the listener; pushing after it means
     the base is already `confirm` when the prompt's scope goes on (the explorer's ordering trap).
   - The listener acts only while its own push is still the held one, the `open === opened` check of
     `chat-dialogs.ts`. It dispatches `dismissConfirm` and logs `cancel prompt dismissed: the view moved on` under
     `forms` only when the store's view then is no longer `confirm`.
2. **`start.ts`**: wire `setScope: (view) => api.keys.setScope(view)` and
   `pushConfirmScope: () => api.keys.pushScope('confirm')`; delete the `store.subscribe` block that set the scope
   and the `formShown` wiring. Pass `toast: services.toast` and `activate: (sessionId) =>
   sessions.activate(sessionId)` to `guardClose`.
3. **`guardClose`**: the background branch keeps its log line
   `session close kept: <label> is open in the background`, then toasts `Finish or cancel <label>'s round first`
   with tone `info`, then calls `deps.activate(sessionId)`, and returns false. The active-round branch is unchanged.
   Update the function's comment: a background round's session stays, and the guard selects it and says why.
4. **Self-test (`selftest-script.ts`)**: insert after the step `{ keys: ['n'], expect: '[page] n ran
   forms.dismissConfirm' }` that follows `C` (the review's first cancel prompt, now line 486):

   ```
   { keys: ['C'], expect: '[page] C ran forms.askCancel' },
   { keys: [' ', 'k', 'd'], expect: '[forms] cancel prompt dismissed: the view moved on' },
   { keys: [' ', 'k', 's'], expect: '[page] showed Sessions mode' },
   { keys: ['C'], expect: '[page] C ran forms.askCancel' },
   { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
   ```

   The second `C` proves the review's scope is back once Sessions mode shows the Form tab again. In the step
   comment above `STEPS`, replace "where C opens and n dismisses the cancel prompt;" with "where C opens and n
   dismisses the cancel prompt; C opens it again and Space k d shows Docs mode, which dismisses it, and Space k s
   shows Sessions mode, back in the review's scope, where C opens it and n dismisses it;".

## Tests

`src/plugins/forms/page/forms-commands.test.ts` — `setup()` records each `activate` call in `activated: string[]`
and passes `toast` and `activate` into its `guardClose` wrapper.
- Extend and rename `the close guard keeps a background round's session and logs the refusal` to `the close guard
  keeps a background round's session, says why and selects it`: after `roundShown` for `presentedRound('r2')`,
  `guardClose('r2-session')` is false; the store is the same object; `shownForms` is empty; `logs` equals
  `['session close kept: project · r2 is open in the background']`; `toasts` equals
  `["Finish or cancel project · r2's round first"]`; `toastTones` equals `['info']`; `activated` equals
  `['r2-session']`.
- Extend `the close guard lets a session with no round close` and `the close guard opens the prompt and keeps a
  session with an open round`: `toasts` and `activated` stay empty.

The prompt's scope push, pop and dismissal live in `forms-view.ts`, which has no DOM test harness; the self-test
steps above carry them.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above; the self-test steps are in
the script (task 15 runs them).
Commit:    one commit, "Forms: the cancel prompt pushes its own key scope and leaves with its view; closing a background round's session toasts and selects it"

## Proof

## Live checks for task 15

- **expected** — the forms self-test passes the five new steps (`C`, `Space k d` logging
  `[forms] cancel prompt dismissed: the view moved on`, `Space k s`, `C`, `n`) and every later step that opens or
  answers the prompt (`<D-w>` then `n`, `<D-w>` then `y`, `Space ?` then `<D-w>` closing help). Reason: the push,
  pop and base-change order run only in the live page.
- **low-confidence** — drive: with two sessions holding rounds, `click` the close button of the row that is not
  selected; `query` shows the toast `Finish or cancel <label>'s round first` and that row selected, and the session
  still listed. Reason: the self-test fixture has no background-round close, and the `activate` wiring in
  `start.ts` has no unit test.
- **low-confidence** — drive: `C` in the review, then `Space k d`: `screenshot` shows Docs mode with no
  "Cancel this round?" dialog over it. Reason: the bug was visual; the log line proves the dispatch, not the hidden
  dialog.
