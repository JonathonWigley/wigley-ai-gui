import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type SessionPart,
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import { type UsageLinePart, usagePageKey } from '../../usage/contract';
import { usageTabLinePagePart } from './start';

// The part on the harness, over usage and sessions fakes that file each handle
// with `consumer.track`, as the real views do.
function startOnHarness() {
  return startPagePart(usageTabLinePagePart, {
    dependencies: [
      fakeDependency(usagePageKey, (consumer) => ({
        sessionLinePart(id: string) {
          consumer.track({ dispose() {} });
          return { id, build: () => ({ dispose() {} }) };
        },
      })),
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addBarPart: () => consumer.track({ dispose() {} }),
          }) as unknown as SessionsPageExports,
      ),
    ],
  });
}

describe('usageTabLinePagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('start_AddsBarPartDrawnByUsage', () => {
    const barParts: SessionPart[] = [];
    const made: { part: UsageLinePart; log: (line: string) => void }[] = [];
    const logs: string[] = [];
    const api = {
      services: {
        log: (line: string) => logs.push(line),
      },
      dependency: (key: { id: string }) =>
        ({
          usage: {
            sessionLinePart(id: string, log: (line: string) => void) {
              const part: UsageLinePart = {
                id,
                build: () => ({ dispose: () => undefined }),
              };
              made.push({ part, log });
              return part;
            },
          },
          sessions: {
            addBarPart(part: SessionPart) {
              barParts.push(part);
              return { dispose: () => undefined };
            },
          },
        })[key.id as 'usage' | 'sessions'],
    } as unknown as Parameters<typeof usageTabLinePagePart.start>[0];

    usageTabLinePagePart.start(api);
    made[0].log('session line in gamma 2: context 180k/300k');

    expect(barParts).toEqual([made[0].part]);
    expect(barParts[0].id).toBe('usage-tab-line.sessionLine');
    expect(logs).toEqual(['session line in gamma 2: context 180k/300k']);
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBe(2);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });
});
