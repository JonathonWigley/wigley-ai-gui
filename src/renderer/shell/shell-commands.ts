import type { Log } from '../../contracts/log';
import type { PageCommandContext } from '../../contracts/plugin';
import { errorText } from '../../shared/error-text';
import type { KitCommands } from '../../shared/page/layout-host/base-kit';
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
      try {
        void commands.router.run(id, arg, {});
      } catch (error) {
        log('commands', `command ${id} failed: ${errorText(error)}`);
      }
    },
  };
}
