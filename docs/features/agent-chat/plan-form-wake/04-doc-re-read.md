# 04 — Doc re-read

Status: in progress
Type: Task
Wave: 3 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

Files:     modify (only where stale) `AGENTS.md` (wigley-ai-gui) · modify (only where stale) `.agents/skills/drive/SKILL.md` ·
           modify (only where stale) `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md`
Consumes:  the landed code of 01, 02 and 03

Re-read each of these line by line against the landed code:
- `AGENTS.md`: the agent-forms entry ("the wake … through the `AgentFormWake` the service is handed: chat's `send` for
  a session chat owns, nothing for any other") and the chat entry ("`send` and `profileOf` to forms and the primer (the
  form wake)"). Commit `0b9105cd`. Also any line stating the plugin start order or the self-test script order, which 03
  changed.
- `.agents/skills/drive/SKILL.md`: what it says `chat.start` returns (02 added `hostSessionId`).
- forms `README.md` § Outcomes, **The wake** paragraph (commits `817df38` and the follow-up commit that added the
  already-read sentence):
  - the message text must match the service's composed text character for character, for a round and for a primer
  - the claim that a replayed collect changes nothing must match `collectLastForm`
  - the paragraph must say that a form whose session moved to a new host id gets no wake, matching 01's
    `madeUnderCurrentHost`, if the paragraph states which sessions are woken

Fix every stale line. Commit each repo's fixes in that repo: the marketplace is a separate repo, committed with its
own message.
Done when: every line is checked, and the fixes are committed or "no change" is recorded in Proof.
Commit:    one per repo with a fix

## Proof

