# 07 — Chat self-test steps

Status: not started
Type: Task
Wave: 6 · Depends on: 05, 06
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/chat/main/start.ts` (the deps it
           hands `chatSelfTestScript`)
Consumes:  `ChatSessions.sessions()`, `.setArchived(hostSessionId, archived)` ← 04 (with plan A's `.start`, `.closed`,
           `.permissionToolSession`) · `FAKE_PAST_SESSIONS`, `FakeAgentHarness.pastSessionCalls` ← 03 · the page
           lines of 05 (`picker shown: Session`, `archived <title>`, `archived sessions shown`, `restored <title>`,
           `archived sessions hidden`) and 06 (`completions offered: <words>`, `completion accepted: /<word>`) ·
           from plan A, in the tree once it landed (its task 11): `chatSelfTestScript(deps)`, `ChatSelfTestDeps`,
           `SELFTEST_PROJECT_DIR` (`'/selftest/chat-selftest'`), its fixture, its 21 steps and `problems`; plan A's
           page lines `picker shown: Folder`, `picker shown: Profile`, `Chat tab shown in <name>`, `result entry added
           in <name>`, `left the box`, `session closed: <name>` (its tasks 09, 10); `isFakeAgentHarness`,
           `FakeAgentProcessRecord`, `FakeAgentCall` (`src/shared/fake-agent-harness.ts`, its task 05)
Produces:  `ChatSelfTestDeps.chat` widened to `Pick<ChatSessions, 'start' | 'closed' | 'permissionToolSession' |
           'sessions' | 'setArchived'>`; steps 22–34 below appended to plan A's 21; the `problems` lines below
Decisions: the new steps run after plan A's step 21 (the fixture session closed), so plan A's checks of the fixture's
           process calls stay as they are · **fixture** additions, so a reload mid-run starts clean: `open(run)` first
           calls `chat.closed(id)` for every held state whose `projectDir` is `SELFTEST_PROJECT_DIR` (this replaces
           plan A's close of the earlier run's one id, and covers a resumed session left open), and starts
           `chat.setArchived(id, false)` for both `FAKE_PAST_SESSIONS` ids, their rejections kept for `problems` ·
           **record lookup**: plan A's "last record for `SELFTEST_PROJECT_DIR`" becomes the last such record whose
           `request.resume` is false (the fixture's); the resumed record is the last whose `request.resume` is true;
           `problems` reads both from the fake's `processes` when it runs, since resume happens after the result
           promise settles · at step 22 the recent folders hold `SELFTEST_PROJECT_DIR` (the fixture's `start`
           recorded it), the profiles are the defaults with `work` pre-selected, and the fake lists both
           `FAKE_PAST_SESSIONS`, none open and none archived · typed text holds no `j` (the insert remap `jk`), as
           plan A's steps
GIVEN `npm run selftest` with every earlier task landed WHEN chat's script runs THEN plan A's 21 steps pass and then, each
      line under `[chat]`:

      | # | Keys | Expect | Fit |
      |---|---|---|---|
      | 22 | `' '` `k` `n` | `[chat] picker shown: Folder` | |
      | 23 | `Enter` | `[chat] picker shown: Profile` | |
      | 24 | `Enter` | `[chat] picker shown: Session` | yes |
      | 25 | `j` `x` | `[chat] archived fake past session one` | |
      | 26 | `.` | `[chat] archived sessions shown` | yes |
      | 27 | `k` `x` | `[chat] restored fake past session one` | |
      | 28 | `.` | `[chat] archived sessions hidden` | |
      | 29 | `Enter` | `[chat] Chat tab shown in chat-selftest` | yes |
      | 30 | `/` `f` `a` | `[chat] completions offered: /fake-command` | |
      | 31 | `Tab` | `[chat] completion accepted: /fake-command` | |
      | 32 | `Escape` `Enter` | `[chat] result entry added in chat-selftest` | |
      | 33 | `Escape` | `[chat] left the box` | |
      | 34 | `<D-w>` | `[chat] session closed: chat-selftest` | |

      What each proves: 22–24 — the session step follows folder and profile; 25 — `x` archives the entry under the
      cursor and the hidden list drops it; 26 — `.` shows it again, marked archived (the cursor stays on session two,
      the item after it); 27 — `k` reaches it and `x` restores it; 28 — `.` hides archived entries again; 29 — Enter
      resumes session one and its Chat tab shows with the fake's history; 30 — `/` at the box's start offers the
      fake's `fake-command`, filtered by `fa`; 31 — Tab accepts in insert mode; 32 — the accepted text sends; 34 —
      the idle resumed session closes without the confirm
GIVEN the run above WHEN `problems(result)` runs THEN plan A's lines plus, each when wrong:
      `archive reset failed: <errorText>` for a rejected fixture `setArchived`;
      `no resumed fake process` when no record has `request.resume` true;
      `resumed request <JSON>` unless the resumed record's `request.sessionId` is
      `00000000-0000-4000-8000-000000000001`, `resume` true and `projectDir` `SELFTEST_PROJECT_DIR`;
      `resumed calls <JSON>` unless its calls equal, in order, send `/fake-command ` then end (compared as
      `JSON.stringify` of `FakeAgentCall` values built in the script, as plan A's check);
      `past session calls <JSON>` unless `pastSessionCalls` holds a `listSessions` with `projectDir`
      `SELFTEST_PROJECT_DIR` and a `history` with `sessionId` `00000000-0000-4000-8000-000000000001` and that
      `projectDir`
      — and the driver prints `[selftest] PASS chat result as expected`
Tests:     `npm run selftest` — steps 22–34 and the `problems` lines above (the self-test is the claim; no unit test
           restates the script)
Done when: the typecheck and `npm run lint` pass; `npm run selftest` passes forms' and chat's scripts, all 34 chat steps
Commit:    one commit for the group

## Proof
