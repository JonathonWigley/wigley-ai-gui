import { describe, expect, it } from 'vitest';
import { CHECKLIST_WORKFLOW_ID, type DeclaredWorkflow } from '../contract';
import { newFlow } from '../flow';
import { createEnabledWorkflows } from './enabled-workflows';
import { designDeclared } from './fixtures.test-support';

function onWorkflow(workflow: string) {
  return { ...newFlow('s1', '/r'), workflow };
}

describe('createEnabledWorkflows', () => {
  it('Set_GivesTheListInOrder', () => {
    const enabled = createEnabledWorkflows();
    const list = [designDeclared('medium'), designDeclared('small')];

    enabled.set(list);

    expect(enabled.enabledWorkflows().map(({ id }) => id)).toEqual([
      'wigley:medium',
      'wigley:small',
    ]);
  });

  it('OnWorkflowsChanged_FiresOncePerDifferingSet', () => {
    const enabled = createEnabledWorkflows();
    const heard: string[][] = [];
    enabled.onWorkflowsChanged((workflows) =>
      heard.push(workflows.map(({ id }) => id)),
    );

    enabled.set([designDeclared('small')]);
    enabled.set([designDeclared('small')]);
    enabled.set([designDeclared('small'), designDeclared('large')]);

    expect(heard).toEqual([
      ['wigley:small'],
      ['wigley:small', 'wigley:large'],
    ]);
  });

  it('OnWorkflowsChanged_Disposed_HearsNoMore', () => {
    const enabled = createEnabledWorkflows();
    const heard: (readonly DeclaredWorkflow[])[] = [];
    enabled.onWorkflowsChanged((workflows) => heard.push(workflows)).dispose();

    enabled.set([designDeclared('small')]);

    expect(heard).toEqual([]);
  });

  it.each([
    { workflow: 'wigley:large', found: 'wigley:large' },
    { workflow: CHECKLIST_WORKFLOW_ID, found: null },
    { workflow: 'other:large', found: null },
  ])('WorkflowOf_$workflow_Gives$found', ({ workflow, found }) => {
    const enabled = createEnabledWorkflows();
    enabled.set([designDeclared('small'), designDeclared('large')]);

    expect(enabled.workflowOf(onWorkflow(workflow))?.id ?? null).toBe(found);
  });
});
