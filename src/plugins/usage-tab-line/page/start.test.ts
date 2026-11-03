import { describe, expect, it } from 'vitest';
import type { SessionPart } from '../../sessions/contract';
import type { UsageLinePart } from '../../usage/contract';
import { usageTabLinePagePart } from './start';

describe('usageTabLinePagePart', () => {
  it('start_AddsBarPartDrawnByUsage', () => {
    const barParts: SessionPart[] = [];
    const made: { part: UsageLinePart; log: (line: string) => void }[] = [];
    const logs: [string, string][] = [];
    const api = {
      services: {
        log: (plugin: string, line: string) => logs.push([plugin, line]),
      },
      dependency: (pluginId: string) =>
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
        })[pluginId as 'usage' | 'sessions'],
    } as unknown as Parameters<typeof usageTabLinePagePart.start>[0];

    usageTabLinePagePart.start(api);
    made[0].log('session line in gamma 2: context 180k/300k');

    expect(barParts).toEqual([made[0].part]);
    expect(barParts[0].id).toBe('usage-tab-line.sessionLine');
    expect(logs).toEqual([
      ['usage-tab-line', 'session line in gamma 2: context 180k/300k'],
    ]);
  });
});
