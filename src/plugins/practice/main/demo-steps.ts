import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { MainServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import { writePracticeFixture } from './selftest-fixture';

// `holdSample` makes the channel serve the practice folder `folder` until its
// dispose.
export interface PracticeDemoMainDeps {
  files: Files;
  paths: Paths;
  holdSample(folder: string): Disposable;
}

// The Practice step's main half: the self-test's problems in a practice
// folder of their own under the scratch folder, served to the page for the
// step's length.
export function registerDemoSteps(
  services: MainServices,
  deps: PracticeDemoMainDeps,
): Disposable {
  const registrations = createRegistrations();
  // The fixture writer trashes whatever its folder's `problems/` holds, so
  // each enter writes into a folder that does not exist yet: the first free
  // `practice/<n>` at or above this.
  let nextNumber = 1;
  const newSampleFolder = async (scratchDir: string): Promise<string> => {
    const { files, paths } = deps;
    let number = nextNumber;
    const folderOf = (n: number) =>
      paths.join(scratchDir, 'practice', String(n));
    while ((await files.stat(folderOf(number))) !== null) {
      number += 1;
    }
    nextNumber = number + 1;
    return folderOf(number);
  };
  registrations.track(
    services.demoSteps.register({
      id: 'practice.mode',
      async enter(context) {
        const folder = await newSampleFolder(context.scratchDir);
        await writePracticeFixture(deps, folder);
        const hold = deps.holdSample(folder);
        return { sessions: {}, dispose: () => hold.dispose() };
      },
    }),
  );
  return registrations;
}
