import { describe, expect, it } from 'vitest';
import { mapCompileErrors } from './compile-errors';

const SOLUTION = '/u/leetcode/problems/two-sum/solution.cpp';
const DRIVER = '/b/.build/two-sum/solution/driver.cpp';

describe('mapCompileErrors', () => {
  it.each([
    {
      name: 'a solution error to its base name',
      output: `${SOLUTION}:4:9: error: x`,
      path: SOLUTION,
      mapped: 'solution.cpp:4:9: error: x',
    },
    {
      name: 'the include lines away',
      output: `In file included from ${DRIVER}:210:\n${SOLUTION}:4:9: error: x`,
      path: SOLUTION,
      mapped: 'solution.cpp:4:9: error: x',
    },
    {
      name: 'a driver line as it is',
      output: `${DRIVER}:230:31: error: no matching member function`,
      path: SOLUTION,
      mapped: `${DRIVER}:230:31: error: no matching member function`,
    },
    {
      name: 'a note pointing into the solution',
      output: `${DRIVER}:230:31: error: no match\n${SOLUTION}:3:17: note: candidate`,
      path: SOLUTION,
      mapped: `${DRIVER}:230:31: error: no match\nsolution.cpp:3:17: note: candidate`,
    },
    {
      name: 'the reference path',
      output: '/b/.build/x/import/reference.cpp:8:1: error: y',
      path: '/b/.build/x/import/reference.cpp',
      mapped: 'reference.cpp:8:1: error: y',
    },
    {
      name: 'a path holding regex characters',
      output: '/u/a+b (1)/solution.cpp:2:3: error: z',
      path: '/u/a+b (1)/solution.cpp',
      mapped: 'solution.cpp:2:3: error: z',
    },
  ])('maps $name', ({ output, path, mapped }) => {
    expect(mapCompileErrors(output, path)).toBe(mapped);
  });
});
