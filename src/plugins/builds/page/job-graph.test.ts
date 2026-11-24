import { describe, expect, it } from 'vitest';
import type { BuildJob } from '../contract';
import { buildJob } from '../contract.test-support';
import { defaultJob, type GraphMove, jobGraph, movedJob } from './job-graph';

// Jobs built from `[id, dependsOn]` pairs, in order.
function jobsOf(pairs: [string, string[]][]): BuildJob[] {
  return pairs.map(([id, dependsOn]) => buildJob({ id, dependsOn }));
}

describe('jobGraph', () => {
  it.each<{
    case: string;
    jobs: [string, string[]][];
    columns: string[][];
    edges: { from: string; to: string }[];
  }>([
    { case: 'no jobs', jobs: [], columns: [], edges: [] },
    {
      case: 'independent jobs keep their order',
      jobs: [
        ['b', []],
        ['a', []],
      ],
      columns: [['b', 'a']],
      edges: [],
    },
    {
      case: 'longest chain sets the column',
      jobs: [
        ['a', []],
        ['b', ['a']],
        ['c', ['a', 'b']],
      ],
      columns: [['a'], ['b'], ['c']],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
      ],
    },
    {
      case: 'a job listed before its prerequisite',
      jobs: [
        ['d', ['e']],
        ['e', []],
      ],
      columns: [['e'], ['d']],
      edges: [{ from: 'e', to: 'd' }],
    },
    {
      case: 'a missing id is ignored',
      jobs: [
        ['a', ['x']],
        ['b', ['a']],
      ],
      columns: [['a'], ['b']],
      edges: [{ from: 'a', to: 'b' }],
    },
    {
      case: 'a repeated id gives one edge',
      jobs: [
        ['a', []],
        ['b', ['a', 'a']],
      ],
      columns: [['a'], ['b']],
      edges: [{ from: 'a', to: 'b' }],
    },
    {
      case: 'a two-job cycle',
      jobs: [
        ['a', ['b']],
        ['b', ['a']],
      ],
      columns: [['b'], ['a']],
      edges: [{ from: 'b', to: 'a' }],
    },
    {
      case: 'a self-dependency',
      jobs: [['a', ['a']]],
      columns: [['a']],
      edges: [],
    },
    {
      case: 'a three-job cycle',
      jobs: [
        ['a', ['c']],
        ['b', ['a']],
        ['c', ['b']],
      ],
      columns: [['b'], ['c'], ['a']],
      edges: [
        { from: 'c', to: 'a' },
        { from: 'b', to: 'c' },
      ],
    },
    {
      case: 'a repeated job id keeps the first',
      jobs: [
        ['a', []],
        ['b', ['a']],
        ['a', ['b']],
      ],
      columns: [['a'], ['b']],
      edges: [{ from: 'a', to: 'b' }],
    },
  ])('$case', ({ jobs, columns, edges }) => {
    const graph = jobGraph(jobsOf(jobs));

    expect(graph.columns).toEqual(columns);
    expect(graph.edges).toEqual(edges);
  });
});

describe('defaultJob', () => {
  it.each<{ case: string; jobs: BuildJob[]; expected: string | null }>([
    { case: 'no jobs', jobs: [], expected: null },
    {
      case: 'the first running job wins over a failed one before it',
      jobs: [
        buildJob({ id: 'f', state: 'finished', result: 'failure' }),
        buildJob({ id: 'r1', state: 'running', result: null }),
        buildJob({ id: 'r2', state: 'running', result: null }),
      ],
      expected: 'r1',
    },
    {
      case: 'the first failed job when none runs',
      jobs: [
        buildJob({ id: 's', state: 'finished', result: 'success' }),
        buildJob({ id: 'f1', state: 'finished', result: 'failure' }),
        buildJob({ id: 'f2', state: 'finished', result: 'failure' }),
      ],
      expected: 'f1',
    },
    {
      case: 'else the last job of the last column',
      jobs: [
        buildJob({ id: 'a', state: 'finished', result: 'success' }),
        buildJob({
          id: 'b',
          state: 'finished',
          result: 'success',
          dependsOn: ['a'],
        }),
        buildJob({ id: 'c', state: 'finished', result: 'success' }),
      ],
      expected: 'b',
    },
    {
      case: 'a queued build',
      jobs: [
        buildJob({ id: 'a', state: 'queued', result: null }),
        buildJob({ id: 'b', state: 'queued', result: null, dependsOn: ['a'] }),
      ],
      expected: 'b',
    },
  ])('$case', ({ jobs, expected }) => {
    expect(defaultJob(jobs, jobGraph(jobs))).toBe(expected);
  });
});

