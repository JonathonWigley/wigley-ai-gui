// The sample Large workflow's stage rules and page stages, through the
// engine's declared halves and the plan fold.

import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_WORKFLOW_ID,
  type PageStage,
  type PlanProgress,
  type PlanState,
  type PlanTaskLine,
  type SessionFlow,
  statusLine,
  type WorkflowDraw,
  type WorkflowSignal,
} from '../contract';
import { foldFlow, newFlow } from '../flow';
import { createPlanFold } from '../plan/plan-fold';
import { buildMainWorkflow } from './build-main';
import { buildPageWorkflow } from './build-page';
import { sampleDeclared } from './sample-workflows';

const LARGE = sampleDeclared('large');
const MAIN = buildMainWorkflow(LARGE, createPlanFold());
const PAGE = buildPageWorkflow(LARGE, {
  draw: {} as WorkflowDraw,
  planPane: { checklist: () => null },
  runAction: async () => undefined,
  openDoc: () => undefined,
  paths: { join: (folder, ...segments) => [folder, ...segments].join('/') },
});

const PLAN_DIR = '/r/plan-f';

// `total` build task lines, the first `checked` of them ticked.
function tasksOf(checked: number, total: number): PlanTaskLine[] {
  return Array.from({ length: total }, (_, index) => ({
    group: 1,
    text: `task ${index + 1}`,
    done: index < checked,
    file: null,
    status: null,
    verification: false,
  }));
}

// A read of `checked` ticked boxes in `total` and `reviewRounds` rounds in
// the Run log, its task lines matching its counts.
function progressOf(
  fields: Partial<Omit<PlanProgress, 'counters'>> & { reviewRounds?: number },
): PlanProgress {
  const { reviewRounds = 0, ...rest } = fields;
  const checked = rest.checked ?? 0;
  const total = rest.total ?? 3;
  return {
    title: 'F',
    checked,
    total,
    wave: total > checked ? 1 : null,
    counters: { reviewRounds },
    tasks: tasksOf(checked, total),
    ...rest,
  };
}

// A plan at `dir`, read as `progress` (null: unread), with `snapshots`.
function planOf(
  progress: PlanProgress | null,
  fields: Partial<PlanState> = {},
): PlanState {
  return {
    dir: PLAN_DIR,
    reported: false,
    unreportedDir: null,
    progress,
    snapshots: {},
    ...fields,
  };
}

// A Large flow in `stage`.
function flowIn(stage: string, fields: Partial<SessionFlow> = {}): SessionFlow {
  return { ...newFlow('s1', '/r'), workflow: LARGE.id, stage, ...fields };
}

function skillStarted(
  skill: string,
  argsPath: string | null = null,
): WorkflowSignal {
  return { type: 'skillStarted', skill, args: argsPath ?? '', argsPath };
}

const step = (name: string): WorkflowSignal => ({
  type: 'stepReported',
  step: name,
});
const event = (name: string): WorkflowSignal => ({
  type: 'event',
  event: name,
});
const planChanged = (progress: PlanProgress): WorkflowSignal => ({
  type: 'planChanged',
  progress,
});
const TURN_ENDED: WorkflowSignal = { type: 'turnEnded' };
const PLAN_GONE: WorkflowSignal = { type: 'planGone' };

const fold = (flow: SessionFlow, signal: WorkflowSignal) =>
  foldFlow(flow, signal, [MAIN]);

const foldAll = (flow: SessionFlow, signals: readonly WorkflowSignal[]) =>
  signals.reduce(fold, flow);

// The stage after each signal in turn.
function stagesAfter(
  flow: SessionFlow,
  signals: readonly WorkflowSignal[],
): string[] {
  const stages: string[] = [];
  let current = flow;
  for (const signal of signals) {
    current = fold(current, signal);
    stages.push(current.stage);
  }
  return stages;
}

describe('sample Large › claims', () => {
  it.each<{ name: string; signal: WorkflowSignal; claims: boolean }>([
    ...[
      'wigley:feature',
      'feature',
      'wigley:feature-primer',
      'feature-primer',
      'wigley:make',
      'make',
    ].map((skill) => ({
      name: skill,
      signal: skillStarted(skill),
      claims: true,
    })),
    ...['wigley:review', 'wigley:featurex', 'wigley:small'].map((skill) => ({
      name: skill,
      signal: skillStarted(skill),
      claims: false,
    })),
    { name: 'a turn end', signal: TURN_ENDED, claims: false },
  ])('claims_NamesOnlyLargeSkills ($name)', ({ signal, claims }) => {
    expect(MAIN.claims(signal)).toBe(claims);
  });

  // Breaks: a claim that lands in the transient first stage and stays there.
  it.each([
    { skill: 'wigley:make', argsPath: null, stage: 'make', planDir: null },
    {
      skill: 'wigley:feature',
      argsPath: null,
      stage: 'explore',
      planDir: null,
    },
    {
      skill: 'wigley:feature-primer',
      argsPath: null,
      stage: 'primer',
      planDir: null,
    },
    {
      skill: 'wigley:make',
      argsPath: PLAN_DIR,
      stage: 'make',
      planDir: PLAN_DIR,
    },
  ])(
    'claim_EntersTheClaimedSkillsStage $skill $argsPath',
    ({ skill, argsPath, stage, planDir }) => {
      const folded = fold(newFlow('s1', '/r'), skillStarted(skill, argsPath));

      expect({
        workflow: folded.workflow,
        stage: folded.stage,
        movedUpFrom: folded.movedUpFrom,
        planDir: folded.plan?.dir ?? null,
      }).toEqual({ workflow: LARGE.id, stage, movedUpFrom: null, planDir });
    },
  );

  it('wigley:review claims nothing', () => {
    const folded = fold(newFlow('s1', '/r'), skillStarted('wigley:review'));

    expect(folded.workflow).toBe(CHECKLIST_WORKFLOW_ID);
  });
});

