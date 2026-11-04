import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import type { AgentsPageExports } from '../contract';
import { agentsPagePart } from './start';

describe('agentsPagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startPagePart(agentsPagePart);
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startPagePart(agentsPagePart);
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it('exports_ConsumerDisposed_HearsNoMoreChanges', () => {
    const harness = startPagePart(agentsPagePart);
    const exportsFor = harness.started().exports as (
      consumer: ReturnType<typeof createRegistrations>,
    ) => AgentsPageExports;
    const consumerA = createRegistrations();
    const consumerB = createRegistrations();
    const heardByA = vi.fn();
    const heardByB = vi.fn();
    exportsFor(consumerA).onRosterChanged(heardByA);
    exportsFor(consumerB).onRosterChanged(heardByB);

    consumerA.dispose();
    harness.send('rosterChanged', {
      sessionId: 's1',
      roster: { agents: [], tasks: [] },
    });

    expect(heardByA).toHaveBeenCalledTimes(0);
    expect(heardByB).toHaveBeenCalledTimes(1);
  });
});
