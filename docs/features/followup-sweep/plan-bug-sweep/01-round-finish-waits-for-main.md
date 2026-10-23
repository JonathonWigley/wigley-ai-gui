# 01 — Submit and cancel close the round only when main says it closed

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/main/channel-presenter.ts` · `src/plugins/forms/contract.ts` ·
           `src/plugins/forms/page/forms-commands.ts` · `src/plugins/forms/page/start.ts` ·
           `src/plugins/forms/page/form-state.ts` · `src/plugins/forms/page/view-model.ts` ·
           `src/plugins/forms/page/forms-view.ts` (status line only; added to the File Structure row, see Decisions)
           · test `src/plugins/forms/main/channel-presenter.test.ts` · `src/plugins/forms/page/forms-commands.test.ts` ·
           `src/plugins/forms/page/form-state.test.ts` · `src/plugins/forms/page/view-model.test.ts`
Consumes:  `SessionsPageExports.closeSession(sessionId: string): void` (tree) · `errorText` in
           `src/shared/error-text.ts` (tree)
Produces:  `export interface RoundSend { kind: RoundEnd['kind']; closesSession: boolean }` in `src/plugins/forms/page/form-state.ts`
           `RoundState.sending: RoundSend | null` in `src/plugins/forms/page/form-state.ts`
           `FormsAction` members `{ type: 'sendStarted'; roundId: string; kind: RoundEnd['kind'] }` and
           `{ type: 'sendFailed'; roundId: string }` in `src/plugins/forms/page/form-state.ts`; the
           `{ type: 'confirmCancel' }` member is removed
           `FormsCommandDeps.finish(roundId: string, end: RoundEnd): Promise<void>` in `src/plugins/forms/page/forms-commands.ts`
           `export type CloseRoundFromMainDeps = Pick<FormsCommandDeps, 'store' | 'closeSession' | 'toast' | 'log'>` in
           `src/plugins/forms/page/forms-commands.ts`
           `export function closeRoundFromMain(deps: CloseRoundFromMainDeps, roundId: string): void` in
           `src/plugins/forms/page/forms-commands.ts`
           `export function roundSaveLabel(round: RoundState): string` in `src/plugins/forms/page/view-model.ts`
Decisions: the round closes on the page only on main's `roundClosed` (interview, Design Overview diagram) ·
           while sending, the save status reads `Sending…` and the round's keys do nothing (Decided notice) · toasts
           pinned: `Answers sent: <label>` (success), `Round cancelled: <label>` (info), `Round not sent: <errorText>`
           (error) · `forms-view.ts` joins this task: the status line's text is drawn there and no other wave-1 task
           lists it; tasks 02 and 03 run after this one

## Behaviour

GIVEN a round in the review WHEN the user submits THEN main gets the body, the round stays shown with its save status
`Sending…`, and no toast shows yet.
GIVEN a round sending WHEN main sends `roundClosed` for it THEN the round leaves the page, the log reads `submitted`
(or `cancelled`), the success toast shows, and a cancel the close prompt asked also closes the session.
GIVEN a round sending WHEN main's `finish` rejects THEN the round stays with its answers, focus, view and editors, the
mark clears, and the toast `Round not sent: <errorText>` shows in the error tone; the user can send again.
GIVEN a round sending WHEN the user presses any of its keys or clicks its rail or choices THEN nothing changes.
GIVEN main's round listener throws on `finish` WHEN the page invokes `finish` THEN main keeps the round open, sends no
`roundClosed`, and the page's invoke rejects with the listener's error text.
GIVEN main's round listener finishes WHEN the page invoked `finish` THEN main drops its open entry and sends
`roundClosed` once.

## Approach

1. **Main (`channel-presenter.ts`)**: the `finish` handler returns when the round is unknown, as now; otherwise it
   calls `entry.listener.finish(end)` first, then `close(roundId)`. `close` already deletes the entry, sends
   `roundClosed` and updates the open count, and is a no-op when the listener's own `closeInWindow` already ran it, so
   `roundClosed` goes out exactly once. A throw from the listener leaves the entry, the count and the close guard as
   they were and propagates out of the handler, which rejects the page's invoke (the `draft` handler's existing rule).
   The handler no longer deletes or counts on its own. Add a one-line comment above the handler stating that a
   listener that throws leaves the round open.
2. **Contract (`contract.ts`)**: replace the `FormsChannel` comment with this text:

   ```
   // The forms page part invokes `openRounds` and `layout` on load, `draft` as
   // the user types, `finish` on submit or cancel, and `cycleLayout`,
   // `copyLayout` and `openPreview` from the layout keys; main sends each round
   // as it opens, the id of each round that closes, a round the page finished
   // included, and each layout change, the page's own cycles and copies
   // included. A `draft` whose save failed rejects with the reason; a `finish`
   // whose answers main could not take rejects with the reason and leaves the
   // round open; `layout` rejects when the layouts failed to start.
   ```

   and above `RoundListener.finish` add `// Throws an Error with the reason when the answers cannot be read; the round
   then stays open.`
3. **State (`form-state.ts`)**:
   - `restoreRound` sets `sending: null`.
   - `sendStarted` sets the named round's `sending` to `{ kind, closesSession: kind === 'cancelled' &&
     state.confirmClosesSession }` when its `sending` is null; otherwise it returns `state`.
   - `sendFailed` sets the named round's `sending` to null and changes nothing else (view, focus, answers,
     `confirmClosesSession` stay); `state` itself when the round is gone or not sending.
   - `roundClosed` is unchanged: it closes a sending round like any other.
   - Remove the `confirmCancel` action and its reducer case; a cancel now closes through `roundClosed`.
   - While the active round's `sending` is not null, `apply` returns `state` itself for every action except
     `roundShown`, `roundClosed`, `sessionActivated`, `setText`, `saveStarted`, `saveFinished` and `sendFailed`. Text
     edits still apply, so the store keeps what the editors show if the send fails.
4. **Commands (`forms-commands.ts`)**:
   - `finishActiveRound` returns, as now, unless the view is `from` and a round is active, and also when that round's
     `sending` is not null. Otherwise it builds the body, dispatches `sendStarted`, then calls
     `deps.finish(roundId, { kind, body })`. On rejection it dispatches `sendFailed`, logs
     `round <roundId> not finished: <errorText>` (the line `start.ts` logs today) and toasts
     `Round not sent: <errorText>` with tone `error`. A resolve does nothing: `roundClosed` carries the success. It
     no longer closes the round, logs the kind, toasts on success or closes the session.
   - `closeRoundFromMain(deps, roundId)` reads the round's `label`, `sessionId` and `sending` before it dispatches
     `{ type: 'roundClosed', roundId }`. When `sending` was not null it then logs the kind (`submitted` or
     `cancelled`), toasts `Answers sent: <label>` (`success`) or `Round cancelled: <label>` (`info`), and calls
     `deps.closeSession(sessionId)` when `sending.closesSession`. A round main closed on its own (no `sending`), or a
     round already gone, gets no log, toast or session close.
   - The `[forms] submitted` line the self-test waits for (`selftest-script.ts` step `o`, `<D-Enter>`) is now logged
     here, after main's `roundClosed` reaches the page, not inside the submit command.
5. **Page start (`start.ts`)**: delete `finishRound`; wire `finish: (roundId, end) => api.channel.invoke('finish',
   roundId, end)`. `listenForRounds` routes `roundClosed` to `closeRoundFromMain` with `store`, `closeSession` (to
   `sessions.closeSession`), `services.toast` and `services.log`, in place of the bare dispatch.
6. **Status line**: `roundSaveLabel(round)` returns `Sending…` while `round.sending` is not null, else
   `saveLabel(saveState(round), round.saveError)`. `buildStatusLine` in `forms-view.ts` sets the save text from it;
   `data-state` stays the `saveState` value.

## Tests

`src/plugins/forms/main/channel-presenter.test.ts`:
- Flip `sends no close to the page for a round its own finish closes` to `sends the page one close for a round its own
  finish closes`: the same listener (its `finish` calls `presenter.close('round-1')`); `page.sent` equals
  `[['roundShown', ROUND], ['roundClosed', 'round-1']]`.
- Extend `ends a round the page finishes and drops what arrives after`: also `page.sent.at(-1)` equals
  `['roundClosed', 'round-1']`.
- New `keeps a round open and rejects the page's finish when its listener throws`: the listener's `finish` throws
  `new Error('round round-1 has no question 3')`; `finish('round-1', end)` throws that message; `openRounds()` equals
  `[ROUND]`; `page.sent` equals `[['roundShown', ROUND]]`; `attention.counts` equals `[1]`; `mayClose('app-1')` is
  false.

