import type { DriveHost } from '../../../contracts/plugin';
import { argsObject, optionalOneOf } from '../../../shared/drive-args';
import type { StatsFixtureVariant, StatsSnapshot } from '../contract';
import { STATS_FIXTURE_VARIANTS } from './stats-fixture';

// `snapshot` is the one the page draws; `seed` writes the variant's fixture, stops sampling for the run and returns
// the fixture.
export interface StatsDriveDeps {
  snapshot(): StatsSnapshot | null;
  seed(variant: StatsFixtureVariant): StatsSnapshot;
}

// `system-stats.seed` and `system-stats.snapshot`.
export function addDriveActions(drive: DriveHost, deps: StatsDriveDeps): void {
  drive.add('seed', {
    description:
      'Replaces the snapshot with a fixed one and stops sampling for the run: busy, or error (busy with a sample error).',
    args: '{ "variant"?: "busy" | "error" }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const variant =
        optionalOneOf(args, 'variant', STATS_FIXTURE_VARIANTS) ?? 'busy';
      return deps.seed(variant);
    },
  });
  drive.add('snapshot', {
    description: 'Returns the snapshot the page draws, null before the first.',
    args: '{}',
    async run(rawArgs) {
      argsObject(rawArgs);
      return deps.snapshot();
    },
  });
}
