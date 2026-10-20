# 06 — Self-test: rows, tabs, the new keys and scoped editor binds

Status: in progress
Type: Task
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/forms/main/selftest-script.ts`

Consumes:
- Sessions page log lines (source `sessions`) ← 05: `activated <label>`, `sidebar hidden`, `sidebar shown`,
  `no other tab in <label>`, `nothing shown in <label>`; the Form tab's `shown()` setting forms' scope; manifest binds `[' ', 'k', 's']`, `<A-S-o>`, `<A-S-i>`, `<A-o>`, `<D-w>`; editor bind
  `<Leader>ks` [any] ← 05
- Forms log `closing the session asks to cancel <label>` ← 05
- Forms editor binds in scopes `forms.forms` and `forms.review` ← 01
- `SessionInfo.harness` ← 02
- In the tree: `src/main/selftest.ts` (presses each key, waits for `expect` among the lines logged after the step
  began, then the fit check when `checksFit`), `SelfTestStep`, `SelfTestScript`.

Produces: no new member; `STEPS`, `SCROLLS_ITSELF` and `formsSelfTestScript`'s `connect` change as below.

Decisions (AGENTS.md § Running and testing: a key behaviour the agent adds gets a step in forms' script; plan.md
Decisions: the self-test proves scoped editor binds):
- **Fixture sessions**: the first connects with `harness: 'claude'`, the second with `harness: 'codex'`; both keep
  `projectDir: 'selftest'`, so the rows read `selftest` and `selftest 2` with `Claude` and `Codex` beside them, and
  the fit check sees both harness labels. A third session connects after them with `sessionId: selftest-<run>-3`,
  `projectDir: null`, `harness: 'codex'`, `deadlineSeconds: 120`, and never gets a round: its row reads
  `Codex session` and it has no tab. All three join `connected`, so the next run ends them. Main connects the rows
  before any round; the first round selects the first row (none was selected) and the second marks the second row,
  as tabs did.
- **Step 1** `[' ', 'k']` becomes `[' ', 'k', 'k']`, same `expect` (`[page] k ran forms.prevItem`) and `checksFit`:
  `Space k` now begins `Space k s`, so a second `k` breaks the sequence; the first `k` replays to the notice and the
  second `k` finds no item before it. Step 2 (`j` back to finding 1) stays.
- **Session steps**: `{ keys: ['<A-o>'], expect: '[sessions] activated selftest 2', checksFit: true }` becomes
  `<A-S-o>` with the same expect and fit check. Right after it, a new step
  `{ keys: ['<A-o>'], expect: '[sessions] no other tab in selftest 2' }` proves the tab key runs over one Form tab.
  `{ keys: ['<A-i>'], expect: '[sessions] activated selftest' }` becomes `<A-S-i>`.
- **Close**: both `<D-w>` steps keep their keys; their expects read
  `[forms] closing the session asks to cancel selftest · Second self-test round` and
  `[forms] closing the session asks to cancel selftest · Self-test round`.
- **Sidebar toggle**, inserted right after the `<A-S-i>` step (the first session's form shows, focus on question 2,
  no box focused):
  - `{ keys: [' ', 'k', 's'], expect: '[sessions] sidebar hidden', checksFit: true }`
  - `{ keys: [' ', 'k', 's'], expect: '[sessions] sidebar shown' }`
  - `{ keys: ['a'], expect: '[forms] focused notes on question 2' }`
  - `{ keys: ['j', 'k', ' ', 'k', 's'], expect: '[sessions] sidebar hidden' }` — the `any` editor bind `<Leader>ks`
    fires in a box in scope `forms.forms`.
  - `{ keys: [' ', 'k', 's'], expect: '[sessions] sidebar shown' }` — still in the box, NORMAL mode.
  - `{ keys: ['Escape'], expect: '[forms] left the box' }` — forms' `<Esc>` bind in scope `forms.forms`.
- **A hidden view keeps no scope** (05's visible-tab check), inserted right after the sidebar steps:
  - `{ keys: ['<A-S-i>'], expect: '[sessions] nothing shown in Codex session', checksFit: true }` — the step wraps
    from `selftest` to the last row, which has no tab, so the base scope becomes `sessions.idle`; the fit check sees
    the `Nothing open` text.
  - `{ keys: ['<A-S-o>'], expect: '[sessions] activated selftest' }` — wraps back to the first row; its Form tab's
    `shown()` sets `forms.forms` again.
  Then the review steps follow as today: `[' ', ' ']` → `[forms] review opened` fires only in scope `forms.forms`, so
  it proves the Form tab took its scope back.
- **Scoped editor binds in review**: the existing step `o n o t e j k Escape` → `[forms] left the box` is the proof
  that forms' `<Esc>` bind fires in scope `forms.review` (the round note's box); the comment above `STEPS` names it.
  Every earlier `Space a …`, `Escape` step inside a box is the proof in `forms.forms`.
- **Fit checks and the narrow sidebar**: the self-test window opens at the default 900 px, where the sidebar sits
  beside the content, and each fit check narrows it to the 420 px minimum, below 680 px, where 05's narrow rule hides
  the sidebar (no overlay is open at any fit check) — so each fit check sees the form at its fitted width, and the
  sidebar's own rows are fit-checked only by the live check in 08. The overlay itself needs a narrow window while keys
  run, which the driver gives only during a fit check, so its proof is 05's `tabs.ts` tests and 08's live check.
  The sidebar steps above run at 900 px, so they log `sidebar hidden` / `sidebar shown`, never
  `sidebar shown over the content`.
- **SCROLLS_ITSELF**: keep `.session-tab-label`; add `.session-row-label` and `.session-row-status` (rows end in an
  ellipsis, their full text in the row's tooltip); its comment says rail, row and tab titles.
- **Comment**: the walk-through comment above `STEPS` is rewritten to follow the new steps, in its present style;
  the comment above `formsSelfTestScript` says the first round's row is selected (not "its tab is active").

GIVEN the self-test runs WHEN every step's line arrives and every fit check passes THEN it prints
`[selftest] all passed`.

Tests: `npm run selftest` (the agent's live check; AGENTS.md allows the agent to run it any time).

Done when: `npm run selftest` exits 0 with `[selftest] all passed`; `npm run typecheck`, `npm test`, `npm run lint`
pass. A failing step is fixed in the code task it proves (01, 02 or 05), not by loosening the step.
Commit: one commit for the group.

## Proof

