# 01 — Queue a retro at each clear

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/auto-retro/main/retro-queue.ts` · modify `src/plugins/auto-retro/main/start.ts` · test `src/plugins/auto-retro/main/retro-queue.test.ts` · test `src/plugins/auto-retro/main/start.test.ts`
Consumes:  `ChatMainEvents['sessionCleared']` (`profile`, `titles`, `sent`) in `src/plugins/chat/contract.ts` — already in the tree
Produces:  in `src/plugins/auto-retro/main/retro-queue.ts`:
           `| { kind: 'cleared'; oldHostSessionId: string; newHostSessionId: string; profile: string; titles: SessionTitles; sent: boolean }` in `QueueEvent`
           `RetroQueue` with the fields `queued`, `running`, `launched` only (`cleared` deleted)
Decisions: see plan.md § Design Overview — one item per ended conversation; `cleared` map deleted with no migration; one retro-row check for both events

Changes:

- `afterClose` — now: queues `[...earlierIds, host]`. After: queues `[host]`. The retro-row branch (host in `launched`)
  stays as it is, less the `cleared` bookkeeping.
- `afterClear` — now: for a row not in `launched`, moves the old id into `cleared[newHost]`. After: when the old id is in
  `launched`, remap as today. Else, when `sent` is true and `titles.firstMessage` does not open with
  `` `${RETRO_COMMAND} ` ``, append `{ hostIds: [oldHostSessionId], profile, title }` to `queued` (title: the
  `editableTitle` rule `afterClose` uses, `''` → null). Else return the queue unchanged.
- Move the first-message check and the item build into helpers that `afterClose` and `afterClear` both call.
- Delete `cleared` from `RetroQueue`, `EMPTY_QUEUE`, `isClearedIds`, and `isRetroQueue`.
- `start.ts` — the `chat.sessionCleared` listener passes `profile`, `titles` and `sent` from the event. The
  `queued retro of <host ids> (<n> queued)` log line fires for a clear that queues an item, as it does for a close: move
  the log out of `closed` so both paths reach it.

GIVEN a row that is not a retro row WHEN a clear arrives with `sent` true THEN `queued` gains `{ hostIds: [old id], profile, title }`
GIVEN a row that is not a retro row WHEN a clear arrives with `sent` false THEN `queued` does not change
GIVEN a row whose first message opens with `/wigley:retro auto ` WHEN a clear arrives with `sent` true THEN `queued` does not change
GIVEN a retro row in `launched` WHEN a clear arrives THEN `launched` and `running.hostSessionId` take the new id, and `queued` does not change
GIVEN a row cleared twice with `sent` true, then closed with `sent` true WHEN the events apply THEN `queued` holds three items, `[h0]`, `[h1]`, `[h2]`, in that order

Tests:

- `retro-queue.test.ts`, `nextQueue` table — the `cleared(old, new)` helper takes `sent` (default true) and `titles`
  (default `TITLES`) and builds the full event. Add one row per GIVEN above. Rewrite the row that expects
  `cleared('h0','h1'), cleared('h1','h2'), closed('h2')` to queue three items. Delete the rows "a close drops the row's
  cleared ids" and the row whose start is `queueOf({ cleared: { r1: ['r0'] } })`; remove `cleared` from every `queueOf`
  and expected queue.
- `retro-queue.test.ts`, `parseQueue` — the good-text fixture drops `cleared`. Add a case: text that still holds a
  `cleared` key parses to the queue without it being read (the old file shape loads).
- `start.test.ts` — replace `sessionCleared_ThenClose_LaunchesWithEveryId` with
  `sessionCleared_SentConversation_LaunchesItsRetroAtTheClear`: emit `chat.sessionCleared` (`h0` → `h1`, `sent` true),
  and expect `part.texts()` to equal `['/wigley:retro auto h0']` with no close emitted. Add
  `sessionCleared_UnsentConversation_LaunchesNothing`: the same event with `sent` false, `part.texts()` equal to `[]`.

Done when: `npm test -- src/plugins/auto-retro` passes; `npm run lint` passes; `grep -rn "cleared" src/plugins/auto-retro`
shows no use of a `cleared` map.
Commit:    one commit for the group

## Proof

