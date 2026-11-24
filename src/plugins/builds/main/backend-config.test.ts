import { describe, expect, it } from 'vitest';
import { parseBackends } from './backend-config';

const expandTilde = (text: string) => text.replace('~', '/home/u');

function validSet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rc',
    label: 'RC set',
    kinds: ['dev'],
    branches: 'releases/*',
    agentPrompt: 'Make an RC set.',
    ...overrides,
  };
}

function validGame(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: `Game ${id}`,
    clone: '/c',
    defaultBranch: 'main',
    kinds: { dev: { label: 'Dev', target: 'dev-target' } },
    sets: [validSet()],
    ...overrides,
  };
}

function validBackend(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    kind: 'local',
    label: 'Backend',
    config: {},
    games: [validGame('g1'), validGame('g2')],
    ...overrides,
  };
}

// The setting with game `g1` changed by `overrides`, beside a valid `g2`.
function withGame1(overrides: Record<string, unknown>): unknown[] {
  return [
    validBackend({ games: [validGame('g1', overrides), validGame('g2')] }),
  ];
}

// The setting with `g1`'s one set changed by `overrides`.
function withSet(overrides: Record<string, unknown>): unknown[] {
  return withGame1({ sets: [validSet(overrides)] });
}

// The setting with `g1`'s kind `dev` given `downloads`.
function withDownloads(downloads: unknown): unknown[] {
  return withGame1({
    kinds: { dev: { label: 'Dev', target: 'dev-target', downloads } },
  });
}

