import type { AgentHarnessRegistry } from '../../../contracts/agent';
import type { Clock } from '../../../contracts/ambient';
import type { DriveHost } from '../../../contracts/plugin';
import {
  argsObject,
  optionalOneOf,
  optionalString,
} from '../../../shared/drive-args';
import { isFakeAgentHarness } from '../../../shared/fake-agent-harness';
import type { UsageSnapshot } from '../contract';
import { USAGE_FIXTURE_VARIANTS, usageFixture } from './usage-fixture';

// `snapshot` is the one the page draws; `seed` replaces it and stops the
// poller for the run; `pollNow` reads every profile's plan usage and resolves
// once the reads settle.
export interface UsageDriveDeps {
  clock: Clock;
  selectedSessionId(): string | null;
  snapshot(): UsageSnapshot;
  seed(snapshot: UsageSnapshot): void;
  pollNow(): Promise<void>;
  harnesses: AgentHarnessRegistry;
}

const DEFAULT_POLL_FAILURE = 'fake poll failed';

// `usage.seed`, `usage.snapshot`, `usage.pollNow` and `usage.failNextPoll`.
export function addDriveActions(drive: DriveHost, deps: UsageDriveDeps): void {
  drive.add('seed', {
    description:
      "Replaces plan and session usage with a fixed snapshot and stops the poller for the run: fresh, stale (work's poll failed after a good one) or error (work's first poll failed). The session's usage goes on sessionId, else the selected session, on work.",
    args: '{ "variant"?: "fresh" | "stale" | "error", "sessionId"?: string }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const variant =
        optionalOneOf(args, 'variant', USAGE_FIXTURE_VARIANTS) ?? 'fresh';
      const sessionId =
        optionalString(args, 'sessionId') ?? deps.selectedSessionId();
      const snapshot = usageFixture(variant, deps.clock.now(), sessionId);
      deps.seed(snapshot);
      return snapshot;
    },
  });
  drive.add('snapshot', {
    description: 'Returns the usage snapshot the page draws.',
    args: '{}',
    async run(rawArgs) {
      argsObject(rawArgs);
      return deps.snapshot();
    },
  });
  drive.add('pollNow', {
    description:
      "Reads every profile's plan usage now and returns the snapshot once the reads settle.",
    args: '{}',
    async run(rawArgs) {
      argsObject(rawArgs);
      await deps.pollNow();
      return deps.snapshot();
    },
  });
  drive.add('failNextPoll', {
    description:
      "Makes the fake harness's next plan usage read fail with message, so the next poll marks its profile stale. Fake harness only.",
    args: '{ "message"?: string }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const message = optionalString(args, 'message') ?? DEFAULT_POLL_FAILURE;
      const fake = deps.harnesses.list().find(isFakeAgentHarness);
      if (fake === undefined) {
        throw new Error('usage.failNextPoll needs the fake harness');
      }
      fake.failNextPlanUsage(message);
      return {};
    },
  });
}
