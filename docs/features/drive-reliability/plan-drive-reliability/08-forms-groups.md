# 08 — Forms' self-test in named groups; the gallery pages with `repeat`

Status: in progress
Type: Task
Wave: 4 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/main/selftest-script.ts`
Consumes:  `SelfTestGroup`, `SelfTestStep.why`, `SelfTestStep.repeat` ← 07
Produces:  forms' `groups` in its `SelfTestScript`, in `src/plugins/forms/main/selftest-script.ts`
Decisions: groups and whys replace the 57-line narration (round 1, choice 1; the follow-up) · the step array splits
           into top-level consts at group boundaries, with no nesting or re-indenting, so step 1's added steps merge
           (round 2) · repeat removes the gallery's page count (follow-up)

## Behaviour

### Groups

- The comment above `STEPS` (lines 96–160 at plan time, re-verify) narrates the steps in order. Split `STEPS` into one
  top-level `const <NAME>_STEPS: SelfTestStep[]` per group, cutting the array where it changes subject, and hand them
  as `groups` in array order. Steps never move: their order is what they prove. The groups, in array order (a subject
  the array holds that this list misses becomes its own group, named in the same style, including steps step 1's
  bug sweep added):
  1. `gallery` — the sample round, Gallery mode paged full and reduced, Sessions mode under both transparencies, the
     shell layout swap and its restore
  2. `finding actions` — findings 1 to 3: picks, actions, the notes box and its editor bind
  3. `question boxes` — question 1's notes and reason boxes, which-key in a box, pending keys dropped on leaving
  4. `broken bind` — the self-test bind broken into the notes box, `x` marking question 2 not applicable
  5. `user keymap` — the `keymap.json` steps, which sit right after it in the array (inline comments near lines 325
     and 349 at plan time)
  6. `choices` — Ctrl+h back to question 1, clearing and re-picking a choice, Option+n, the which-key `Space z` group
  7. `second session` — its tabs, the cancel prompt kept, Option+p
  8. `side bar from a box` — `Space k s` from INSERT and NORMAL
  9. `cancelled preview` — the preview round cancelled, the Codex session's Docs tab, the wrap back
  10. `layout cycle` — the self-test layout's card failures and the cycle back to default
  11. `review` — help, the cancel prompt, the round note, the send
  12. `sample round again` — the preview reopened and its cancel prompt dismissed
- Each group's `why` says what the group proves in one or two sentences, taken from its part of the narration. A
  step gets its own `why` only where the narration explains a mechanism the step's keys and line do not show (for
  example: the first `k` replays to the notice because `Space k` then `k` breaks `Space k s`). The narration comment
  is deleted; the comments that describe the fixture, the layout and the binds above it stay.

### Gallery

- The two runs of `<C-j>` steps (full: four `[gallery] paged down` and one `[gallery] reached the end`, screenshots
  `gallery-2-full` to `gallery-6-full`; reduced: four and one, `gallery-2-reduced` to `gallery-5-reduced`) each become
  one step: `{ keys: ['<C-j>'], expect: '[gallery] paged down', repeat: { until: '[gallery] reached the end', max:
  12 }, screenshot: 'gallery-full' }` and the same with `screenshot: 'gallery-reduced'`. The other gallery
  screenshots are renamed so file `0` is the opening page and `n` the page after press `n` in both runs:
  `gallery-1-full` → `gallery-full-0`, `gallery-1-reduced` (the `g g` step) → `gallery-reduced-0`, and
  `gallery-6-reduced` (the `t` step at the end) → `gallery-reduced-end`. `max: 12` leaves room for twice today's six
  pages.

GIVEN the forms script WHEN the self-test runs THEN it reports 12 groups (or more, by the rule above) in order and
every step passes
GIVEN the gallery at six pages WHEN the repeating step runs THEN it presses five times, saves one screenshot per press
and passes on `[gallery] reached the end`

Tests:     no unit test: the script is data the self-test runs; `npm run selftest` is its test
Done when: `npm run typecheck` and `npm run lint` pass; `grep -c 'expect:'` drops by exactly 8, the gallery steps
           folded into the two repeats (145 → 137 at plan time, re-verify); the test gate runs `npm run selftest`, and every
           gallery screenshot under `.selftest/screenshots/` is read against `DESIGN.md` as before
Commit:    one commit for the group

## Proof

