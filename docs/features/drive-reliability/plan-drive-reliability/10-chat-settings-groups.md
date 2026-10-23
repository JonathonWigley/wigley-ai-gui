# 10 — Chat's and settings' self-tests in named groups

Status: not started
Type: Batch
Wave: 4 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/settings/main/selftest-script.ts`
Consumes:  `SelfTestGroup`, `SelfTestStep.why` ← 07
Produces:  chat's and settings' `groups` in their `SelfTestScript`s
Decisions: as task 08: groups and whys replace each script's narration comments (round 1, choice 1); arrays split at
           group boundaries with no re-indenting (round 2)

## Behaviour

- Each script's `STEPS` splits into top-level `const <NAME>_STEPS` arrays where its narration comments change subject,
  handed as `groups` in order. Group names are short words naming what each covers, chosen from the comments (chat's
  89 comment lines and settings' 30 at plan time, re-verify); chat's name its sessions, the resume list, archive,
  slash completion, images and permission cards, as its comments do.
- Whys follow task 08's rule. Each narration comment that describes steps is deleted; comments that describe the
  fixture, a constant or the result check stay.

GIVEN the chat and settings scripts WHEN the self-test runs THEN each reports its groups in order and every step passes

Tests:     no unit test: the scripts are data the self-test runs
Done when: `npm run typecheck` and `npm run lint` pass; `grep -c 'expect:'` is unchanged in both files; the test gate
           runs `npm run selftest`
Commit:    one commit for the group

## Proof

