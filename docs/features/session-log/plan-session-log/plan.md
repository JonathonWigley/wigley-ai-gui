# Session log and Recently closed — plan

Feature: Session log · Implements: none · Ticket: none
Target: main · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every session lifecycle change fires an event and writes a line to a log. The start prompt shows a Recently closed
section, so the user can reopen a closed session in few keys.

## Architecture

Systems touched:

- `sessions` plugin: the `connected` event says if chat owns the session. `editableTitle` moves to its contract.
- `chat` plugin main: new lifecycle events, `addResumeSection`, the `resumeSections` channel call.
- `src/shared/page/list-picker`: headings the cursor skips.
- `chat` plugin page: the `pickerHeading` layout part, the section row, the start prompt.
- `session-log`: a new main-only plugin. It hears the events, appends the log and registers the section.

## Preconditions

Run each command from the repo root. Each passed at plan time on `abe4d1d6`.

| Claim | Command | Expected |
|---|---|---|
| `sessions.closed` has only a row id | `grep -n "closed: { sessionId: string }" src/plugins/sessions/contract.ts` | one match |
| `sessionOpened` has no origin | `grep -n "sessionOpened: { sessionId: string; profileDir: string }" src/plugins/chat/contract.ts` | one match |
| The row primitive takes a detail | `grep -n "detail?: string" src/shared/page/ui/row.ts` | one match |
| The kit has a section header | `grep -n "sectionHeader: (parent, text)" src/shared/page/layout-host/base-kit.ts` | one match |
| `Files.append` is not atomic | `grep -n "Not atomic" src/contracts/files.ts` | one match |
| No plugin folder is named `session-log` | `test ! -e src/plugins/session-log` | exit 0 |

## Docs written ahead

Commit `e8aa534b`:

- `docs/features/session-log/design.md`
- `AGENTS.md` (the plugin list and the chat export line)
- `docs/features/agent-chat/design.md` (the Flow diagram)

The plan's own commit also holds: `AGENTS.md` (the `pickerHeading` part, the self-test list), `docs/features/agent-chat/design.md` (the part list, § Resume and archive), and `docs/features/session-log/design.md` (the row order).

## Mandatory Reads

- `AGENTS.md`: § Architecture (a plugin, a registration, a send gate, an event, a setting, plugin data, a layout, a
  chat layout) and § Running and testing
- `DESIGN.md`: for tasks 04 and 05
- `docs/features/session-log/design.md`

## Design Overview

```
 chat main ──────── sessionOpened / sessionClosed / sessionCleared / processEnded / sessionArchived ─┐
 sessions main ──── connected (owned flag) / ended ─────────────────────────────────────────────────┤
                                                                                                    ▼
                                                             session-log main ─► session-events.jsonl
                                                                    │ addResumeSection                │ read
                                                                    ▼                                 │
 Space k n ─► page start prompt ─ resumeSections ─► chat main ─ rows(isResumable) ─► recently closed ◄┘
                    │
                    ├─ Folder step:  [Recently closed] [Folders]; cursor on the first folder; pick ─► sign-in check ─► resume
                    └─ Session step: [Recently closed] [Sessions]; cursor on New session; filtered to folder and profile
```

Decisions:

- A quit or relaunch is never a close. `session-log` stops before chat, and chat's stop does not run `closed`.
- Chat knows no log exists. Chat knows only titled sections. The words "Recently closed" exist only in `session-log`.
- Chat owns "is it resumable": not held, not open on another row, not archived. `session-log` owns "was it closed".
- With no section rows, each step looks as it does today, with no headings.
- A section row on the Session step needs a matching row from `pastSessions`. A session with no transcript drops out
  there. The Folder step does not list transcripts, so a pick there can fail with the existing resume toast.
- A restored row whose profile is missing fires no `sessionOpened` today, and stays so. It has no process to log.
- A section lists its newest row last, next to the cursor, so `k` then Enter reopens the session closed last. The cap still keeps the newest rows.
- A session stays out of a section until its process has ended. `pastSessions` has the same wait today, and it lasts as long as `process.end()`.
- A section whose `rows` never settles holds the start prompt. The only provider reads one local file, so no timeout is added.

Out of scope:

- A log viewer. A later plugin can hear the same events.
- A key that reopens the last closed session.
- A sign-in check on chat's existing resume path, which already runs it before the Session step.
- Idle expiry as a process-ended reason. The code cannot tell it apart.

## File Structure

New files, with why each is needed:

- `src/plugins/session-log/manifest.ts`: the plugin, its dependencies and its setting
- `src/plugins/session-log/main/start.ts`: the part: hears events, registers the section, hands the self-test script
- `src/plugins/session-log/main/session-event-log.ts`: the log file: ordered appends and a tolerant read
- `src/plugins/session-log/main/recently-closed.ts`: the pure fold from log entries to section rows
- `src/plugins/session-log/main/selftest-script.ts`: the self-test group

Names more than one task uses, all in `src/plugins/chat/contract.ts` unless named otherwise:

