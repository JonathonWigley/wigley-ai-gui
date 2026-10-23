# 09 — Docs' self-test in named groups, and the hidden-tree step in a narrow window

Status: in progress
Type: Task
Wave: 4 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/selftest-script.ts`
Consumes:  `SelfTestGroup`, `SelfTestStep.why`, `SelfTestStep.width` ← 07; `connectDocsFixtureSession`'s options
           parameter ← 06 (same file, earlier wave)
Produces:  `docsGroups(paths: Paths, homeDir: string): SelfTestGroup[]` in place of `docsSteps`, in
           `src/plugins/docs/main/selftest-script.ts`, handed as the script's `groups`
Decisions: groups and whys replace the narration (round 1, choice 1) · arrays split at group boundaries, no
           re-indenting (round 2) · the hidden-tree step needs the held `width` (round 1, choice 3; the follow-up)

## Behaviour

### Groups

- `docsSteps` returns one array narrated by the comment above it (about 66 comment lines at plan time, re-verify).
  Split its array into one local `const` per group at the narration's subject changes, and return them as groups in
  order. Groups, by the narration (a subject this list misses becomes its own group, named alike):
  `doc editor`, `links and disk changes`, `create and rename`, `trash and rescan`, `tree filter`,
  `detail views`, `plugin cache`, `pickers`, `side bar`, `narrow window` (new, below), `session Docs tab`,
  `Docs mode from a session`, `transparency`.
- Whys follow task 08's rule: a group's `why` says what it proves; a step's own `why` only for a mechanism its keys
  and line do not show. The narration comment is deleted.

### The hidden-tree step

- New group `narrow window`, after `side bar` (its last step, `Option+h` focusing the tree, leaves the tree focused
  with the side bar shown):
  - `{ width: 600, keys: ['j'], expect: '[docs] tree out of sight: treeDown ran docs.scrollDown in the doc', why:
    'Below 680 px the side bar hides, so a tree key runs in the doc pane by the keymap' }`
  - `{ width: 'start', keys: ['<A-h>'], expect: '[docs] tree focused' }`, so the next group starts as `side bar`
    left it
- 600 px is below the 680 px narrow breakpoint (`src/renderer/shell/modes.ts`) and above the 420 px minimum
  (`src/config/settings.ts`).
- Step 1's tree toggle steps (`Space v t`, landed on `main` in `cebc48a`) sit between the `Space k d` steps and the
  closing `<A-h>`; they stay in the `side bar` group, since a split there would cut the sequence.

GIVEN Docs mode with the tree focused WHEN the window is 600 px wide and `j` is pressed THEN the page logs
`[docs] tree out of sight: treeDown ran docs.scrollDown in the doc`
GIVEN the docs script WHEN the self-test runs THEN every group reports in order and every step passes

Tests:     no unit test: the routing rule has `hidden-tree-keys.test.ts`; this step is the self-test of its wiring
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs `npm run selftest`
Commit:    one commit for the group

## Proof

