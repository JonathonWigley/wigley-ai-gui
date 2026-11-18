import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OsName } from '../../../contracts/platform';
import type {
  ProcessResult,
  ProcessRunner,
  ProcessRunOptions,
} from '../../../contracts/processes';
import { createNodeFiles } from '../../../main/files/node-files';
import { hostNodeProcesses } from '../../../main/processes/node-processes.test-support';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { practiceManifest } from '../manifest';
import { expectedAnswer, type Problem } from '../problem';
import { createJudge, type JudgeCase } from './judge';
import { PRACTICE_FOLDER, TWO_SUM } from './practice-fixtures.test-support';

const BUILD = `${PRACTICE_FOLDER}/.build`;
const CODE_PATH = `${PRACTICE_FOLDER}/problems/two-sum/solution.cpp`;
const SNAPSHOT_PATH = `${BUILD}/two-sum/solution/solution.cpp`;

function exited(code: number, stdout = '', stderr = ''): ProcessResult {
  return { code, stdout, stderr, timedOut: false };
}

const TIMED_OUT: ProcessResult = {
  code: -1,
  stdout: '',
  stderr: '',
  timedOut: true,
};

interface CaseScript {
  result: ProcessResult;
  resultText: string;
}

// A runner whose `clang++` call gives `compile`, and whose program call for
// case k writes `cases[k].resultText` to the result file named in its args,
// then gives `cases[k].result`. Each call's options land in `options`.
function scriptedRunner(
  files: MemoryFiles,
  compile: ProcessResult | Error,
  cases: CaseScript[],
  options: (ProcessRunOptions | undefined)[],
): Pick<ProcessRunner, 'run'> {
  return {
    async run(command, args, runOptions) {
      options.push(runOptions);
      if (command === 'clang++') {
        if (compile instanceof Error) {
          throw compile;
        }
        return compile;
      }
      const script = cases[Number(args[1])];
      await files.write(args[2], script.resultText);
      return script.result;
    },
  };
}

// A judge over memory files holding `class Solution {};` at `CODE_PATH`.
async function memoryJudge(
  compile: ProcessResult | Error,
  cases: CaseScript[],
) {
  const files = createMemoryFiles();
  await files.write(CODE_PATH, 'class Solution {};');
  const runOptions: (ProcessRunOptions | undefined)[] = [];
  let now = 1000;
  const judge = createJudge({
    files,
    processes: scriptedRunner(files, compile, cases, runOptions),
    paths: posixPaths,
    clock: { now: () => (now += 7) },
    settings: () => ({
      buildFolder: BUILD,
      compiler: 'clang++',
      flags: '-std=c++20  -O1',
      timeLimitMs: 2000,
    }),
  });
  return { files, judge, runOptions };
}

function cases(problem: Problem, count = problem.cases.length): JudgeCase[] {
  return problem.cases
    .slice(0, count)
    .map((testCase) => ({ ...testCase, source: 'example' }));
}

