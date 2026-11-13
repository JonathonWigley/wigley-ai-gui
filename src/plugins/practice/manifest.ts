import { definePlugin } from '../../shared/define-plugin';

// Practice mode: LeetCode-style problems in C++ under the `folder` setting, judged
// by compiling with `compiler` and `flags` and running each case under
// `timeLimitMs`, with progress on a review ladder of `reviewSteps` days. Its main
// names `chat` for the import session, `sessions` for its tools and
// `scoped-agents` for the interviewer; its page names `scoped-agents` for the
// interviewer's pane. `layout` names the layout
// Practice draws with. `openProblemRow` is the click on a list row, naming its
// problem, `showTab` the click on a tab and `openSubmissionRow` the click on a
// Submissions row, so they have no key.
export const practiceManifest = definePlugin({
  id: 'practice',
  label: 'Practice',
  description:
    'Adds Practice mode, for solving LeetCode-style problems in C++ with a judge, progress and an interviewer.',
  dependsOn: {
    main: ['chat', 'sessions', 'scoped-agents'],
    page: ['scoped-agents'],
  },
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
    run: {
      label: 'run the examples and your cases',
      group: 'judge',
      runsIn: 'page',
    },
    submit: { label: 'submit the solution', group: 'judge', runsIn: 'page' },
    nextTab: { label: 'next tab', group: 'tabs', runsIn: 'page' },
    prevTab: { label: 'previous tab', group: 'tabs', runsIn: 'page' },
    showTab: {
      label: 'show this tab',
      group: 'tabs',
      runsIn: 'page',
      arg: 'string',
    },
    paneDown: { label: 'next row or line', group: 'pane', runsIn: 'page' },
    paneUp: { label: 'previous row or line', group: 'pane', runsIn: 'page' },
    paneTop: { label: 'top', group: 'pane', runsIn: 'page' },
    paneBottom: { label: 'bottom', group: 'pane', runsIn: 'page' },
    lineDown: { label: 'scroll a line down', group: 'pane', runsIn: 'page' },
    lineUp: { label: 'scroll a line up', group: 'pane', runsIn: 'page' },
    halfPageDown: {
      label: 'scroll half a page down',
      group: 'pane',
      runsIn: 'page',
    },
    halfPageUp: {
      label: 'scroll half a page up',
      group: 'pane',
      runsIn: 'page',
    },
    openSubmission: {
      label: "show the submission's code",
      group: 'pane',
      runsIn: 'page',
    },
    openSubmissionRow: {
      label: "show this submission's code",
      group: 'pane',
      runsIn: 'page',
      arg: 'string',
    },
    closeSubmission: {
      label: 'back to the submissions',
      group: 'pane',
      runsIn: 'page',
    },
    editBox: { label: 'edit the box', group: 'box', runsIn: 'page' },
    leaveBox: { label: 'leave the box', group: 'box', runsIn: 'page' },
    confirmYes: { label: 'open it', group: 'confirm', runsIn: 'page' },
    confirmNo: { label: 'keep solving', group: 'confirm', runsIn: 'page' },
    toggleInterviewer: {
      label: 'focus or leave the interviewer',
      group: 'interviewer',
      runsIn: 'page',
    },
    importStart: { label: 'import problems', group: 'import', runsIn: 'page' },
    importAccept: {
      label: 'start the import',
      group: 'import',
      runsIn: 'page',
    },
    importCancel: { label: 'cancel', group: 'import', runsIn: 'page' },
  },
  scopes: {
    list: 'In the practice list',
    problem: 'In the practice problem pane',
    editor: 'In the practice editor',
    console: 'In the practice console',
    box: 'In the practice filter box',
    confirm: 'In a practice confirmation',
    import: 'In the import box',
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
