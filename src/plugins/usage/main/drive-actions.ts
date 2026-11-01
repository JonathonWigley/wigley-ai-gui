import type { AgentHarness } from '../../../contracts/agent';
import type { Clock } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { DriveHost } from '../../../contracts/plugin';
import { argsObject, optionalString } from '../../../shared/drive-args';
import { isFakeAgentHarness } from '../../../shared/fake-agent-harness';
import type { JsonObject } from '../../../shared/json';
import type { UsageSnapshot } from '../contract';
import {
  USAGE_FIXTURE_VARIANTS,
  type UsageFixtureVariant,
  usageFixture,
} from './usage-fixture';

// `snapshot` is the one the page draws; `seed` replaces it and stops the
// poller for the run; `pollNow` reads every profile's plan usage and resolves
// once the reads settle.
export interface UsageDriveDeps {
  clock: Clock;
  selectedSessionId(): string | null;
  snapshot(): UsageSnapshot;
  seed(snapshot: UsageSnapshot): void;
  pollNow(): Promise<void>;
  harnesses: readonly AgentHarness[];
}

const DEFAULT_POLL_FAILURE = 'fake poll failed';

function variantOf(args: JsonObject): UsageFixtureVariant {
  const variant = args.variant ?? 'fresh';
  if (!USAGE_FIXTURE_VARIANTS.includes(variant as UsageFixtureVariant)) {
    throw new Error('variant must be fresh, stale or error');
  }
  return variant as UsageFixtureVariant;
}

// `usage.seed`, `usage.snapshot`, `usage.pollNow` and `usage.failNextPoll`.
// Disposing removes them all.
export function addDriveActions(
  drive: DriveHost,
  deps: UsageDriveDeps,
): Disposable {
  const actions = [
    drive.add('seed', {
      description:
        "Replaces plan and session usage with a fixed snapshot and stops the poller for the run: fresh, stale (work's poll failed after a good one) or error (work's first poll failed). The session's usage goes on sessionId, else the selected session, on work.",
      args: '{ "variant"?: "fresh" | "stale" | "error", "sessionId"?: string }',
      async run(rawArgs) {
        const args = argsObject(rawArgs);
        const variant = variantOf(args);
        const sessionId =
          optionalString(args, 'sessionId') ?? deps.selectedSessionId();
        const snapshot = usageFixture(variant, deps.clock.now(), sessionId);
        deps.seed(snapshot);
        return snapshot;
      },
    }),
    drive.add('snapshot', {
      description: 'Returns the usage snapshot the page draws.',
      args: '{}',
      async run(rawArgs) {
        argsObject(rawArgs);
        return deps.snapshot();
      },
    }),
    drive.add('pollNow', {
      description:
        "Reads every profile's plan usage now and returns the snapshot once the reads settle.",
      args: '{}',
      async run(rawArgs) {
        argsObject(rawArgs);
        await deps.pollNow();
        return deps.snapshot();
      },
    }),
    drive.add('failNextPoll', {
      description:
        "Makes the fake harness's next plan usage read fail with message, so the next poll marks its profile stale. Fake harness only.",
      args: '{ "message"?: string }',
      async run(rawArgs) {
        const args = argsObject(rawArgs);
        const message = optionalString(args, 'message') ?? DEFAULT_POLL_FAILURE;
        const fake = deps.harnesses.find(isFakeAgentHarness);
        if (fake === undefined) {
          throw new Error('usage.failNextPoll needs the fake harness');
        }
        fake.failNextPlanUsage(message);
        return {};
      },
    }),
  ];
  return {
    dispose() {
      for (const action of actions) {
        action.dispose();
      }
    },
  };
}
