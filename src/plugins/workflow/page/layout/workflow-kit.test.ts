import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import type { StageStatus } from '../../layouts/layout';
import { testWorkflowKit } from '../engine-parts.test-support';

const KIT_MANIFEST = { id: 'workflow-small', commands: {} };

describe('workflow kit stage tag', () => {
  beforeEach(() => installFakeDom(vi.stubGlobal));
  afterEach(() => vi.unstubAllGlobals());

  it.each<{
    status: StageStatus | null;
    tone: string;
    state: string | undefined;
    checks: number;
  }>([
    { status: 'running', tone: 'ui-tag--running', state: 'running', checks: 0 },
    { status: 'paused', tone: 'ui-tag--neutral', state: 'paused', checks: 0 },
    { status: 'ready', tone: 'ui-tag--neutral', state: 'ready', checks: 0 },
    { status: 'done', tone: 'ui-tag--success', state: 'done', checks: 1 },
    { status: null, tone: 'ui-tag--neutral', state: undefined, checks: 0 },
  ])('stageTag_TonesByStatus $status', ({ status, tone, state, checks }) => {
    const { kit } = testWorkflowKit(KIT_MANIFEST);

    const stageTag = asFake(
      kit.stageTag(asHtml(new FakeElement('div')), 'Build', status),
    );

    expect(stageTag.classList.contains('workflow-stage-tag')).toBe(true);
    expect(stageTag.classList.contains(tone)).toBe(true);
    expect(stageTag.dataset.state).toBe(state);
    expect(findAll(stageTag, 'workflow-stage-tag-check')).toHaveLength(checks);
  });
});
