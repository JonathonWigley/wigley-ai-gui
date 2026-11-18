import { describe, expect, it, vi } from 'vitest';
import type {
  DemoMainContext,
  DemoMainStep,
} from '../../../contracts/demo';
import type { CommandInfo, MainServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import type { ConfirmRequest } from '../../forms/contract';
import { registerDemoSteps } from './demo-steps';

const CLOSE_SESSION: CommandInfo = {
  id: 'sessions.closeSession',
  plugin: 'sessions',
  label: 'close the session',
  group: 'sessions',
  runsIn: 'page',
  risky: true,
  targets: true,
};

const CONTEXT: DemoMainContext = {
  scratchDir: '/scratch',
  launchSession: () => Promise.resolve('demo-1'),
  processEvents: () => {
    throw new Error('no process events in this test');
  },
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// The step registered over `list` and a sample confirm that answers
// `isAllowed`; every confirm asked and line logged is kept.
function enterWith(list: readonly CommandInfo[], isAllowed: boolean) {
  const demoSteps = createDemoStepRegistry<DemoMainStep>();
  const logged: string[] = [];
  const confirmSample = vi.fn(
    (_sessionId: string, _request: ConfirmRequest, _signal: AbortSignal) =>
      Promise.resolve(isAllowed),
  );
  registerDemoSteps({ demoSteps } as unknown as MainServices, {
    senderName: (sessionId) => `name of ${sessionId}`,
    list: () => list,
    forms: { confirmSample },
    log: (line) => logged.push(line),
  });
  const [step] = demoSteps.list();
  return { stage: step.enter(CONTEXT), confirmSample, logged };
}

describe('agent commands demo steps', () => {
  it.each([
    { answer: 'allow', isAllowed: true },
    { answer: 'deny', isAllowed: false },
  ])('answer $answer runs nothing', async ({ answer, isAllowed }) => {
    const { stage, confirmSample, logged } = enterWith(
      [CLOSE_SESSION],
      isAllowed,
    );

    expect((await stage).sessions).toEqual({ session: 'demo-1' });
    await flush();

    expect(confirmSample.mock.calls.map(([sessionId, request]) => [
      sessionId,
      request.title,
    ])).toEqual([['demo-1', 'Run close the session?']]);
    expect(confirmSample.mock.calls[0]?.[1].detail).toContain(
      'sessions.closeSession',
    );
    expect(logged).toEqual([`sample confirm answered: ${answer}`]);
  });

  it('a missing closeSession asks nothing', async () => {
    const { stage, confirmSample, logged } = enterWith([], true);

    expect((await stage).sessions).toEqual({ session: 'demo-1' });
    await flush();

    expect(confirmSample).not.toHaveBeenCalled();
    expect(logged).toEqual([
      'demo confirm: sessions.closeSession not listed',
    ]);
  });

  it('leaving aborts the confirm and logs no answer', async () => {
    const { stage, confirmSample, logged } = enterWith([CLOSE_SESSION], true);
    confirmSample.mockImplementation(
      (_sessionId, _request, signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve(false)),
        ),
    );

    (await stage).dispose();
    await flush();

    expect(confirmSample.mock.calls[0]?.[2].aborted).toBe(true);
    expect(logged).toEqual([]);
  });
});
