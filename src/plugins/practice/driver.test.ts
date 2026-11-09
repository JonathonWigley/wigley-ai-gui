import { describe, expect, it } from 'vitest';
import { driverSource, stubSource } from './driver';
import type { Problem } from './problem';

function problemWith(signature: Problem['signature']): Problem {
  return {
    slug: 'some-problem',
    title: 'Some Problem',
    difficulty: 'easy',
    tags: [],
    lists: [],
    signature,
    compare: 'exact',
    cases: [],
  };
}

describe('stubSource', () => {
  it.each<{ name: string; signature: Problem['signature']; stub: string }>([
    {
      name: 'a function taking a vector by reference',
      signature: {
        kind: 'function',
        method: 'twoSum',
        params: [
          { name: 'nums', type: 'vector<int>' },
          { name: 'target', type: 'int' },
        ],
        returns: 'vector<int>',
      },
      stub: [
        'class Solution {',
        'public:',
        '    vector<int> twoSum(vector<int>& nums, int target) {',
        '        ',
        '    }',
        '};',
        '',
      ].join('\n'),
    },
    {
      name: 'a function taking a string and a list by value',
      signature: {
        kind: 'function',
        method: 'insertAfter',
        params: [
          { name: 's', type: 'string' },
          { name: 'head', type: 'ListNode*' },
        ],
        returns: 'ListNode*',
      },
      stub: [
        'class Solution {',
        'public:',
        '    ListNode* insertAfter(string s, ListNode* head) {',
        '        ',
        '    }',
        '};',
        '',
      ].join('\n'),
    },
    {
      name: 'a design class',
      signature: {
        kind: 'design',
        className: 'LRUCache',
        constructor: [{ name: 'capacity', type: 'int' }],
        methods: [
          {
            name: 'get',
            params: [{ name: 'key', type: 'int' }],
            returns: 'int',
          },
          {
            name: 'put',
            params: [
              { name: 'key', type: 'int' },
              { name: 'value', type: 'int' },
            ],
            returns: 'void',
          },
        ],
      },
      stub: [
        'class LRUCache {',
        'public:',
        '    LRUCache(int capacity) {',
        '        ',
        '    }',
        '    ',
        '    int get(int key) {',
        '        ',
        '    }',
        '    ',
        '    void put(int key, int value) {',
        '        ',
        '    }',
        '};',
        '',
      ].join('\n'),
    },
  ])("writes LeetCode's stub for $name", ({ signature, stub }) => {
    expect(stubSource(problemWith(signature))).toBe(stub);
  });
});

describe('driverSource', () => {
  const problem = problemWith({
    kind: 'function',
    method: 'twoSum',
    params: [{ name: 'nums', type: 'vector<int>' }],
    returns: 'vector<int>',
  });

  it('includes the solution by its path as given', () => {
    expect(driverSource(problem, 'C:\\leet code\\solution.cpp')).toContain(
      '#include "C:\\leet code\\solution.cpp"',
    );
  });

  it.each([
    { name: 'a quote', path: '/leet"code/solution.cpp' },
    { name: 'a line break', path: '/leet\ncode/solution.cpp' },
    { name: 'a carriage return', path: '/leet\rcode/solution.cpp' },
  ])('refuses a path holding $name', ({ path }) => {
    expect(() => driverSource(problem, path)).toThrow(
      'driverSource: cannot #include a path holding a quote or line break',
    );
  });
});
