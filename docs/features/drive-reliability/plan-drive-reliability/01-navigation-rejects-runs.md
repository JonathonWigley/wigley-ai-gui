# 01 — A script call rejects when the page navigates under it; each wait check is capped

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/main/drive/driven-window.ts` · modify `src/main/electron-driven-window.ts` ·
           modify `src/main/drive/fake-driven-window.ts` · modify `src/main/drive/page-driver.ts` ·
           test `src/main/drive/page-driver.test.ts`
Consumes:  `DrivenWindow` in `src/main/drive/driven-window.ts` (tree); `waitFor`, `holdsBefore` in
           `src/main/drive/page-driver.ts` (tree)
Produces:  `export class PageNavigatedError extends Error` in `src/main/drive/driven-window.ts`
           `const CHECK_TIMEOUT_MS = 2000` in `src/main/drive/page-driver.ts`
Decisions: the rejection lives in the one Electron adapter, documented on `DrivenWindow.run` as its error mode
           (round 2, design review: depth, locality) · each wait check capped at 2 s (round 2) · the fake mirrors
           the adapter so the drive tests reach the new error (design review)

## Behaviour

- `DrivenWindow.run`'s comment gains its error mode: it rejects with `PageNavigatedError` when the page's main frame
  commits a navigation, or its renderer goes away, while the script runs. `PageNavigatedError` is
  declared in `driven-window.ts` (no `electron` import there) with the message
  `The page navigated while the script ran`.
- `electronDrivenWindow.run` keeps a set of the pending calls' reject functions; each settled call leaves the set. On
  `did-navigate` (a main-frame commit: the old document, and every call sent to it, is gone) and on
  `render-process-gone`, it rejects every pending call with a `PageNavigatedError` and empties the set. Rejecting at
  commit rather than at `did-start-navigation` keeps a navigation `window.ts` refuses in `will-navigate` from
  rejecting calls on a page that never left. The rejection goes in the adapter's existing `did-navigate` listener,
  after its counting. Check `render-process-gone`'s shape in Electron 44's docs.
- The self-test stands down on the same event: `startSelfTest`'s `did-navigate` listener bumps `latestRun`
  (`src/main/selftest.ts`), and a rejection's `catch` in `startRun` runs in a microtask after every listener of that
  event has returned, so `isCurrent()` is already false there and the run stands down without a FAIL line, as it
  does today. Leave `selftest.ts` unchanged, and confirm the order with `npm run selftest` (forge's startup reload
  lands mid-run on most starts).
- `fakeDrivenWindow`'s `navigate()` also rejects every `run` still pending with a `PageNavigatedError`, as the
  adapter does. A fake answer that returns a promise which never settles models a lost call.
- `page-driver.ts`: `holdsBefore` races each check against `min(deadline, now + CHECK_TIMEOUT_MS)` rather than the
  deadline alone, and a check rejected with `PageNavigatedError` counts as not holding; any other rejection still
  propagates out of `waitFor`. `waitFor`'s comment says both. The check left running after its cap is left running,
  as today.
- `waitForPage` in `drive-commands.ts` already reads every rejection as "not ready yet"; leave it.

GIVEN a check that never settles, then one that holds WHEN `waitFor` runs with a 10 s timeout THEN it returns true
after about `CHECK_TIMEOUT_MS`, not 10 s
GIVEN a check whose `run` is pending WHEN the fake window navigates THEN the run rejects with `PageNavigatedError`
and `waitFor` polls again, returning true once a later check holds
GIVEN a check that rejects with an `Error` that is not `PageNavigatedError` WHEN `waitFor` runs THEN it rejects with
that error

Tests:     in `page-driver.test.ts`, under a `waitFor` describe; new tests in sentence style, the file's existing
           `Name_Case_Result` names stay (renaming them is master-plan step 22):
           - a never-settling first check then a holding one returns true within 3 s (fake timers or a real 2 s wait;
             assert the elapsed time is below the 10 s timeout, not an exact figure)
           - a pending run rejected by `navigate()` is retried and the wait returns true
           - a non-navigation rejection rejects the wait
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and `npm run selftest`
           (no run fails on the startup reload). The live restart loop is task 12's.
Commit:    one commit for the group

## Proof

