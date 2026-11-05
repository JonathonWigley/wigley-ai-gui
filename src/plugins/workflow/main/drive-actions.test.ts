import { describe, expect, it } from 'vitest';
import { createRegistrations } from '../../../shared/registrations';
import {
  reportsStep,
  startsSkill,
  type WorkflowMainExports,
} from '../contract';
import { startEngineMainPart } from './engine-fakes.test-support';

const settled = () => new Promise((settle) => setImmediate(settle));

// The real engine with a drive host and a workflow `stub` holding `s1`, at `scope`.
async function startEngine() {
  const { engine: part } = startEngineMainPart({ drive: true });
  const engine = part
    .started()
    .exports?.(createRegistrations()) as WorkflowMainExports;
  engine.addWorkflow({
    id: 'stub',
    order: 10,
    claims: (signal) => startsSkill(signal, 'x:stub'),
    firstStage: 'scope',
    stages: [
      { id: 'scope', order: 10, enter: () => null },
      {
        id: 'build',
        order: 20,
        reportedAs: 'build',
        enter: (_flow, signal) =>
          reportsStep(signal, 'build') ? 'build' : null,
      },
    ],
  });
  part.emit('sessions.connected', {
    id: 's1',
    info: { sessionId: 'h1', projectDir: '/r' },
  });
  part.emit('chat.sessionOpened', { sessionId: 's1', profileDir: '~/.c' });
  await settled();
  engine.signal(
    's1',
    { type: 'skillStarted', skill: 'x:stub', args: '', argsPath: null },
    'live',
  );
  const drive = part.drive;
  if (drive === null) {
    throw new Error('the harness has no drive host');
  }
  return { engine, drive };
}

describe('workflow drive actions', () => {
  it.each([
    { name: 'Light', step: 'build', accepted: true, stage: 'build' },
    { name: 'UnknownStep', step: 'review', accepted: false, stage: 'scope' },
  ])('reportStep_$name', async ({ step, accepted, stage }) => {
    const { engine, drive } = await startEngine();

    const result = await drive.run('reportStep', { sessionId: 's1', step });

    expect(result).toEqual({ accepted });
    expect(engine.flowOf('s1')?.stage).toBe(stage);
  });

  it.each([
    { action: 'reportStep', args: { step: 'build' }, names: 'sessionId' },
    { action: 'reportStep', args: { sessionId: 's1' }, names: 'step' },
    { action: 'reportChecklist', args: { items: [] }, names: 'sessionId' },
  ])('reportStep_BadArgs $action $names', async ({ action, args, names }) => {
    const { drive } = await startEngine();

    await expect(drive.run(action, args)).rejects.toThrow(names);
  });

  it.each([
    { name: 'no array', items: 'a' },
    { name: 'empty text', items: [{ text: '', done: false }] },
    { name: 'a done of no boolean', items: [{ text: 'a', done: 'yes' }] },
  ])('reportChecklist_BadItems: $name', async ({ items }) => {
    const { engine, drive } = await startEngine();

    await expect(
      drive.run('reportChecklist', { sessionId: 's1', items }),
    ).rejects.toThrow('items');
    expect(engine.flowOf('s1')?.checklist).toBeNull();
  });

  it('reportChecklist_SetsTheList', async () => {
    const { engine, drive } = await startEngine();
    const items = [{ text: 'a', done: false }];

    const result = await drive.run('reportChecklist', {
      sessionId: 's1',
      items,
    });

    expect(result).toEqual({ accepted: true });
    expect(engine.flowOf('s1')?.checklist).toEqual(items);
  });
});
