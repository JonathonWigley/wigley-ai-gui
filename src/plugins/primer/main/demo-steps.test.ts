import { describe, expect, it, vi } from 'vitest';
import type { PresentedAgentForm } from '../../../contracts/agent-forms';
import type {
  DemoMainContext,
  DemoMainStep,
} from '../../../contracts/demo';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import { sessionsMainPart } from '../../sessions/main/start';
import { type Primer, type PrimerBody, SAVED_PRIMERS_FOLDER } from '../contract';
import { primerMainPart } from './start';

const HOME = '/home/user';

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

describe('primer demo steps', () => {
  it('entering primer.primer asks the sample service and saves nothing', async () => {
    const demoSteps = createDemoStepRegistry<DemoMainStep>();
    const send = vi.fn();
    const harness = startMainPart(primerMainPart, {
      parts: [sessionsMainPart],
      dependencies: [
        fakeDependency(
          chatMainKey,
          () =>
            ({
              profileOf: () => 'claude',
              isHeadless: () => false,
              send,
            }) as unknown as ChatMainExports,
        ),
      ],
      services: {
        demoSteps,
        homeDir: HOME,
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    const step = demoSteps.list().find((each) => each.id === 'primer.primer');

    const stage = await step?.enter(CONTEXT);
    await flush();
    const shown = harness.sent
      .filter((each) => each.message === 'formShown')
      .map((each) => each.data as PresentedAgentForm<Primer, PrimerBody>);
    const saved = await harness.files.list(`${HOME}/${SAVED_PRIMERS_FOLDER}`, {
      recursive: true,
    });

    expect(stage?.sessions).toEqual({ session: 'demo-1' });
    expect(
      shown.map((primer) => [primer.sessionId, primer.form.feature.name]),
    ).toEqual([['demo-1', 'Daily quests']]);
    expect(saved.filter((entry) => entry.kind === 'file')).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    stage?.dispose();
    await harness.stop();
  });
});
