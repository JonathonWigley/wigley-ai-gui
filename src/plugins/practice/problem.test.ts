import { describe, expect, it } from 'vitest';
import {
  parseCustomCases,
  parseProblem,
  parseValueType,
  problemJson,
  ProblemError,
  type DesignSignature,
} from './problem';

type Json = Record<string, unknown>;

function validProblem(overrides: Json = {}): Json {
  return {
    title: 'Two Sum',
    difficulty: 'easy',
    signature: {
      kind: 'function',
      method: 'twoSum',
      params: [
        { name: 'nums', type: 'vector<int>' },
        { name: 'target', type: 'int' },
      ],
      returns: 'vector<int>',
    },
    cases: [
      { input: [[2, 7, 11, 15], 9], expected: [0, 1], visible: true },
      { input: [[3, 2, 4], 6], expected: [1, 2], visible: false },
    ],
    ...overrides,
  };
}

function counterSignature(overrides: Json = {}): Json {
  return {
    kind: 'design',
    className: 'Counter',
    constructor: [{ name: 'start', type: 'int' }],
    methods: [
      { name: 'add', params: [{ name: 'n', type: 'int' }], returns: 'void' },
      { name: 'get', params: [], returns: 'int' },
    ],
    ...overrides,
  };
}

function counterCase(overrides: Json = {}): Json {
  return {
    ops: ['Counter', 'add', 'get'],
    args: [[1], [2], []],
    expected: [null, null, 3],
    visible: true,
    ...overrides,
  };
}

function validDesign(overrides: Json = {}): Json {
  return {
    title: 'Counter',
    difficulty: 'medium',
    tags: ['design'],
    lists: ['Basics'],
    signature: counterSignature(),
    cases: [counterCase()],
    ...overrides,
  };
}

function withParamType(name: string, type: string, value: unknown): Json {
  return validProblem({
    signature: {
      kind: 'function',
      method: 'f',
      params: [
        { name: 'a', type: 'int' },
        { name, type },
      ],
      returns: 'int',
    },
    cases: [{ input: [1, value], expected: 0, visible: true }],
  });
}

function validCodec(overrides: Json = {}): Json {
  return {
    title: 'Encode and Decode Strings',
    difficulty: 'medium',
    signature: {
      kind: 'codec',
      className: 'Codec',
      encode: 'encode',
      decode: 'decode',
      type: 'vector<string>',
    },
    cases: [{ input: ['lint', 'code'], visible: true }],
    ...overrides,
  };
}

function caughtField(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ProblemError) {
      return error.field;
    }
    throw error;
  }
  throw new Error('expected a ProblemError');
}

