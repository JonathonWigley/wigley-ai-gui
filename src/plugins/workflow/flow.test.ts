import { describe, expect, it, vi } from 'vitest';
import {
  CHECKLIST_STAGE,
  CHECKLIST_WORKFLOW_ID,
  checklistCount,
  isBusy,
  type MainStage,
  type MainWorkflow,
  type SessionFlow,
  startsSkill,
  type WorkflowSignal,
} from './contract';
import { foldFlow, markMissedLevel, newFlow } from './flow';

function flowWith(fields: Partial<SessionFlow>): SessionFlow {
  return { ...newFlow('s1', '/r'), ...fields };
}

function skill(name: string): WorkflowSignal {
  return { type: 'skillStarted', skill: name, args: '', argsPath: null };
}

const reportedBuild: MainStage['enter'] = (_flow, signal) =>
  signal.type === 'stepReported' && signal.step === 'build' ? 'build' : null;

function workflow(
  id: string,
  order: number,
  claimed: string,
  firstStage: string,
  stages: readonly MainStage[] = [
    { id: 'build', order: 10, enter: reportedBuild },
  ],
): MainWorkflow {
  return {
    id,
    order,
    claims: (signal) => startsSkill(signal, claimed),
    firstStage,
    stages,
  };
}

const NO_RULE: MainStage['enter'] = () => null;

// Both hold a stage `done`; only Small's finishes its workflow.
const SMALL = workflow('small', 10, 'wigley:small', 'scope', [
  { id: 'build', order: 10, enter: reportedBuild },
  { id: 'done', order: 20, finishes: true, enter: NO_RULE },
]);
const MEDIUM = workflow('medium', 20, 'wigley:medium', 'interview', [
  { id: 'build', order: 10, enter: reportedBuild },
  { id: 'done', order: 20, enter: NO_RULE },
]);
const WORKFLOWS = [SMALL, MEDIUM];

const CHECKLIST = [{ text: 'a', done: false }];
const UNCHANGED = 'unchanged';

const SMALL_AT_BUILD = { workflow: 'small', stage: 'build' };

const WORKFLOW_ROWS: {
  name: string;
  flow: SessionFlow;
  signal: WorkflowSignal;
  expected: Partial<SessionFlow> | typeof UNCHANGED;
}[] = [
  {
    name: 'a claim of a new flow goes to the first stage and clears missedLevel',
    flow: flowWith({ missedLevel: true }),
    signal: skill('wigley:small'),
    expected: {
      workflow: 'small',
      stage: 'scope',
      movedUpFrom: null,
      missedLevel: false,
    },
  },
  {
    name: 'a claim by another workflow moves up and starts over',
    flow: flowWith({
      ...SMALL_AT_BUILD,
      checklist: [{ text: 'a', done: true }],
      counters: { n: 1 },
    }),
    signal: skill('wigley:medium'),
    expected: {
      workflow: 'medium',
      stage: 'interview',
      movedUpFrom: 'small',
      counters: {},
      checklist: null,
    },
  },
  {
    name: "the current workflow's own claim with no list changes nothing",
    flow: flowWith({ ...SMALL_AT_BUILD, movedUpFrom: 'medium' }),
    signal: skill('wigley:small'),
    expected: UNCHANGED,
  },
  {
    name: "the current workflow's own claim mid-run empties the list and keeps the rest",
    flow: flowWith({
      ...SMALL_AT_BUILD,
      movedUpFrom: 'medium',
      checklist: CHECKLIST,
      counters: { n: 1 },
    }),
    signal: skill('wigley:small'),
    expected: {
      workflow: 'small',
      stage: 'build',
      movedUpFrom: 'medium',
      counters: { n: 1 },
      checklist: null,
    },
  },
  {
    name: "the current workflow's own claim from a finished stage starts a new run",
    flow: flowWith({
      workflow: 'small',
      stage: 'done',
      movedUpFrom: 'medium',
      checklist: CHECKLIST,
    }),
    signal: skill('wigley:small'),
    expected: { workflow: 'small', movedUpFrom: null, checklist: null },
  },
  {
    name: "another workflow's claim from a finished stage starts a new run",
    flow: flowWith({ workflow: 'small', stage: 'done', movedUpFrom: 'large' }),
    signal: skill('wigley:medium'),
    expected: { workflow: 'medium', stage: 'interview', movedUpFrom: null },
  },
  {
    name: 'a stage of that id finishing in the claiming workflow alone moves up',
    flow: flowWith({ workflow: 'medium', stage: 'done' }),
    signal: skill('wigley:small'),
    expected: { workflow: 'small', stage: 'scope', movedUpFrom: 'medium' },
  },
  {
    name: 'a skill no workflow claims changes nothing',
    flow: flowWith(SMALL_AT_BUILD),
    signal: skill('wigley:review'),
    expected: UNCHANGED,
  },
  {
    name: 'a report on the Checklist flow, not registered here, changes nothing',
    flow: flowWith({}),
    signal: { type: 'stepReported', step: 'build' },
    expected: UNCHANGED,
  },
  {
    name: 'a claim from the Checklist flow leaves movedUpFrom null and keeps checklistReported',
    flow: flowWith({ checklistReported: true, checklist: CHECKLIST }),
    signal: skill('wigley:medium'),
    expected: {
      workflow: 'medium',
      stage: 'interview',
      movedUpFrom: null,
      checklist: null,
      checklistReported: true,
    },
  },
  {
    name: 'another workflow claim mid-run keeps checklistReported',
    flow: flowWith({ ...SMALL_AT_BUILD, checklistReported: true }),
    signal: skill('wigley:medium'),
    expected: { workflow: 'medium', checklistReported: true },
  },
  {
    name: 'a checklist replaces the list',
    flow: flowWith(SMALL_AT_BUILD),
    signal: { type: 'checklistReported', items: CHECKLIST },
    expected: { checklist: CHECKLIST },
  },
  {
    name: 'an equal checklist keeps the flow',
    flow: flowWith({ ...SMALL_AT_BUILD, checklist: CHECKLIST }),
    signal: { type: 'checklistReported', items: structuredClone(CHECKLIST) },
    expected: UNCHANGED,
  },
  {
    name: 'a checklist that only moves the running item replaces the list',
    flow: flowWith({ ...SMALL_AT_BUILD, checklist: CHECKLIST }),
    signal: {
      type: 'checklistReported',
      items: CHECKLIST.map((item, index) => ({
        ...item,
        running: index === 0,
      })),
    },
    expected: {
      checklist: CHECKLIST.map((item, index) => ({
        ...item,
        running: index === 0,
      })),
    },
  },
  {
    name: 'a checklist on the Checklist flow sets the list and checklistReported',
    flow: flowWith({}),
    signal: { type: 'checklistReported', items: CHECKLIST },
    expected: {
      workflow: CHECKLIST_WORKFLOW_ID,
      stage: CHECKLIST_STAGE,
      checklist: CHECKLIST,
      checklistReported: true,
    },
  },
  {
    name: 'a checklist on a workflow id no plugin holds sets the list and checklistReported',
    flow: flowWith({ workflow: 'gone', stage: 'build' }),
    signal: { type: 'checklistReported', items: CHECKLIST },
    expected: { stage: 'build', checklist: CHECKLIST, checklistReported: true },
  },
  {
    name: 'cleared clears missedLevel and keeps the workflow, stage and counters',
    flow: flowWith({
      ...SMALL_AT_BUILD,
      missedLevel: true,
      counters: { n: 1 },
    }),
    signal: { type: 'cleared' },
    expected: {
      workflow: 'small',
      stage: 'build',
      counters: { n: 1 },
      missedLevel: false,
    },
  },
  {
    name: 'a saved workflow with no plugin folds the running state only',
    flow: flowWith({ workflow: 'gone', stage: 'build' }),
    signal: { type: 'turnStarted' },
    expected: { turnRunning: true, stage: 'build' },
  },
];

