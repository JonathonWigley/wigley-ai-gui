import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import { SESSION_NOTE } from './session-note';
import { visualMainPart } from './start';

// The part on the harness, over a chat whose `addInstructions` files its handle
// with `consumer.track`, as chat's view does; `notes` holds the live ones.
function startOnHarness() {
  const notes = new Set<string>();
  const harness = startMainPart(visualMainPart, {
    dependencies: [
      fakeDependency(
        chatMainKey,
        (consumer) =>
          ({
            addInstructions(text: string) {
              notes.add(text);
              return consumer.track({
                dispose() {
                  notes.delete(text);
                },
              });
            },
          }) as unknown as ChatMainExports,
      ),
    ],
  });
  return { harness, notes };
}

describe('visualMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness, notes } = startOnHarness();
    expect([...notes]).toEqual([SESSION_NOTE]);
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });
    expect([...notes]).toEqual([]);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness, notes } = startOnHarness();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
    expect([...notes]).toEqual([SESSION_NOTE]);
  });
});
