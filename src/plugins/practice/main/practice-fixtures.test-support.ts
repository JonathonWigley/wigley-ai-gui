import type { Files } from '../../../contracts/files';
import { problemJson, type Problem } from '../problem';

// The practice folder the main tests use, under the home folder `/home/u`.
export const PRACTICE_FOLDER = '/home/u/leetcode';

// A function problem: one visible case, then two hidden ones.
export const TWO_SUM: Problem = {
  slug: 'two-sum',
  title: 'Two Sum',
  difficulty: 'easy',
  tags: ['array', 'hash table'],
  lists: ['Blind 75'],
  signature: {
    kind: 'function',
    method: 'twoSum',
    params: [
      { name: 'nums', type: 'vector<int>' },
      { name: 'target', type: 'int' },
    ],
    returns: 'vector<int>',
  },
  compare: 'exact',
  cases: [
    { input: [[2, 7, 11, 15], 9], expected: [0, 1], visible: true },
    { input: [[3, 2, 4], 6], expected: [1, 2], visible: false },
    { input: [[3, 3], 6], expected: [0, 1], visible: false },
  ],
};

// A design problem: a counter built from a start value.
export const COUNTER: Problem = {
  slug: 'counter',
  title: 'Counter',
  difficulty: 'medium',
  tags: ['design'],
  lists: [],
  signature: {
    kind: 'design',
    className: 'Counter',
    constructor: [{ name: 'start', type: 'int' }],
    methods: [{ name: 'get', params: [], returns: 'int' }],
  },
  compare: 'exact',
  cases: [
    {
      ops: ['Counter', 'get'],
      args: [[4], []],
      expected: [null, 4],
      visible: true,
    },
  ],
};

// Writes `problems/<slug>/problem.json` for `problem` under `folder`.
export function writeProblem(
  files: Files,
  problem: Problem,
  folder = PRACTICE_FOLDER,
): Promise<void> {
  return files.write(
    `${folder}/problems/${problem.slug}/problem.json`,
    problemJson(problem),
  );
}
