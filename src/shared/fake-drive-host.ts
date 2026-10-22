import type { DriveAction, DriveHost } from '../contracts/plugin';

// A `DriveHost` for the tests: `actions` holds what was added under its bare
// name, and `run` runs one as the drive would, throwing for a name nothing
// added.
export function fakeDriveHost() {
  const actions = new Map<string, DriveAction>();
  const host: DriveHost = {
    add(name, action) {
      actions.set(name, action);
      return { dispose: () => actions.delete(name) };
    },
  };
  const run = (name: string, args?: unknown) => {
    const action = actions.get(name);
    if (action === undefined) {
      throw new Error(`no drive action ${name}`);
    }
    return action.run(args);
  };
  return { host, actions, run };
}