describe('foldFlow', () => {
  it.each(WORKFLOW_ROWS)(
    'foldFlow_Workflows: $name',
    ({ flow, signal, expected }) => {
      const before = structuredClone(flow);

      const folded = foldFlow(flow, signal, WORKFLOWS);

      if (expected === UNCHANGED) {
        expect(folded).toBe(flow);
      } else {
        expect(folded).toMatchObject(expected);
      }
      expect(flow).toEqual(before);
    },
  );

  it('foldFlow_Workflows: two workflows claiming a skill give the lower order', () => {
    const lower = workflow('lower', 10, 'wigley:both', 'scope');
    const higher = workflow('higher', 20, 'wigley:both', 'interview');

    const folded = foldFlow(flowWith({}), skill('wigley:both'), [
      lower,
      higher,
    ]);

    expect(folded.workflow).toBe('lower');
  });

  it("foldFlow_Workflows: a report runs only the current workflow's rule", () => {
    const smallEnter = vi.fn(reportedBuild);
    const small = workflow('small', 10, 'wigley:small', 'scope', [
      { id: 'build', order: 10, enter: smallEnter },
    ]);
    const flow = flowWith({ workflow: 'medium', stage: 'interview' });

    const folded = foldFlow(flow, { type: 'stepReported', step: 'build' }, [
      small,
      MEDIUM,
    ]);

    expect(folded.stage).toBe('build');
    expect(smallEnter).not.toHaveBeenCalled();
  });

  it('the first stage rule in array order wins', () => {
    const answers = (id: string): MainStage => ({
      id,
      order: 10,
      enter: () => id,
    });
    const stub = workflow('stub', 10, 'x:stub', 'first', [
      answers('b'),
      answers('a'),
    ]);

    const folded = foldFlow(
      flowWith({ workflow: 'stub', stage: 'first' }),
      { type: 'turnEnded' },
      [stub],
    );

    expect(folded.stage).toBe('b');
  });

  it.each<{
    name: string;
    flow: SessionFlow;
    signal: WorkflowSignal;
    expected: Partial<SessionFlow> | typeof UNCHANGED;
  }>([
    {
      name: 'turnEnded clears turnRunning and keeps running subagents',
      flow: flowWith({ turnRunning: true, runningSubagents: ['a1'] }),
      signal: { type: 'turnEnded' },
      expected: { turnRunning: false, runningSubagents: ['a1'] },
    },
    {
      name: 'subagentStarted adds the agent',
      flow: flowWith({}),
      signal: { type: 'subagentStarted', agentId: 'a1' },
      expected: { runningSubagents: ['a1'] },
    },
    {
      name: 'subagentStarted for a listed agent changes nothing',
      flow: flowWith({ runningSubagents: ['a1'] }),
      signal: { type: 'subagentStarted', agentId: 'a1' },
      expected: UNCHANGED,
    },
    {
      name: 'subagentFinished removes the agent',
      flow: flowWith({ runningSubagents: ['a1', 'a2'] }),
      signal: { type: 'subagentFinished', agentId: 'a1' },
      expected: { runningSubagents: ['a2'] },
    },
    {
      name: 'subagentFinished for an unlisted agent changes nothing',
      flow: flowWith({ runningSubagents: ['a1', 'a2'] }),
      signal: { type: 'subagentFinished', agentId: 'a9' },
      expected: UNCHANGED,
    },
    {
      name: 'cleared stops the turn and the subagents',
      flow: flowWith({ turnRunning: true, runningSubagents: ['a1'] }),
      signal: { type: 'cleared' },
      expected: { turnRunning: false, runningSubagents: [] },
    },
  ])('the running state: $name', ({ flow, signal, expected }) => {
    const folded = foldFlow(flow, signal, []);

    if (expected === UNCHANGED) {
      expect(folded).toBe(flow);
    } else {
      expect(folded).toMatchObject(expected);
    }
  });
});