describe('sample Large › stage rules', () => {
  // idle
  it.each([
    {
      name: 'handedOff from make',
      from: 'make',
      signal: event('handedOff'),
      stage: 'idle',
    },
    {
      name: 'handedOff from planReady',
      from: 'planReady',
      signal: event('handedOff'),
      stage: 'idle',
    },
    {
      name: 'dismissed from closed',
      from: 'closed',
      signal: event('dismissed'),
      stage: 'idle',
    },
    {
      name: 'dismissed from make',
      from: 'make',
      signal: event('dismissed'),
      stage: 'make',
    },
    // primer
    {
      name: 'wigley:feature-primer from idle',
      from: 'idle',
      signal: skillStarted('wigley:feature-primer'),
      stage: 'primer',
    },
    {
      name: 'wigley:feature-primer from closed',
      from: 'closed',
      signal: skillStarted('wigley:feature-primer'),
      stage: 'primer',
    },
    // explore
    {
      name: 'wigley:feature from idle',
      from: 'idle',
      signal: skillStarted('wigley:feature'),
      stage: 'explore',
    },
    {
      name: 'wigley:feature from primer',
      from: 'primer',
      signal: skillStarted('wigley:feature'),
      stage: 'explore',
    },
    {
      name: 'wigley:feature from closed',
      from: 'closed',
      signal: skillStarted('wigley:feature'),
      stage: 'explore',
    },
    {
      name: 'wigley:featurex keeps the stage',
      from: 'primer',
      signal: skillStarted('wigley:featurex'),
      stage: 'primer',
    },
    // make
    ...['planReady', 'idle', 'review', 'fix', 'closed'].map((from) => ({
      name: `wigley:make from ${from}`,
      from,
      signal: skillStarted('wigley:make'),
      stage: 'make',
    })),
  ])('$name', ({ from, signal, stage }) => {
    expect(fold(flowIn(from), signal).stage).toBe(stage);
  });

  // planReady: an explore flow with a plan written, read with three boxes, and
  // nothing busy, unless the row says otherwise.
  const READ = planOf(progressOf({ total: 3 }));
  it.each<{
    name: string;
    flow: Partial<SessionFlow>;
    signals: readonly WorkflowSignal[];
    stage: string;
    clearsPlan?: true;
  }>([
    {
      name: 'turnEnded with a plan with boxes',
      flow: {},
      signals: [TURN_ENDED],
      stage: 'planReady',
    },
    ...(['interview', 'plan', 'coldRead'] as const).map((stage) => ({
      name: `turnEnded in ${stage}`,
      flow: { stage },
      signals: [TURN_ENDED],
      stage: 'planReady',
    })),
    {
      name: 'planChanged with boxes',
      flow: { plan: planOf(null) },
      signals: [planChanged(progressOf({ total: 3 }))],
      stage: 'planReady',
    },
    {
      name: 'turnEnded with no plan folder',
      flow: { plan: null },
      signals: [TURN_ENDED],
      stage: 'explore',
    },
    {
      name: 'turnEnded with the plan unread',
      flow: { plan: planOf(null) },
      signals: [TURN_ENDED],
      stage: 'explore',
    },
    {
      name: 'turnEnded with a Tasks section holding no box',
      flow: { plan: planOf(progressOf({ total: 0 })) },
      signals: [TURN_ENDED],
      stage: 'explore',
    },
    {
      name: 'planChanged while a turn runs',
      flow: { turnRunning: true, plan: planOf(null) },
      signals: [planChanged(progressOf({ total: 3 }))],
      stage: 'explore',
    },
    {
      name: 'turnEnded while a drafter runs',
      flow: { turnRunning: true, runningSubagents: ['a1'] },
      signals: [TURN_ENDED],
      stage: 'explore',
    },
    {
      name: 'subagentFinished of the last subagent waits for the next turn end',
      flow: { runningSubagents: ['a1'] },
      signals: [{ type: 'subagentFinished', agentId: 'a1' }],
      stage: 'explore',
    },
    {
      name: 'fileWritten of a plan.md waits for the turn end',
      flow: { turnRunning: true },
      signals: [{ type: 'fileWritten', path: `${PLAN_DIR}/plan.md` }],
      stage: 'explore',
    },
    {
      name: 'turnEnded in make',
      flow: { stage: 'make' },
      signals: [TURN_ENDED],
      stage: 'make',
    },
    {
      name: 'wigley:feature from closed clears the plan',
      flow: { stage: 'closed' },
      signals: [skillStarted('wigley:feature')],
      stage: 'explore',
      clearsPlan: true,
    },
    {
      name: 'wigley:feature-primer from closed clears the plan',
      flow: { stage: 'closed' },
      signals: [skillStarted('wigley:feature-primer')],
      stage: 'primer',
      clearsPlan: true,
    },
    {
      name: "a closed run's plan never makes the interview plan ready",
      flow: { stage: 'closed' },
      signals: [skillStarted('wigley:feature'), TURN_ENDED],
      stage: 'explore',
    },
  ])('planReady: $name', ({ flow, signals, stage, clearsPlan }) => {
    const folded = foldAll(flowIn('explore', { plan: READ, ...flow }), signals);

    expect(folded.stage).toBe(stage);
    if (clearsPlan === true) {
      expect(folded.plan).toBeNull();
    }
  });

  // review: a flow whose plan folder is known and unread; each read holds
  // `reviewRounds` rounds and `checked` of seven boxes.
  const roundsRead = (reviewRounds: number, checked = 5) =>
    planChanged(progressOf({ checked, total: 7, wave: 3, reviewRounds }));
  it.each<{
    name: string;
    from: string;
    signals: readonly WorkflowSignal[];
    stages: readonly string[];
  }>([
    {
      name: 'wigley:review in make',
      from: 'make',
      signals: [skillStarted('wigley:review')],
      stages: ['review'],
    },
    {
      name: 'wigley:review in fix',
      from: 'fix',
      signals: [skillStarted('wigley:review')],
      stages: ['review'],
    },
    {
      name: 'wigley:review in explore',
      from: 'explore',
      signals: [skillStarted('wigley:review')],
      stages: ['explore'],
    },
    {
      name: 'a round logged in fix stays in fix',
      from: 'fix',
      signals: [roundsRead(1), roundsRead(2)],
      stages: ['fix', 'fix'],
    },
    {
      name: 'planChanged with no review round in make',
      from: 'make',
      signals: [roundsRead(0)],
      stages: ['make'],
    },
    {
      name: 'Resume make from review waits for a round logged after it',
      from: 'planReady',
      signals: [
        roundsRead(0),
        skillStarted('wigley:make'),
        roundsRead(1),
        skillStarted('wigley:make'),
        roundsRead(1, 6),
        roundsRead(2, 6),
      ],
      stages: ['planReady', 'make', 'review', 'make', 'make', 'review'],
    },
    {
      name: 'make of an unread plan counts its rounds from the first read',
      from: 'idle',
      signals: [
        skillStarted('wigley:make', '/r/plan-g'),
        roundsRead(2),
        roundsRead(2, 6),
        roundsRead(3, 6),
      ],
      stages: ['make', 'make', 'make', 'review'],
    },
  ])('review: $name', ({ from, signals, stages }) => {
    expect(stagesAfter(flowIn(from, { plan: planOf(null) }), signals)).toEqual(
      stages,
    );
  });

  // closed: a flow whose plan was read, closed from review, with `running`
  // subagents.
  const CLOSED_READ = progressOf({ checked: 2, total: 5 });
  const MAKE_OF_A_NEW_FOLDER = skillStarted('wigley:make', '/r/plan-g');
  it.each<{
    name: string;
    from: string;
    running?: string[];
    signals: readonly WorkflowSignal[];
    stage: string;
  }>([
    {
      name: 'the plan read while closed and a subagent runs reopens it',
      from: 'closed',
      running: ['a1'],
      signals: [planChanged(CLOSED_READ)],
      stage: 'review',
    },
    {
      name: 'the plan read while closed and nothing runs keeps it closed',
      from: 'closed',
      signals: [planChanged(CLOSED_READ)],
      stage: 'closed',
    },
    {
      name: 'the plan read while closed during a turn reopens it',
      from: 'closed',
      signals: [{ type: 'turnStarted' }, planChanged(CLOSED_READ)],
      stage: 'review',
    },
    ...['make', 'review', 'fix'].map((from) => ({
      name: `planGone in ${from}`,
      from,
      signals: [PLAN_GONE],
      stage: 'closed',
    })),
    ...['explore', 'planReady'].map((from) => ({
      name: `planGone in ${from}`,
      from,
      signals: [PLAN_GONE],
      stage: from,
    })),
    {
      name: 'make of a folder not written yet waits for it',
      from: 'idle',
      signals: [MAKE_OF_A_NEW_FOLDER, PLAN_GONE],
      stage: 'make',
    },
    {
      name: 'make of a folder written after it starts closes once it goes',
      from: 'idle',
      signals: [
        MAKE_OF_A_NEW_FOLDER,
        PLAN_GONE,
        planChanged(CLOSED_READ),
        PLAN_GONE,
      ],
      stage: 'closed',
    },
  ])('closed: $name', ({ from, running = [], signals, stage }) => {
    const flow = flowIn(from, {
      plan: planOf(CLOSED_READ),
      enteredFrom: 'review',
      runningSubagents: running,
    });

    expect(foldAll(flow, signals).stage).toBe(stage);
  });

  it('closed finishes the run', () => {
    expect(MAIN.stages.find((stage) => stage.id === 'closed')?.finishes).toBe(
      true,
    );
  });
});

