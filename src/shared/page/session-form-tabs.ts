import { element } from './dom';
import { emptyState } from './ui/empty-state';

// A tab added to a session; the sessions plugin's `SessionTabView` fits.
export interface FormTabView {
  id: string;
  title: string;
  // A Codicon name.
  icon: string;
  element: HTMLElement;
  closesAtOnce(): boolean;
  beforeClose(atOnce: boolean): boolean;
  shown(): void;
}

// The sessions plugin's `SessionTabHandle` fits.
export interface FormTabHandle {
  takeOver(): { release(): void };
  isVisible(): boolean;
}

// A row part with no content whose tooltip is the session's form status; the
// sessions plugin's `SessionPart` fits.
export interface FormStatusPart {
  id: string;
  build(): Record<string, never>;
  tooltip(sessionId: string): string | null;
}

export interface SessionFormTabsDeps {
  // The sessions plugin's page export `addTab` fits.
  addTab(sessionId: string, tab: FormTabView): FormTabHandle;
  tabId: string;
  title: string;
  // The tab's Codicon name.
  icon: string;
  // The tab element's class.
  className: string;
  // The idle state's line while the session has no open form.
  idleText: string;
  // The id of the row part showing each session's status.
  statusPartId: string;
  // Whether the close key closes the session at once.
  closesAtOnce(sessionId: string): boolean;
  beforeClose(sessionId: string): boolean;
  // Runs each time one of these tabs becomes the visible tab.
  shown(): void;
  // Called when a session's form starts or stops showing, so the host can tell the session's row.
  formShown(sessionId: string, shown: boolean): void;
}

export interface SessionFormTabs {
  // Puts a form's view root into the session's tab, before its idle state, adding the tab first when the
  // session has none.
  mount(sessionId: string, root: HTMLElement): void;
  // Takes over the session with its tab for form `formId`; `release` gives it back.
  takeOver(formId: string, sessionId: string): void;
  release(formId: string): void;
  // For each tab: shows its idle state while `statusOf` is null, keeps its status (`statusOf`) for
  // `statusPart`'s tooltip, and calls `formShown` when whether a form shows changed.
  sync(statusOf: (sessionId: string) => string | null): void;
  // Drops the session's tab entry once sessions dropped the tab.
  forget(sessionId: string): void;
  // Whether one of these tabs is the visible tab now.
  isShown(): boolean;
  // The row part whose tooltip is the session's status as `sync` last kept it, null for none or ''.
  statusPart: FormStatusPart;
}

// A session's tab: it holds the session's form views and the idle state,
// with the status `sync` last kept.
interface FormTab {
  handle: FormTabHandle;
  element: HTMLElement;
  idle: HTMLElement;
  status: string;
  // Whether `statusOf` last returned a status, even an empty one.
  shown: boolean;
}

// One tab per session that has held a form, each form taking over its
// session with it while the form is open.
export function createSessionFormTabs(
  deps: SessionFormTabsDeps,
): SessionFormTabs {
  const tabs = new Map<string, FormTab>();
  // Each open form's take over of its session's tabs, by form id.
  const takeOvers = new Map<string, { release(): void }>();
  const tabOf = (sessionId: string): FormTab => {
    const existing = tabs.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const tab = element('div', deps.className);
    const idle = emptyState(deps.idleText);
    tab.append(idle);
    const handle = deps.addTab(sessionId, {
      id: deps.tabId,
      title: deps.title,
      icon: deps.icon,
      element: tab,
      closesAtOnce: () => deps.closesAtOnce(sessionId),
      beforeClose: () => deps.beforeClose(sessionId),
      shown: deps.shown,
    });
    const created: FormTab = {
      handle,
      element: tab,
      idle,
      status: '',
      shown: false,
    };
    tabs.set(sessionId, created);
    return created;
  };

  return {
    mount(sessionId, root) {
      const tab = tabOf(sessionId);
      tab.element.insertBefore(root, tab.idle);
    },
    takeOver(formId, sessionId) {
      const tab = tabs.get(sessionId);
      if (tab === undefined) {
        throw new Error(
          `Form ${formId} takes over session ${sessionId}, which has no mounted tab`,
        );
      }
      takeOvers.set(formId, tab.handle.takeOver());
    },
    release(formId) {
      takeOvers.get(formId)?.release();
      takeOvers.delete(formId);
    },
    sync(statusOf) {
      for (const [sessionId, tab] of tabs) {
        const shownStatus = statusOf(sessionId);
        const shown = shownStatus !== null;
        tab.idle.hidden = shown;
        tab.status = shownStatus ?? '';
        if (tab.shown !== shown) {
          tab.shown = shown;
          deps.formShown(sessionId, shown);
        }
      }
    },
    forget(sessionId) {
      tabs.delete(sessionId);
    },
    isShown() {
      return [...tabs.values()].some((tab) => tab.handle.isVisible());
    },
    statusPart: {
      id: deps.statusPartId,
      build: () => ({}),
      tooltip: (sessionId) => {
        const status = tabs.get(sessionId)?.status ?? '';
        return status === '' ? null : status;
      },
    },
  };
}
