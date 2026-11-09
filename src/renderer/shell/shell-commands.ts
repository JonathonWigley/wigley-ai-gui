import type { Log } from '../../contracts/log';
import type { PageCommandContext } from '../../contracts/plugin';
import {
  type KitCommands,
  runLogged,
} from '../../shared/page/layout-host/base-kit';
import type { RuntimeCommands } from '../../shared/runtime-commands';

// The shell kit's commands, read from the router's catalog as every plugin's
// kit reads them. `run` logs under `commands` a run that throws at the call.
export function shellCommands(
  commands: Pick<RuntimeCommands<PageCommandContext<any>>, 'infoOf' | 'router'>,
  log: Log,
): KitCommands {
  return {
    exists: (id) => commands.infoOf(id) !== undefined,
    argShape: (id) => commands.infoOf(id)?.arg,
    run(id, arg) {
      runLogged(
        id,
        (line) => log('commands', line),
        () => commands.router.run(id, arg, {}),
      );
    },
  };
}