describe('createJudge', () => {
  it.each([
    {
      name: 'compile exits 1',
      compile: exited(1, '', `${SNAPSHOT_PATH}:3:1: error: x`),
      run: exited(0),
      resultText: '[0,1]',
      verdict: 'compileError',
      compileOutput: 'solution.cpp:3:1: error: x',
    },
    {
      name: 'compile times out',
      compile: TIMED_OUT,
      run: exited(0),
      resultText: '[0,1]',
      verdict: 'compileError',
      compileOutput: 'Compilation took longer than 120 s.',
    },
    {
      name: 'run times out',
      compile: exited(0),
      run: TIMED_OUT,
      resultText: '',
      verdict: 'timeLimit',
      compileOutput: null,
    },
    {
      name: 'run times out after a sanitizer report',
      compile: exited(0),
      run: {
        code: -1,
        stdout: '',
        stderr: '==ERROR: AddressSanitizer: SEGV on unknown address',
        timedOut: true,
      },
      resultText: '',
      verdict: 'runtimeError',
      compileOutput: null,
    },
    {
      name: 'run exits -1',
      compile: exited(0),
      run: exited(-1),
      resultText: '',
      verdict: 'runtimeError',
      compileOutput: null,
    },
    {
      name: 'a sanitizer report with exit 0',
      compile: exited(0),
      run: exited(0, '', 'x.cpp:2:3: runtime error: signed integer overflow'),
      resultText: '[0,1]',
      verdict: 'runtimeError',
      compileOutput: null,
    },
    {
      name: 'no answer written',
      compile: exited(0),
      run: exited(0),
      resultText: '',
      verdict: 'runtimeError',
      compileOutput: null,
    },
    {
      name: 'the expected answer',
      compile: exited(0),
      run: exited(0),
      resultText: '[0,1]',
      verdict: 'accepted',
      compileOutput: null,
    },
    {
      name: 'another answer',
      compile: exited(0),
      run: exited(0),
      resultText: '[1,0]',
      verdict: 'wrongAnswer',
      compileOutput: null,
    },
  ])('maps each run to a verdict: $name', async (row) => {
    const { judge } = await memoryJudge(row.compile, [
      { result: row.run, resultText: row.resultText },
    ]);

    const result = await judge.judge(TWO_SUM, CODE_PATH, cases(TWO_SUM, 1), {
      stopAtFirstFailure: false,
    });

    expect(result.verdict).toBe(row.verdict);
    expect(result.compileOutput).toBe(row.compileOutput);
    expect(result.total).toBe(1);
    expect(result.cases).toHaveLength(row.compileOutput === null ? 1 : 0);
  });

  it('rejects when the compiler cannot start', async () => {
    const { judge, runOptions } = await memoryJudge(
      new Error('Could not run clang++: ENOENT'),
      [{ result: exited(0), resultText: '[0,1]' }],
    );

    await expect(
      judge.judge(TWO_SUM, CODE_PATH, cases(TWO_SUM, 1), {
        stopAtFirstFailure: false,
      }),
    ).rejects.toThrow('Could not run clang++: ENOENT');
    expect(runOptions).toHaveLength(1);
  });

  it.each([
    {
      name: 'the code handed in',
      code: 'class Handed {};',
      compiled: 'class Handed {};',
    },
    {
      name: 'the file when none is handed in',
      code: undefined,
      compiled: 'class Solution {};',
    },
  ])('compiles a snapshot of $name', async (row) => {
    const { files, judge } = await memoryJudge(exited(0), [
      { result: exited(0), resultText: '[0,1]' },
    ]);

    await judge.judge(TWO_SUM, CODE_PATH, cases(TWO_SUM, 1), {
      stopAtFirstFailure: false,
      code: row.code,
    });

    expect(await files.read(SNAPSHOT_PATH)).toBe(row.compiled);
    expect(await files.read(`${BUILD}/two-sum/solution/driver.cpp`)).toContain(
      `#include "${SNAPSHOT_PATH}"`,
    );
  });

  it('caps the output kept of every run', async () => {
    const { judge, runOptions } = await memoryJudge(exited(0), [
      { result: exited(0), resultText: '[0,1]' },
    ]);

    await judge.judge(TWO_SUM, CODE_PATH, cases(TWO_SUM, 1), {
      stopAtFirstFailure: false,
    });

    expect(runOptions.map((options) => options?.maxOutputBytes)).toEqual([
      1_000_000, 1_000_000,
    ]);
  });

  it('marks a case that wrote no answer in its stderr', async () => {
    const { judge } = await memoryJudge(exited(0), [
      { result: exited(0, '', 'boom'), resultText: '' },
    ]);

    const result = await judge.judge(TWO_SUM, CODE_PATH, cases(TWO_SUM, 1), {
      stopAtFirstFailure: false,
    });

    expect(result.cases[0].stderr).toBe(
      'boom\nThe program ended before writing its answer.',
    );
    expect(result.cases[0].output).toBeNull();
  });

  it.each([
    { stopAtFirstFailure: true, run: 2, passed: 1 },
    { stopAtFirstFailure: false, run: 3, passed: 2 },
  ])(
    'stops at the first failure only when asked: $stopAtFirstFailure',
    async (row) => {
      const { judge } = await memoryJudge(exited(0), [
        { result: exited(0), resultText: '[0,1]' },
        { result: exited(0), resultText: '[2,1]' },
        { result: exited(0), resultText: '[0,1]' },
      ]);

      const result = await judge.judge(TWO_SUM, CODE_PATH, cases(TWO_SUM), {
        stopAtFirstFailure: row.stopAtFirstFailure,
      });

      expect(result.cases).toHaveLength(row.run);
      expect(result.passed).toBe(row.passed);
      expect(result.total).toBe(3);
      expect(result.verdict).toBe('wrongAnswer');
      expect(result.failing?.index).toBe(1);
      expect(result.ms).toBe(7 * row.run);
    },
  );

  it('writes the build files', async () => {
    const { files, judge } = await memoryJudge(exited(0), [
      { result: exited(0), resultText: '[0,1]' },
    ]);

    await judge.judge(TWO_SUM, CODE_PATH, cases(TWO_SUM, 1), {
      stopAtFirstFailure: false,
    });

    expect(await files.read(`${BUILD}/.gitignore`)).toBe('*\n');
    expect(await files.read(`${BUILD}/prelude.h`)).toContain(
      'using namespace std;',
    );
    expect(await files.read(`${BUILD}/bits/stdc++.h`)).toContain(
      '#include "../prelude.h"',
    );
    expect(await files.read(`${BUILD}/two-sum/solution/cases.json`)).toBe(
      '[[[2,7,11,15],9]]',
    );
  });
});

