import { describe, expect, it } from 'vitest';
import type { SessionFlow } from '../contract';
import { newFlow } from '../flow';
import { checklistHookHandler, checklistHookReply } from './checklist-hook';
import { samplePlan, taskLine } from './fixtures.test-support';

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

const MAKE_LEAD = samplePlan({
  tasks: [taskLine('t1', true), taskLine('t2', false), taskLine('t3', false)],
});

describe('checklistHookReply', () => {
  it.each([
    {
      name: 'a session with no flow',
      flow: null,
      reply: { reported: false, open: 0, items: [] },
    },
    {
      name: 'a fresh flow',
      flow: flowWith({}),
      reply: { reported: false, open: 0, items: [] },
    },
    {
      name: 'a flow that sent its checklist',
      flow: flowWith(REPORTED_CHECKLIST),
      reply: {
        reported: true,
        open: 1,
        items: [
          { text: 'a', done: true },
          { text: 'b', done: false },
        ],
      },
    },
    {
      name: "a make lead's reported plan and no checklist",
      flow: flowWith({ workflow: 'p:large', stage: 'make', plan: MAKE_LEAD }),
      reply: {
        reported: true,
        open: 2,
        items: [
          { text: 't1', done: true },
          { text: 't2', done: false },
          { text: 't3', done: false },
        ],
      },
    },
    {
      name: 'a checklist beside a reported plan',
      flow: flowWith({ ...REPORTED_CHECKLIST, plan: MAKE_LEAD }),
      reply: {
        reported: true,
        open: 1,
        items: [
          { text: 'a', done: true },
          { text: 'b', done: false },
        ],
      },
    },
    {
      name: 'an unreported plan',
      flow: flowWith({ plan: samplePlan(null, { reported: false }) }),
      reply: { reported: false, open: 0, items: [] },
    },
    {
      name: 'a flow on an unregistered workflow that sent a checklist',
      flow: flowWith({ ...REPORTED_CHECKLIST, workflow: 'gone:level' }),
      reply: {
        reported: true,
        open: 1,
        items: [
          { text: 'a', done: true },
          { text: 'b', done: false },
        ],
      },
    },
  ])('$name', ({ flow, reply }) => {
    expect(checklistHookReply(flow)).toEqual(reply);
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
    });

    const reply = handler({ id: 's1' } as Parameters<typeof handler>[0], {});
    flows.set('s1', flowWith(REPORTED_CHECKLIST));
    open();

    expect(await reply).toMatchObject({ reported: true, open: 1 });
  });
});
