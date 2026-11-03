# Hidden connected-session rows — plan

Feature: connected-session rows · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A session the app did not start (a terminal `claude` or Codex session, joined over the relay) shows no row in
the sessions sidebar until a form (a forms round or a primer) opens for it. When the session's last open form
closes — by submit, cancel, or any other close — its row closes again. The next form brings the row back.
Sessions the app starts (`open`, the Chat sessions) keep today's behaviour.

## Architecture

- `sessions` plugin, main side: `session-list.ts` (the rows), `contract.ts` (`SessionsMainExports`), `start.ts`
  (exports wiring, the drive `connect` action) and its self-test script.
- `src/contracts/agent-forms.ts` (`AgentFormSessions`) and `src/shared/agent-forms/channel-presenter.ts`: the
  shared presenter both forms and the primer use.
- Self-test fixtures in docs, notes and usage that need a row with no form.

## Preconditions

- `git -C <repo> rev-list --left-right --count HEAD...@{u}` → right count `0` (the branch is not behind origin;
  36 unpushed commits ahead at plan time, measured at plan time, re-verify).
- `grep -rn "createAgentFormChannelPresenter(" src --include=\*.ts` → only `src/plugins/forms/main/start.ts` and
  `src/plugins/primer/main/start.ts` (plus the presenter test), both passing the whole `SessionsMainExports`.
- `grep -rln "sessions.connect\|\.connect({" src --include=\*.ts` lists the fixture users this plan sorts in
  task 03 and task 01: the primer, forms, chat, usage, docs, notes and sessions self-test scripts,
  `agent-form-preview.ts` and `drive-actions.ts` (measured at plan time, re-verify).
- Another session shares this working tree (file-drop work in `src/plugins/notes/page/`, `src/plugins/chat/page/`,
  `src/shared/page/`). No task here touches those files. Commit only the task's own paths (`git commit -- <paths>`).

## Docs written ahead

- `AGENTS.md` § Architecture, the relay paragraph (connected sessions, `mark`, `activate` and `release`) — commit
  `b6aff9f`, `activate` added in the plan's own commit.

## Mandatory Reads

- `AGENTS.md` (root) — Intent, Architecture, Running and testing
- `DESIGN.md` is not needed: no view, CSS or layout changes

## Design Overview

```
relay hello (unowned) ──► list.connect ──► entry, NO row, emits `connected`
                                              │
form shown ──► presenter.show ──► sessions.mark ──► row added at end (selected if none, else marked)
                                              │
form closed (submit / cancel / end) ──► presenter.close ──► open.delete
                                         └─► sessions.release(sessionId)
                                                 │ owned session?      → nothing
                                                 │ no row?             → nothing
                                                 │ any close guard no? → row stays (another form open)
                                                 └─► row removed, state sent, emits `closed`
session ends ──► entry and row gone, emits `ended` (as today)
```

Decisions (all from the interview, round 1 and its notices):

- Every unowned session is treated the same, whatever its harness.
- Rounds and primers both bring the row; the row stays while either is open (close guards express that).
- Submit and cancel both close the row; so does any other presenter close.
- A form arriving marks and notifies as today: `mark` already re-adds a missing row.
- Sessions owns the rule through a `release` export; sessions never learns form types.
- Fixed behaviour, not a setting.
- No picker for hidden sessions. No follow-up is recorded (the user asked for one only if the need arises).
- Owned sessions keep today's rows: `release` does nothing for them.
- `activate` on a known session with no row adds the row, then selects it (the previews and the primer
  self-test activate right after connect; a notification click shows a hidden session).
- `release` is silent for an unknown, owned or row-less session (normal on every session end); it logs only a
  close guard keeping the row.
- `release` closing the selected row moves the selection to its neighbour, as a user close does.
- A hidden session keeps the label number it took at connect, so `gamma 2` may show with no `gamma` visible.
- Fixtures that need a row with no form open an owned session in the background (`open(info, { select: false })`)
  instead of `connect`. Fixtures that test the relay path or show a form keep `connect`.

