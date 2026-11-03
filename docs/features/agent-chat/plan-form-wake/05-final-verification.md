# 05 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Runs in a drive run (`npm run drive`, loop in `.agents/skills/drive/SKILL.md`), on the dev build.

Setup, before any session is opened (the service reads the deadline once per session, at `startSession`):
`setting forms.deadlineSeconds 5` and `setting primer.deadlineSeconds 5`. Each must report `applied: true`.

Live checks:
- **Expected — the wake reaches a chat-owned session.** `chat.start` a session under the fake harness and keep its
  `hostSessionId` (02). `forms.openRound` with `sessionId` set to that host id. Confirm the round shows in that chat
  row's Form tab, not in a new row. Wait past 5 s, so the round's only call returns its draft and nothing waits.
  Submit the round with keys in the Form tab. Expect the Chat tab to show
  `The user submitted the round "<heading>" in the forms app. Call collect_last_round for its answers.` as a sent
  message, followed by the fake harness's echo of it. Capture the Chat tab.
- **Low-confidence — no wake while a call waits.** In a fresh `chat.start` session, set the deadline to 120 first
  (`setting forms.deadlineSeconds 120`), open a round the same way and submit it at once. Expect `forms.answers` to
  return the submitted payload and no wake message in the Chat tab. Capture the Chat tab.
- **Low-confidence — the primer's wording.** Repeat the first check with `primer.openPrimer` and the 5 s deadline.
  Expect `… the primer "<heading>" in the forms app. Call collect_last_primer for its answers.`

Paste each captured message text into Proof, and compare it character for character with the README's
**The wake** paragraph.

Restore `forms.deadlineSeconds` and `primer.deadlineSeconds` to `240` at the end; the run's `settings.json` lives in
the drive run's own home, so this only keeps a reused run home clean.

The check only the user can make (a real Claude session that stops after a draft, then resumes on submit) goes in
the run's wrap-up, not here.

Done when: all three checks pass, with captures read.
Commit:    none (verification only)

## Proof