describe('movedJob', () => {
  // Columns [['a', 'b', 'c'], ['d', 'e', 'f']], every edge joining rows that differ.
  const crossed: [string, string[]][] = [
    ['a', []],
    ['b', []],
    ['c', []],
    ['d', ['b']],
    ['e', ['c']],
    ['f', ['a']],
  ];

  it.each<{
    graph: [string, string[]][];
    from: string | null;
    move: GraphMove;
    expected: string | null;
    why: string;
  }>([
    { graph: crossed, from: 'b', move: 'up', expected: 'a', why: 'a step up' },
    {
      graph: crossed,
      from: 'a',
      move: 'up',
      expected: 'a',
      why: 'held at the top',
    },
    {
      graph: crossed,
      from: 'b',
      move: 'down',
      expected: 'c',
      why: 'a step down',
    },
    {
      graph: crossed,
      from: 'c',
      move: 'down',
      expected: 'c',
      why: 'held at the bottom',
    },
    {
      graph: crossed,
      from: 'f',
      move: 'top',
      expected: 'd',
      why: 'the first job of its column',
    },
    {
      graph: crossed,
      from: 'e',
      move: 'bottom',
      expected: 'f',
      why: 'the last job of its column',
    },
    {
      graph: crossed,
      from: 'b',
      move: 'right',
      expected: 'd',
      why: 'follows the edge b→d, not row 1 (e)',
    },
    {
      graph: crossed,
      from: 'c',
      move: 'right',
      expected: 'e',
      why: 'follows the edge c→e, not row 2 (f)',
    },
    {
      graph: crossed,
      from: 'a',
      move: 'right',
      expected: 'f',
      why: 'follows the edge a→f, not row 0 (d)',
    },
    {
      graph: crossed,
      from: 'e',
      move: 'left',
      expected: 'c',
      why: 'follows the edge c→e, not row 1 (b)',
    },
    {
      graph: crossed,
      from: 'd',
      move: 'left',
      expected: 'b',
      why: 'follows the edge b→d, not row 0 (a)',
    },
    {
      graph: crossed,
      from: 'f',
      move: 'left',
      expected: 'a',
      why: 'follows the edge a→f, not row 2 (c)',
    },
    {
      graph: crossed,
      from: 'a',
      move: 'left',
      expected: 'a',
      why: 'held in column 0',
    },
    {
      graph: crossed,
      from: 'e',
      move: 'right',
      expected: 'e',
      why: 'held in the last column',
    },
    {
      graph: crossed,
      from: null,
      move: 'down',
      expected: 'a',
      why: 'no cursor: the first job',
    },
    {
      graph: crossed,
      from: 'zz',
      move: 'left',
      expected: 'a',
      why: 'an id the graph lacks: the first job',
    },
    {
      graph: [
        ['a', []],
        ['b', []],
        ['x', ['a']],
        ['y', ['a']],
      ],
      from: 'b',
      move: 'right',
      expected: 'y',
      why: 'no edge from b: row 1 kept',
    },
    {
      graph: [
        ['a', []],
        ['b', []],
        ['c', []],
        ['z', ['a']],
      ],
      from: 'c',
      move: 'right',
      expected: 'z',
      why: 'no edge from c; row 2 clamps to row 0',
    },
    {
      graph: [],
      from: null,
      move: 'down',
      expected: null,
      why: 'empty graph',
    },
  ])('$from $move → $expected: $why', ({ graph, from, move, expected }) => {
    expect(movedJob(jobGraph(jobsOf(graph)), from, move)).toBe(expected);
  });
});
