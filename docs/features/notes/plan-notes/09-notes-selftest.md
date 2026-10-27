# 09 — Notes self-test

Status: done
Type: Task
Wave: 5 · Depends on: 08
Plan: [plan.md](plan.md)

**Contents**

- **Fields** — files, interfaces, decisions, tests.
- **Fixture** — the session, the features home, the reset at each run.
- **Groups** — each group's keys, lines and `why`.
- **Result** — what the script reads once the steps end, and each problem it reports.
- **Drive actions** — the notes actions a drive run (task 11) uses.

This task adds the notes plugin's self-test script, so every key path the popup offers runs in `npm run selftest`,
and the drive actions task 11 needs. A key behaviour the agent adds gets a step in its plugin's script (AGENTS.md §
Running and testing).

Files:     create `src/plugins/notes/main/selftest-script.ts` · create `src/plugins/notes/main/drive-actions.ts` ·
           modify `src/plugins/notes/main/start.ts` (hand the script to `services.selfTest?.run`, add the drive
           actions when `api.drive` is non-null and dispose them in `dispose`, as `src/plugins/docs/main/start.ts`
           does; add the send signal below)
Consumes:  `notesMainPart`, `DraftStore` (`draft`, `clear`) ← 07 · every `[notes] …` log line and key in task 08 §
           Keys and § Log lines ← 08 · `ChatMainExports.launch` and its log line `[chat] launched session
           <sessionId> in <projectDir>` ← 04 · existing: `SelfTestScript`, `SelfTestGroup`, `SelfTestStep`,
           `DriveHost`, `DriveAction` (`src/contracts/plugin.ts`), `SessionsMainExports.connect`, `activate`,
           `ConnectedSession` (`src/plugins/sessions/contract.ts`), `isFakeAgentHarness`, `FakeAgentProcessRecord`
           (`src/shared/fake-agent-harness.ts`), `argsObject` (`src/shared/drive-args.ts`), docs' self-test fixture
           (`src/plugins/docs/main/selftest-fixture.ts`: the folder `<home>/dev/selftest-repo` and the list-shaped
           home `<home>/wigley-features/selftest-repo/followups.md`, which the docs index lists under repo
           `selftest-repo`)
Produces:  `export function notesSelfTestScript(deps: NotesSelfTestDeps): SelfTestScript` in `selftest-script.ts`;
           `NotesSelfTestDeps` holds `homeDir: string`, `files: Pick<Files, 'read' | 'realPath' | 'makeFolder'>`,
           `sessions: Pick<SessionsMainExports, 'connect' | 'activate'>`, `harnesses: readonly AgentHarness[]`,
           `store: Pick<DraftStore, 'clear'>`, `nextSessionSend(): Promise<void>`
           `export function addDriveActions(drive: DriveHost, deps: { store: Pick<DraftStore, 'draft' | 'clear'>;
           data: Pick<Files, 'list'> }): Disposable` in `drive-actions.ts`
Decisions: the script sends into docs' fixture home `~/wigley-features/selftest-repo` in the self-test's temp home,
           which docs' fixture writes and indexes at each script run, so notes writes no index entry and never
           reaches the user's home (agent, plan time) · the script asserts only on the follow-up it writes itself,
           since docs' and Backlog's steps run first and change that file (agent, plan time) · each run clears the
           draft first, so a run a reload restarted begins from a fresh draft (agent, plan time) · the fixture
           session's host id is the fixed `notes-selftest`, so the static step lines name it; each run ends the last
           run's connection before it connects again (agent, plan time) · the self-test cannot reload the page (a
           reload ends the run), so it proves the draft kept across close and reopen, which reads the draft back from
           main as a reload does; the reload itself goes to task 11's drive run, through `restart` (agent, plan time)
           · paste, drop and drawn markup take mouse or clipboard input a self-test step cannot give; they go to task
           11 (agent, plan time)
Done when: `npm run lint` and `npm run typecheck` pass. Task 11 (Final verification) runs `npm run selftest`, which
           runs this script.
Commit:    one commit for the group

## Fixture

`open(run)`:

1. End the connection the last run made, if any.
2. `store.clear()`, so the run starts from a fresh draft.
3. The folder: `<files.realPath(homeDir)>/dev/selftest-repo`; `makeFolder` it (docs' fixture makes it first; this
   only guards the order).
4. `sessions.connect({ sessionId: 'notes-selftest', projectDir: <the folder>, deadlineSeconds: null, harness:
   'claude' })`, then `sessions.activate` its row, so the popup attaches it.
5. Mark the fake harness's process count, as chat's script marks its run (`markRun`), so the result reads only this
   run's processes.
6. Return `shownLine: '[notes] session notes-selftest listed'` and the result (§ Result).

The send signal in `start.ts`: `nextSessionSend()` returns a promise that resolves at the next `sendToSession` call
whose result is `sent`. Hold the waiting resolvers in a list the channel handler empties after each `sent`.

## Groups

`pageBinds` none; `settings` none; `scrollsItself` none, unless the fit check flags the image strip, which then goes
in. The `fresh` popup line is `[notes] popup shown: title "", 0 images, target selftest-repo, session notes-selftest`
(`FRESH_LINE` below). Keys are written as the other scripts write them (`' '` for Space, `Escape`, `Enter`, single
characters). Each step's `expect` is the last line its keys cause.