describe('sample Large › a reported step', () => {
  const READ = planOf(progressOf({ checked: 2, total: 5, reviewRounds: 1 }));

  it.each([
    { from: 'explore', step: 'interview', stage: 'interview' },
    { from: 'interview', step: 'plan', stage: 'plan' },
    { from: 'plan', step: 'coldRead', stage: 'coldRead' },
    { from: 'coldRead', step: 'plan', stage: 'plan' },
    { from: 'plan', step: 'interview', stage: 'interview' },
    { from: 'interview', step: 'explore', stage: 'explore' },
    { from: 'planReady', step: 'plan', stage: 'plan' },
    { from: 'make', step: 'fix', stage: 'fix' },
    { from: 'review', step: 'fix', stage: 'fix' },
    { from: 'idle', step: 'interview', stage: 'idle' },
    { from: 'idle', step: 'explore', stage: 'idle' },
    { from: 'idle', step: 'fix', stage: 'idle' },
    { from: 'primer', step: 'plan', stage: 'primer' },
    { from: 'make', step: 'plan', stage: 'make' },
    { from: 'review', step: 'coldRead', stage: 'review' },
    { from: 'fix', step: 'interview', stage: 'fix' },
    { from: 'closed', step: 'explore', stage: 'closed' },
    { from: 'closed', step: 'fix', stage: 'closed' },
    { from: 'explore', step: 'fix', stage: 'explore' },
    { from: 'planReady', step: 'fix', stage: 'planReady' },
  ])(
    '$step from $from leaves the flow in $stage',
    ({ from, step: name, stage }) => {
      expect(fold(flowIn(from, { plan: READ }), step(name)).stage).toBe(stage);
    },
  );

  it.each(['explore', 'interview'])(
    'back to %s from plan keeps the plan',
    (name) => {
      expect(fold(flowIn('plan', { plan: READ }), step(name)).plan).toEqual(
        READ,
      );
    },
  );

  // Breaks: a stage whose rule names a stage id that is not registered, or a
  // stage no signal can enter.
  it('every stage rule enters a registered stage, and every stage is entered', () => {
    const registered = MAIN.stages.map((stage) => stage.id);
    const signals: WorkflowSignal[] = [
      ...[
        'wigley:feature-primer',
        'wigley:feature',
        'wigley:make',
        'wigley:review',
        'other:make',
      ].map((skill) => skillStarted(skill)),
      { type: 'fileWritten', path: `${PLAN_DIR}/plan.md` },
      { type: 'turnStarted' },
      TURN_ENDED,
      { type: 'subagentStarted', agentId: 'a1' },
      { type: 'subagentFinished', agentId: 'a1' },
      { type: 'cleared' },
      planChanged(progressOf({ checked: 2, total: 5, reviewRounds: 2 })),
      PLAN_GONE,
      event('handedOff'),
      event('dismissed'),
      ...registered.map(step),
    ];
    const entered = new Set<string>();
    for (const from of registered) {
      const flow = flowIn(from, {
        plan: planOf(progressOf({ checked: 2, total: 5, reviewRounds: 1 }), {
          snapshots: { reviewRounds: 0 },
        }),
        enteredFrom: 'review',
        runningSubagents: from === 'closed' ? ['a1'] : [],
      });
      for (const signal of signals) {
        for (const stage of MAIN.stages) {
          const id = stage.enter(flow, signal);
          if (id !== null) {
            entered.add(id);
          }
        }
      }
    }

    expect([...entered].sort()).toEqual([...registered].sort());
  });
});

