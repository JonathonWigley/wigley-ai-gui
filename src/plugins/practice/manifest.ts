import { definePlugin } from '../../shared/define-plugin';

// Practice mode: LeetCode-style problems in C++ under the `folder` setting, judged
// by compiling with `compiler` and `flags` and running each case under
// `timeLimitMs`, with progress on a review ladder of `reviewSteps` days. Its main
// names `chat` and `sessions` for the import and interviewer sessions; its page
// names `chat` for the interviewer's chat view. `layout` names the layout
// Practice draws with. `openProblemRow` is the click on a list row, naming its
// problem, so it has no key.
export const practiceManifest = definePlugin({
  id: 'practice',
  label: 'Practice',
  description:
    'Adds Practice mode, for solving LeetCode-style problems in C++ with a judge, progress and an interviewer.',
  dependsOn: { main: ['chat', 'sessions'], page: ['chat'] },
  reads: { main: [], page: [] },
  commands: {
    showMode: {
      label: 'practice (again: toggle the side bar)',
      group: 'modes',
      runsIn: 'page',
    },
    listDown: { label: 'next row', group: 'list', runsIn: 'page' },
    listUp: { label: 'previous row', group: 'list', runsIn: 'page' },
    listTop: { label: 'first row', group: 'list', runsIn: 'page' },
    listBottom: { label: 'last row', group: 'list', runsIn: 'page' },
    openProblem: { label: 'open the problem', group: 'list', runsIn: 'page' },
    openKeepingFocus: {
      label: 'open the problem, staying in the list',
      group: 'list',
      runsIn: 'page',
    },
    filter: {
      label: 'filter by difficulty, status, tag, list or title',
      group: 'list',
      runsIn: 'page',
    },
    boxAccept: { label: 'accept', group: 'box', runsIn: 'page' },
    boxCancel: { label: 'cancel', group: 'box', runsIn: 'page' },
    openProblemRow: {
      label: 'open this problem',
      group: 'list',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: {
    list: 'In the practice list',
    problem: 'In the practice problem pane',
    editor: 'In the practice editor',
    console: 'In the practice console',
    box: 'In the practice filter box',
  },
  settings: {
    folder: '~/leetcode',
    compiler: 'clang++',
    flags:
      '-std=c++20 -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer',
    timeLimitMs: 2000,
    reviewSteps: [1, 3, 7, 14, 30, 60],
    layout: 'default',
  },
  settingInfo: {
    folder: {
      label: 'Practice folder',
      description: 'The folder holding the problems; ~ is the home folder.',
    },
    compiler: {
      label: 'Compiler',
      description:
        'The C++ compiler the judge runs, by name on the PATH or by full path.',
    },
    flags: {
      label: 'Compiler flags',
      description: 'The flags the judge compiles with, separated by spaces.',
    },
    timeLimitMs: {
      label: 'Time limit',
      description:
        'Milliseconds one test case may run before Time Limit Exceeded.',
    },
    reviewSteps: {
      label: 'Review steps',
      description: 'Days between reviews, one per step of the review ladder.',
    },
    layout: {
      label: 'Layout',
      description:
        "The Practice layout: a folder name in practice's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
