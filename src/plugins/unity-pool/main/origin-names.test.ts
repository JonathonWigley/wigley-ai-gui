import { describe, expect, it } from 'vitest';
import { createOriginNames } from './origin-names';

const NAME_OF_A = 'repo-of-a';
const NAME_OF_B = 'repo-of-b';

describe('createOriginNames', () => {
  // `rounds` holds the folders asked together, each round settling before the
  // next. `firstAnswer` is what git gives its first call, every later call
  // answering with the folder's repo name. A rejection reads as `rejected`.
  it.each<{
    name: string;
    firstAnswer?: () => Promise<string | null>;
    rounds: string[][];
    gitCalls: string[];
    results: (string | null)[];
  }>([
    {
      name: 'one folder asked while its lookup is pending',
      rounds: [['/a', '/a']],
      gitCalls: ['/a'],
      results: [NAME_OF_A, NAME_OF_A],
    },
    {
      name: 'one folder asked after its lookup landed',
      rounds: [['/a'], ['/a']],
      gitCalls: ['/a'],
      results: [NAME_OF_A, NAME_OF_A],
    },
    {
      name: 'two folders',
      rounds: [['/a', '/b']],
      gitCalls: ['/a', '/b'],
      results: [NAME_OF_A, NAME_OF_B],
    },
    {
      name: 'a null from git stays cached',
      firstAnswer: async () => null,
      rounds: [['/a'], ['/a']],
      gitCalls: ['/a'],
      results: [null, null],
    },
    {
      name: 'a rejected lookup is asked again',
      firstAnswer: () => Promise.reject(new Error('git cannot start')),
      rounds: [['/a'], ['/a']],
      gitCalls: ['/a', '/a'],
      results: ['rejected', NAME_OF_A],
    },
  ])(
    'cachesOneLookupPerFolder: $name',
    async ({ firstAnswer, rounds, gitCalls, results }) => {
      const calls: string[] = [];
      const originName = createOriginNames({
        originRepoName: (folder) => {
          calls.push(folder);
          if (calls.length === 1 && firstAnswer !== undefined) {
            return firstAnswer();
          }
          return Promise.resolve(folder === '/a' ? NAME_OF_A : NAME_OF_B);
        },
      });

      const settled: (string | null)[] = [];
      for (const round of rounds) {
        const answers = await Promise.all(
          round.map((folder) => originName(folder).catch(() => 'rejected')),
        );
        settled.push(...answers);
      }

      expect(calls).toEqual(gitCalls);
      expect(settled).toEqual(results);
    },
  );
});
