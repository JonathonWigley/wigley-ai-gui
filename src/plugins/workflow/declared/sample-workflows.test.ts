import { describe, expect, it } from 'vitest';
import {
  actionCommandShortId,
  CHECKLIST_WORKFLOW_ID,
  type ChecklistItem,
  type MainWorkflow,
  type PageWorkflow,
  type SessionFlow,
  type WorkflowDraw,
  type WorkflowSignal,
} from '../contract';
import { foldFlow, newFlow } from '../flow';
import { buildMainWorkflow } from './build-main';
import { buildPageWorkflow } from './build-page';
import { NO_PLAN_FOLD } from './plan-fold';
import { planFormatReader } from './plan-format-reader';
import { SAMPLE_SOURCE } from './sample-fixtures.test-support';
import {
  SAMPLE_AURI_FILE,
  type SampleWorkflowId,
  sampleDeclared,
} from './sample-workflows';
import { workflowsReader } from './workflows-reader';

const IDS: readonly SampleWorkflowId[] = ['small', 'medium', 'large', 'spike'];

const SMALL = sampleDeclared('small');
const MEDIUM = sampleDeclared('medium');
const LARGE = sampleDeclared('large');
const SPIKE = sampleDeclared('spike');

// The four samples' main halves, by `order` as the engine keeps them.
const WORKFLOWS: readonly MainWorkflow[] = IDS.map((id) =>
  buildMainWorkflow(sampleDeclared(id), NO_PLAN_FOLD),
).sort((a, b) => a.order - b.order);

const mainOf = (id: string): MainWorkflow => {
  const workflow = WORKFLOWS.find((each) => each.id === id);
  if (workflow === undefined) {
    throw new Error(`no workflow ${id}`);
  }
  return workflow;
};

// The page half of sample `id` over no-op deps.
function pageOf(id: SampleWorkflowId): PageWorkflow {
  return buildPageWorkflow(sampleDeclared(id), {
    draw: {} as WorkflowDraw,
    planPane: { checklist: () => null },
    runAction: async () => undefined,
    openDoc: () => undefined,
    paths: { join: (folder, ...segments) => [folder, ...segments].join('/') },
  });
}

function pageStageOf(id: SampleWorkflowId, stageId: string) {
  const stage = pageOf(id).stages.find((each) => each.id === stageId);
  if (stage === undefined) {
    throw new Error(`no page stage ${id}.${stageId}`);
  }
  return stage;
}

function skill(name: string): WorkflowSignal {
  return { type: 'skillStarted', skill: name, args: '', argsPath: null };
}

function step(name: string): WorkflowSignal {
  return { type: 'stepReported', step: name };
}

const NEW_FLOW = newFlow('s1', '/r');

const fold = (flow: SessionFlow, signal: WorkflowSignal) =>
  foldFlow(flow, signal, WORKFLOWS);

const foldAll = (flow: SessionFlow, signals: readonly WorkflowSignal[]) =>
  signals.reduce(fold, flow);

function flowOf(
  workflow: string,
  stage: string,
  fields: Partial<SessionFlow> = {},
): SessionFlow {
  return { ...NEW_FLOW, workflow, stage, ...fields };
}

const ONE_OF_THREE: ChecklistItem[] = [
  { text: 'a', done: true },
  { text: 'b', done: false },
  { text: 'c', done: false },
];

describe('sample workflows', () => {
  // Breaks: a sample the contract refuses, which task 13 would ship.
  it('SAMPLE_AURI_FILE_ReadsThroughTheWorkflowsReader', () => {
    const workflows = SAMPLE_AURI_FILE.workflows ?? [];
    const planFormat = SAMPLE_AURI_FILE.planFormat ?? {};

    expect({
      version: SAMPLE_AURI_FILE.version,
      ids: workflows.map(({ id }) => id),
      workflows: workflowsReader.read(workflows, SAMPLE_SOURCE),
      planFormat: planFormatReader.read(planFormat, SAMPLE_SOURCE),
    }).toEqual({
      version: 1,
      ids: ['small', 'medium', 'large', 'spike'],
      workflows: { ok: true, value: workflows },
      planFormat: { ok: true, value: planFormat },
    });
  });

  // Breaks: a sample declaration under another plugin or id.
  it('sampleDeclared_QualifiesUnderThePluginName', () => {
    expect([
      SMALL.id,
      sampleDeclared('large', 'demo').id,
      LARGE.planFormat === null,
      SMALL.planFormat === null,
    ]).toEqual(['wigley:small', 'demo:large', false, false]);
  });
});

