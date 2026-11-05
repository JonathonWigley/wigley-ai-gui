import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import { agentSkillsMainPart } from './start';

function startOnHarness() {
  return startMainPart(agentSkillsMainPart, {
    dependencies: [
      fakeDependency(chatMainKey, () => ({}) as ChatMainExports),
      fakeDependency(sessionsMainKey, () => ({}) as SessionsMainExports),
    ],
  });
}

describe('agentSkillsMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);

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
