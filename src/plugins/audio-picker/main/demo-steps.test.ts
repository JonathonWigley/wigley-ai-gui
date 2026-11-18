import { describe, expect, it } from 'vitest';
import type { DemoMainContext, DemoMainStep } from '../../../contracts/demo';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { startMainPart } from '../../../shared/plugin-part-harness.test-support';
import { fakeChat } from '../../agent-form-fakes.test-support';
import { sessionsMainPart } from '../../sessions/main/start';
import { SAMPLE_SOUNDS } from './fixtures';
import { audioPickerMainPart } from './start';

const SCRATCH = '/scratch';
const DATA = '/data/audio-picker';

const CONTEXT: DemoMainContext = {
  scratchDir: SCRATCH,
  launchSession: () => Promise.resolve('demo-1'),
  processEvents: () => {
    throw new Error('no process events in this test');
  },
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('audio picker demo steps', () => {
  it('entering audio-picker.picker writes the sounds under the scratch folder only', async () => {
    const demoSteps = createDemoStepRegistry<DemoMainStep>();
    const harness = startMainPart(audioPickerMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
      services: {
        demoSteps,
        homeDir: '/home/user',
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    await flush();
    const dataBefore = await harness.files.list(DATA, { recursive: true });
    const step = demoSteps
      .list()
      .find((each) => each.id === 'audio-picker.picker');

    const stage = await step?.enter(CONTEXT);
    await flush();

    const sounds = await harness.files.list(
      `${SCRATCH}/audio-picker/sample-sounds`,
    );
    expect(sounds.map((entry) => entry.path).sort()).toEqual(
      SAMPLE_SOUNDS.map((sound) => sound.file).sort(),
    );
    expect(await harness.files.list(DATA, { recursive: true })).toEqual(
      dataBefore,
    );
    expect(stage?.sessions).toEqual({ session: 'demo-1' });
    stage?.dispose();
    await harness.stop();
  });
});
