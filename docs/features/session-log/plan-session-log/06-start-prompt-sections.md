# 06 — Start prompt sections

Status: not started
Type: Task
Wave: 4 · Depends on: 03, 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/start-prompt.ts` · modify `src/plugins/chat/page/start-prompt-items.ts` · modify `src/plugins/chat/page/resume-items.ts` · modify `src/plugins/chat/page/picker-row.ts` · test `src/plugins/chat/page/start-prompt.test.ts` · test `src/plugins/chat/page/start-prompt-items.test.ts` · test `src/plugins/chat/page/resume-items.test.ts` · test `src/plugins/chat/page/picker-row.test.ts`
Consumes:  `resumeSections` on `ChatChannel.invoke`, `ResumeSectionRows`, `ResumeSectionRow` ← 03
           `section` on `PickerRequest`, the `section` `PickerItemInput` member ← 05
Produces:  `export const FOLDERS_HEADING = 'Folders'` in `src/plugins/chat/page/start-prompt-items.ts`
           `export const SESSIONS_HEADING = 'Sessions'` in `src/plugins/chat/page/resume-items.ts`
           `FolderItem` member `{ kind: 'section'; section: string; row: ResumeSectionRow; label: string }` in `src/plugins/chat/page/start-prompt-items.ts`
           `SessionItem` member `{ kind: 'section'; section: string; row: PastSessionRow; closed: ResumeSectionRow; label: string }` in `src/plugins/chat/page/resume-items.ts`
Decisions: the cursor keeps today's start (the user's choice) · each session shows once on each step (the user's choice) · `Ctrl+N` asks for no sections · a folder rank beats a section row, so a folder's filter habit holds

**Opening.** `openPrompt` invokes `resumeSections` only when `offersSavedSessions` is true. It waits for both answers. A rejected `resumeSections` logs `resume sections not read: <error>` and uses `[]`, and the prompt opens. `PromptContext` gains `sections: readonly ResumeSectionRows[]`. For each non-empty section it logs `resume section <title>: <n> rows`. Self-test task 08 waits on this line, so the wording is pinned.

**Folder step.**

- The signature is `folderItems(recent, sections, homeDir, paths)`. Items are each section's rows in the order given, then the recent folders, then the choose line.
- When two sections hold one host id, the first section keeps it.
- The label is `<title> · <folder base> · <profile> · <sessionTime(at)>`.
- `folderName` returns `''` for a section row. `name` is the filter's first tier, so a section row can match only on its label.
- `section` returns the row's section title for a section row, and `FOLDERS_HEADING` for the rest. When the step shows no section rows it returns null for every row.
- `selected` is the number of section rows it shows, the index of the first folder.
- The row input is `{ list: 'folder', kind: 'section', title, detail: '<folder base> · <profile> · <sessionTime(at)>', at }`.

**A Folder step pick.**

- With the row's profile in `context.profiles`, it runs `checkAccount` and then resumes.
- With a missing profile, it invokes `resume` directly. Main's rejection shows the existing `Session not resumed: …` toast.
- `checkAccount(context, profile, goOn)` takes `goOn` as a parameter. The profile step passes today's choice. Its other behaviour stays.
- `resumeSession` changes to take `(context, projectDir, profileName, hostSessionId, title)`.

**Session step.**

- The signature is `sessionItems(rows, sections, step, paths, showArchived)`. `step` is `{ projectDir: string; profile: string }`. It builds: section rows in the order given, then the New session line, then the past rows.
- A section row shows when the row's `projectDir` is the same path as the step's folder, by `paths.samePath`; its `profile` equals the step's; and `rows` holds a row with its host id with `archived` false.
- When two sections hold one session, the first section keeps it.
- A past row whose id shows in a section leaves the past rows.
- The label is `<title> · <sessionTime(at)>`.
- The row input is `{ list: 'session', kind: 'section', title, detail: sessionTime(at), at }`.
- `section` returns the section title, and `SESSIONS_HEADING` for the rest. When the step shows no section rows it returns null for every row, so a lone New session line has no heading.
- `selected` is the index of the New session line.
- `archiveStateOf` returns `live` for a section row.
- `selectedAfterChange` keeps its rule and reads each line by identity: a past or section row is its host id, in either kind, and the New session line is itself. It scans `before` from the cursor and returns the index in `after` of the first line `after` holds, else the last line. So with [S1, New, P1], archiving S1 moves the cursor to New. A cursor on the New session line stays on it.
- A section row's pick resumes with `closed.title`.
- With no rows from `pastSessions`, the prompt still starts a new session, as today.

GIVEN two closed sessions WHEN `Space k n` opens THEN the Folder step lists them under a heading, then the folders, and the cursor is on the first folder
GIVEN no section rows WHEN either step opens THEN its items and `selected` are as today, and `section` returns null
GIVEN `openForNewSession` WHEN it opens THEN `resumeSections` is not invoked
GIVEN `resumeSections` rejects WHEN `Space k n` opens THEN the Folder step opens with its folders
GIVEN a section row in the chosen folder and profile WHEN the Session step opens THEN it shows above New session, the cursor is on New session, and the session is absent from the rows below
GIVEN a section row of another folder, another profile, or with no row from `pastSessions` WHEN the Session step opens THEN it does not show
GIVEN the cursor on a section row WHEN `x` archives it and archived rows are hidden THEN the row leaves the section and the cursor moves to the next row
GIVEN a signed-out profile WHEN a Folder step section row is picked THEN the sign-in dialog opens, and the resume runs only once it finishes signed in
GIVEN a missing profile WHEN a Folder step section row is picked THEN `resume` is invoked and its rejection toasts
GIVEN a folder named `ai-dev` and a section row whose folder is `ai-dev` WHEN `ai-dev` is typed THEN the folder ranks first, as the `name` tier decides
GIVEN two sections that hold one session WHEN the Folder step opens THEN the session lists once, under the first section
Tests:     add to `start-prompt.test.ts`: `open_Sections_ListsThemAndKeepsCursorOnFirstFolder`, `openForNewSession_AsksForNoSections`, `open_SectionsReject_StillOpens`, `pick_SectionRow_SignedOut_SignsInThenResumes`, `pick_SectionRow_MissingProfile_ToastsRejection`, `sessionStep_SectionRow_ResumesWithItsTitle`. Add `resumeSections` to the test's `Answers`. Add to `resume-items.test.ts`: a table `sessionItems_SectionRows_ShowOnlyMatchingAndOnce`, `selectedAfterChange_ArchivedSectionRow_MovesToNextRow` (rows: [S1, New, P1] with S1 gone gives New's index; [New, S1 as last line] gives the last line), `selectedAfterChange_OnNewLine_StaysOnNewLine`. Add to `start-prompt-items.test.ts`: `folderItems_Sections_ComeFirstAndOnce`, `folderName_SectionRow_IsEmpty`. Add a row to the `picker-row.test.ts` table for each list's section row. The real matcher decides the name tier: add `rank_EmptyNameTier_FolderRanksFirstThenLabel` to `src/renderer/fzf/fzf-matcher.test.ts`. Its rows are `section` with tiers `[[''], ['Fix login · ai-dev · work · 2026-01-02 10:00']]` and `folder` with tiers `[['ai-dev'], ['~/ai-dev']]`. Query `ai-dev` gives `['folder', 'section']`. Query `login` gives `['section']`.
Done when: compiles; lint passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

