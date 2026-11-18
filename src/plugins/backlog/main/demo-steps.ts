import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { MainServices } from '../../../contracts/plugin';
import type { ProcessRunner } from '../../../contracts/processes';
import { createRegistrations } from '../../../shared/registrations';
import {
  type DocsMainExports,
  SAMPLE_HOME_FOLDER,
  type SampleDocs,
} from '../../docs/contract';
import {
  BACKLOG_FOLLOWUPS,
  BACKLOG_REPO,
  writeBacklogFixture,
} from './selftest-fixture';

// The folder, under the scratch folder, an emptied earlier sample repo moves
// to.
const OLD_BACKLOG_FOLDER = 'old-backlog';

// `holdSample` makes the channel serve a backlog over `sample` until its
// dispose.
export interface BacklogDemoMainDeps {
  files: Files;
  processes: ProcessRunner;
  paths: Paths;
  addSampleDocs: DocsMainExports['addSampleDocs'];
  holdSample(sample: SampleDocs): Disposable;
}

// The Backlog step's main half: the self-test repo in the sample docs home,
// read through the sample docs, served to the page for the step's length.
export function registerDemoSteps(
  services: MainServices,
  deps: BacklogDemoMainDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'backlog.mode',
      async enter(context) {
        await writeBacklogSample(deps, context.scratchDir);
        const sample = await deps.addSampleDocs(context.scratchDir);
        let hold: Disposable;
        try {
          hold = deps.holdSample(sample);
        } catch (error) {
          sample.dispose();
          throw error;
        }
        return {
          sessions: {},
          dispose() {
            hold.dispose();
            sample.dispose();
          },
        };
      },
    }),
  );
  return registrations;
}

// Writes the self-test repo into the sample docs home unless its follow-ups
// are there. The fixture writer trashes a repo it finds, so a repo an earlier
// run left emptied (the run deletes files only) is first moved aside, by a
// rename, to the first free `old-backlog/<n>`.
async function writeBacklogSample(
  deps: Pick<BacklogDemoMainDeps, 'files' | 'processes' | 'paths'>,
  scratchDir: string,
): Promise<void> {
  const { files, paths } = deps;
  const scratch = await files.realPath(scratchDir);
  const sampleHome = paths.join(scratch, SAMPLE_HOME_FOLDER);
  await files.makeFolder(sampleHome);
  if ((await files.stat(paths.join(sampleHome, BACKLOG_FOLLOWUPS))) !== null) {
    return;
  }
  const repo = paths.join(sampleHome, BACKLOG_REPO);
  if ((await files.stat(repo)) !== null) {
    const oldFolder = paths.join(scratch, OLD_BACKLOG_FOLDER);
    await files.makeFolder(oldFolder);
    let n = 1;
    while ((await files.stat(paths.join(oldFolder, String(n)))) !== null) {
      n += 1;
    }
    await files.rename(repo, paths.join(oldFolder, String(n)));
  }
  await writeBacklogFixture(deps, sampleHome);
}