describe('parseBackends', () => {
  it.each([
    {
      case: 'not an object',
      input: ['b1'],
      problem: 'entry 1 is not an object',
      level: 'backend',
    },
    {
      case: 'no id',
      input: [validBackend({ id: '' })],
      problem: 'entry 1 has no id',
      level: 'backend',
    },
    {
      case: 'id with a slash',
      input: [validBackend({ id: 'a/b' })],
      problem: 'a/b is not a valid id',
      level: 'backend',
    },
    {
      case: 'id of dots',
      input: [validBackend({ id: '..' })],
      problem: '.. is not a valid id',
      level: 'backend',
    },
    {
      case: 'id with a space',
      input: [validBackend({ id: 'my ci' })],
      problem: 'my ci is not a valid id',
      level: 'backend',
    },
    {
      case: 'duplicate id, other case',
      input: [validBackend({ id: 'Work' }), validBackend({ id: 'work' })],
      problem: 'duplicate backend id "work"',
      level: 'backend',
      id: 'work#2',
    },
    {
      case: 'no kind',
      input: [validBackend({ kind: 3 })],
      problem: 'b1 has no kind',
      level: 'backend',
    },
    {
      case: 'no label',
      input: [validBackend({ label: '' })],
      problem: 'b1 has no label',
      level: 'backend',
    },
    {
      case: 'games not a list',
      input: [validBackend({ games: {} })],
      problem: 'b1: games is not a list',
      level: 'backend',
    },
    {
      case: 'game not an object',
      input: [validBackend({ games: ['g1', validGame('g2')] })],
      problem: 'game 1 has no id',
      level: 'game',
    },
    {
      case: 'duplicate game id',
      input: [validBackend({ games: [validGame('g2'), validGame('g2')] })],
      problem: 'duplicate game id "g2"',
      level: 'game',
    },
    {
      case: 'game with no label',
      input: withGame1({ label: '' }),
      problem: 'game g1 has no label',
      level: 'game',
    },
    {
      case: 'clone not a path',
      input: withGame1({ clone: 5 }),
      problem: 'game g1: clone is not a path',
      level: 'game',
    },
    {
      case: 'clone empty',
      input: withGame1({ clone: '' }),
      problem: 'game g1: clone is not a path',
      level: 'game',
    },
    {
      case: 'no defaultBranch',
      input: withGame1({ defaultBranch: '' }),
      problem: 'game g1 has no defaultBranch',
      level: 'game',
    },
    {
      case: 'empty kinds',
      input: withGame1({ kinds: {} }),
      problem: 'game g1 has no kinds',
      level: 'game',
    },
    {
      case: 'kind with no target',
      input: withGame1({ kinds: { dev: { label: 'Dev' } } }),
      problem: 'game g1: kind dev needs a label and a target',
      level: 'game',
    },
    {
      case: 'downloads not a list',
      input: withDownloads('x'),
      problem: 'game g1: kind dev: downloads is not a list',
      level: 'game',
    },
    {
      case: 'download with no path',
      input: withDownloads([{ label: 'Zip' }]),
      problem: 'game g1: kind dev: download 1 needs a label and a path',
      level: 'game',
    },
    {
      case: 'download with an empty label',
      input: withDownloads([{ label: '', path: '/p' }]),
      problem: 'game g1: kind dev: download 1 needs a label and a path',
      level: 'game',
    },
    {
      case: 'download not an object',
      input: withDownloads(['x']),
      problem: 'game g1: kind dev: download 1 needs a label and a path',
      level: 'game',
    },
    {
      case: 'download null',
      input: withDownloads([null]),
      problem: 'game g1: kind dev: download 1 needs a label and a path',
      level: 'game',
    },
    {
      case: 'download with an empty path',
      input: withDownloads([{ label: 'Zip', path: '' }]),
      problem: 'game g1: kind dev: download 1 needs a label and a path',
      level: 'game',
    },
    {
      case: 'second download with no path',
      input: withDownloads([{ label: 'A', path: '/a' }, { label: 'B' }]),
      problem: 'game g1: kind dev: download 2 needs a label and a path',
      level: 'game',
    },
    {
      case: 'sets not a list',
      input: withGame1({ sets: 'rc' }),
      problem: 'game g1: sets is not a list',
      level: 'game',
    },
    {
      case: 'set not an object',
      input: withGame1({ sets: [5] }),
      problem: 'game g1: set 1 has no id',
      level: 'game',
    },
    {
      case: 'duplicate set id',
      input: withGame1({ sets: [validSet(), validSet()] }),
      problem: 'game g1: duplicate set id "rc"',
      level: 'game',
    },
    {
      case: "set with a kind's id",
      input: withSet({ id: 'dev' }),
      problem: 'game g1: set "dev" has a kind\'s id',
      level: 'game',
    },
    {
      case: 'set with no label',
      input: withSet({ label: '' }),
      problem: 'game g1: set rc has no label',
      level: 'game',
    },
    {
      case: 'set with no kinds',
      input: withSet({ kinds: [] }),
      problem: 'game g1: set rc has no kinds',
      level: 'game',
    },
    {
      case: 'set naming no kind',
      input: withSet({ kinds: ['dev', 'qa'] }),
      problem: 'game g1: set rc names no kind "qa"',
      level: 'game',
    },
    {
      case: 'set with no branches',
      input: withSet({ branches: '' }),
      problem: 'game g1: set rc has no branches',
      level: 'game',
    },
    {
      case: 'agentPrompt not text',
      input: withSet({ agentPrompt: 5 }),
      problem: 'game g1: set rc: agentPrompt is not text',
      level: 'game',
    },
  ])('$case → $problem', ({ input, problem, level, id }) => {
    const parsed = parseBackends(input, expandTilde).at(-1);

    expect(parsed?.problems).toEqual([problem]);
    if (level === 'backend') {
      expect(parsed?.entry).toBeNull();
    } else {
      expect(parsed?.entry?.games.map((game) => game.id)).toEqual(['g2']);
    }
    if (id !== undefined) {
      expect(parsed?.id).toBe(id);
    }
  });

  it.each([
    {
      case: 'one game fails two checks',
      input: withGame1({ label: '', defaultBranch: '' }),
      problems: ['game g1 has no label'],
      hasEntry: true,
    },
    {
      case: 'two games fail',
      input: [
        validBackend({
          games: [
            validGame('g1', { kinds: undefined }),
            validGame('g2'),
            validGame('g3', { defaultBranch: '' }),
          ],
        }),
      ],
      problems: ['game g1 has no kinds', 'game g3 has no defaultBranch'],
      hasEntry: true,
    },
    {
      case: 'backend fails two checks',
      input: [validBackend({ kind: '', label: '' })],
      problems: ['b1 has no kind'],
      hasEntry: false,
    },
  ])('first check and order: $case', ({ input, problems, hasEntry }) => {
    const [parsed] = parseBackends(input, expandTilde);

    expect(parsed.problems).toEqual(problems);
    expect(parsed.entry !== null).toBe(hasEntry);
  });

  it('expands ~ in clone and fills the optional fields', () => {
    const target = { command: 'make', args: [] };
    const zip = { label: 'Android zip', path: '~/d/{version}.zip', extra: 1 };
    const [parsed] = parseBackends(
      [
        validBackend({
          config: { command: '' },
          games: [
            validGame('g1', {
              clone: '~/dev/game',
              kinds: {
                dev: { label: 'Dev', target, downloads: [zip] },
                qa: { label: 'QA', target: 'qa-target', downloads: null },
              },
              sets: undefined,
            }),
            validGame('g2', {
              clone: null,
              sets: [validSet({ agentPrompt: undefined })],
            }),
          ],
        }),
      ],
      expandTilde,
    );

    expect(parsed.entry).toEqual({
      id: 'b1',
      kind: 'local',
      label: 'Backend',
      config: { command: '' },
      games: [
        {
          id: 'g1',
          label: 'Game g1',
          clone: '/home/u/dev/game',
          defaultBranch: 'main',
          kinds: {
            dev: {
              label: 'Dev',
              target: { command: 'make', args: [] },
              downloads: [
                { label: 'Android zip', path: '/home/u/d/{version}.zip' },
              ],
            },
            qa: { label: 'QA', target: 'qa-target', downloads: [] },
          },
          sets: [],
        },
        {
          id: 'g2',
          label: 'Game g2',
          clone: null,
          defaultBranch: 'main',
          kinds: { dev: { label: 'Dev', target: 'dev-target', downloads: [] } },
          sets: [
            {
              id: 'rc',
              label: 'RC set',
              kinds: ['dev'],
              branches: 'releases/*',
              agentPrompt: null,
            },
          ],
        },
      ],
    });
  });
});