// The clang suite runs the machine's clang++, which a machine without it on
// the PATH cannot.
const clangOnPath = (() => {
  try {
    execFileSync('clang++', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const OS_NAMES: Partial<Record<NodeJS.Platform, OsName>> = {
  darwin: 'macos',
  win32: 'windows',
};

const ECHO: Problem = {
  slug: 'echo',
  title: 'Echo',
  difficulty: 'easy',
  tags: [],
  lists: [],
  signature: {
    kind: 'design',
    className: 'Echo',
    constructor: [],
    methods: [
      { name: 'nextInt', params: [{ name: 'x', type: 'int' }], returns: 'int' },
      {
        name: 'twice',
        params: [{ name: 'x', type: 'long long' }],
        returns: 'long long',
      },
      {
        name: 'half',
        params: [{ name: 'x', type: 'double' }],
        returns: 'double',
      },
      { name: 'flip', params: [{ name: 'b', type: 'bool' }], returns: 'bool' },
      { name: 'next', params: [{ name: 'c', type: 'char' }], returns: 'char' },
      {
        name: 'shout',
        params: [{ name: 's', type: 'string' }],
        returns: 'string',
      },
      {
        name: 'grid',
        params: [{ name: 'g', type: 'vector<vector<int>>' }],
        returns: 'vector<vector<int>>',
      },
      {
        name: 'names',
        params: [{ name: 'n', type: 'vector<string>' }],
        returns: 'vector<string>',
      },
      {
        name: 'flags',
        params: [{ name: 'f', type: 'vector<bool>' }],
        returns: 'vector<bool>',
      },
      {
        name: 'tail',
        params: [{ name: 'head', type: 'ListNode*' }],
        returns: 'ListNode*',
      },
      {
        name: 'left',
        params: [{ name: 'root', type: 'TreeNode*' }],
        returns: 'TreeNode*',
      },
      { name: 'reset', params: [], returns: 'void' },
    ],
  },
  compare: 'exact',
  cases: [
    {
      ops: [
        'Echo',
        'nextInt',
        'twice',
        'half',
        'flip',
        'next',
        'shout',
        'grid',
        'names',
        'flags',
        'tail',
        'left',
        'reset',
      ],
      args: [
        [],
        [7],
        [3000000000],
        [2.5],
        [true],
        ['a'],
        ['q"\\\n'],
        [[[1, 2], [3]]],
        [['x', 'y']],
        [[true, false]],
        [[1, 2, 3]],
        [[1, 2, 3, null, 4]],
        [],
      ],
      expected: [
        null,
        8,
        6000000000,
        1.25,
        false,
        'b',
        'q"\\\n!',
        [[1, 2], [3], [0]],
        ['y', 'x'],
        [false, true],
        [2, 3],
        [2, null, 4],
        null,
      ],
      visible: true,
    },
  ],
};

const ECHO_SOLUTION = `class Echo {
public:
    Echo() {}
    int nextInt(int x) { return x + 1; }
    long long twice(long long x) { return x * 2; }
    double half(double x) { return x / 2; }
    bool flip(bool b) { return !b; }
    char next(char c) { return c + 1; }
    string shout(string s) { return s + "!"; }
    vector<vector<int>> grid(vector<vector<int>>& g) { g.push_back({0}); return g; }
    vector<string> names(vector<string>& n) { reverse(n.begin(), n.end()); return n; }
    vector<bool> flags(vector<bool>& f) { for (auto&& b : f) { b = !b; } return f; }
    ListNode* tail(ListNode* head) { return head->next; }
    TreeNode* left(TreeNode* root) { return root->left; }
    void reset() {}
};
`;

const TWO_SUM_BODY = `        unordered_map<int, int> seen;
        for (int i = 0; i < (int)nums.size(); i++) {
            auto found = seen.find(target - nums[i]);
            if (found != seen.end()) {
                return {found->second, i};
            }
            seen[nums[i]] = i;
        }
        return {};`;

function twoSum(body: string, head = ''): string {
  return `${head}class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
${body}
    }
};
`;
}

describe.skipIf(!clangOnPath)('createJudge with clang++', () => {
  let root = '';

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Writes `code` as the problem's `solution.cpp` in a fresh temp folder and
  // judges it on the problem's first case.
  async function judgeReal(problem: Problem, code: string) {
    root = mkdtempSync(join(tmpdir(), 'practice-judge-'));
    const folder = join(root, 'problems', problem.slug);
    mkdirSync(folder, { recursive: true });
    const codePath = join(folder, 'solution.cpp');
    writeFileSync(codePath, code);
    const judge = createJudge({
      files: createNodeFiles({
        trashItem: (path) => rm(path, { recursive: true, force: true }),
        os: OS_NAMES[process.platform] ?? 'linux',
      }),
      processes: hostNodeProcesses(),
      paths: posixPaths,
      clock: { now: () => Date.now() },
      settings: () => ({
        buildFolder: join(root, '.build'),
        compiler: 'clang++',
        flags: practiceManifest.settings.flags,
        // A case ending in a sanitizer report has run past 1 s on a busy machine.
        timeLimitMs: 3000,
      }),
    });
    return judge.judge(problem, codePath, cases(problem, 1), {
      stopAtFirstFailure: false,
    });
  }

  it('round-trips every value type through a design class', async () => {
    const result = await judgeReal(ECHO, ECHO_SOLUTION);

    expect(result.compileOutput).toBeNull();
    expect(result.cases[0].output).toEqual(expectedAnswer(ECHO.cases[0]));
    expect(result.verdict).toBe('accepted');
  }, 60_000);

  it.each([
    {
      name: 'a correct solution that prints',
      code: twoSum(`        cout << "hi" << endl;\n${TWO_SUM_BODY}`),
      verdict: 'accepted',
      check: { stdout: 'hi\n', output: [0, 1] },
    },
    {
      name: 'an empty answer',
      code: twoSum('        return {};'),
      verdict: 'wrongAnswer',
      check: { output: [] },
    },
    {
      name: 'an endless loop',
      code: twoSum('        while (true) {}\n        return {};'),
      verdict: 'timeLimit',
      check: {},
    },
    {
      name: 'a null pointer read',
      code: twoSum('        int* p = nullptr;\n        return {*p};'),
      verdict: 'runtimeError',
      check: {},
    },
    {
      name: 'a missing semicolon on line 4',
      code: twoSum('        int x = 1\n        return {x};'),
      verdict: 'compileError',
      check: {},
    },
    {
      name: 'a solution including bits/stdc++.h',
      code: twoSum(
        TWO_SUM_BODY,
        '#include <bits/stdc++.h>\nusing namespace std;\n\n',
      ),
      verdict: 'accepted',
      check: { output: [0, 1] },
    },
  ])(
    'judges a function solution: $name',
    async (row) => {
      const result = await judgeReal(TWO_SUM, row.code);

      expect(result.verdict, `the case ran ${result.cases[0]?.ms} ms`).toBe(
        row.verdict,
      );
      if (row.verdict === 'compileError') {
        expect(result.compileOutput).toContain('solution.cpp:4:');
      } else {
        expect(result.cases[0]).toMatchObject(row.check);
      }
    },
    60_000,
  );

  it.each([
    {
      name: 'a cyclic list input',
      problem: HAS_CYCLE,
      code: HAS_CYCLE_SOLUTION,
      verdict: 'accepted',
      stderr: '',
    },
    {
      name: 'a vector of lists',
      problem: MERGE_LISTS,
      code: MERGE_LISTS_SOLUTION,
      verdict: 'accepted',
      stderr: '',
    },
    {
      name: 'a graph deep copy',
      problem: CLONE_GRAPH,
      code: cloneGraph('copies[node] = new Node(node->val);'),
      verdict: 'accepted',
      stderr: '',
    },
    {
      name: 'a graph answer sharing a node with the input',
      problem: CLONE_GRAPH,
      code: 'class Solution {\npublic:\n    Node* cloneGraph(Node* node) { return node; }\n};\n',
      verdict: 'runtimeError',
      stderr: 'the answer shares node 1 with the input: return a deep copy',
    },
    {
      name: 'a random list deep copy',
      problem: COPY_RANDOM_LIST,
      code: COPY_RANDOM_LIST_SOLUTION,
      verdict: 'accepted',
      stderr: '',
    },
    {
      name: 'a random list answer sharing a node with the input',
      problem: COPY_RANDOM_LIST,
      code: 'class Solution {\npublic:\n    Node* copyRandomList(Node* head) { return head; }\n};\n',
      verdict: 'runtimeError',
      stderr: 'the answer shares node 7 with the input: return a deep copy',
    },
    {
      name: 'a list answer whose next pointers loop',
      problem: MERGE_LISTS,
      code: 'class Solution {\npublic:\n    ListNode* mergeKLists(vector<ListNode*>& lists) {\n        ListNode* head = new ListNode(1);\n        head->next = head;\n        return head;\n    }\n};\n',
      verdict: 'runtimeError',
      stderr: "the returned list's next pointers loop back",
    },
    {
      name: 'a codec round trip',
      problem: TREE_CODEC,
      code: TREE_CODEC_SOLUTION,
      verdict: 'accepted',
      stderr: '',
    },
    {
      name: 'a codec whose decoder reads the encoder instance',
      problem: TREE_CODEC,
      code: 'class Codec {\npublic:\n    string serialize(TreeNode* root) { kept = root; return ""; }\n    TreeNode* deserialize(string data) { return kept; }\nprivate:\n    TreeNode* kept = nullptr;\n};\n',
      verdict: 'wrongAnswer',
      stderr: '',
    },
  ])(
    'judges $name',
    async (row) => {
      const result = await judgeReal(row.problem, row.code);

      expect(result.compileOutput).toBeNull();
      expect(result.verdict, result.cases[0]?.stderr).toBe(row.verdict);
      expect(result.cases[0].stderr).toContain(row.stderr);
      if (row.verdict === 'accepted') {
        expect(result.cases[0].output).toEqual(
          expectedAnswer(row.problem.cases[0]),
        );
      }
    },
    60_000,
  );
});

const HAS_CYCLE: Problem = {
  slug: 'linked-list-cycle',
  title: 'Linked List Cycle',
  difficulty: 'easy',
  tags: [],
  lists: [],
  signature: {
    kind: 'function',
    method: 'hasCycle',
    params: [{ name: 'head', type: 'ListNode*' }],
    returns: 'bool',
  },
  compare: 'exact',
  cases: [
    {
      input: [{ values: [3, 2, 0, -4], pos: 1 }],
      expected: true,
      visible: true,
    },
  ],
};

const HAS_CYCLE_SOLUTION = `class Solution {
public:
    bool hasCycle(ListNode* head) {
        ListNode* slow = head;
        ListNode* fast = head;
        while (fast != nullptr && fast->next != nullptr) {
            slow = slow->next;
            fast = fast->next->next;
            if (slow == fast) return true;
        }
        return false;
    }
};
`;

const MERGE_LISTS: Problem = {
  slug: 'merge-k-sorted-lists',
  title: 'Merge k Sorted Lists',
  difficulty: 'hard',
  tags: [],
  lists: [],
  signature: {
    kind: 'function',
    method: 'mergeKLists',
    params: [{ name: 'lists', type: 'vector<ListNode*>' }],
    returns: 'ListNode*',
  },
  compare: 'exact',
  cases: [
    {
      input: [
        [
          [1, 4, 5],
          [1, 3, 4],
          [2, 6],
        ],
      ],
      expected: [1, 1, 2, 3, 4, 4, 5, 6],
      visible: true,
    },
  ],
};

const MERGE_LISTS_SOLUTION = `class Solution {
public:
    ListNode* mergeKLists(vector<ListNode*>& lists) {
        vector<int> values;
        for (ListNode* list : lists) {
            for (ListNode* node = list; node != nullptr; node = node->next) values.push_back(node->val);
        }
        sort(values.begin(), values.end());
        ListNode head;
        ListNode* tail = &head;
        for (int value : values) {
            tail->next = new ListNode(value);
            tail = tail->next;
        }
        return head.next;
    }
};
`;

const CLONE_GRAPH: Problem = {
  slug: 'clone-graph',
  title: 'Clone Graph',
  difficulty: 'medium',
  tags: [],
  lists: [],
  signature: {
    kind: 'function',
    method: 'cloneGraph',
    params: [{ name: 'node', type: 'GraphNode*' }],
    returns: 'GraphNode*',
  },
  compare: 'exact',
  cases: [
    {
      input: [
        [
          [2, 4],
          [1, 3],
          [2, 4],
          [1, 3],
        ],
      ],
      expected: [
        [2, 4],
        [1, 3],
        [2, 4],
        [1, 3],
      ],
      visible: true,
    },
  ],
};

function cloneGraph(copyLine: string): string {
  return `class Solution {
public:
    Node* cloneGraph(Node* start) {
        if (start == nullptr) return nullptr;
        unordered_map<Node*, Node*> copies;
        vector<Node*> pending = {start};
        Node* node = start;
        ${copyLine}
        while (!pending.empty()) {
            Node* current = pending.back();
            pending.pop_back();
            for (Node* neighbour : current->neighbors) {
                if (copies.count(neighbour) == 0) {
                    node = neighbour;
                    ${copyLine}
                    pending.push_back(neighbour);
                }
                copies[current]->neighbors.push_back(copies[neighbour]);
            }
        }
        return copies[start];
    }
};
`;
}

const COPY_RANDOM_LIST: Problem = {
  slug: 'copy-list-with-random-pointer',
  title: 'Copy List with Random Pointer',
  difficulty: 'medium',
  tags: [],
  lists: [],
  signature: {
    kind: 'function',
    method: 'copyRandomList',
    params: [{ name: 'head', type: 'RandomNode*' }],
    returns: 'RandomNode*',
  },
  compare: 'exact',
  cases: [
    {
      input: [
        [
          [7, null],
          [13, 0],
          [11, 4],
          [10, 2],
          [1, 0],
        ],
      ],
      expected: [
        [7, null],
        [13, 0],
        [11, 4],
        [10, 2],
        [1, 0],
      ],
      visible: true,
    },
  ],
};

const COPY_RANDOM_LIST_SOLUTION = `class Solution {
public:
    Node* copyRandomList(Node* head) {
        unordered_map<Node*, Node*> copies;
        for (Node* node = head; node != nullptr; node = node->next) copies[node] = new Node(node->val);
        for (Node* node = head; node != nullptr; node = node->next) {
            copies[node]->next = node->next == nullptr ? nullptr : copies[node->next];
            copies[node]->random = node->random == nullptr ? nullptr : copies[node->random];
        }
        return head == nullptr ? nullptr : copies[head];
    }
};
`;

const TREE_CODEC: Problem = {
  slug: 'serialize-and-deserialize-binary-tree',
  title: 'Serialize and Deserialize Binary Tree',
  difficulty: 'hard',
  tags: [],
  lists: [],
  signature: {
    kind: 'codec',
    className: 'Codec',
    encode: 'serialize',
    decode: 'deserialize',
    type: 'TreeNode*',
  },
  compare: 'exact',
  cases: [{ input: [1, 2, 3, null, null, 4, 5], visible: true }],
};

const TREE_CODEC_SOLUTION = `class Codec {
public:
    string serialize(TreeNode* root) {
        if (root == nullptr) return "#";
        return to_string(root->val) + " " + serialize(root->left) + " " + serialize(root->right);
    }

    TreeNode* deserialize(string data) {
        istringstream in(data);
        return read(in);
    }

private:
    TreeNode* read(istringstream& in) {
        string token;
        in >> token;
        if (token == "#") return nullptr;
        TreeNode* node = new TreeNode(stoi(token));
        node->left = read(in);
        node->right = read(in);
        return node;
    }
};
`;