describe('parseProblem', () => {
  it('accepts a valid problem and fills defaults', () => {
    const problem = parseProblem(validProblem(), 'two-sum');

    expect(problem).toMatchObject({
      slug: 'two-sum',
      title: 'Two Sum',
      tags: [],
      lists: [],
      compare: 'exact',
    });
    expect(problem.cases).toHaveLength(2);
  });

  it.each([
    { name: 'root not an object', json: [], field: '(root)' },
    { name: 'empty title', json: validProblem({ title: '' }), field: 'title' },
    {
      name: 'capitalised difficulty',
      json: validProblem({ difficulty: 'Easy' }),
      field: 'difficulty',
    },
    {
      name: 'non-string tag',
      json: validProblem({ tags: [1] }),
      field: 'tags[0]',
    },
    {
      name: 'misspelt case key',
      json: validProblem({
        cases: [{ input: [[1, 2], 3], expected: [0, 1], visable: true }],
      }),
      field: 'cases[0].visable',
    },
    {
      name: 'unknown root key',
      json: validProblem({ kind: 'function' }),
      field: 'kind',
    },
    { name: 'no cases', json: validProblem({ cases: [] }), field: 'cases' },
    {
      name: 'no visible case',
      json: validProblem({
        cases: [{ input: [[1, 2], 3], expected: [0, 1], visible: false }],
      }),
      field: 'cases',
    },
    {
      name: 'unknown signature kind',
      json: validProblem({ signature: { kind: 'other' } }),
      field: 'signature.kind',
    },
    {
      name: 'method not an identifier',
      json: validProblem({
        signature: {
          kind: 'function',
          method: 'two-sum',
          params: [],
          returns: 'int',
        },
      }),
      field: 'signature.method',
    },
    {
      name: 'duplicate param names',
      json: validProblem({
        signature: {
          kind: 'function',
          method: 'twoSum',
          params: [
            { name: 'nums', type: 'vector<int>' },
            { name: 'nums', type: 'int' },
          ],
          returns: 'vector<int>',
        },
      }),
      field: 'signature.params[1].name',
    },
    {
      name: 'unsupported param type',
      json: validProblem({
        signature: {
          kind: 'function',
          method: 'twoSum',
          params: [{ name: 'n', type: 'unsigned' }],
          returns: 'int',
        },
      }),
      field: 'signature.params[0].type',
    },
    {
      name: 'void function return',
      json: validProblem({
        signature: {
          kind: 'function',
          method: 'twoSum',
          params: [],
          returns: 'void',
        },
      }),
      field: 'signature.returns',
    },
    {
      name: 'one input for two params',
      json: validProblem({
        cases: [{ input: [[1, 2]], expected: [0, 1], visible: true }],
      }),
      field: 'cases[0].input',
    },
    {
      name: 'string for int',
      json: validProblem({
        cases: [{ input: [[1, 2], '7'], expected: [0, 1], visible: true }],
      }),
      field: 'cases[0].input[1]',
    },
    {
      name: 'int past its range',
      json: validProblem({
        cases: [
          { input: [[1, 2], 2147483648], expected: [0, 1], visible: true },
        ],
      }),
      field: 'cases[0].input[1]',
    },
    {
      name: 'fraction for int',
      json: validProblem({
        cases: [{ input: [[1, 2], 2.5], expected: [0, 1], visible: true }],
      }),
      field: 'cases[0].input[1]',
    },
    {
      name: 'long long past the safe range',
      json: withParamType('big', 'long long', Number.MAX_SAFE_INTEGER + 1),
      field: 'cases[0].input[1]',
    },
    {
      name: 'two letters for char',
      json: withParamType('c', 'char', 'ab'),
      field: 'cases[0].input[1]',
    },
    {
      name: 'tree starting with null',
      json: withParamType('root', 'TreeNode*', [null, 1]),
      field: 'cases[0].input[1]',
    },
    {
      name: 'tree with values past its last node',
      json: withParamType('root', 'TreeNode*', [1, null, null, 2]),
      field: 'cases[0].input[1]',
    },
    {
      name: 'list holding null',
      json: withParamType('head', 'ListNode*', [1, null]),
      field: 'cases[0].input[1]',
    },
    {
      name: 'expected of the wrong type',
      json: validProblem({
        cases: [{ input: [[1, 2], 3], expected: 'x', visible: true }],
      }),
      field: 'cases[0].expected',
    },
    {
      name: 'design first op not the class',
      json: validDesign({
        cases: [counterCase({ ops: ['add', 'add', 'get'] })],
      }),
      field: 'cases[0].ops[0]',
    },
    {
      name: 'design op naming no method',
      json: validDesign({
        cases: [counterCase({ ops: ['Counter', 'add', 'reset'] })],
      }),
      field: 'cases[0].ops[2]',
    },
    {
      name: 'design constructor answer not null',
      json: validDesign({ cases: [counterCase({ expected: [1, null, 3] })] }),
      field: 'cases[0].expected[0]',
    },
    {
      name: 'design signature without a constructor key',
      json: validDesign({
        signature: {
          kind: 'design',
          className: 'Counter',
          methods: [{ name: 'get', params: [], returns: 'int' }],
        },
      }),
      field: 'signature.constructor',
    },
    {
      name: 'design void method answering a value',
      json: validDesign({ cases: [counterCase({ expected: [null, 3, 3] })] }),
      field: 'cases[0].expected[1]',
    },
    {
      name: 'design lengths differ',
      json: validDesign({ cases: [counterCase({ args: [[1], [2]] })] }),
      field: 'cases[0].args',
    },
    {
      name: 'anyOrder on a design problem',
      json: validDesign({ compare: 'anyOrder' }),
      field: 'compare',
    },
    {
      name: 'a cyclic list as an answer',
      json: validProblem({
        signature: {
          kind: 'function',
          method: 'f',
          params: [{ name: 'head', type: 'ListNode*' }],
          returns: 'ListNode*',
        },
        cases: [
          {
            input: [[1]],
            expected: { values: [1], pos: 0 },
            visible: true,
          },
        ],
      }),
      field: 'cases[0].expected',
    },
    {
      name: 'a cycle position past the list',
      json: withParamType('head', 'ListNode*', { values: [1, 2], pos: 2 }),
      field: 'cases[0].input[1]',
    },
    {
      name: 'a graph neighbour past the last node',
      json: withParamType('node', 'GraphNode*', [[2], [3]]),
      field: 'cases[0].input[1]',
    },
    {
      name: 'a random index past the last node',
      json: withParamType('head', 'RandomNode*', [[7, 1]]),
      field: 'cases[0].input[1]',
    },
    {
      name: 'both node types a solution spells Node',
      json: validProblem({
        signature: {
          kind: 'function',
          method: 'f',
          params: [{ name: 'node', type: 'GraphNode*' }],
          returns: 'RandomNode*',
        },
        cases: [{ input: [[]], expected: [], visible: true }],
      }),
      field: 'signature',
    },
    {
      name: 'a codec compared out of order',
      json: validCodec({ compare: 'anyOrder' }),
      field: 'compare',
    },
    {
      name: 'a codec case with an expected answer',
      json: validCodec({
        cases: [{ input: ['a'], expected: ['a'], visible: true }],
      }),
      field: 'cases[0].expected',
    },
    {
      name: 'a codec whose encode and decode share a name',
      json: validCodec({
        signature: {
          kind: 'codec',
          className: 'Codec',
          encode: 'code',
          decode: 'code',
          type: 'vector<string>',
        },
      }),
      field: 'signature',
    },
  ])('refuses $name, naming $field', ({ json, field }) => {
    expect(caughtField(() => parseProblem(json, 'two-sum'))).toBe(field);
  });

  it('refuses a slug that is not lower-case words joined by dashes', () => {
    expect(caughtField(() => parseProblem(validProblem(), 'Two Sum'))).toBe(
      'slug',
    );
  });

  it('names the bad value in the message', () => {
    const json = validProblem({
      cases: [{ input: [[1, 2], '7'], expected: [0, 1], visible: true }],
    });

    expect(() => parseProblem(json, 'two-sum')).toThrow('"7"');
  });

  it.each([
    {
      name: 'trailing nulls',
      tree: [1, null, 2, null, null],
      read: [1, null, 2],
    },
    { name: 'only nulls past the root', tree: [1, null, null], read: [1] },
    { name: 'no trailing null', tree: [1, 2, 3], read: [1, 2, 3] },
    { name: 'an empty tree', tree: [], read: [] },
  ])('reads a tree without its trailing nulls: $name', ({ tree, read }) => {
    const json = validProblem({
      signature: {
        kind: 'function',
        method: 'same',
        params: [{ name: 'root', type: 'TreeNode*' }],
        returns: 'TreeNode*',
      },
      cases: [{ input: [tree], expected: tree, visible: true }],
    });

    const problem = parseProblem(json, 'trees');

    expect(problem.cases[0]).toEqual({
      input: [read],
      expected: read,
      visible: true,
    });
  });

  it.each([
    {
      name: 'a cyclic list',
      type: 'ListNode*',
      value: { values: [3, 2, 0, -4], pos: 1 },
    },
    {
      name: 'a list with no cycle',
      type: 'ListNode*',
      value: { values: [1], pos: -1 },
    },
    { name: 'a graph', type: 'GraphNode*', value: [[2], [1]] },
    {
      name: 'a random list',
      type: 'RandomNode*',
      value: [
        [7, null],
        [13, 0],
      ],
    },
  ])('accepts $name as an input', ({ type, value }) => {
    const problem = parseProblem(withParamType('x', type, value), 'nodes');

    expect(problem.cases[0]).toMatchObject({ input: [1, value] });
  });

  it('reads each tree of a vector without its trailing nulls', () => {
    const json = withParamType('roots', 'vector<TreeNode*>', [
      [1, null, null],
      [],
    ]);

    const problem = parseProblem(json, 'forest');

    expect(problem.cases[0]).toMatchObject({ input: [1, [[1], []]] });
  });

  it('reads a nested type spelling as its canonical form', () => {
    const json = validProblem({
      signature: {
        kind: 'function',
        method: 'f',
        params: [{ name: 'grid', type: 'vector < vector<int> >' }],
        returns: 'int',
      },
      cases: [{ input: [[[1], [2, 3]]], expected: 0, visible: true }],
    });

    const problem = parseProblem(json, 'grid');

    expect(problem.signature).toMatchObject({
      params: [{ name: 'grid', type: 'vector<vector<int>>' }],
    });
  });
});