Out of scope: a picker or command to show hidden sessions; any page-side change (the page reacts to the rows main
sends, and its `sessionAdded`/`sessionRemoved` already follow them).

## File Structure

Modified:

- `src/plugins/sessions/contract.ts` — `connect` comment; new `release` on `SessionsMainExports`; `closed` event
  comment.
- `src/plugins/sessions/main/session-list.ts` — `connect` adds no row; `release`.
- `src/plugins/sessions/main/start.ts` — exports pass `release`; drive `connect` description.
- `src/plugins/sessions/main/session-list.test.ts` — connect and release tests.
- `src/plugins/sessions/main/selftest-script.ts` — the panes fixture opens owned sessions.
- `src/contracts/agent-forms.ts` — `release` on `AgentFormSessions`.
- `src/shared/agent-forms/channel-presenter.ts` and its test — release on close.
- `src/shared/agent-forms/drive-actions.ts` — the `connect` comment only.
- `src/plugins/{docs,notes,usage}/main/selftest-script.ts` and the `start.ts` that hands each its sessions —
  fixtures open owned sessions.

No new files. Boundary rule: `sessions` imports nothing from forms or primer; the presenter reaches sessions only
through `AgentFormSessions`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Session list: hidden connected rows and release](01-session-list-release.md)

### Wave 2
- [x] [Presenter releases the session on close](02-presenter-release.md) — after 01
- [x] [Row-only fixtures open owned sessions](03-fixtures-open-owned.md) — after 01

### Wave 3
- [x] [Doc re-read](04-doc-re-read.md) — after 02, 03
- [ ] [Final verification](05-final-verification.md) — after 04

## Run log

Review base: d757831

### Groups
- 01 · 6145731 · diff read: release on SessionsMainExports, list and exports present; typecheck clean; sessions tests 230 pass · concerns: SessionEntry.group comment still says fixed at connect (label, left); activate no longer logs 'with no row ignored' for a known session — forms preview-round.ts:28 still cites the 'mark … with no row ignored' line, which no path emits; selftest pane fixtures now owned host ids
- 02 · def3f45 · diff read: release on AgentFormSessions present, presenter close releases after formClosed; worker typecheck clean; presenter test 12 pass; tree-wide typecheck re-run after 03 lands · concerns: none; presenter doc comment line runs past the file's width
- 03 · 367e51d · diff read: four sessions deps typed Pick<'open'|'activate'>, openDocsFixtureSession at every reference; typecheck clean; full npm test 340 files / 5299 pass · concerns: touched docs/main/start.test.ts and usage selftest-script.test.ts outside the list (stubs retyped); open still emits sessions.connected so docs' per-session index source registers for the fixture
- 04 · 5c54dac · diff read: AGENTS.md relay paragraph and docs-browser sidebar bullet match landed code; drive SKILL.md:62 true, unchanged; typecheck clean · concerns: presenter doc comment rewrap still leaves one line past width; docs-browser design.md sidebar bullet line past 120 cols; preview-round.ts:28 sample finding cites 'mark … with no row ignored', which no path emits now (fictional sample, left)
### Contract changes
### Rulings
- addEntry takes a separate addsRow flag, equal to owned today — keeps the row rule apart from ownership — one redundant parameter if wrong · group 01 · group 01
- activate on a known row-less session adds the row instead of logging 'activate … with no row ignored' — per the activate decision — a caller relying on that log line loses it · group 01 · group 01
- presenter test fake logs release into the shared calls log and each close test asserts ['send formClosed','release app-1'] — one assertion covers once, id, order and none-for-gone — a test rewrite if wrong · group 02 · group 02
- docs drive action keeps the name docs.connectSession and its connected/connects locals — renaming breaks drive scripts and docs — one more rename pass if wrong · group 03 · group 03
### Review rounds
### Test gate