describe('sample workflows › levels', () => {
  // Breaks: a claim that keeps the old workflow, or loses where it came from.
  it('claimOrder_MovesUp', () => {
    const small = fold(
      { ...NEW_FLOW, checklist: [{ text: 'a', done: true }] },
      skill('wigley:small'),
    );
    const medium = fold(
      { ...small, checklist: [{ text: 'a', done: true }] },
      skill('wigley:medium'),
    );
    const large = fold(medium, skill('wigley:feature'));

    expect(small).toMatchObject({ workflow: SMALL.id, movedUpFrom: null });
    expect(medium).toMatchObject({
      workflow: MEDIUM.id,
      movedUpFrom: SMALL.id,
      stage: 'interview',
      checklist: null,
    });
    expect(large).toMatchObject({
      workflow: LARGE.id,
      movedUpFrom: MEDIUM.id,
    });
  });

  it('movingDown_SetsMovedUpFromToo', () => {
    const flow = foldAll(NEW_FLOW, [
      skill('wigley:medium'),
      skill('wigley:small'),
    ]);

    expect(flow).toMatchObject({
      workflow: SMALL.id,
      movedUpFrom: MEDIUM.id,
    });
  });

  it.each([
    { workflow: SMALL.id, stage: 'build' },
    { workflow: MEDIUM.id, stage: 'review' },
  ])(
    'sharedStageIds_FoldOnlyTheCurrentWorkflow $workflow',
    ({ workflow, stage }) => {
      const flow = fold(flowOf(workflow, 'build'), step('review'));

      expect(flow.stage).toBe(stage);
    },
  );

  it.each(['wigley:review', 'wigley:debug', 'wigley:explore'])(
    'skillsOutsideTheLevels_ClaimNothing %s',
    (name) => {
      expect(fold(NEW_FLOW, skill(name)).workflow).toBe(CHECKLIST_WORKFLOW_ID);
    },
  );

  it.each([
    'wigley:small',
    'wigley:medium',
    'wigley:feature',
    'wigley:feature-primer',
    'wigley:make',
    'wigley:spike',
  ])('claims_AreDisjoint %s', (name) => {
    const claimers = WORKFLOWS.filter((workflow) =>
      workflow.claims(skill(name)),
    );

    expect(claimers).toHaveLength(1);
  });
});

// The stage rules of Small, Medium and Spike: from a flow in `from` (a new
// flow when null), `signal` gives `stage`, still in the workflow.
const LEVEL_RULES: {
  workflow: string;
  from: string | null;
  signal: WorkflowSignal;
  stage: string;
}[] = [
  {
    workflow: SMALL.id,
    from: null,
    signal: skill('wigley:small'),
    stage: 'scope',
  },
  { workflow: SMALL.id, from: null, signal: skill('small'), stage: 'scope' },
  ...[
    { from: 'scope', signal: step('build'), stage: 'build' },
    { from: 'build', signal: step('check'), stage: 'check' },
    { from: 'check', signal: step('land'), stage: 'land' },
    { from: 'land', signal: step('done'), stage: 'done' },
    { from: 'scope', signal: step('done'), stage: 'done' },
    { from: 'scope', signal: step('answered'), stage: 'answered' },
    { from: 'answered', signal: skill('wigley:small'), stage: 'scope' },
    { from: 'check', signal: step('build'), stage: 'build' },
    { from: 'done', signal: skill('wigley:small'), stage: 'scope' },
    { from: 'build', signal: step('review'), stage: 'build' },
    { from: 'build', signal: skill('wigley:review'), stage: 'build' },
    { from: 'build', signal: { type: 'turnEnded' } as const, stage: 'build' },
  ].map((row) => ({ workflow: SMALL.id, ...row })),
  {
    workflow: MEDIUM.id,
    from: null,
    signal: skill('wigley:medium'),
    stage: 'interview',
  },
  {
    workflow: MEDIUM.id,
    from: null,
    signal: skill('medium'),
    stage: 'interview',
  },
  ...[
    { from: 'interview', signal: step('build'), stage: 'build' },
    { from: 'build', signal: step('review'), stage: 'review' },
    { from: 'review', signal: step('fix'), stage: 'fix' },
    { from: 'fix', signal: step('review'), stage: 'review' },
    { from: 'fix', signal: step('land'), stage: 'land' },
    { from: 'land', signal: step('done'), stage: 'done' },
    { from: 'interview', signal: step('done'), stage: 'done' },
    { from: 'done', signal: skill('wigley:medium'), stage: 'interview' },
    { from: 'build', signal: { type: 'turnEnded' } as const, stage: 'build' },
    { from: 'build', signal: skill('wigley:review'), stage: 'build' },
    { from: 'build', signal: step('check'), stage: 'build' },
  ].map((row) => ({ workflow: MEDIUM.id, ...row })),
  {
    workflow: SPIKE.id,
    from: null,
    signal: skill('wigley:spike'),
    stage: 'interview',
  },
  {
    workflow: SPIKE.id,
    from: null,
    signal: skill('spike'),
    stage: 'interview',
  },
  ...[
    { from: 'interview', signal: step('build'), stage: 'build' },
    { from: 'build', signal: step('check'), stage: 'check' },
    { from: 'check', signal: step('land'), stage: 'land' },
    { from: 'land', signal: step('done'), stage: 'done' },
    { from: 'interview', signal: step('done'), stage: 'done' },
    { from: 'check', signal: step('build'), stage: 'build' },
    { from: 'done', signal: skill('wigley:spike'), stage: 'interview' },
    { from: 'build', signal: step('interview'), stage: 'interview' },
    { from: 'build', signal: step('review'), stage: 'build' },
    { from: 'build', signal: skill('wigley:review'), stage: 'build' },
    { from: 'build', signal: { type: 'turnEnded' } as const, stage: 'build' },
  ].map((row) => ({ workflow: SPIKE.id, ...row })),
];