describe('markMissedLevel', () => {
  it('sets the flag on the Checklist flow with another workflow registered', () => {
    expect(markMissedLevel(flowWith({}), true).missedLevel).toBe(true);
  });

  it.each([
    { name: 'already set', fields: { missedLevel: true }, other: true },
    { name: 'a workflow', fields: { workflow: 'small' }, other: true },
    { name: 'no other workflow registered', fields: {}, other: false },
  ])('keeps the same flow with $name', ({ fields, other }) => {
    const flow = flowWith(fields);

    expect(markMissedLevel(flow, other)).toBe(flow);
  });
});

describe('newFlow', () => {
  it('NewFlow_IsOnTheChecklistFlow', () => {
    expect(newFlow('s1', '/r')).toMatchObject({
      workflow: CHECKLIST_WORKFLOW_ID,
      stage: CHECKLIST_STAGE,
      checklistReported: false,
      plan: null,
      counters: {},
      enteredFrom: null,
      countdownEndsAt: null,
    });
  });
});

describe('foldFlow on an unregistered workflow id', () => {
  it('FoldsItsStageRules_OnceTheIdIsRegistered', () => {
    const flow = flowWith({ workflow: 'late', stage: 'scope' });
    const report: WorkflowSignal = { type: 'stepReported', step: 'build' };
    const late = workflow('late', 30, 'x:late', 'scope');

    expect(foldFlow(flow, report, WORKFLOWS)).toBe(flow);
    expect(foldFlow(flow, report, [...WORKFLOWS, late]).stage).toBe('build');
  });
});

describe('foldFlow field hooks', () => {
  it('FoldFields_RunsBeforeTheStageRules_AndAfterStageSeesBoth', () => {
    const seen: string[] = [];
    const stub: MainWorkflow = {
      id: 'stub',
      order: 10,
      claims: () => false,
      firstStage: 'a',
      stages: [
        {
          id: 'b',
          order: 10,
          enter: (flow) => (flow.counters.n === 1 ? 'b' : null),
        },
      ],
      foldFields: (flow) => ({ ...flow, counters: { n: 1 } }),
      afterStage: (before, next) => {
        seen.push(`${before.stage}>${next.stage}`);
        return { ...next, enteredFrom: before.stage };
      },
    };

    const folded = foldFlow(
      flowWith({ workflow: 'stub', stage: 'a' }),
      { type: 'turnEnded' },
      [stub],
    );

    expect(folded).toMatchObject({
      stage: 'b',
      counters: { n: 1 },
      enteredFrom: 'a',
    });
    expect(seen).toEqual(['a>b']);
  });
});

describe('checklistCount', () => {
  it.each([
    { name: 'no list', checklist: null, count: null },
    { name: 'an empty list', checklist: [], count: null },
    {
      name: 'one of three',
      checklist: [
        { text: 'a', done: true },
        { text: 'b', done: false },
        { text: 'c', done: false },
      ],
      count: '1/3',
    },
  ])('$name → $count', ({ checklist, count }) => {
    expect(checklistCount(flowWith({ checklist }))).toBe(count);
  });
});

describe('isBusy', () => {
  it.each([
    { name: 'no turn and no subagent', fields: {}, expected: false },
    { name: 'a turn', fields: { turnRunning: true }, expected: true },
    {
      name: 'a subagent',
      fields: { runningSubagents: ['a1'] },
      expected: true,
    },
  ])('$name → $expected', ({ fields, expected }) => {
    expect(isBusy(flowWith(fields))).toBe(expected);
  });
});
