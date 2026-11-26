import { describe, expect, it } from 'vitest';
import type { ProcessActivity } from '../../../contracts/agent';
import type { ChatSessionInfo, SessionCompaction } from '../../chat/contract';
import { type RetroRowState, retroRowState } from './retro-done';

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
    harness: 'fake',
    profile: 'work',
    activity,
    background,
    activeTime: { totalMs: 0, since: null },
    running,
    pid: null,
    compaction,
    repo: 'wigley-agents',
    branch: 'main',
    worktrees: [],
    headless: false,
  };
}

// Catches a lost row read as busy (the queue waits on it forever), a lost row read as done (a silent finish), and a
// waiting row read as lost. S started, E ended, R restored with its history read.
describe('retroRowState', () => {
  it.each([
    {
      case: 'none',
      value: undefined,
      S: true,
      E: false,
      R: false,
      state: 'busy',
    },
    {
      case: 'idle 0, running',
      value: info('idle', 0, true),
      S: false,
      E: false,
      R: false,
      state: 'busy',
    },
    {
      case: 'idle 0, not running',
      value: info('idle', 0, false),
      S: false,
      E: false,
      R: false,
      state: 'busy',
    },
    {
      case: 'idle 0, running',
      value: info('idle', 0, true),
      S: true,
      E: false,
      R: false,
      state: 'done',
    },
    {
      case: 'working 0, running',
      value: info('working', 0, true),
      S: true,
      E: false,
      R: false,
      state: 'busy',
    },
    {
      case: 'idle 2, running',
      value: info('idle', 2, true),
      S: true,
      E: false,
      R: false,
      state: 'busy',
    },
    {
      case: 'waiting 0, running',
      value: info('waiting', 0, true),
      S: true,
      E: false,
      R: false,
      state: 'busy',
    },
    {
      case: 'idle 0 with a compaction, running',
      value: info('idle', 0, true, COMPACTION),
      S: true,
      E: false,
      R: false,
      state: 'busy',
    },
    {
      case: 'working 1, not running',
      value: info('working', 1, false),
      S: true,
      E: false,
      R: false,
      state: 'done',
    },
    {
      case: 'idle 0, not running',
      value: info('idle', 0, false),
      S: true,
      E: true,
      R: false,
      state: 'done',
    },
    {
      case: 'idle 0, not running',
      value: info('idle', 0, false),
      S: false,
      E: true,
      R: false,
      state: 'lost',
    },
    {
      case: 'idle 0, running',
      value: info('idle', 0, true),
      S: false,
      E: false,
      R: true,
      state: 'lost',
    },
    {
      case: 'idle 0, not running',
      value: info('idle', 0, false),
      S: false,
      E: false,
      R: true,
      state: 'lost',
    },
    {
      case: 'working 0, running',
      value: info('working', 0, true),
      S: false,
      E: false,
      R: true,
      state: 'busy',
    },
  ] satisfies {
    case: string;
    value: ChatSessionInfo | undefined;
    S: boolean;
    E: boolean;
    R: boolean;
    state: RetroRowState;
  }[])(
    'retroRowState: $case, S $S E $E R $R → $state',
    ({ value, S, E, R, state }) => {
      expect(
        retroRowState(value, { hasStarted: S, hasEnded: E, isRestored: R }),
      ).toBe(state);
    },
  );
});