1. **open** — why: `Space n n` opens the popup over the current mode, attaches the selected session, and defaults the
   target to that session's repo by its folder name.
   - `[' ', 'n', 'n']` → `FRESH_LINE`; screenshot `popup`; `checksFit: true`.
   - `[...'The save hint sits low. It overlaps the bar.', 'Escape', 'Escape']` → `[notes] field body`.
   - `['k']` → `[notes] field title`.
   - `['i', ...'Notes selftest nit', 'Escape']` → `[notes] field title`.
   - `[]` → `[notes] draft saved`.
2. **kept on close** — why: closing keeps the draft, and the reopened popup reads it back from main, the read a page
   reload makes.
   - `['Escape']` → `[notes] popup closed`.
   - `[' ', 'n', 'n']` → `[notes] popup shown: title "Notes selftest nit", 0 images, target selftest-repo, session
     notes-selftest`.
3. **capture and markup** — why: a capture attaches a PNG of the window, and the markup view opens on it with its
   tool and colour keys.
   - `['Escape', ' ', 'n', 'c']` → `[notes] image 1 attached (capture)`; screenshot `popup-image`.
   - `['Enter']` → `[notes] markup shown for image 1`.
   - `['t']` → `[notes] tool text`; `['c']` → `[notes] colour yellow`; screenshot `markup`.
   - `['Escape']` → `[notes] markup closed for image 1`.
4. **new follow-up** — why: `Cmd+Enter` files the note as a new follow-up in the target home, with its image and
   session line, and clears the draft.
   - `['<D-Enter>']` → `[notes] sent: Follow-up added: Notes selftest nit`.
5. **append** — why: the append picker lists the target home's open follow-ups, and the chosen one gets the note at
   its end.
   - `[' ', 'n', 'n']` → `FRESH_LINE`.
   - `[...'Also the border.', 'Escape', ' ', 'n', 'a']` → `[notes] picker shown: Follow-up`.
   - `['/', ...'Notes selftest', 'Enter']` → `[notes] sent: Added to Notes selftest nit`.
6. **new session** — why: `Space n s` starts a background session in the target's folder, its first message the brief,
   the note and the session line, and leaves the selected row as it was.
   - `[' ', 'n', 'n']` → `FRESH_LINE`.
   - `[...'Launch me.', 'Escape', ' ', 'n', 's']` → `[notes] sent: Session started in ~/dev/selftest-repo`.
7. **discard** — why: discard asks first, then drops the draft and keeps the popup open.
   - `[' ', 'n', 'n']` → `FRESH_LINE`.
   - `[...'Throw this away', 'Escape', ' ', 'n', 'd']` → `[notes] discard asked`.
   - `['y']` → `[notes] draft discarded`.
   - `['Escape']` → `[notes] popup closed`.

Group 6's folder: `selftest-repo`'s home sits outside any clone (`folder` null), so `launchFolder` takes the attached
session's folder. That proves task 06's rule 3 and the launch folder rule in the running app.

## Result

`result`: await `nextSessionSend()`, then read the home's `followups.md` and find the first fake process started
after the mark whose `request.projectDir` is the fixture folder. Resolve to `{ followups: string; send: { text:
string; imageCount: number } | null }`, `send` being that process's first `send` call.

`problems(result)` lists each that fails, empty when none:

- `followups` holds `**Notes selftest nit**`, else `follow-up "Notes selftest nit" missing`.
- it holds `The save hint sits low.` and `It overlaps the bar.`, else `note body missing`.
- it holds `Source session: Claude Code notes-selftest in ~/dev/selftest-repo` twice (the create and the append),
  else `session line count <n>, expected 2`.
- it holds `followups-images/` before `Also the border.`, else `image link missing or after the appended text`.
- it holds `Also the border.`, else `appended text missing`.
- `send` is non-null, else `no session launched in <folder>`.
- `send.text` starts with `A nitpick to fix, noted while working. Make the change, then report.`, holds `Launch me.`
  and the session line, else `launched message <text>`.
- `send.imageCount` is 0, else `launched message carries <n> images`.

## Drive actions

`addDriveActions(drive, deps)` adds two actions, each removed by the returned `Disposable`:

- `notes.draft` — description `Returns the kept note draft and every file in notes' data folder, for checking what the
  popup saved.`; args `{}`; returns `{ draft: NoteDraft, files: string[] }`, the files from a recursive `data.list` of the data folder's root, folders
  left out, sorted.
- `notes.discard` — description `Clears the kept note draft and removes its images, as a sent note does, so a drive
  check starts fresh.`; args `{}`; returns `{ draft: NoteDraft }` from `store.clear()`.

A drive run gets its session and features home from docs' own actions: `docs.seed`, then `docs.connectSession`, whose
session sits in `<home>/dev/selftest-repo` with harness `claude` and host id `drive-docs-<n>`. Task 11 names that
order.

## Proof

Commit 43fbe28 · proof: diff read: notesSelfTestScript, addDriveActions present; start.ts hands the script to selfTest.run, adds drive actions in drive runs and disposes them, send waiters resolve on sent; typecheck clean · concerns: send signal in start.ts has no unit test; group 5 picks the follow-up by fuzzy filter Notes selftest, which a higher-ranked open follow-up from docs or Backlog steps could beat; local markRun copy of chat script helper
