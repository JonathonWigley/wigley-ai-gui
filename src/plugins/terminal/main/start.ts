import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { type TerminalChannel, terminalOutputSlot } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { terminalManifest } from '../manifest';
import { TERMINAL_SESSION_NOTE } from './session-note';
import { createShells } from './shells';

type TerminalApi = MainApi<
  typeof terminalManifest,
  TerminalChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

const LINE_BREAK = /[\r\n]/;

// Registers terminal's layouts, hands chat the session note, and runs each
// session's shell: the page's channel calls, `terminal.type` for the calling
// session, and a kill on `sessions.closed`. Once chat's restore settles it
// adopts the host's shells. A restart or quit leaves the shells running in the
// host for the next start; a switch-off ends them.
export const terminalMainPart: MainPart<typeof terminalManifest> = {
  manifest: terminalManifest,
  start(api: TerminalApi) {
    api.layouts.register({ layoutTypes });
    const { services } = api;
    const chat = api.dependency(chatMainKey);
    chat.addInstructions(TERMINAL_SESSION_NOTE);
    const sessionRows = api.state.read(sessionsRowsSlot);
    const output = api.state.publish(terminalOutputSlot);
    const shells = createShells({
      terminals: services.terminals,
      resolveShell: () => services.processes.resolveProgram('shell'),
      folderOf: (id) => sessionRows.get(id)?.projectDir ?? services.homeDir,
      labelOf: (id) => sessionRows.get(id)?.label ?? id,
      hasRow: (id) => sessionRows.get(id) !== undefined,
      newShellId: services.randomUuid,
      send: (message, data) => api.channel.send(message, data),
      output,
      timers: services.timers,
      log: services.log,
    });
    api.channel.handle('open', (sessionId, cols, rows) =>
      shells.open(sessionId, cols, rows),
    );
    api.channel.handle('write', (sessionId, data) =>
      shells.write(sessionId, data),
    );
    api.channel.handle('resize', (sessionId, cols, rows) =>
      shells.resize(sessionId, cols, rows),
    );
    api.channel.handle('restart', (sessionId, cols, rows) =>
      shells.restart(sessionId, cols, rows),
    );
    api.events.on('sessions.closed', ({ sessionId }) =>
      shells.kill(sessionId),
    );
    let isStopped = false;
    return {
      commands: {
        type: async ({ arg, callerSessionId }) => {
          if (callerSessionId === undefined) {
            throw new Error('terminal.type needs a calling session');
          }
          if (LINE_BREAK.test(arg)) {
            throw new Error(
              'terminal.type takes one line: the text holds a line break',
            );
          }
          await shells.type(callerSessionId, arg);
        },
      },
      ready() {
        void chat
          .restored()
          .then(() => (isStopped ? undefined : shells.adopt()));
      },
      dispose(stop) {
        isStopped = true;
        if (stop === 'end') {
          shells.killAll();
        } else {
          shells.detachAll();
        }
      },
    };
  },
};
