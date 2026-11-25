import './terminal.css';
import { coreThemeSlot } from '../../../contracts/core-state';
import type {
  DrawnLayoutPart,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import type {
  TerminalScreen,
  TerminalSize,
} from '../../../contracts/terminal-emulator';
import type { TerminalExit } from '../../../contracts/terminals';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import {
  followRows,
  NEEDS_YOU_ACTIVITY,
  type SessionDrawerHandle,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import type { TerminalChannel, TerminalOpened } from '../contract';
import { exitReason } from '../exit-reason';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type {
  DrawerHeaderInput,
  Layout,
  TerminalPart,
} from '../layouts/layout';
import { terminalManifest } from '../manifest';
import { readTerminalLayout } from './layout/read-terminal-layout';
import { readTerminalLook } from './palette';

type TerminalApi = PageApi<typeof terminalManifest, TerminalChannel>;

type DataMessage = TerminalChannel['messages']['data'];
type ExitedMessage = TerminalChannel['messages']['exited'];

// A `data` or `exited` message, tagged, as the drawer queues it.
type ShellMessage =
  | ({ kind: 'data' } & DataMessage)
  | ({ kind: 'exited' } & ExitedMessage);

// The call that asks main for a session's shell and answers with it.
type OpenMethod = 'open' | 'restart';

// The source id the drawer's "needs you" mark is set under.
const ACTIVITY_SOURCE = 'terminal';
const VIEW_ID = 'terminal';
const SCOPE = 'terminal';

// One session's terminal: its drawer in sessions, its screen, and where it
// stands with main's shell. `shell` is the shell id of the last reply, null
// before one; `opened` turns true at the first reply; `pending` holds while an
// `open` or `restart` waits, and `queue` and `held` keep the messages and the
// input that arrive meanwhile; `sentSize` is the size that call sent.
interface Drawer {
  readonly sessionId: string;
  readonly handle: SessionDrawerHandle;
  readonly root: HTMLElement;
  readonly headerHost: HTMLElement;
  readonly screen: TerminalScreen;
  shell: string | null;
  opened: boolean;
  pending: boolean;
  queue: ShellMessage[];
  held: string[];
  sentSize: TerminalSize;
  lastSeq: number;
  exit: TerminalExit | null;
  folder: string;
  header: DrawnLayoutPart<TerminalPart> | null;
  isForgotten: boolean;
}

function exitLine(exit: TerminalExit): string {
  return `\r\n[shell exited: ${exitReason(exit)}] Press Enter to start a new shell.\r\n`;
}

function failureLine(error: unknown): string {
  return `\r\n[terminal: ${errorText(error)}]\r\n`;
}

function isSameSize(a: TerminalSize, b: TerminalSize): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}

// `exit` is set only by a reply, or an `exited` after one, so a drawer not yet
// opened is `starting`.
function headerInputOf(drawer: Drawer): DrawerHeaderInput {
  let state: DrawerHeaderInput['state'] = 'starting';
  if (drawer.opened) {
    state = drawer.exit === null ? 'running' : 'exited';
  }
  return {
    sessionId: drawer.sessionId,
    folder: drawer.folder,
    state,
    exitReason: drawer.exit === null ? null : exitReason(drawer.exit),
  };
}

// Draws each session's terminal in sessions' drawer, made the first time the
// user toggles it or main types into the session's shell. The screen shows
// main's buffer of the shell from each `open` reply, then the live output in
// seq order, dropping what belongs to a shell a reply replaced; the user's
// input goes to the shell, and Enter after an exit starts a new one. Main's
// `typed` opens the drawer without focus and marks the row as needing the user
// until a line is sent or the drawer closes. The header draws through the
// `terminal.layout` layout, and the screens take the theme's colours and font.
export const terminalPagePart: PagePart<typeof terminalManifest> = {
  manifest: terminalManifest,
  start(api: TerminalApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const drawers = new Map<string, Drawer>();
    let look = readTerminalLook(getComputedStyle(document.documentElement));
    let isStopped = false;

    const labelOf = (sessionId: string) =>
      rows.get(sessionId)?.label ?? sessionId;
    const log = (line: string, sessionId: string) =>
      services.log(`${line} in ${labelOf(sessionId)}`);
    const isGone = (drawer: Drawer) => isStopped || drawer.isForgotten;
    const clearMark = (sessionId: string) =>
      sessions.setActivity(sessionId, ACTIVITY_SOURCE, null);

    const show = api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readTerminalLayout,
      userLayout: () => api.settings().layout,
      setLayouts: () => callEach([...drawers.values()], drawHeader),
    });

    function drawHeader(drawer: Drawer): void {
      const previous = drawer.header;
      drawer.header = null;
      if (previous !== null) {
        previous.built.element.remove();
        previous.dispose();
      }
      drawer.header = show.draw(
        'drawerHeader',
        drawer.headerHost,
        headerInputOf(drawer),
      );
    }

    // Runs a call to main that answers nothing, logging a failure.
    function tell(drawer: Drawer, what: string, call: Promise<void>): void {
      void call.catch((error: unknown) => {
        if (!isGone(drawer)) {
          services.log(
            `${what} failed in ${labelOf(drawer.sessionId)}: ${errorText(error)}`,
          );
        }
      });
    }

    function sendSize(drawer: Drawer, size: TerminalSize): void {
      tell(
        drawer,
        'resize',
        api.channel.invoke('resize', drawer.sessionId, size.cols, size.rows),
      );
    }

    function request(drawer: Drawer, method: OpenMethod): void {
      drawer.pending = true;
      drawer.sentSize = drawer.screen.size();
      const { cols, rows: rowCount } = drawer.sentSize;
      void api.channel.invoke(method, drawer.sessionId, cols, rowCount).then(
        (reply) => {
          if (!isGone(drawer)) {
            applyReply(drawer, reply, method);
          }
        },
        (error: unknown) => {
          if (!isGone(drawer)) {
            failed(drawer, error);
          }
        },
      );
    }

    function applyReply(
      drawer: Drawer,
      reply: TerminalOpened,
      method: OpenMethod,
    ): void {
      if (drawer.shell !== null) {
        drawer.screen.reset();
      }
      if (reply.buffer !== '') {
        drawer.screen.write(reply.buffer);
      }
      drawer.shell = reply.shell;
      drawer.lastSeq = reply.seq;
      drawer.exit = reply.exit;
      drawer.folder = services.paths.tilde(reply.folder, services.homeDir);
      drawer.opened = true;
      drawer.pending = false;
      if (reply.exit !== null) {
        drawer.screen.write(exitLine(reply.exit));
      }
      const queued = drawer.queue;
      drawer.queue = [];
      for (const message of queued) {
        if (message.shell === reply.shell) {
          applyMessage(drawer, message);
        }
      }
      const size = drawer.screen.size();
      if (drawer.exit === null && !isSameSize(size, drawer.sentSize)) {
        sendSize(drawer, size);
      }
      const held = drawer.held;
      drawer.held = [];
      for (const data of held) {
        takeInput(drawer, data);
      }
      drawHeader(drawer);
      if (method === 'restart') {
        log('restarted', drawer.sessionId);
      }
    }

    function failed(drawer: Drawer, error: unknown): void {
      drawer.pending = false;
      drawer.queue = [];
      drawer.held = [];
      drawer.screen.write(failureLine(error));
      services.log(
        `open failed in ${labelOf(drawer.sessionId)}: ${errorText(error)}`,
      );
    }

    // A message of the drawer's own shell, once it is opened and not waiting.
    function applyMessage(drawer: Drawer, message: ShellMessage): void {
      if (message.kind === 'data') {
        if (message.seq > drawer.lastSeq) {
          drawer.screen.write(message.chunk);
          drawer.lastSeq = message.seq;
        }
        return;
      }
      if (drawer.exit === null) {
        exitShell(drawer, message.exit);
      }
    }

    function exitShell(drawer: Drawer, exit: TerminalExit): void {
      drawer.exit = exit;
      drawer.screen.write(exitLine(exit));
      drawHeader(drawer);
      services.log(
        `shell exited in ${labelOf(drawer.sessionId)}: ${exitReason(exit)}`,
      );
    }

    function hearShellMessage(message: ShellMessage): void {
      const drawer = drawers.get(message.sessionId);
      if (drawer === undefined) {
        return;
      }
      if (drawer.pending) {
        drawer.queue.push(message);
        return;
      }
      if (!drawer.opened) {
        return;
      }
      if (message.shell !== drawer.shell) {
        request(drawer, 'open');
        return;
      }
      applyMessage(drawer, message);
    }

    function restartShell(drawer: Drawer): void {
      const canRestart =
        drawer.opened && !drawer.pending && drawer.exit !== null;
      if (canRestart) {
        request(drawer, 'restart');
      }
    }

    function takeInput(drawer: Drawer, data: string): void {
      if (drawer.pending) {
        drawer.held.push(data);
        return;
      }
      if (!drawer.opened) {
        return;
      }
      const sendsLine = data.includes('\r');
      if (drawer.exit !== null) {
        if (sendsLine) {
          restartShell(drawer);
        }
        return;
      }
      tell(
        drawer,
        'write',
        api.channel.invoke('write', drawer.sessionId, data),
      );
      if (sendsLine) {
        clearMark(drawer.sessionId);
        log('line sent', drawer.sessionId);
      }
    }

    function takeResize(drawer: Drawer, size: TerminalSize): void {
      const isLive = drawer.opened && !drawer.pending && drawer.exit === null;
      if (isLive) {
        sendSize(drawer, size);
      }
    }

    function ensureDrawer(sessionId: string): Drawer {
      const existing = drawers.get(sessionId);
      if (existing !== undefined) {
        return existing;
      }
      const root = document.createElement('div');
      root.className = 'terminal-drawer';
      const headerHost = document.createElement('div');
      headerHost.className = 'terminal-drawer-header';
      const screenHost = document.createElement('div');
      screenHost.className = 'terminal-drawer-screen';
      root.append(headerHost, screenHost);
      const screen = services.terminals.create(look);
      screenHost.append(screen.element);
      root.addEventListener('focusin', () => api.keys.setScope(SCOPE));
      const handle = sessions.addDrawer(sessionId, {
        id: VIEW_ID,
        element: root,
        shown() {
          screen.fit();
          if (!drawer.opened && !drawer.pending) {
            request(drawer, 'open');
          }
        },
        focus() {
          api.keys.setScope(SCOPE);
          screen.focus();
        },
      });
      const drawer: Drawer = {
        sessionId,
        handle,
        root,
        headerHost,
        screen,
        shell: null,
        opened: false,
        pending: false,
        queue: [],
        held: [],
        sentSize: screen.size(),
        lastSeq: 0,
        exit: null,
        folder: '',
        header: null,
        isForgotten: false,
      };
      drawers.set(sessionId, drawer);
      screen.onInput((data) => takeInput(drawer, data));
      screen.onResize((size) => takeResize(drawer, size));
      drawHeader(drawer);
      return drawer;
    }

    function disposeDrawer(drawer: Drawer): void {
      drawer.isForgotten = true;
      callEach<() => void>(
        [
          () => drawer.handle.dispose(),
          () => drawer.header?.dispose(),
          () => drawer.screen.dispose(),
        ],
        (step) => step(),
      );
    }

    function forget(sessionId: string): void {
      const drawer = drawers.get(sessionId);
      if (drawer === undefined) {
        return;
      }
      drawers.delete(sessionId);
      disposeDrawer(drawer);
    }

    function hearTyped(message: TerminalChannel['messages']['typed']): void {
      const drawer = ensureDrawer(message.sessionId);
      drawer.handle.open({ focus: false });
      sessions.setActivity(
        message.sessionId,
        ACTIVITY_SOURCE,
        NEEDS_YOU_ACTIVITY,
      );
      log('typed', message.sessionId);
      const isNewShell =
        drawer.opened && !drawer.pending && message.shell !== drawer.shell;
      if (isNewShell) {
        request(drawer, 'open');
      }
    }

    function toggle(): void {
      const sessionId = sessions.shownSessionId();
      if (sessionId === null) {
        services.log('no session shown');
        return;
      }
      const existing = drawers.get(sessionId);
      if (existing !== undefined && existing.handle.isOpen()) {
        existing.handle.close();
        clearMark(sessionId);
        log('drawer closed', sessionId);
        return;
      }
      ensureDrawer(sessionId).handle.open({ focus: true });
      log('drawer opened', sessionId);
    }

    function back(): void {
      const focused = document.activeElement;
      const drawer = [...drawers.values()].find((each) =>
        each.root.contains(focused),
      );
      if (drawer === undefined) {
        return;
      }
      drawer.handle.returnFocus();
      log('back to the session', drawer.sessionId);
    }

    function applyLook(): void {
      look = readTerminalLook(getComputedStyle(document.documentElement));
      callEach([...drawers.values()], (drawer) =>
        drawer.screen.setPalette(look.palette, look.fontFamily, look.fontSize),
      );
    }

    api.channel.on('data', (message) =>
      hearShellMessage({ kind: 'data', ...message }),
    );
    api.channel.on('exited', (message) =>
      hearShellMessage({ kind: 'exited', ...message }),
    );
    api.channel.on('typed', hearTyped);
    api.state.read(coreThemeSlot).on(() => applyLook());
    followRows(rows, { removed: forget });

    return {
      commands: {
        toggle,
        back,
        restart: ({ arg }) => {
          const drawer = drawers.get(arg);
          if (drawer !== undefined) {
            restartShell(drawer);
          }
        },
      },
      dispose() {
        isStopped = true;
        const held = [...drawers.values()];
        drawers.clear();
        callEach(held, disposeDrawer);
      },
    };
  },
};
