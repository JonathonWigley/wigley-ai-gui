import { describe, expect, it } from 'vitest';
import {
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { fakeChat } from '../../agent-form-fakes.test-support';
import { sessionsMainPart } from '../../sessions/main/start';
import { audioPickerMainPart } from './start';

describe('audio picker main part', () => {
  it('stops with nothing live and starts again', async () => {
    const harness = startMainPart(audioPickerMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
    });
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    // The real sessions part throws on a tool name still contributed.
    await harness.restart();
    await harness.stop();
  });
});