describe('sample workflows › Small, Medium and Spike stages', () => {
  it.each(
    LEVEL_RULES.map((row) => ({
      ...row,
      name: `${row.workflow} ${row.from ?? 'new flow'}, ${JSON.stringify(row.signal)}`,
    })),
  )('foldFlow_LevelRules ($name)', ({ workflow, from, signal, stage }) => {
    const start = from === null ? NEW_FLOW : flowOf(workflow, from);

    const after = foldFlow(start, signal, [mainOf(workflow)]);

    expect({
      stage: after.stage,
      workflow: after.workflow,
      movedUpFrom: after.movedUpFrom,
    }).toEqual({ stage, workflow, movedUpFrom: null });
  });

  // Breaks: a stage that reports under another step, or a run that never ends.
  it.each([
    {
      id: 'small' as const,
      order: 10,
      firstStage: 'scope',
      reported: ['build', 'check', 'land', 'done', 'answered'],
      finishing: ['done', 'answered'],
    },
    {
      id: 'medium' as const,
      order: 20,
      firstStage: 'interview',
      reported: ['build', 'review', 'fix', 'land', 'done'],
      finishing: ['done'],
    },
    {
      id: 'spike' as const,
      order: 40,
      firstStage: 'interview',
      reported: ['interview', 'build', 'check', 'land', 'done'],
      finishing: ['done'],
    },
  ])('$id_Values', ({ id, order, firstStage, reported, finishing }) => {
    const workflow = mainOf(sampleDeclared(id).id);
    const { stages } = sampleDeclared(id).decl;

    expect({
      order: workflow.order,
      firstStage: workflow.firstStage,
      reported: stages.flatMap((stage) => stage.step ?? []),
      finishing: stages
        .filter((stage) => stage.finishes === true)
        .map((stage) => stage.id),
    }).toEqual({ order, firstStage, reported, finishing });
  });

  // Breaks: a trail with a word lost, doubled or out of order.
  it.each([
    { id: 'small' as const, trail: 'Scope › Build › Check › Land' },
    {
      id: 'medium' as const,
      trail: 'Interview › Build › Review › Fix › Land',
    },
    { id: 'spike' as const, trail: 'Interview › Build › Check › Land' },
  ])('$id Trail_Reads $trail', ({ id, trail }) => {
    const bySlot = new Map(
      pageOf(id)
        .stages.filter((stage) => stage.inStepper)
        .map((stage) => [stage.stepSlot ?? stage.id, stage.label]),
    );

    expect({
      trail: [...bySlot.values()].join(' › '),
      done: pageStageOf(id, 'done').label,
    }).toEqual({ trail, done: 'Land' });
  });

  it.each(
    (['small', 'medium', 'spike'] as const).flatMap((id) => [
      { id, stage: 'land', turnRunning: true, status: 'running' },
      { id, stage: 'land', turnRunning: false, status: 'paused' },
      { id, stage: 'done', turnRunning: true, status: 'running' },
      { id, stage: 'done', turnRunning: false, status: 'done' },
    ]),
  )(
    '$id Status $stage turnRunning $turnRunning',
    ({ id, stage, turnRunning, status }) => {
      const flow = flowOf(sampleDeclared(id).id, stage, { turnRunning });

      expect(pageStageOf(id, stage).status(flow)).toBe(status);
    },
  );

  it.each([true, false])(
    'small Status answered turnRunning %s',
    (turnRunning) => {
      const flow = flowOf(SMALL.id, 'answered', { turnRunning });

      expect(pageStageOf('small', 'answered').status(flow)).toBeNull();
    },
  );

  it.each(
    (['small', 'medium', 'spike'] as const).flatMap((id) => [
      { id, checklist: null, progress: '' },
      { id, checklist: ONE_OF_THREE, progress: ' 1/3' },
    ]),
  )('$id buildStatusProgress $progress', ({ id, checklist, progress }) => {
    const flow = flowOf(sampleDeclared(id).id, 'build', { checklist });

    expect(pageStageOf(id, 'build').statusProgress?.(flow)).toBe(progress);
  });

  // A template whose every variable is 0 renders empty.
  it.each<{ counters: Record<string, number>; progress: string }>([
    { counters: {}, progress: '' },
    { counters: { fix: 2 }, progress: ' · cycle 2' },
  ])('medium fixStatusProgress $progress', ({ counters, progress }) => {
    const flow = flowOf(MEDIUM.id, 'fix', { counters });

    expect(pageStageOf('medium', 'fix').statusProgress?.(flow)).toBe(progress);
  });
});

