import { describe, expect, it } from 'vitest';
import type {
  ActionInput,
  ChipInput,
  SidePaneInput,
  SideGroupInput,
  StripInput,
  WorkflowKit,
} from '../../../workflow/layouts/layout';
import layout from './layout.js';

// The DOM surface the default layout uses. This layer may not import the
// page's shared fake DOM.
class FakeElement {
  children: FakeElement[] = [];

  constructor(readonly part: string) {}

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }
}

function asHtml(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

// Every part under `element`, depth first, in the order the layout drew them.
function allParts(element: FakeElement): string[] {
  return element.children.flatMap((child) => [child.part, ...allParts(child)]);
}

function drawn(part: { element: HTMLElement }): string[] {
  return allParts(part.element as unknown as FakeElement);
}

// Each kit part appends a fake element tagged with the part and its text
// (`section:Make`), so a test reads what the layout drew in order.
function fakeKit(): WorkflowKit {
  const part = (parent: HTMLElement, name: string) => {
    const node = new FakeElement(name);
    (parent as unknown as FakeElement).append(node);
    return asHtml(node);
  };
  const kit: Partial<WorkflowKit> = {
    el: (parent, _tag, className) => part(parent, `el:${className ?? ''}`),
    sectionHeader: (parent, text) => part(parent, `section:${text}`),
    stepper: (parent) => part(parent, 'stepper'),
    countdown: (parent, text) => part(parent, `countdown:${text}`),
    row: (parent, options) =>
      part(
        parent,
        options.detail === undefined
          ? `row:${options.label}`
          : `row:${options.label}|${options.detail}`,
      ),
    actionButton: (parent, action) =>
      part(parent, `action:${action.label}`) as HTMLButtonElement,
    tag: (parent, text) => part(parent, `tag:${text}`),
    badge: (parent, letter, label) => part(parent, `badge:${letter}:${label}`),
    stageTag: (parent, label, status) =>
      part(parent, `stage:${label}:${status}`),
    meter: (parent, percent) => part(parent, `meter:${percent}`),
    statusMark: (parent, state) => part(parent, `mark:${state}`),
    sideList: (parent) => part(parent, 'list'),
    finishedFold: (parent, text, open) =>
      part(parent, `fold:${text}:${open}`) as HTMLButtonElement,
  };
  return kit as WorkflowKit;
}

const MAIN_ACTION: ActionInput = {
  command: 'resumeMake',
  label: 'Resume make',
  enabled: true,
  main: true,
};
const OTHER_ACTION: ActionInput = {
  command: 'openPlan',
  label: 'Open plan',
  enabled: true,
  main: false,
};

function chipInput(): ChipInput {
  return {
    badge: 'H',
    workflowLabel: 'Heavy',
    stage: 'make',
    label: 'Make',
    status: 'running',
    statusText: 'Make · running',
    detail: '',
    countdown: null,
    mainAction: null,
    onRowLabel: false,
  };
}

function stripInput(hasChecklist: boolean): StripInput {
  return {
    ...chipInput(),
    statusLine: 'Make · running 3/9',
    steps: [],
    actions: [MAIN_ACTION, OTHER_ACTION],
    hasChecklist,
  };
}

function sidePaneInput(fields: Partial<SidePaneInput> = {}): SidePaneInput {
  return {
    ...stripInput(true),
    checklistTitle: 'Plan x',
    checked: 1,
    total: 3,
    finishedGroups: [],
    finishedOpen: false,
    currentGroup: null,
    laterGroups: [],
    ...fields,
  };
}

// A wave titled `title` of `tasks` done items named after it.
function doneWave(title: string, tasks: number): SideGroupInput {
  return {
    title,
    items: Array.from({ length: tasks }, (_, index) => ({
      text: `${title} task ${index + 1}`,
      state: 'done' as const,
    })),
  };
}

function drawPane(fields: Partial<SidePaneInput> = {}): string[] {
  const parent = new FakeElement('parent');
  return drawn(
    layout.sidePane(asHtml(parent), sidePaneInput(fields), fakeKit()),
  );
}

function withoutBadge(parts: string[]): string[] {
  return parts.filter((part) => !part.startsWith('badge:'));
}

describe('default layout chip', () => {
  it('chip_RunningStage_TagReadsTheStageAndItsStatus', () => {
    const parent = new FakeElement('parent');

    const chip = layout.chip(asHtml(parent), chipInput(), fakeKit());

    expect(withoutBadge(drawn(chip))).toEqual(['stage:Make:running']);
  });

  it('chip_StateOnRowLabel_DrawsOnlyTheCountdown', () => {
    const parent = new FakeElement('parent');

    const chip = layout.chip(
      asHtml(parent),
      { ...chipInput(), onRowLabel: true, countdown: '9s' },
      fakeKit(),
    );

    expect(withoutBadge(drawn(chip))).toEqual(['countdown:9s']);
  });

  it.each([
    { onRowLabel: false, parts: ['badge:H:Heavy', 'stage:Make:running'] },
    { onRowLabel: true, parts: ['badge:H:Heavy'] },
  ])(
    'chip_DrawsTheBadgeFirst onRowLabel $onRowLabel',
    ({ onRowLabel, parts }) => {
      const parent = new FakeElement('parent');

      const chip = layout.chip(
        asHtml(parent),
        { ...chipInput(), onRowLabel },
        fakeKit(),
      );

      expect(drawn(chip)).toEqual(parts);
    },
  );
});

describe('default layout strip', () => {
  it.each([
    {
      name: 'no plan, stage in the stepper',
      hasChecklist: false,
      stepId: 'make',
      parts: ['stepper'],
    },
    {
      name: 'a plan, stage in the stepper',
      hasChecklist: true,
      stepId: 'make',
      parts: ['stepper'],
    },
    {
      name: 'no plan, stage outside the stepper',
      hasChecklist: false,
      stepId: 'review',
      parts: ['mark:running', 'el:workflow-status-line', 'stepper'],
    },
    {
      name: 'a plan, stage outside the stepper',
      hasChecklist: true,
      stepId: 'review',
      parts: ['mark:running', 'el:workflow-status-line'],
    },
  ])('strip_DrawsThePinnedParts ($name)', ({ hasChecklist, stepId, parts }) => {
    const parent = new FakeElement('parent');
    const input: StripInput = {
      ...stripInput(hasChecklist),
      steps: [{ id: stepId, label: stepId, state: 'running', progress: '' }],
    };

    const drawnParts = drawn(layout.strip(asHtml(parent), input, fakeKit()));

    expect(drawnParts).toEqual([...parts, 'action:Resume make']);
  });

  it('strip_Countdown_DrawsBeforeTheMainAction', () => {
    const parent = new FakeElement('parent');

    const parts = drawn(
      layout.strip(
        asHtml(parent),
        { ...stripInput(true), countdown: '9s' },
        fakeKit(),
      ),
    );

    expect(parts.slice(-2)).toEqual(['countdown:9s', 'action:Resume make']);
  });
});

describe('default layout sidePane', () => {
  it.each([
    {
      name: 'one task reads its text',
      tasks: 1,
      line: 'row:Wave 4|Wave 4 task 1',
    },
    { name: 'two tasks read a count', tasks: 2, line: 'row:Wave 4|2 tasks' },
  ])('sidePane_LaterWave_$name', ({ tasks, line }) => {
    const parts = drawPane({ laterGroups: [doneWave('Wave 4', tasks)] });

    expect(parts).toContain('section:Up next');
    expect(parts).toContain(line);
  });

  it('sidePane_NoLaterWaves_LeavesOutUpNext', () => {
    expect(drawPane()).not.toContain('section:Up next');
  });

  it.each([
    {
      waves: [doneWave('Wave 1', 1)],
      fold: 'fold:1 wave · 1 done:false',
    },
    {
      waves: [
        doneWave('Wave 1', 1),
        doneWave('Wave 2', 2),
        doneWave('Wave 3', 1),
      ],
      fold: 'fold:3 waves · 4 done:false',
    },
  ])('sidePane_FinishedWaves_FoldReads $fold', ({ waves, fold }) => {
    expect(drawPane({ finishedGroups: waves })).toContain(fold);
  });

  it('sidePane_NoFinishedWaves_LeavesOutTheFold', () => {
    const parts = drawPane();

    expect(parts.filter((part) => part.startsWith('fold:'))).toEqual([]);
  });

  it.each([
    { finishedOpen: false, tasks: [] },
    { finishedOpen: true, tasks: ['row:Wave 1 task 1'] },
  ])(
    'sidePane_FinishedOpen$finishedOpen_DrawsFinishedTasksOnlyWhenOpen',
    ({ finishedOpen, tasks }) => {
      const parts = drawPane({
        finishedGroups: [doneWave('Wave 1', 1)],
        finishedOpen,
      });

      expect(parts.filter((part) => part.startsWith('row:'))).toEqual(tasks);
    },
  );

  it.each([
    { checked: 1, total: 3, percent: 33.33 },
    { checked: 3, total: 4, percent: 75 },
    { checked: 0, total: 0, percent: 0 },
  ])(
    'sidePane_Checked$checked_Of$total_FillsTheBarTo$percent',
    ({ checked, total, percent }) => {
      const meter = drawPane({ checked, total }).find((part) =>
        part.startsWith('meter:'),
      );

      expect(Number(meter?.slice('meter:'.length))).toBeCloseTo(percent, 2);
    },
  );

  it.each([
    { actions: [], row: [] },
    {
      actions: [MAIN_ACTION, OTHER_ACTION],
      row: [
        'el:workflow-side-actions',
        'action:Resume make',
        'action:Open plan',
      ],
    },
  ])(
    'sidePane_Actions_DrawsEveryOneAndLeavesOutAnEmptyRow $row',
    ({ actions, row }) => {
      const parts = drawPane({ actions });

      expect(
        parts.filter(
          (part) =>
            part === 'el:workflow-side-actions' || part.startsWith('action:'),
        ),
      ).toEqual(row);
    },
  );

  it('sidePane_EveryPart_DrawsInThePinnedOrder', () => {
    const parts = drawPane({
      finishedGroups: [doneWave('Wave 1', 1)],
      currentGroup: {
        title: 'Wave 2',
        items: [{ text: 'open task', state: 'running' }],
      },
      laterGroups: [doneWave('Wave 3', 2)],
    });

    expect(parts).toEqual([
      'el:workflow-side-status',
      'mark:running',
      'el:workflow-status-line',
      'el:workflow-side-detail',
      expect.stringMatching(/^meter:/),
      'list',
      'fold:1 wave · 1 done:false',
      'section:Wave 2',
      'el:workflow-side-tasks',
      'mark:running',
      'row:open task',
      'section:Up next',
      'row:Wave 3|2 tasks',
      'el:workflow-side-actions',
      'action:Resume make',
      'action:Open plan',
    ]);
  });
});
