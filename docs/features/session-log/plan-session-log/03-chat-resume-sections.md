# 03 — Chat resume sections

Status: in progress
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · test `src/plugins/chat/main/start.test.ts`
Consumes:  `archivedIdsOrNone` and `isOpenOnOtherRow` in `chat-sessions.ts`, both in the tree
Produces:  `ResumeSectionRow`, `ResumeSectionRows`, `ResumeSection` in `src/plugins/chat/contract.ts`, as `plan.md` writes them
           `addResumeSection(section: ResumeSection): Disposable` on `ChatMainExports` in `src/plugins/chat/contract.ts`
           `resumeSections(): Promise<ResumeSectionRows[]>` on `ChatChannel.invoke` in `src/plugins/chat/contract.ts`
           `addResumeSection` and `resumeSections` on `ChatSessions` in `src/plugins/chat/main/chat-sessions.ts`
Decisions: the shape copies `addSendGate` in all its places: contract, `ChatSessions`, a registration set, `consumer.track` in the export · chat passes the provider its resumable rule, so the provider's cap counts only rows that can show

`resumeSections` does this:

1. It reads `archivedIdsOrNone()` once.
2. It builds `isResumable(hostSessionId)`: true when the id is not archived, no held row has that host id, and `isOpenOnOtherRow` is false.
3. It asks each section in registration order, in one `Promise.all`, so the order of the answers holds.
4. A section that rejects, or whose `rows` throws at the call, logs `resume section <title> not read: <error>` and gives no entry. Wrap each call in an async function, so a throw takes this path.
5. A section with no rows gives no entry.

The call never rejects for a section's failure, so the start prompt still opens.

GIVEN one held session, one archived session and one free session WHEN a section's `rows` asks `isResumable` for each THEN only the free session is true
GIVEN a row that `/clear` moved to a new host id WHEN `isResumable` reads the old id THEN it is true
GIVEN two sections, the first rejects WHEN `resumeSections` runs THEN it returns the second, and logs the failure
GIVEN a row just closed whose process has not ended WHEN `isResumable` reads its host id THEN it is false, and it is true after `sessionEnded`
GIVEN a section whose `rows` throws at the call WHEN `resumeSections` runs THEN it returns the others, and logs the failure
GIVEN a section with no rows WHEN `resumeSections` runs THEN it holds no entry for that section
GIVEN a consumer's registrations are disposed WHEN `resumeSections` runs THEN its section is gone
Tests:     add to `chat-sessions.test.ts`: `resumeSections_IsResumable_FollowsHeldArchivedAndOpen` (a table), `resumeSections_SectionFails_KeepsTheOthers` (rows: rejects, throws at the call), `isResumable_JustClosedRowEnding_IsFalseUntilEnded`, `resumeSections_NoRows_LeavesSectionOut`. Add `exports_AddResumeSection_ConsumerDisposed_DropsSection` to `start.test.ts`, as `exports_ConsumerDisposed` does for the send gate.
Done when: compiles; lint passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