`src/plugins/forms/page/forms-commands.test.ts` — `setup()` changes: the `finish` fake records the call and returns a
promise that resolves, or rejects with the error a new `failFinish(error: Error)` set; `setup()` also returns
`closeFromMain: (roundId: string) => closeRoundFromMain({ store, closeSession, toast, log }, roundId)` over the same
fakes. Tests:
- Replace `hands main the body on submit, then closes the round` with `hands main the body on submit and keeps the
  round until main closes it`: after `choose3`, `openReview`, `submit`: `finished` equals
  `[{ roundId: 'r1', end: { kind: 'submitted', body } }]`; `round().sending` equals
  `{ kind: 'submitted', closesSession: false }`; the view is `review`; `toasts` is empty and `logs.at(-1)` is
  `review opened`.
- New `closes a submitted round when main closes it, then logs and toasts the send`: after `submit`,
  `closeFromMain('r1')`: `store.get().rounds` is empty; view `idle`; `logs.at(-1)` is `submitted`; `toasts` equals
  `['Answers sent: project · r1']`; `toastTones` equals `['success']`.
- New `keeps a round whose finish rejects, with its answers, and toasts the error`: `choose3`, `openReview`,
  `failFinish(new Error('round r1 has no question 3'))`, `submit`; `await vi.waitFor` until `toasts` equals
  `['Round not sent: round r1 has no question 3']`; `toastTones` equals `['error']`; `logs` contains
  `round r1 not finished: round r1 has no question 3`; `round().sending` is null; `round().answers[0].choice` is 3;
  view `review`; a second `submit` makes `finished` hold two entries.