```ts
export type SessionOrigin = 'new' | 'resumed' | 'launched' | 'restored';
export type SessionCloseReason = 'user' | 'start-failed' | 'project-closed';
export type ProcessEndReason = 'stopped' | 'clean' | 'crash';

// ChatMainEvents members
sessionOpened: { sessionId: string; profileDir: string; hostSessionId: string; projectDir: string; profile: string; origin: SessionOrigin };
sessionClosed: { sessionId: string; hostSessionId: string; projectDir: string; profile: string; titles: SessionTitles; sent: boolean; reason: SessionCloseReason };
sessionCleared: { sessionId: string; oldHostSessionId: string; newHostSessionId: string; projectDir: string; profile: string; titles: SessionTitles; sent: boolean };
processEnded: { sessionId: string; hostSessionId: string; reason: ProcessEndReason; code: number | null; error: string | null };
sessionArchived: { hostSessionId: string; archived: boolean };

export interface ResumeSectionRow { hostSessionId: string; projectDir: string; profile: string; title: string; at: number }
export interface ResumeSectionRows { title: string; rows: ResumeSectionRow[] }
// `rows` is in list order: the last row sits next to the cursor.
export interface ResumeSection { title: string; rows(isResumable: (hostSessionId: string) => boolean): Promise<ResumeSectionRow[]> }
```

Boundary rules:

- `session-log` imports only `chat/contract.ts`, `sessions/contract.ts`, `src/contracts` and `src/shared`.
- Only tasks 02 and 03 edit `chat-sessions.ts`, `chat/main/start.ts` and `chat/contract.ts`.
- Each task's code stands without a live app. Only task 10 starts the app.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Sessions: the owned flag and the title rule](01-sessions-owned-and-title.md)
- [x] [List picker headings](04-list-picker-headings.md)

### Wave 2
- [x] [Chat lifecycle events](02-chat-lifecycle-events.md) — after 01
- [x] [Chat heading part and section row input](05-chat-heading-part.md) — after 04

### Wave 3
- [ ] [Chat resume sections](03-chat-resume-sections.md) — after 02

### Wave 4
- [ ] [Start prompt sections](06-start-prompt-sections.md) — after 03, 05
- [ ] [The session-log plugin](07-session-log-plugin.md) — after 01, 02, 03

### Wave 5
- [ ] [Self-test group](08-selftest-group.md) — after 06, 07

### Wave 6
- [ ] [Final verification](10-final-verification.md) — after 08

### Wave 7
- [ ] [Doc re-read](09-doc-re-read.md) — after 10

## Run log

Review base: c185a42b7f2b01809184af8d5e2e5748ee0077f2

### Groups
- 01 · 2ca6ca8b · diff read; typecheck and lint pass · concerns: Files line named primer, forms and sessions start.test.ts as connected emitters, but they emit none and stayed unedited; connected payload is now a shallow copy, its listeners read only id and info; connected_ConnectAndOpen_SayIfOwned overlaps three existing connected assertions
- 04 · e6b8a22f · diff read; typecheck and lint pass · concerns: scrollToCursor scrolls to the row only, so moving up to a section's first row in a scrolled list can leave its heading just out of view; check in the drive run
- 05 · 27b4edd7 · diff read; scoped typecheck clean; layout and layout-contract tests pass · concerns: picker wiring of section and drawHeading has no test, by the task's decision, so drive check 1 of task 10 proves it; the h3 inside the heading li has not been seen on screen; the comment on PickerItemInput rests on task 06's plan text
- 02 · 8233a622 · diff read; typecheck and lint pass · concerns: a restored row with a missing profile fires sessionClosed with no sessionOpened, so task 07 must not assume they pair; the isLive guard means a closed or cleared row's old process and a failed attach fire no processEnded, as specified; stop_HeldRows_FiresNoSessionClosed does not exercise the plugin host's stop order; docs/features/usage/design.md:90 draws sessionOpened with its old fields
### Contract changes
- pickerHeading input: inline { title: string } → named PickerHeadingInput, with PickerHeadingKit = BaseKit · why: the file names each part's input · consumers: none need a change · group 05
### Rulings
- Fixtures where the compiler does not force owned set it false — they stand for relay connects — no listener reads it yet · group 01 · group 01
- drawHeading appends its own root to the li and the picker uses only dispose, as drawRow does — the task names DrawnPickerRow — task 05 must append, or its heading draws nothing · group 04 · group 04
- Heading height is --wg-row-tree with section header type and .ui-row inline padding — the plan named no size — a one-line CSS change if wrong · group 04 · group 04
- Added section headings to chat's surface list in docs/features/layouts/design.md, outside the Files line — the row lists every chat surface — one phrase to revert · group 05 · group 05
- The new-row GIVEN adds no test — pickerRow_Default_PlacesCursorEnd already asserts that row's options — undefined detail is not told apart from missing, which row treats the same · group 05 · group 05
- closeEarlierSessions in chat's self-test passes project-closed — it clears a self-test project and no user closed anything — one word if wrong · group 02 · group 02
- processEnded fires last in the ended callback, after save — the row's state is settled for a listener — no consumer reads the row during it · group 02 · group 02
### Review rounds
### Test gate
