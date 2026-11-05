import { describe, expect, it } from 'vitest';
import type { PoolState } from '../contract';
import { readStateFile, type StateFileRead } from './state-file';

// The README's example state file (§ State file) with general values: two
// clones keyed out of order, one claimed, one stranded with a failed warm-up,
// and two queue tickets.
function readmeShape(): Record<string, unknown> {
  return {
    version: 1,
    pool: 'repo-a',
    updatedAt: 1762300007,
    clones: {
      '3': {
        path: '/dev/repo-a-3',
        facts: {
          branch: 'main',
          dirty: false,
          editor: 'ready',
          probedAt: 1762300003,
        },
        claim: {
          kind: 'agent',
          session: 'session-1',
          row: 'row-1',
          since: 1762299001,
          renewedAt: 1762299902,
        },
        handoff: null,
        stranded: null,
        lastHolder: { session: 'session-1', row: null },
        lastReleasedAt: 1762290005,
        warmup: {
          state: 'done',
          startedAt: 1762290006,
          finishedAt: 1762290404,
          error: null,
        },
      },
      '1': {
        path: '/dev/repo-a',
        facts: {
          branch: 'feature/x',
          dirty: true,
          editor: 'play',
          probedAt: 1762300011,
        },
        claim: null,
        handoff: {
          session: 'session-2',
          row: 'row-2',
          until: 1762300120,
        },
        stranded: {
          session: 'session-2',
          row: 'row-2',
          since: 1762299500,
          reason: 'session-ended-dirty',
        },
        lastHolder: null,
        lastReleasedAt: null,
        warmup: {
          state: 'failed',
          startedAt: 1762299600,
          finishedAt: null,
          error: 'fetch failed',
        },
      },
    },
    queue: [
      {
        session: 'session-4',
        row: 'row-4',
        branch: 'release',
        enqueuedAt: 1762299700,
        polledAt: 1762299995,
        longWait: true,
      },
      {
        session: 'session-3',
        row: null,
        branch: 'main',
        enqueuedAt: 1762299800,
        polledAt: 1762299990,
        longWait: false,
      },
    ],
    sessions: {
      'session-1': { cwd: '/dev/repo-a-3', row: 'row-1', seenAt: 1762299900 },
    },
  };
}

const README_POOL: PoolState = {
  pool: 'repo-a',
  updatedAt: 1762300007000,
  clones: [
    {
      number: 1,
      path: '/dev/repo-a',
      facts: {
        branch: 'feature/x',
        dirty: true,
        editor: 'play',
        probedAt: 1762300011000,
      },
      claim: null,
      handoff: { session: 'session-2', row: 'row-2', until: 1762300120000 },
      stranded: {
        session: 'session-2',
        row: 'row-2',
        since: 1762299500000,
        reason: 'session-ended-dirty',
      },
      lastHolder: null,
      lastReleasedAt: null,
      warmup: {
        state: 'failed',
        startedAt: 1762299600000,
        finishedAt: null,
        error: 'fetch failed',
      },
    },
    {
      number: 3,
      path: '/dev/repo-a-3',
      facts: {
        branch: 'main',
        dirty: false,
        editor: 'ready',
        probedAt: 1762300003000,
      },
      claim: {
        kind: 'agent',
        session: 'session-1',
        row: 'row-1',
        since: 1762299001000,
        renewedAt: 1762299902000,
      },
      handoff: null,
      stranded: null,
      lastHolder: { session: 'session-1', row: null },
      lastReleasedAt: 1762290005000,
      warmup: {
        state: 'done',
        startedAt: 1762290006000,
        finishedAt: 1762290404000,
        error: null,
      },
    },
  ],
  queue: [
    {
      session: 'session-4',
      row: 'row-4',
      branch: 'release',
      enqueuedAt: 1762299700000,
      polledAt: 1762299995000,
      longWait: true,
    },
    {
      session: 'session-3',
      row: null,
      branch: 'main',
      enqueuedAt: 1762299800000,
      polledAt: 1762299990000,
      longWait: false,
    },
  ],
};

// The README shape with `change` applied to clone 3.
function withClone3(
  change: (clone: Record<string, unknown>) => void,
): Record<string, unknown> {
  const file = readmeShape();
  change((file.clones as Record<string, Record<string, unknown>>)['3']);
  return file;
}

function clone3Of(read: StateFileRead) {
  if (read.kind !== 'pool') {
    throw new Error(`expected a pool, got ${JSON.stringify(read)}`);
  }
  return read.pool.clones.find((clone) => clone.number === 3);
}

describe('readStateFile', () => {
  it('readStateFile_Version1_ReadsTheReadmeShape', () => {
    expect(readStateFile(JSON.stringify(readmeShape()))).toEqual({
      kind: 'pool',
      pool: README_POOL,
    });
  });

  it('readStateFile_NeverProbedFacts_ReadsNulls', () => {
    const file = withClone3((clone) => {
      clone.facts = {
        branch: null,
        dirty: null,
        editor: 'unknown',
        probedAt: null,
      };
      clone.warmup = null;
    });

    expect(clone3Of(readStateFile(JSON.stringify(file)))?.facts).toEqual({
      branch: null,
      dirty: null,
      editor: 'unknown',
      probedAt: null,
    });
  });

  it('readStateFile_UnknownEditorWord_ReadsUnknown', () => {
    const file = withClone3((clone) => {
      (clone.facts as Record<string, unknown>).editor = 'compiling';
    });

    expect(clone3Of(readStateFile(JSON.stringify(file)))?.facts.editor).toBe(
      'unknown',
    );
  });

  it.each<{ name: string; text: () => string; expected: StateFileRead }>([
    {
      name: 'not JSON',
      text: () => '{"version": 1, "pool": "re',
      expected: { kind: 'invalid', reason: 'not JSON' },
    },
    {
      name: 'a JSON array',
      text: () => '[1, 2]',
      expected: { kind: 'invalid', reason: 'not a JSON object' },
    },
    {
      name: 'version 2',
      text: () => JSON.stringify({ ...readmeShape(), version: 2 }),
      expected: { kind: 'unknownVersion', version: 2 },
    },
    {
      name: 'no version',
      text: () => JSON.stringify({ ...readmeShape(), version: undefined }),
      expected: { kind: 'unknownVersion', version: undefined },
    },
    {
      name: 'a clone key that is no clone number',
      text: () => {
        const file = readmeShape();
        file.clones = { x: (file.clones as Record<string, unknown>)['3'] };
        return JSON.stringify(file);
      },
      expected: { kind: 'invalid', reason: 'clones.x is not a clone number' },
    },
    {
      name: 'clone facts missing',
      text: () =>
        JSON.stringify(
          withClone3((clone) => {
            delete clone.facts;
          }),
        ),
      expected: { kind: 'invalid', reason: 'clones.3.facts is missing' },
    },
    {
      name: 'queue not an array',
      text: () => JSON.stringify({ ...readmeShape(), queue: {} }),
      expected: { kind: 'invalid', reason: 'queue is not an array' },
    },
    {
      name: 'claim kind a number',
      text: () =>
        JSON.stringify(
          withClone3((clone) => {
            (clone.claim as Record<string, unknown>).kind = 2;
          }),
        ),
      expected: {
        kind: 'invalid',
        reason: 'clones.3.claim.kind is not one of agent, hold',
      },
    },
  ])('readStateFile_Rejects: $name', ({ text, expected }) => {
    expect(readStateFile(text())).toEqual(expected);
  });
});