describe('sample workflows › Medium fix cycles', () => {
  const medium = mainOf(MEDIUM.id);
  const foldMedium = (
    flow: SessionFlow,
    signals: readonly WorkflowSignal[],
  ): SessionFlow =>
    signals.reduce(
      (current, signal) => foldFlow(current, signal, [medium]),
      flow,
    );

  it('fixCycles_CountsEachEntryToFix', () => {
    const flow = foldMedium(
      flowOf(MEDIUM.id, 'build'),
      ['fix', 'review', 'fix', 'done'].map(step),
    );

    expect(medium.fixCycles?.(flow)).toBe(2);
  });

  it.each([
    {
      name: 'review then fix',
      from: 'review',
      fix: 0,
      steps: ['fix'],
      cycles: 1,
    },
    {
      name: 'fix, review, fix',
      from: 'fix',
      fix: 1,
      steps: ['review', 'fix'],
      cycles: 2,
    },
    { name: 'fix then fix', from: 'fix', fix: 1, steps: ['fix'], cycles: 1 },
  ])('fixCycles: $name', ({ from, fix, steps, cycles }) => {
    const flow = foldMedium(
      flowOf(MEDIUM.id, from, { counters: { fix } }),
      steps.map(step),
    );

    expect(medium.fixCycles?.(flow)).toBe(cycles);
  });

  it('fixCycles_OtherStep_KeepsTheCount', () => {
    const after = foldMedium(
      flowOf(MEDIUM.id, 'interview', { counters: { fix: 1 } }),
      [step('build')],
    );

    expect({ stage: after.stage, cycles: medium.fixCycles?.(after) }).toEqual({
      stage: 'build',
      cycles: 1,
    });
  });

  it('fixCycles_SecondMediumAsk_CountsFromZero', () => {
    const after = foldMedium(
      flowOf(MEDIUM.id, 'done', { counters: { fix: 2 } }),
      [skill('wigley:medium')],
    );

    expect(medium.fixCycles?.(after)).toBe(0);
  });
});

describe('sample workflows › page halves', () => {
  it.each([
    { id: 'small' as const, label: 'Small', letter: 'S' },
    { id: 'medium' as const, label: 'Medium', letter: 'M' },
    { id: 'spike' as const, label: 'Spike', letter: 'X' },
  ])('badge_Reads$letter', ({ id, label, letter }) => {
    const page = pageOf(id);

    expect({ id: page.id, label: page.label, badge: page.badge }).toEqual({
      id: `wigley:${id}`,
      label,
      badge: letter,
    });
  });

  it.each(['small', 'medium', 'spike'] as const)(
    '%s progressText_CountsTheChecklist',
    (id) => {
      const flow = flowOf(sampleDeclared(id).id, 'build', {
        checklist: ONE_OF_THREE,
      });

      expect(pageOf(id).progressText?.(flow)).toBe('1/3');
    },
  );

  // Breaks: a Large key bound to no command, or to the old plugin's.
  it('sampleKeys_BindUnderActionCommandIds', () => {
    const keyed = Object.entries(LARGE.decl.actions ?? {}).flatMap(
      ([actionId, action]) =>
        action.key === undefined
          ? []
          : [
              [
                action.key,
                `workflow.${actionCommandShortId(LARGE.id, actionId)}`,
              ],
            ],
    );

    expect(Object.fromEntries(keyed)).toEqual({
      '<Leader>wn': 'workflow.wigley-large-makeInNewSession',
      '<Leader>wr': 'workflow.wigley-large-resumeMake',
      '<Leader>wo': 'workflow.wigley-large-openPlan',
      '<Leader>wt': 'workflow.wigley-large-retro',
      '<Leader>wd': 'workflow.wigley-large-dismiss',
    });
  });
});