describe('sample Large › foldFlow over Large', () => {
  const PLAN_X = '/r/docs/features/x/plan-a';
  const READ = progressOf({ checked: 1, total: 3, wave: 2, reviewRounds: 1 });
  const ROUNDS_2 = { ...READ, counters: { reviewRounds: 2 } };
  const planX = (
    progress: PlanProgress | null,
    snapshots: Record<string, number> = {},
  ): PlanState => planOf(progress, { dir: PLAN_X, snapshots });
  // A stage no Large rule names, so only the bookkeeping moves.
  const IN_C = 'c';

  it.each<{
    name: string;
    flow: SessionFlow;
    signal: WorkflowSignal;
    expected: Partial<SessionFlow> | 'unchanged';
  }>([
    {
      name: 'the rules see the flow after the bookkeeping',
      flow: flowIn('explore', { plan: planX(null) }),
      signal: planChanged(READ),
      expected: { stage: 'planReady', plan: planX(READ) },
    },
    {
      name: 'a stage change stops the countdown',
      flow: flowIn('explore', { plan: planX(READ), countdownEndsAt: 5000 }),
      signal: TURN_ENDED,
      expected: {
        stage: 'planReady',
        plan: planX(READ),
        countdownEndsAt: null,
      },
    },
    {
      name: 'wigley:feature drops the plan',
      flow: flowIn(IN_C, { plan: planX(READ) }),
      signal: skillStarted('wigley:feature'),
      expected: { stage: 'explore', plan: null },
    },
    {
      name: 'wigley:feature-primer drops the plan',
      flow: flowIn(IN_C, { plan: planX(READ) }),
      signal: skillStarted('wigley:feature-primer'),
      expected: { stage: 'primer', plan: null },
    },
    {
      name: 'a report entering a clearsPlan stage keeps the plan',
      flow: flowIn('plan', { plan: planX(READ) }),
      signal: step('explore'),
      expected: { stage: 'explore', plan: planX(READ) },
    },
    {
      name: 're-entering a clearsPlan stage drops the plan',
      flow: flowIn('explore', { plan: planX(READ) }),
      signal: skillStarted('wigley:feature'),
      expected: { stage: 'explore', plan: null },
    },
    {
      name: "entering make records the plan's review rounds",
      flow: flowIn(IN_C, { plan: planX(READ) }),
      signal: skillStarted('wigley:make'),
      expected: { stage: 'make', plan: planX(READ, { reviewRounds: 1 }) },
    },
    {
      name: 're-entering make records the rounds again',
      flow: flowIn('make', { plan: planX(READ, { reviewRounds: 0 }) }),
      signal: skillStarted('wigley:make'),
      expected: { stage: 'make', plan: planX(READ, { reviewRounds: 1 }) },
    },
    {
      name: 'entering make with the plan unread records none',
      flow: flowIn(IN_C, { plan: planX(null, { reviewRounds: 2 }) }),
      signal: skillStarted('wigley:make'),
      expected: { stage: 'make', plan: planX(null) },
    },
    {
      name: 'returning to idle drops the plan',
      flow: flowIn(IN_C, { plan: planX(READ, { reviewRounds: 1 }) }),
      signal: event('handedOff'),
      expected: { stage: 'idle', plan: null },
    },
    {
      name: 'planGone in review closes the run and keeps the stage it closed from',
      flow: flowIn('review', { plan: planX(READ) }),
      signal: PLAN_GONE,
      expected: { stage: 'closed', plan: planX(READ), enteredFrom: 'review' },
    },
    {
      name: 'the plan read again while a subagent runs reopens a closed run in the stage it closed from',
      flow: flowIn('closed', {
        runningSubagents: ['a1'],
        plan: planX(READ, { reviewRounds: 0 }),
        enteredFrom: 'fix',
      }),
      signal: planChanged(ROUNDS_2),
      expected: {
        stage: 'fix',
        plan: planX(ROUNDS_2, { reviewRounds: 0 }),
        enteredFrom: 'fix',
      },
    },
    {
      name: 'the plan read again during a turn reopens a closed run into make keeping its recorded review rounds',
      flow: flowIn('closed', {
        turnRunning: true,
        plan: planX(READ, { reviewRounds: 0 }),
        enteredFrom: 'make',
      }),
      signal: planChanged(ROUNDS_2),
      expected: {
        stage: 'make',
        plan: planX(ROUNDS_2, { reviewRounds: 0 }),
        enteredFrom: 'make',
      },
    },
    {
      name: 'the plan read again with nothing running leaves a closed run closed',
      flow: flowIn('closed', {
        plan: planX(READ, { reviewRounds: 0 }),
        enteredFrom: 'fix',
      }),
      signal: planChanged(ROUNDS_2),
      expected: { stage: 'closed', plan: planX(ROUNDS_2, { reviewRounds: 0 }) },
    },
    {
      name: 'wigley:make of the same folder from closed records the review rounds again',
      flow: flowIn('closed', {
        turnRunning: true,
        plan: planX(ROUNDS_2, { reviewRounds: 0 }),
        enteredFrom: 'review',
      }),
      signal: skillStarted('wigley:make', PLAN_X),
      expected: {
        stage: 'make',
        plan: planX(ROUNDS_2, { reviewRounds: 2 }),
        enteredFrom: 'review',
      },
    },
    {
      name: 'the plan read again leaves a closed run saved with no stage it closed from closed',
      flow: flowIn('closed', {
        runningSubagents: ['a1'],
        plan: planX(READ, { reviewRounds: 0 }),
      }),
      signal: planChanged(ROUNDS_2),
      expected: { stage: 'closed', plan: planX(ROUNDS_2, { reviewRounds: 0 }) },
    },
    {
      name: 'a signal nothing answers changes nothing',
      flow: flowIn(IN_C, { plan: planX(READ) }),
      signal: PLAN_GONE,
      expected: 'unchanged',
    },
  ])('$name', ({ flow, signal, expected }) => {
    const before = structuredClone(flow);

    const folded = fold(flow, signal);

    if (expected === 'unchanged') {
      expect(folded).toBe(flow);
    } else {
      const named = Object.fromEntries(
        Object.keys(expected).map((key) => [
          key,
          folded[key as keyof SessionFlow],
        ]),
      );
      expect(named).toEqual(expected);
    }
    expect(flow).toEqual(before);
  });

  it.each([
    { name: 'no progress', plan: planX(null), cycles: 0 },
    { name: 'two rounds', plan: planX(ROUNDS_2), cycles: 2 },
  ])('fixCycles_ReadsTheRounds ($name)', ({ plan, cycles }) => {
    expect(MAIN.fixCycles?.(flowIn('make', { plan }))).toBe(cycles);
  });

  it('fixCycles_ReadsTheRounds (two rounds after planGone)', () => {
    const closed = fold(flowIn('make', { plan: planX(ROUNDS_2) }), PLAN_GONE);

    expect(MAIN.fixCycles?.(closed)).toBe(2);
  });
});