describe('parseValueType', () => {
  it.each([
    { text: 'int', type: 'int' },
    { text: 'long  long', type: 'long long' },
    { text: ' vector < int > ', type: 'vector<int>' },
    { text: 'vector<vector<string>>', type: 'vector<vector<string>>' },
    { text: 'std::vector<std::string>', type: 'vector<string>' },
    { text: 'ListNode *', type: 'ListNode*' },
    { text: 'TreeNode*', type: 'TreeNode*' },
    { text: 'void', type: 'void' },
    { text: 'unsigned', type: null },
    { text: 'pair<int,int>', type: null },
    { text: 'vector<ListNode*>', type: 'vector<ListNode*>' },
    { text: 'vector<TreeNode *>', type: 'vector<TreeNode*>' },
    { text: 'GraphNode*', type: 'GraphNode*' },
    { text: 'RandomNode*', type: 'RandomNode*' },
    { text: 'vector<GraphNode*>', type: null },
    { text: 'Node*', type: null },
    { text: 'vector<int', type: null },
    { text: 'int*', type: null },
  ])('reads "$text" as $type', ({ text, type }) => {
    expect(parseValueType(text)).toBe(type);
  });
});

describe('parseCustomCases', () => {
  const twoSum = parseProblem(validProblem(), 'two-sum').signature;
  const counter = parseProblem(validDesign(), 'counter')
    .signature as DesignSignature;

  it.each([
    { name: 'empty text', text: '  \n', signature: twoSum, cases: [] },
    {
      name: 'a function input',
      text: '[[[1,2],3]]',
      signature: twoSum,
      cases: [{ input: [[1, 2], 3] }],
    },
    {
      name: 'a design call list',
      text: '[{"ops":["Counter","get"],"args":[[1],[]]}]',
      signature: counter,
      cases: [{ ops: ['Counter', 'get'], args: [[1], []] }],
    },
    {
      name: 'a codec value',
      text: '[["a","b"]]',
      signature: parseProblem(validCodec(), 'codec').signature,
      cases: [{ value: ['a', 'b'] }],
    },
  ])('reads $name', ({ text, signature, cases }) => {
    expect(parseCustomCases(text, signature)).toEqual(cases);
  });

  it.each([
    { name: 'one value for two params', text: '[[[1,2]]]', field: '[0]' },
    { name: 'text that is not JSON', text: 'not json', field: '(root)' },
  ])('refuses $name, naming $field', ({ text, field }) => {
    expect(caughtField(() => parseCustomCases(text, twoSum))).toBe(field);
  });
});

describe('problemJson', () => {
  it.each([
    { name: 'a function problem', json: validProblem({ compare: 'anyOrder' }) },
    { name: 'a design problem', json: validDesign({ compare: 'float' }) },
    { name: 'a codec problem', json: validCodec() },
  ])('round-trips $name', ({ json }) => {
    const problem = parseProblem(json, 'some-slug');

    const reread = parseProblem(JSON.parse(problemJson(problem)), 'some-slug');

    expect(reread).toEqual(problem);
  });
});