- New `sends nothing more while a round is sending`: `openReview`, `submit`, `submit`, `closeReview`: `finished` has
  one entry; view `review`.
- Rewrite `asks before cancelling, then hands main a cancelled round`: after `confirmCancel` the kinds equal
  `['cancelled']` and the view is still `confirm`; after `closeFromMain('r1')` the rounds are empty, `logs.at(-1)` is
  `cancelled`, `toasts` equals `['Round cancelled: project · r1']`, `toastTones` equals `['info']`.
- Extend `keeps the round when the confirmation is dismissed`: call `closeFromMain('r1')` after the final
  `confirmCancel`; `closedSessions` stays empty.
- Rewrite `confirming a close prompt cancels the round, then closes its session`: after `confirmCancel`,
  `closedSessions` is empty; after `closeFromMain('r1')` it equals `[{ sessionId: 'r1-session', roundCount: 0 }]`.
- New `a close prompt whose cancel fails keeps the session and the prompt`: `guardClose('r1-session')`,
  `failFinish(new Error('disk full'))`, `confirmCancel`; after the toast `Round not sent: disk full` arrives,
  `closedSessions` is empty, the view is `confirm`, `round().sending` is null.
- New `closing a round main closed on its own shows no toast and closes no session`: `closeFromMain('r1')` with no
  send: rounds empty; `toasts`, `logs` and `closedSessions` empty.

`src/plugins/forms/page/form-state.test.ts`, new `describe('sending')` over `initialState([presented('r1'),
presented('r2')], 'r1-session')`, and the `cancel` describe:
- `marks the active round sending with its kind`: after `openReview`, `sendStarted` (`submitted`): `active(state).sending`
  equals `{ kind: 'submitted', closesSession: false }`.
- `marks a cancel the close prompt asked as closing its session`: `askClose` for `r1-session`, then `sendStarted`
  (`cancelled`): `closesSession` is true.
- `ignores the round's keys while it is sending`: from the sending review state, each of `reviewNext`, `closeReview`,
  `askCancel`, `reviewJump` and `askClose` for `r1-session` returns the same state object; from a sending cancel
  (`openReview`, `askCancel`, `sendStarted` `cancelled`), `dismissConfirm` returns the same state object.
- `still takes text edits while sending`: `setText` on the note changes `active(state).note`.
- `a failed send clears the mark and keeps the view and answers`: `choose 2` in the forms view, `openReview`,
  `sendStarted`, `sendFailed`: `sending` is null, the view is `review`, `answers[0].choice` is 2.
- `a sending round closes on roundClosed`: `roundClosed` for `r1` leaves `['r2']` and the view `idle`.
- In `cancel`: remove `confirming closes the active round and shows the idle view` and `confirming outside the
  confirmation does nothing` with the action.

`src/plugins/forms/page/view-model.test.ts`, new `describe('roundSaveLabel')`:
- `reads Sending… while the round is sending`: a round after `openReview` and `sendStarted` → `Sending…`.
- `reads the save state while the round is not sending`: a fresh round → `Saved`.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above.
Commit:    one commit, "Forms: submit and cancel close the round only on main's roundClosed; a failed finish keeps the round with an error toast"

## Proof

44968c9 · diff read, every Produces present as named; typecheck, lint and the forms tests pass (worker) · concerns: roundClosed vs finish-reply order over real IPC untested (page does not depend on it) — task 15 live check

## Live checks for task 15

- **expected** — the forms self-test passes its close-prompt cancel (`<D-w>` then `y` on the layout preview, which
  must still close the session and select its neighbour) and its submit step (`o`, `<D-Enter>` expecting
  `[forms] submitted`). Both now wait on main's `roundClosed` over real IPC, which no unit test crosses.
- **low-confidence** — drive: `forms.openRound`, open the review, `Cmd+Enter`: the toast `Answers sent: <label>`
  shows and the Form tab shows its idle line. Reason: the order of main's `roundClosed` message and the `finish`
  invoke's reply in Electron is untested; the page must not depend on it, and only a live run shows that it does not.
