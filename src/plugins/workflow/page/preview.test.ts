import { describe, expect, it } from 'vitest';
import { previewFlow } from './preview';

const NOW = 1_000_000;

describe('previewFlow', () => {
  it.each([
    { index: 0, stage: 'idle', endsAt: null, checked: null },
    { index: 1, stage: 'primer', endsAt: null, checked: null },
    { index: 2, stage: 'feature', endsAt: null, checked: 0 },
    { index: 3, stage: 'planReady', endsAt: null, checked: 0 },
    { index: 4, stage: 'planReady', endsAt: NOW + 7000, checked: 0 },
    { index: 5, stage: 'make', endsAt: null, checked: 3 },
    { index: 6, stage: 'review', endsAt: null, checked: 6 },
    { index: 7, stage: 'closed', endsAt: null, checked: 7 },
  ])(
    'previewFlow_EachIndex_ShowsItsStage $index',
    ({ index, stage, endsAt, checked }) => {
      const flow = previewFlow(index, 'preview', NOW, 7);

      expect({
        stage: flow.stage,
        endsAt: flow.countdownEndsAt,
        checked: flow.progress?.checked ?? null,
        hasLeftIdle: flow.hasLeftIdle,
      }).toEqual({ stage, endsAt, checked, hasLeftIdle: true });
    },
  );
});
