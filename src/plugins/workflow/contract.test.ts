import { describe, expect, it } from 'vitest';
import type { RowActivity } from '../sessions/contract';
import {
  type PageStage,
  type SessionFlow,
  type StageStatus,
  shownRowActivity,
} from './contract';
import { newFlow } from './flow';

const STAGE_LABEL: RowActivity = {
  word: 'ready to make',
  tone: 'attention',
  rank: 15,
  emphasis: 'raised',
};

const IDLE: Partial<SessionFlow> = {};
const TURN: Partial<SessionFlow> = { turnRunning: true };
const SUBAGENT: Partial<SessionFlow> = { runningSubagents: ['agent-1'] };

function stageWith(
  status: StageStatus | null,
  rowActivity: RowActivity | undefined,
): PageStage {
  return { status: () => status, rowActivity } as PageStage;
}

describe('shownRowActivity', () => {
  it.each([
    {
      status: 'paused',
      rowActivity: undefined,
      busy: IDLE,
      shown: { word: 'needs you', rank: 18 },
    },
    { status: 'paused', rowActivity: undefined, busy: TURN, shown: null },
    { status: 'paused', rowActivity: undefined, busy: SUBAGENT, shown: null },
    { status: 'running', rowActivity: undefined, busy: IDLE, shown: null },
    { status: 'done', rowActivity: undefined, busy: IDLE, shown: null },
    { status: null, rowActivity: undefined, busy: IDLE, shown: null },
    {
      status: 'ready',
      rowActivity: STAGE_LABEL,
      busy: IDLE,
      shown: { word: 'ready to make', rank: 15 },
    },
    {
      status: 'paused',
      rowActivity: STAGE_LABEL,
      busy: IDLE,
      shown: { word: 'ready to make', rank: 15 },
    },
  ] as const)(
    'shownRowActivity_StatusAndRowActivity_TheRowsActivity status $status',
    ({ status, rowActivity, busy, shown }) => {
      const flow = { ...newFlow('a', '/p'), ...busy };

      const activity = shownRowActivity(stageWith(status, rowActivity), flow);

      expect(activity && { word: activity.word, rank: activity.rank }).toEqual(
        shown,
      );
    },
  );
});
