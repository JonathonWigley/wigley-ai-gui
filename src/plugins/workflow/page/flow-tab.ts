import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { Log } from '../../../contracts/log';
import { element } from '../../../shared/page/dom';
import type { SessionTabHandle, SessionTabView } from '../../sessions/contract';
import type { SessionFlow } from '../contract';

// `addTab` is sessions' export. `flowOf` is the flow the session draws and
// `nameOf` its name in the log. `draw` draws the session's Flow tab into
// `body` until its dispose, setting the tab's status line on each draw (the
// view's `drawFlowTab`). `shown` sets the Flow tab's key scope when the tab
// becomes the visible one.
export interface FlowTabsDeps {
  addTab(sessionId: string, tab: SessionTabView): SessionTabHandle;
  timers: Timers;
  log: Log;
  flowOf(sessionId: string): SessionFlow;
  nameOf(sessionId: string): string;
  draw(
    body: HTMLElement,
    sessionId: string,
    setStatus: (status: string) => void,
  ): Disposable;
  shown(): void;
}

// The Flow tab of each session that has left idle, added after its Chat tab:
// a strip build (`chatTabBuilt`) means chat adds the session's Chat tab once
// the current call returns, so a build schedules the add on a zero-delay
// timer, and a flow that arrives after the build adds it at once. A flow for
// a session whose strip was never built waits for the build. The tab stays
// until `removeTab`, which keeps the build so the next flow adds it again, or
// `forget`, which also forgets the build for a session that left. A tab whose
// draw throws is removed again. `visibleBody` is the scrolling body of the
// Flow tab that is the visible tab, null for none.
export interface FlowTabs {
  chatTabBuilt(sessionId: string): void;
  setFlow(flow: SessionFlow): void;
  removeTab(sessionId: string): void;
  forget(sessionId: string): void;
  visibleBody(): HTMLElement | null;
}

interface HeldTab {
  handle: SessionTabHandle;
  body: HTMLElement;
  drawing: Disposable;
}

const FLOW_TAB_ID = 'workflow.flow';

export function createFlowTabs(deps: FlowTabsDeps): FlowTabs {
  const log = (line: string) => deps.log('workflow', line);
  const built = new Set<string>();
  const tabs = new Map<string, HeldTab>();
  const pendingAdds = new Map<string, number>();

  const shouldAdd = (flow: SessionFlow) =>
    built.has(flow.sessionId) && !tabs.has(flow.sessionId) && flow.hasLeftIdle;

  const cancelPendingAdd = (sessionId: string) => {
    const pending = pendingAdds.get(sessionId);
    if (pending !== undefined) {
      pendingAdds.delete(sessionId);
      deps.timers.clear(pending);
    }
  };

  const add = (sessionId: string) => {
    cancelPendingAdd(sessionId);
    const name = deps.nameOf(sessionId);
    const body = element('div', 'workflow-flow-tab');
    const handle = deps.addTab(sessionId, {
      id: FLOW_TAB_ID,
      title: 'Flow',
      icon: 'checklist',
      element: body,
      beforeClose: () => true,
      shown() {
        deps.shown();
        log(`Flow tab shown in ${name}`);
      },
    });
    let drawing: Disposable;
    try {
      drawing = deps.draw(body, sessionId, (status) =>
        handle.setStatus(status),
      );
    } catch (error) {
      handle.remove();
      throw error;
    }
    tabs.set(sessionId, { handle, body, drawing });
    log(`Flow tab added in ${name}`);
  };

  const removeTab = (sessionId: string) => {
    cancelPendingAdd(sessionId);
    const tab = tabs.get(sessionId);
    if (tab === undefined) {
      return;
    }
    tabs.delete(sessionId);
    try {
      tab.drawing.dispose();
    } finally {
      tab.handle.remove();
    }
  };

  return {
    chatTabBuilt(sessionId) {
      built.add(sessionId);
      if (shouldAdd(deps.flowOf(sessionId)) && !pendingAdds.has(sessionId)) {
        pendingAdds.set(
          sessionId,
          deps.timers.set(() => {
            pendingAdds.delete(sessionId);
            if (shouldAdd(deps.flowOf(sessionId))) {
              add(sessionId);
            }
          }, 0),
        );
      }
    },
    setFlow(flow) {
      if (shouldAdd(flow)) {
        add(flow.sessionId);
      }
    },
    removeTab,
    forget(sessionId) {
      built.delete(sessionId);
      removeTab(sessionId);
    },
    visibleBody() {
      for (const tab of tabs.values()) {
        if (tab.handle.isVisible()) {
          return tab.body;
        }
      }
      return null;
    },
  };
}
