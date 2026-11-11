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
import { createNodeProcesses } from '../../../main/processes/node-processes';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { practiceManifest } from '../manifest';
import type { Problem } from '../problem';
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
      processes: createNodeProcesses(),
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
    expect(result.cases[0].output).toEqual(ECHO.cases[0].expected);
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
});
