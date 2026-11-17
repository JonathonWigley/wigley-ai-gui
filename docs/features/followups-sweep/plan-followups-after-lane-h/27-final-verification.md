# 27 — Final verification

Status: not started
Type: Task
Wave: 8 · Depends on: every group (runs after `wigley:make`'s test gate)
Plan: [plan.md](plan.md)

Files: none (checks only; a fix a check calls for goes back to its group).

Run every check in one live session of the app, driven offscreen through the `drive` project skill
(`.agents/skills/drive/SKILL.md`). Self-test runs are filtered to the plugins named (`npm run selftest -- --plugin
<id> …`), never the whole suite. The user's own app is never touched. Each check names the group whose landing it
proves, and its tag: **expected** (a failure is a bug in the group) or **low-confidence** (the reason is given; a
failure is first re-checked for setup before it is called a bug). A check that needs what this machine cannot give
offscreen (the real Claude CLI's timing, a second profile) is run as far as drive reaches, and the rest is reported as
not reached, with its reason, for the wrap-up.

## Checks

Docs and sessions:

1. **01, tree view place** (expected: a real reload, which the slot round trip in tests does not do). Open Docs with
   two tree views, change each view's expanded groups and selection, reload the page: each view comes back to its own
   place.
2. **01, narrowing** (expected: crosses the shell's narrowing code, which unit tests only fake). Docs mode showing,
   the side bar beside the doc and the filter box open, narrow the window: keys go back to the doc or tree, not the
   hidden filter.
3. **03, first click** (expected: the bug was a real click landing on a replaced element). Two panes; click a tab in
   the unfocused pane once: that tab shows.
4. **03, press on an older selection** (low-confidence: 03's rule assumes Chromium collapses an old selection after
   `mouseup`, which no test proves). In an unfocused pane, select text, then press once on that old selection: keys go
   to the Chat box. A fresh drag-select in a pane still keeps its selection.
5. **05, page model** (expected: the microtask and restore order under a real page load is untested). Split, swap
   and close panes; select rows; reload: the panes and their sessions restore, and the side bar, focus and visible tab
   follow as before.

Chat and the layout host:

6. **06, tall last block** (expected). A session streaming a long reply, the chat cursor parked on a last block taller
   than the view; press `j` / `J`: the view keeps following the stream.
7. **06, hidden tab** (low-confidence: hard to time an overflowing run in a hidden tab). Let a turn end while its chat
   tab is hidden, then show the tab: the cursor is on screen.
8. **07, durations** (expected). The bundled `default` chat layout sets `activityInTranscript: false` and draws no
   step rows, so first add a user layout to the drive run's own home (never the user's `~/.config`):
   `<run>/home/.config/wigley-ai-gui/layouts/chat/steps/layout.js` holding
   `export default { activityInTranscript: true };`, then `setting chat.layout "steps"`. Open an activity line after
   a turn: each tool and thinking row ends with a dim `· Ns`, and the last running step shows none until its next
   entry arrives.
9. **08, bundled fallback** (expected, low risk). A user chat entry layout that lacks a part still draws through the
   bundled default; the primer card falls back the same way.
10. **10, split width** (expected). Drag the split in one docs tab, switch to a second docs tab: it shows the new width
    at once. The same with two primer views, and with the chat hub handle across two session tabs.
11. **10, theme switch** (expected). Switch theme: the side and right bars still reopen at the token width when no
    width is stored.
12. **11, shared tick** (expected, low risk). The chat row clock, agent-strip boxes, workflow countdown and agent-lines
    working line tick each second while shown and stop when nothing runs.

Main, the adapter and drive:

13. **12, page load 1** (expected: the window setup's load order has no unit test). A filtered self-test's first run
    line reads `[selftest] page load 1 starts its run`; a drive run's first `ready` returns `load: 1`.
14. **13, wait-log since** (expected). In a drive run, after start, `wait-log '<a line the page logs at start>'
    '{"since":0,"timeoutMs":2000}'` returns `found: true`; without `since` it returns `found: false`.
15. **17, lost retro row** (low-confidence: needs a seeded restored retro row). Start with an unreadable `queue.json`
    and a restored row whose first message is `/wigley:retro auto …`: the row is in the Retro section and closes once
    it reads done.
16. **19, interrupt before init** (low-confidence: needs the real Claude CLI's timing; the hand-back divider needs a
    background subagent's hand-back, hard to trigger on purpose). `/compact` on an idle session, Ctrl+C before its init
    (about 6 s): the row stays working, with no turn-finished mark until the compaction ends.
17. **20, local command title** (low-confidence: the fake harness reports no delivery). With the real harness, a new
    session's first message `/effort auto` leaves the row untitled; the next real message titles it once the reply
    starts.
18. **21, terminal session name** (low-confidence: needs two profiles). Start the app with a personal-profile
    `CLAUDE_CONFIG_DIR`, then connect a terminal session with no `CLAUDE_CONFIG_DIR` and a name saved in `~/.claude`:
    the row shows that name.

Self-tests and teardown:

19. **23, click and choose steps** (low-confidence: nothing yet routes a runtime main command from a page bind, and
    the first click in an unfocused pane has only been proved by drive runs). `npm run selftest -- --plugin chat
    --plugin forms --plugin sessions --plugin app-update` passes, its new hub-head click steps and the `Space z f c`
    step expecting `[forms] chose 2 on finding 1` included.
20. **23, docs host-id step** (low-confidence: the line's shape on the fake harness and the tab order were read from
    code). In that run, chat-second's `/reset` step logs the session index line
    (`/^\[docs\] session index( rebuilt| read)?: /`) after `<A-i>` showed its Docs tab.
21. **24, no late handler lines** (expected). `npm run selftest -- --plugin docs --plugin chat` ends with no
    `no main handler` line after its last PASS.
22. **24, docs switched off and on with a Docs tab open** (low-confidence: a parked invoke to a stopped main part is
    new; only a live switch shows whether a page part looks stuck). In a drive run, with a session's Docs tab open, set
    the `plugins.disabled` config to include `docs` (the drive config command), then clear it. A drive `restart` does
    not exercise this case: it restarts the whole app and reloads the page, so no page part runs over a stopped main
    part. Expect no `no main handler` or late-draw lines, the Docs tab reads its index again once docs is back, and the
    page stays responsive.

## Dropped

Checks a group's own test already pins, or groups with no behaviour a live run would add to:

- 02, 09, 14, 15, 16, 18: no behaviour change or a unit test pins each GIVEN/WHEN/THEN.
- 25: each view's dispose fix carries a test row in its own view's test.

Done when: every check above passes, or its failure is fixed in its group and the check re-run, or (checks 16–18 only)
it is reported not reached with its reason. Report each check with its result, and attach the stills of checks 1, 3,
8 and 10.

## Proof
