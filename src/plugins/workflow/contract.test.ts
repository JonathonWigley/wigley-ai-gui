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
  return {
    id: 'build',
    label: 'Build',
    inStepper: true,
    order: 10,
    actions: [],
    detail: () => '',
    status: () => status,
    rowActivity,
  };
}

describe('shownRowActivity', () => {
  it.each([
    {
      name: 'paused idle',
      status: 'paused',
      rowActivity: undefined,
      busy: IDLE,
      shown: null,
    },
    {
      name: 'paused turn',
      status: 'paused',
      rowActivity: undefined,
      busy: TURN,
      shown: null,
    },
    {
      name: 'paused subagent',
      status: 'paused',
      rowActivity: undefined,
      busy: SUBAGENT,
      shown: null,
    },
    {
      name: 'running',
      status: 'running',
      rowActivity: undefined,
      busy: IDLE,
      shown: null,
    },
    {
      name: 'done',
      status: 'done',
      rowActivity: undefined,
      busy: IDLE,
      shown: null,
    },
    {
      name: 'no status',
      status: null,
      rowActivity: undefined,
      busy: IDLE,
      shown: null,
    },
    {
      name: 'ready with own label',
      status: 'ready',
      rowActivity: STAGE_LABEL,
      busy: IDLE,
      shown: { word: 'ready to make', rank: 15 },
    },
    {
      name: 'paused with own label',
      status: 'paused',
      rowActivity: STAGE_LABEL,
      busy: IDLE,
      shown: { word: 'ready to make', rank: 15 },
    },
  ] as const)(
    'shownRowActivity_StatusAndRowActivity_TheRowsActivity $name',
    ({ status, rowActivity, busy, shown }) => {
      const flow = { ...newFlow('a', '/p'), ...busy };

      const activity = shownRowActivity(stageWith(status, rowActivity), flow);

      expect(activity && { word: activity.word, rank: activity.rank }).toEqual(
        shown,
      );
    },
  );
});
