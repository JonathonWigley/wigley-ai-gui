import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import type {
  ChipInput,
  SideGroupInput,
  SideItemInput,
  SidePaneInput,
  StripInput,
} from '../../../workflow/layouts/layout';
import { testWorkflowKit } from '../../../workflow/page/engine-parts.test-support';
import layout from './layout.js';

const KIT_MANIFEST = { id: 'workflow-small', commands: {} };

const chipInput: ChipInput = {
  badge: 'S',
  workflowLabel: 'Small',
  stage: 'build',
  label: 'Build',
  status: 'running',
  statusText: 'Build · running',
  detail: '',
  countdown: null,
  mainAction: null,
  onRowLabel: false,
};

const stripInput: StripInput = {
  stage: 'build',
  label: 'Build',
  status: 'running',
  statusText: 'Build · running',
  statusLine: 'Build · running 1/3',
  detail: '',
  countdown: null,
  steps: [
    { id: 'scope', label: 'Scope', state: 'done', progress: '' },
    { id: 'build', label: 'Build', state: 'running', progress: ' 1/3' },
  ],
  actions: [],
  hasChecklist: true,
};

const paneInput = (fields: Partial<SidePaneInput>): SidePaneInput => ({
  ...stripInput,
  checklistTitle: '',
  checked: 0,
  total: 0,
  finishedGroups: [],
  finishedOpen: false,
  currentGroup: null,
  laterGroups: [],
  ...fields,
});

const groupOf = (...items: SideItemInput[]): SideGroupInput => ({
  title: 'Tasks',
  items,
});

const done = (text: string): SideItemInput => ({ text, state: 'done' });

function drawPane(fields: Partial<SidePaneInput>): FakeElement {
  const { kit } = testWorkflowKit(KIT_MANIFEST);
  return asFake(
    layout.sidePane(asHtml(new FakeElement('div')), paneInput(fields), kit)
      .element,
  );
}

const rowLabels = (pane: FakeElement) =>
  findAll(pane, 'ui-row-label').map((label) => label.textContent);

describe('Small default layout', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('chip_DrawsBadgeFirst', () => {
    const { kit } = testWorkflowKit(KIT_MANIFEST);

    const chip = asFake(
      layout.chip(asHtml(new FakeElement('div')), chipInput, kit).element,
    );

    const [badge, tag] = chip.children;
    expect(badge.classList.contains('workflow-badge')).toBe(true);
    expect(badge.textContent).toBe('S');
    expect(badge.title).toBe('Small');
    expect(tag.textContent).toBe('Build');
    expect(tag.dataset.state).toBe('running');
  });

  it('strip_DrawsTheSteps', () => {
    const { kit } = testWorkflowKit(KIT_MANIFEST);

    const strip = asFake(
      layout.strip(
        asHtml(new FakeElement('div')),
        { ...stripInput, countdown: '9s' },
        kit,
      ).element,
    );

    expect(
      findAll(strip, 'workflow-step-label').map((step) => step.textContent),
    ).toEqual(['Scope', 'Build 1/3']);
    expect(findAll(strip, 'workflow-countdown')).toEqual([]);
    expect(findAll(strip, 'ui-button')).toEqual([]);
  });

  it('sidePane_DrawsTheGroups', () => {
    const pane = drawPane({
      checked: 1,
      total: 4,
      finishedGroups: [groupOf(done('a'))],
      currentGroup: groupOf(
        { text: 'b', state: 'running' },
        { text: 'c', state: 'pending' },
      ),
      laterGroups: [groupOf({ text: 'd', state: 'pending' })],
    });

    expect(rowLabels(pane)).toEqual(['a', 'b', 'c', 'd']);
    expect(findAll(pane, 'workflow-side-count')[0].textContent).toBe('1/4');
    expect(findAll(pane, 'workflow-side-actions')).toEqual([]);
  });

  it('sidePane_AllDone_StillListsTheItems', () => {
    const pane = drawPane({
      checked: 2,
      total: 2,
      finishedGroups: [groupOf(done('a'), done('b'))],
    });

    expect(rowLabels(pane)).toEqual(['a', 'b']);
    expect(findAll(pane, 'workflow-finished-fold')).toEqual([]);
  });
});
