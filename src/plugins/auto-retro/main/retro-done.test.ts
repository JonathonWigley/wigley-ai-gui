import { describe, expect, it } from 'vitest';
import type { ProcessActivity } from '../../../contracts/agent';
import type { ChatSessionInfo, SessionCompaction } from '../../chat/contract';
import { isRetroDone } from './retro-done';

const COMPACTION: SessionCompaction = {
  trigger: 'harness',
  reason: null,
  startedAt: 100,
};

function info(
  activity: ProcessActivity,
  background: number,
  running: boolean,
  compaction: SessionCompaction | null = null,
): ChatSessionInfo {
  return {
    sessionId: 'retro-1',
    projectDir: '/home/me/wigley-agents',
    profile: 'work',
    activity,
    background,
    activeTime: { totalMs: 0, since: null },
    running,
    compaction,
    repo: 'wigley-agents',
    branch: 'main',
    worktrees: [],
    headless: false,
  };
}

describe('isRetroDone', () => {
  it.each([
    { case: 'no info', value: undefined, hasStarted: true, expected: false },
    {
      case: 'idle 0 running, not started',
      value: info('idle', 0, true),
      hasStarted: false,
      expected: false,
    },
    {
      case: 'idle 0 running, started',
      value: info('idle', 0, true),
      hasStarted: true,
      expected: true,
    },
    {
      case: 'working 0',
      value: info('working', 0, true),
      hasStarted: true,
      expected: false,
    },
    {
      case: 'idle 2',
      value: info('idle', 2, true),
      hasStarted: true,
      expected: false,
    },
    {
      case: 'waiting 0',
      value: info('waiting', 0, true),
      hasStarted: true,
      expected: false,
    },
    {
      case: 'idle 0 with a compaction',
      value: info('idle', 0, true, COMPACTION),
      hasStarted: true,
      expected: false,
    },
    {
      case: 'not running, working, started',
      value: info('working', 1, false),
      hasStarted: true,
      expected: true,
    },
    {
      case: 'not running, not started',
      value: info('idle', 0, false),
      hasStarted: false,
      expected: false,
    },
  ])('isRetroDone: $case', ({ value, hasStarted, expected }) => {
    expect(isRetroDone(value, hasStarted)).toBe(expected);
  });
});
