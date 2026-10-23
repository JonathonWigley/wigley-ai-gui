# 07 — Chat: askPermission keeps an explicit null input, `loaded` cancels a stale sign-in, raw comments

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/start.ts` · modify `src/plugins/chat/contract.ts` ·
           modify `src/plugins/chat/page/start.ts` · modify `src/contracts/agent.ts` ·
           modify `src/main/claude-code/stream-decoder.ts` · test `src/plugins/chat/main/start.test.ts`
Consumes:  `Accounts.cancelRunning()` in `src/plugins/chat/main/accounts.ts` (in the tree)
Produces:  `loaded(): void;` in `ChatChannel.invoke` in `src/plugins/chat/contract.ts`
           `api.channel.handle('loaded', …)` in `chatMainPart.start` in `src/plugins/chat/main/start.ts`
Decisions: `chat.askPermission` defaults `input` only when it is left out; the chat page sends `loaded` once at start,
           which cancels a stale sign-in, and `sessions` becomes a plain read (plan.md, Decided notices)

## (a) `askPermission` input

In `addDriveActions`' `askPermission` (`src/plugins/chat/main/start.ts`), `input: args.input ?? DEFAULT_PERMISSION_INPUT`
becomes `args.input === undefined ? DEFAULT_PERMISSION_INPUT : args.input`, the shape forms' drive actions use for
`args.round`. An explicit `null` reaches the permission tool as `null`. The action's description and `args` string
already say "default" for a left-out field and stay.

GIVEN `{ sessionId: 'held', input: null }` WHEN `askPermission` runs THEN the permission tool is called with `input`
`null`
GIVEN `{ sessionId: 'held' }` WHEN `askPermission` runs THEN it is called with `input` `{ command: 'ls' }`

## (b) The `loaded` message

- `ChatChannel.invoke` (`src/plugins/chat/contract.ts`) gains `loaded(): void;` as its first member, commented: sent
  once on each page load; cancels any running sign-in, since the page that started it is gone.
- `sessions(): ChatSessionState[]`'s comment (`Read once on each page load, which also cancels any running sign-in:
  the page that started it is gone.`) becomes a plain description: every session chat holds. It cancels nothing.
- Main, `chatMainPart.start`: the `sessions` handler becomes `() => chat.sessions()`; a new
  `api.channel.handle('loaded', () => accounts.cancelRunning())` sits beside it, carrying the comment that now sits
  above `sessions` (`The page reads its sessions once on each load: …`) reworded to the page announcing its load.
  `dispose` still calls `accounts.cancelRunning()`.
- Page, `chatPagePart.start` (`src/plugins/chat/page/start.ts`): the first statement after `const { services } = api;`
  sends `loaded`, fire and forget, with the logged catch `chat-view.ts` uses for its `sessions` read:
  `void api.channel.invoke('loaded').catch((error: unknown) => services.log('chat', \`chat page load not sent:
  ${errorText(error)}\`))`. `errorText` is imported from `src/shared/error-text.ts`. It runs before the view mounts,
  so it reaches main before any sign-in the page can start (invokes from one page arrive in order). The dev server
  loads the page twice at start, so main hears `loaded` twice there; `cancelRunning` with nothing running does
  nothing.

GIVEN a sign-in running WHEN the page sends `loaded` THEN the sign-in is cancelled
GIVEN a sign-in running WHEN the page reads `sessions` THEN the sign-in keeps running

## (c) Raw-event comments

`docs/features/agent-chat/design.md` (already updated) says each entry carries the raw harness events it was built
from, except streaming deltas and Claude's `message_start`, `message_delta` and `message_stop`, whose content the
entry's start event and its final assistant event already hold. Make the two code comments say the same:

- `src/contracts/agent.ts`, above `ChatEntry`: `` `raw` holds the harness events the entry was built from, oldest
  first. `` gains that a harness adapter may leave out streaming events whose content the kept events already hold
  (the contract is harness-neutral; Claude's names stay out of it).
- `src/main/claude-code/stream-decoder.ts`, the `createStreamDecoder` header comment, gains one sentence: an entry's
  `raw` leaves out `content_block_delta`, `content_block_stop`, `message_start`, `message_delta` and `message_stop`
  stream events, whose content the block's `content_block_start` and the final `assistant` event hold.

No test: comment-only, and `decode_AssistantBeforeBlockStop_ConfirmsStreamedEntry` already pins `raw` as the start
event plus the assistant event after a streamed block.

Tests (`src/plugins/chat/main/start.test.ts`):

- `fakeChat()`'s `permissionToolSession().call` records each call's second argument (the tool args) into a `calls`
  array the fake returns, still returning the promise the test replies to.
- `describe('chat drive actions')` (sentence names): `askPermission passes an explicit null input on` — run
  `askPermission` with `{ sessionId: 'held', input: null }`; `chat.calls[0]` equals
  `{ tool_name: 'Bash', input: null, tool_use_id: 'use-1' }`. `askPermission defaults input when the args leave it
  out` — run with `{ sessionId: 'held' }`; `chat.calls[0]` equals
  `{ tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'use-1' }`.
- `describe('chat main part')` (`Name_Case_Result`): `sessions_SignInRunning_CancelsIt` is replaced by
  `loaded_SignInRunning_CancelsIt` — `invoke('logIn', 1, 'work')`, then `invoke('loaded')`; `cancelLogIn` called once.
  Add `sessions_SignInRunning_LeavesItRunning` — `invoke('logIn', 1, 'work')`, then `invoke('sessions')`;
  `cancelLogIn` not called. `startChatPart`'s `chat` is the real `createChatSessions`, so `sessions` returns `[]`.
- The page send has no page test (chat's page has no `start` test); it is a live check below.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

## Live checks for task 15

- **Low-confidence** (page wiring no test covers): after a drive run's `start` (the page's first load sends
  `loaded`), the run's `app.log` holds no line containing `chat page load not sent:`, so the page reached main's
  `loaded` handler. A real sign-in is not
  started in a drive run, so the cancel itself rests on `loaded_SignInRunning_CancelsIt`.
