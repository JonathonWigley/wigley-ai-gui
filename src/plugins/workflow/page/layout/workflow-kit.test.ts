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

describe('workflow kit badge', () => {
  beforeEach(() => installFakeDom(vi.stubGlobal));
  afterEach(() => vi.unstubAllGlobals());

  it('badge_BadgeColor_SetsTheBadgeColour', () => {
    const { kit } = testWorkflowKit(
      KIT_MANIFEST,
      0,
      's1',
      'var(--wg-status-info)',
    );
    const parent = new FakeElement('div');

    kit.badge(asHtml(parent), 'S', 'Small');

    const [badge] = findAll(parent, 'workflow-badge');
    expect(badge.style['--workflow-badge-color']).toBe('var(--wg-status-info)');
  });
});

describe('workflow kit headless chip', () => {
  beforeEach(() => installFakeDom(vi.stubGlobal));
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { headless: true, state: 'on', pressed: 'true' },
    { headless: false, state: 'off', pressed: 'false' },
  ])(
    'headlessChip_State_DrawsAndRunsToggleForItsSession $state',
    ({ headless, state, pressed }) => {
      const { kit, anchors, runs } = testWorkflowKit(KIT_MANIFEST, 0, 's7');
      let stopped = false;

      const chip = asFake(
        kit.headlessChip(asHtml(new FakeElement('div')), headless),
      );
      chip.fire('click', {
        stopPropagation: () => {
          stopped = true;
        },
      });

      expect(chip.classList.contains('workflow-headless')).toBe(true);
      expect(chip.textContent).toBe('Headless');
      expect(chip.dataset.state).toBe(state);
      expect(chip.attributes.get('aria-pressed')).toBe(pressed);
      expect(runs).toEqual([
        {
          id: 'workflow.stageAction',
          arg: { sessionId: 's7', action: 'toggleHeadless' },
        },
      ]);
      expect(stopped).toBe(true);
      expect(anchors.map((anchor) => anchor.command)).toEqual([
        'workflow.toggleHeadless',
      ]);
    },
  );
});
