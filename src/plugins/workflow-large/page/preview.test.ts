import { describe, expect, it } from 'vitest';
import { largeStateOf } from '../contract';
import { LARGE_BEAT_NAMES } from './demo-steps';
import {
  PREVIEW_PLAN,
  PREVIEW_SAMPLES,
  previewFlow,
  type SamplePlan,
} from './preview';

const NOW = 1_000_000;

// The index of the first `make` sample, which carries a plan.
const MAKE_INDEX = 8;

const DAILY_QUESTS: SamplePlan = {
  projectDir: '/scratch',
  planDir: '/scratch/docs/features/daily-quests/plan-daily-quests',
  title: 'Daily quests',
};

describe('previewFlow', () => {
  it.each([
    { index: 0, stage: 'idle', busy: false, endsAt: null, checked: null },
    { index: 1, stage: 'primer', busy: true, endsAt: null, checked: null },
    { index: 2, stage: 'explore', busy: false, endsAt: null, checked: null },
    { index: 3, stage: 'interview', busy: true, endsAt: null, checked: null },
    { index: 4, stage: 'plan', busy: false, endsAt: null, checked: 0 },
    { index: 5, stage: 'coldRead', busy: true, endsAt: null, checked: 0 },
    { index: 6, stage: 'planReady', busy: false, endsAt: null, checked: 0 },
    {
      index: 7,
      stage: 'planReady',
      busy: false,
      endsAt: NOW + 7000,
      checked: 0,
    },
    { index: 8, stage: 'make', busy: true, endsAt: null, checked: 3 },
    { index: 9, stage: 'make', busy: false, endsAt: null, checked: 3 },
    { index: 10, stage: 'review', busy: true, endsAt: null, checked: 6 },
    { index: 11, stage: 'fix', busy: true, endsAt: null, checked: 6 },
    { index: 12, stage: 'closed', busy: false, endsAt: null, checked: 7 },
  ])(
    'previewFlow_EachIndex_ShowsItsSample $index',
    ({ index, stage, busy, endsAt, checked }) => {
      const flow = previewFlow(index, 'preview', NOW, 7);

      const large = largeStateOf(flow);
      expect({
        stage: flow.stage,
        busy: flow.turnRunning,
        endsAt: large.countdownEndsAt,
        checked: large.progress?.checked ?? null,
      }).toEqual({ stage, busy, endsAt, checked });
    },
  );

  // Breaks: a demo plan leaking into the layout preview, or the reverse.
  it.each<{ name: string; plan: SamplePlan | undefined }>([
    { name: 'default', plan: undefined },
    { name: 'demo plan', plan: DAILY_QUESTS },
  ])('previewFlow plan: $name', ({ plan }) => {
    const flow = previewFlow(MAKE_INDEX, 's1', NOW, 7, plan);

    const large = largeStateOf(flow);
    const expected = plan ?? PREVIEW_PLAN;
    expect({
      projectDir: flow.projectDir,
      planDir: large.planDir,
      title: large.progress?.title,
    }).toEqual(expected);
  });

  // Breaks: a sample added without a beat.
  it('demo beat names match PREVIEW_SAMPLES', () => {
    expect(LARGE_BEAT_NAMES).toHaveLength(PREVIEW_SAMPLES.length);
  });
});
