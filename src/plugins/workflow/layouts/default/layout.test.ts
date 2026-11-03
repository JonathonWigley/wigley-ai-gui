import { describe, expect, it } from 'vitest';
import type { FlowTabInput, WorkflowKit } from '../layout';
import layout from './layout.js';

// The DOM surface the default layout uses. This layer may not import the
// page's shared fake DOM.
class FakeElement {
  children: FakeElement[] = [];
  classList = { add: () => undefined };

  constructor(readonly part: string) {}

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }
}

function asHtml(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
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
    emptyState: (parent, text) => part(parent, `empty:${text}`),
    icon: (parent, name) => part(parent, `icon:${name}`),
    row: (parent, options) => part(parent, `row:${options.label}`),
    actionButton: (parent, action) =>
      part(parent, `action:${action.label}`) as HTMLButtonElement,
  };
  return kit as WorkflowKit;
}

// What the Flow tab drew besides its frame: its section headers and its
// empty state.
function drawnParts(element: FakeElement): string[] {
  const shown: string[] = [];
  for (const child of element.children) {
    if (child.part.startsWith('section:')) {
      shown.push(child.part);
    }
    if (child.part.startsWith('empty:')) {
      shown.push(child.part);
    }
  }
  return shown;
}

function flowTabInput(planTitle: string | null, boxes: number): FlowTabInput {
  return {
    stage: 'make',
    label: 'Make',
    detail: '',
    countdown: null,
    planTitle,
    steps: [],
    waves:
      boxes === 0
        ? []
        : [
            {
              title: 'Wave 1',
              current: true,
              tasks: Array.from({ length: boxes }, (_, index) => ({
                text: `Task ${index + 1}`,
                done: false,
              })),
            },
          ],
    actions: [],
  };
}

describe('default layout flowTab', () => {
  it.each([
    {
      name: 'no plan read',
      planTitle: null,
      boxes: 0,
      drawn: ['section:Make', 'empty:No plan yet'],
    },
    {
      name: 'a read plan with no boxes',
      planTitle: 'Fake flow',
      boxes: 0,
      drawn: ['section:Make'],
    },
    {
      name: 'a read plan with no title',
      planTitle: '',
      boxes: 2,
      drawn: ['section:Make', 'section:Wave 1'],
    },
    {
      name: 'a read plan with no title and no boxes',
      planTitle: '',
      boxes: 0,
      drawn: ['section:Make'],
    },
    {
      name: 'a read plan with boxes',
      planTitle: 'Fake flow',
      boxes: 3,
      drawn: ['section:Make', 'section:Wave 1'],
    },
  ])(
    'flowTab_$name_HeadsWithTheStageAndShowsTheEmptyStateOnlyWithNoPlan',
    ({ planTitle, boxes, drawn }) => {
      const parent = new FakeElement('parent');

      const { element } = layout.flowTab(
        asHtml(parent),
        flowTabInput(planTitle, boxes),
        fakeKit(),
      );

      expect(drawnParts(element as unknown as FakeElement)).toEqual(drawn);
    },
  );
});
