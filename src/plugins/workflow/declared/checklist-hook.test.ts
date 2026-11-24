import { describe, expect, it } from 'vitest';
import type { DeclaredWorkflow, SessionFlow } from '../contract';
import { newFlow } from '../flow';
import {
  type ChecklistHookReply,
  checklistHookHandler,
  checklistHookReply,
} from './checklist-hook';
import { samplePlan, taskLine } from './sample-fixtures.test-support';
import { sampleDeclared } from './sample-workflows';

function flowWith(fields: Partial<SessionFlow>): SessionFlow {
  return { ...newFlow('s1', '/r'), ...fields };
}

const REPORTED_CHECKLIST = {
  checklistReported: true,
  checklist: [
    { text: 'a', done: true },
    { text: 'b', done: false },
  ],
};

const LARGE = sampleDeclared('large');

const MAKE_LEAD = samplePlan({
  tasks: [taskLine('t1', true), taskLine('t2', false), taskLine('t3', false)],
});

const NOTHING_REPORTED: ChecklistHookReply = {
  reported: false,
  open: 0,
  items: [],
  step: null,
};

const CHECKLIST_REPLY: ChecklistHookReply = {
  reported: true,
  open: 1,
  items: [
    { text: 'a', done: true },
    { text: 'b', done: false },
  ],
  step: null,
};

describe('checklistHookReply', () => {
  it.each<{
    name: string;
    flow: SessionFlow | null;
    workflow: DeclaredWorkflow | null;
    reply: ChecklistHookReply;
  }>([
    {
      name: 'a session with no flow',
      flow: null,
      workflow: null,
      reply: NOTHING_REPORTED,
    },
    {
      name: 'a fresh flow',
      flow: flowWith({}),
      workflow: null,
      reply: NOTHING_REPORTED,
    },
    {
      name: 'a flow that sent its checklist',
      flow: flowWith(REPORTED_CHECKLIST),
      workflow: null,
      reply: CHECKLIST_REPLY,
    },
    {
      name: "a make lead's reported plan and no checklist, on a stage no step names",
      flow: flowWith({ workflow: LARGE.id, stage: 'make', plan: MAKE_LEAD }),
      workflow: LARGE,
      reply: {
        reported: true,
        open: 2,
        items: [
          { text: 't1', done: true },
          { text: 't2', done: false },
          { text: 't3', done: false },
        ],
        step: null,
      },
    },
    {
      name: 'a checklist beside a reported plan',
      flow: flowWith({ ...REPORTED_CHECKLIST, plan: MAKE_LEAD }),
      workflow: null,
      reply: CHECKLIST_REPLY,
    },
    {
      name: 'an unreported plan',
      flow: flowWith({ plan: samplePlan(null, { reported: false }) }),
      workflow: null,
      reply: NOTHING_REPORTED,
    },
    {
      name: 'a stage whose step name differs from its id',
      flow: flowWith({ workflow: LARGE.id, stage: 'coldRead' }),
      workflow: LARGE,
      reply: { ...NOTHING_REPORTED, step: 'cold_read' },
    },
    {
      name: 'a flow on an unregistered workflow that sent a checklist',
      flow: flowWith({ ...REPORTED_CHECKLIST, workflow: 'gone:level' }),
      workflow: null,
      reply: CHECKLIST_REPLY,
    },
  ])('$name', ({ flow, workflow, reply }) => {
    expect(checklistHookReply(flow, workflow)).toEqual(reply);
  });
});

describe('checklistHookHandler', () => {
  it('Handler_WaitsForReady_ThenRepliesForTheSession', async () => {
    let open: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      open = resolve;
    });
    const flows = new Map<string, SessionFlow>();
    const handler = checklistHookHandler({
      ready,
      flowOf: (sessionId) => flows.get(sessionId) ?? null,
      workflowOf: (flow) => (flow.workflow === LARGE.id ? LARGE : null),
    });

    const reply = handler({ id: 's1' } as Parameters<typeof handler>[0], {});
    flows.set(
      's1',
      flowWith({ ...REPORTED_CHECKLIST, workflow: LARGE.id, stage: 'plan' }),
    );
    open();

    expect(await reply).toMatchObject({
      reported: true,
      open: 1,
      step: 'plan',
    });
  });
});