describe('sample Large › page stages', () => {
  function pageStage(id: string): PageStage {
    const stage = PAGE.stages.find((candidate) => candidate.id === id);
    if (stage === undefined) {
      throw new Error(`no page stage ${id}`);
    }
    return stage;
  }

  // Two build tasks, the first ticked, then the open final verification task.
  const VERIFIED_PLAN_TASKS: PlanTaskLine[] = [
    ...tasksOf(1, 2),
    { ...tasksOf(0, 1)[0], text: 'Final verification', verification: true },
  ];

  // A plan of 3 ticked boxes in 7 in wave 2 unless `fields` says otherwise.
  const claimGrants = (
    fields: Partial<Omit<PlanProgress, 'counters'>> & {
      reviewRounds?: number;
    } = {},
  ) =>
    progressOf({
      checked: 3,
      total: 7,
      wave: 2,
      title: 'Claim grants',
      ...fields,
    });

  // A Large flow with a plan at `/r/plan-f` read as Claim grants, unless the
  // fields say otherwise; `plan: null` has no plan folder.
  const flowWith = (
    fields: Partial<SessionFlow> & { progress?: PlanProgress | null } = {},
  ): SessionFlow => {
    const { progress = claimGrants(), ...flow } = fields;
    return flowIn('idle', { plan: planOf(progress), ...flow });
  };

  const FEATURE_GROUP = ['explore', 'interview', 'plan', 'coldRead'] as const;

  it.each<{ name: string; stage: string; flow: SessionFlow; detail: string }>([
    { name: 'idle', stage: 'idle', flow: flowWith(), detail: '' },
    { name: 'primer', stage: 'primer', flow: flowWith(), detail: '' },
    ...FEATURE_GROUP.flatMap((stage) => [
      { name: stage, stage, flow: flowWith(), detail: 'Claim grants' },
      {
        name: `${stage} unread`,
        stage,
        flow: flowWith({ progress: null }),
        detail: '',
      },
    ]),
    {
      name: 'planReady',
      stage: 'planReady',
      flow: flowWith(),
      detail: 'Claim grants · 7 tasks',
    },
    {
      name: 'planReady unread',
      stage: 'planReady',
      flow: flowWith({ progress: null }),
      detail: '',
    },
    {
      name: 'make in a wave',
      stage: 'make',
      flow: flowWith(),
      detail: '3/7 · wave 2 · Claim grants',
    },
    {
      name: 'make with no open wave',
      stage: 'make',
      flow: flowWith({ progress: claimGrants({ wave: null }) }),
      detail: '3/7 · Claim grants',
    },
    {
      name: 'make unread',
      stage: 'make',
      flow: flowWith({ progress: null }),
      detail: '',
    },
    {
      name: 'make leaves the final verification task out of its count',
      stage: 'make',
      flow: flowWith({
        progress: claimGrants({ wave: null, tasks: VERIFIED_PLAN_TASKS }),
      }),
      detail: '1/2 · Claim grants',
    },
    {
      name: 'review with rounds',
      stage: 'review',
      flow: flowWith({
        progress: claimGrants({ checked: 6, reviewRounds: 2 }),
      }),
      detail: 'round 2 · 6/7 · Claim grants',
    },
    {
      name: 'review with no round',
      stage: 'review',
      flow: flowWith(),
      detail: '3/7 · Claim grants',
    },
    {
      name: 'fix with rounds',
      stage: 'fix',
      flow: flowWith({
        progress: claimGrants({ checked: 6, reviewRounds: 2 }),
      }),
      detail: 'cycle 2 · 6/7 · Claim grants',
    },
    {
      name: 'fix with no round',
      stage: 'fix',
      flow: flowWith(),
      detail: '3/7 · Claim grants',
    },
    {
      name: 'fix unread',
      stage: 'fix',
      flow: flowWith({ progress: null }),
      detail: '',
    },
    // A template whose every variable is empty renders `''`: the untitled
    // closed run draws no `done` alone.
    ...(['planReady', 'make', 'review', 'closed'] as const).map((stage) => ({
      name: `${stage} with an untitled plan`,
      stage,
      flow: flowWith({
        progress: claimGrants({ wave: null, reviewRounds: 1, title: '' }),
      }),
      detail: {
        planReady: '7 tasks',
        make: '3/7',
        review: 'round 1 · 3/7',
        closed: '',
      }[stage],
    })),
    {
      name: 'review unread',
      stage: 'review',
      flow: flowWith({ progress: null }),
      detail: '',
    },
    {
      name: 'closed',
      stage: 'closed',
      flow: flowWith(),
      detail: 'Claim grants · done',
    },
    {
      name: 'closed unread',
      stage: 'closed',
      flow: flowWith({ progress: null }),
      detail: '',
    },
  ])('detail: $name', ({ stage, flow, detail }) => {
    expect(pageStage(stage).detail(flow)).toBe(detail);
  });

  const turnRunning = flowWith({ turnRunning: true });
  const subagentRunning = flowWith({ runningSubagents: ['a1'] });
  const allChecked = flowWith({ progress: claimGrants({ checked: 7 }) });
  const unread = flowWith({ progress: null });
  const noPlan = flowWith({ plan: null });
  const short = (action: string) => `wigley-large-${action}`;

  it.each<{
    name: string;
    stage: string;
    flow: SessionFlow;
    actions: [string, boolean][];
  }>([
    ...(['idle', 'primer'] as const).map((stage) => ({
      name: stage,
      stage,
      flow: flowWith(),
      actions: [] as [string, boolean][],
    })),
    // A `{plan}` action hides with no plan folder (accepted in 06).
    {
      name: 'plan ready with no plan folder',
      stage: 'planReady',
      flow: noPlan,
      actions: [],
    },
    {
      name: 'plan ready during the countdown',
      stage: 'planReady',
      flow: flowWith({ countdownEndsAt: 1000 }),
      actions: [
        ['cancelCountdown', true],
        [short('clearAndMake'), true],
        [short('makeInNewSession'), true],
        [short('openPlan'), true],
      ],
    },
    {
      name: 'plan ready with no countdown',
      stage: 'planReady',
      flow: flowWith(),
      actions: [
        [short('clearAndMake'), true],
        [short('makeInNewSession'), true],
        [short('openPlan'), true],
      ],
    },
    ...[
      { name: 'a turn running', flow: turnRunning },
      { name: 'a subagent running', flow: subagentRunning },
    ].map(({ name, flow }) => ({
      name: `plan ready with ${name}`,
      stage: 'planReady',
      flow,
      actions: [
        [short('clearAndMake'), false],
        [short('makeInNewSession'), true],
        [short('openPlan'), true],
      ] as [string, boolean][],
    })),
    ...(['make', 'review', 'fix'] as const).flatMap((stage) => [
      {
        name: `${stage} with open boxes`,
        stage,
        flow: flowWith(),
        actions: [
          [short('resumeMake'), true],
          [short('openPlan'), true],
        ] as [string, boolean][],
      },
      ...[
        { name: 'every box checked', flow: allChecked },
        { name: 'the plan unread', flow: unread },
        { name: 'a turn running', flow: turnRunning },
        { name: 'a subagent running', flow: subagentRunning },
      ].map(({ name, flow }) => ({
        name: `${stage} with ${name}`,
        stage,
        flow,
        actions: [[short('openPlan'), true]] as [string, boolean][],
      })),
      // Resume make names `{plan}`, so it hides with no plan folder too.
      {
        name: `${stage} with no plan folder`,
        stage,
        flow: noPlan,
        actions: [] as [string, boolean][],
      },
    ]),
    ...FEATURE_GROUP.flatMap((stage) => [
      {
        name: `${stage} with a plan folder`,
        stage,
        flow: flowWith(),
        actions: [[short('openPlan'), true]] as [string, boolean][],
      },
      {
        name: `${stage} with no plan folder`,
        stage,
        flow: noPlan,
        actions: [] as [string, boolean][],
      },
    ]),
    {
      name: 'closed with a turn running',
      stage: 'closed',
      flow: turnRunning,
      actions: [
        [short('retro'), false],
        [short('dismiss'), true],
      ],
    },
  ])('actions: $name', ({ stage, flow, actions }) => {
    const available = pageStage(stage).actions.filter((action) =>
      action.available(flow),
    );

    expect(
      available.map((action) => [action.command, action.enabled(flow)]),
    ).toEqual(actions);
  });

  const threeOfNine = claimGrants({ checked: 3, total: 9 });
  const nineOfNine = claimGrants({ checked: 9, total: 9 });

  it.each<{
    name: string;
    stage: string;
    flow: SessionFlow;
    status: string | null;
    statusLine: string;
  }>([
    {
      name: 'primer busy',
      stage: 'primer',
      flow: turnRunning,
      status: 'running',
      statusLine: 'Primer · running',
    },
    {
      name: 'explore not busy',
      stage: 'explore',
      flow: flowWith(),
      status: 'paused',
      statusLine: 'Explore · paused',
    },
    {
      name: 'cold read busy',
      stage: 'coldRead',
      flow: turnRunning,
      status: 'running',
      statusLine: 'Cold read · running',
    },
    {
      name: 'fix busy with 2 rounds',
      stage: 'fix',
      flow: flowWith({
        turnRunning: true,
        progress: claimGrants({ reviewRounds: 2 }),
      }),
      status: 'running',
      statusLine: 'Fix · running · cycle 2',
    },
    {
      name: 'fix not busy with 0 rounds',
      stage: 'fix',
      flow: flowWith(),
      status: 'paused',
      statusLine: 'Fix · paused',
    },
    {
      name: 'planReady busy',
      stage: 'planReady',
      flow: turnRunning,
      status: 'ready',
      statusLine: 'Make · ready',
    },
    {
      name: 'make busy 3/9',
      stage: 'make',
      flow: flowWith({ turnRunning: true, progress: threeOfNine }),
      status: 'running',
      statusLine: 'Make · running 3/9',
    },
    {
      name: 'make not busy 3/9',
      stage: 'make',
      flow: flowWith({ progress: threeOfNine }),
      status: 'paused',
      statusLine: 'Make · paused 3/9',
    },
    {
      name: 'make with null progress',
      stage: 'make',
      flow: unread,
      status: 'paused',
      statusLine: 'Make · paused',
    },
    {
      name: 'review busy with 2 rounds',
      stage: 'review',
      flow: flowWith({
        turnRunning: true,
        progress: claimGrants({ reviewRounds: 2 }),
      }),
      status: 'running',
      statusLine: 'Review · running · round 2',
    },
    {
      name: 'review not busy with 0 rounds',
      stage: 'review',
      flow: flowWith(),
      status: 'paused',
      statusLine: 'Review · paused',
    },
    {
      name: 'review with null progress',
      stage: 'review',
      flow: unread,
      status: 'paused',
      statusLine: 'Review · paused',
    },
    {
      name: 'closed 9/9',
      stage: 'closed',
      flow: flowWith({ progress: nineOfNine }),
      status: 'done',
      statusLine: 'Close · done · 9/9',
    },
    {
      name: 'closed with null progress',
      stage: 'closed',
      flow: unread,
      status: 'done',
      statusLine: 'Close · done',
    },
    {
      name: 'closed with a turn running',
      stage: 'closed',
      flow: flowWith({ progress: nineOfNine, turnRunning: true }),
      status: 'running',
      statusLine: 'Close · running · 9/9',
    },
    {
      name: 'closed with a subagent running',
      stage: 'closed',
      flow: flowWith({ progress: nineOfNine, runningSubagents: ['a1'] }),
      status: 'running',
      statusLine: 'Close · running · 9/9',
    },
    {
      name: 'idle',
      stage: 'idle',
      flow: flowWith(),
      status: null,
      statusLine: 'Idle',
    },
  ])(
    "each stage's status and status line follow its flow: $name",
    ({ stage, flow, status, statusLine: line }) => {
      expect({
        status: pageStage(stage).status(flow),
        line: statusLine(pageStage(stage), flow),
      }).toEqual({ status, line });
    },
  );

  it.each<{ name: string; stage: string; flow: SessionFlow; chip: string }>([
    { name: 'make', stage: 'make', flow: flowWith(), chip: ' 3/7' },
    {
      name: 'make leaves out the final verification task',
      stage: 'make',
      flow: flowWith({ progress: claimGrants({ tasks: VERIFIED_PLAN_TASKS }) }),
      chip: ' 1/2',
    },
    { name: 'make unread', stage: 'make', flow: unread, chip: '' },
    { name: 'review', stage: 'review', flow: flowWith(), chip: '' },
    { name: 'fix', stage: 'fix', flow: flowWith(), chip: '' },
  ])('chip progress: $name', ({ stage, flow, chip }) => {
    expect(pageStage(stage).chipProgress?.(flow) ?? '').toBe(chip);
  });

  it('actions_HoldNoSide', () => {
    const actions = PAGE.stages.flatMap((stage) => stage.actions);

    expect(actions.filter((action) => 'side' in action)).toEqual([]);
  });

  it('badge_ReadsL', () => {
    expect({ label: PAGE.label, badge: PAGE.badge }).toEqual({
      label: 'Large',
      badge: 'L',
    });
  });
});
