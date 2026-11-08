import { element } from './dom';

// A popup opened over a session; the sessions plugin's `SessionPopupView` fits.
export interface FormPopupView {
  id: string;
  title: string;
  // A Codicon name.
  icon: string;
  element: HTMLElement;
  beforeClose(): boolean | Promise<boolean>;
  shown(): void;
}

// The sessions plugin's `SessionPopupHandle` fits.
export interface FormPopupHandle {
  setStatus(status: string): void;
  open(): void;
  isVisible(): boolean;
  dispose(): void;
}

export interface SessionFormPopupsDeps {
  // The sessions plugin's page export `addPopup` fits.
  addPopup(sessionId: string, popup: FormPopupView): FormPopupHandle;
  popupId: string;
  title: string;
  // The popup's Codicon name.
  icon: string;
  // The popup element's class.
  className: string;
  beforeClose(sessionId: string): boolean | Promise<boolean>;
  // Runs each time one of these popups becomes the visible surface.
  shown(): void;
  // Called when a session's form starts or stops showing, so the host can tell the session's row.
  formShown(sessionId: string, shown: boolean): void;
}

export interface SessionFormPopups {
  // Puts a form's view root into the session's popup and opens it, adding the popup first when the
  // session has none.
  mount(sessionId: string, root: HTMLElement): void;
  // For each popup: disposes it while `statusOf` is null, and otherwise sends its status to the
  // session's row when it changed; calls `formShown` when whether a form shows changed.
  sync(statusOf: (sessionId: string) => string | null): void;
  // Drops the session's popup entry once sessions dropped the popup.
  forget(sessionId: string): void;
  // Opens the session's popup; nothing when it has none.
  open(sessionId: string): void;
  // Whether one of these popups is the visible surface now.
  isShown(): boolean;
}

// A session's popup: it holds the session's form views, with the status last
// sent to the session's row.
interface FormPopup {
  handle: FormPopupHandle;
  element: HTMLElement;
  status: string;
  // Whether `statusOf` last returned a status, even an empty one.
  shown: boolean;
}

// One popup per session while it holds a form, added with its first form's
// root and disposed once `statusOf` says it holds none.
export function createSessionFormPopups(
  deps: SessionFormPopupsDeps,
): SessionFormPopups {
  const popups = new Map<string, FormPopup>();
  const addPopup = (sessionId: string, root: HTMLElement) => {
    const popup = element('div', deps.className);
    popup.append(root);
    const handle = deps.addPopup(sessionId, {
      id: deps.popupId,
      title: deps.title,
      icon: deps.icon,
      element: popup,
      beforeClose: () => deps.beforeClose(sessionId),
      shown: deps.shown,
    });
    popups.set(sessionId, {
      handle,
      element: popup,
      status: '',
      shown: false,
    });
  };

  return {
    mount(sessionId, root) {
      const popup = popups.get(sessionId);
      if (popup === undefined) {
        addPopup(sessionId, root);
        return;
      }
      popup.element.append(root);
      popup.handle.open();
    },
    sync(statusOf) {
      for (const [sessionId, popup] of popups) {
        const status = statusOf(sessionId);
        const shown = status !== null;
        if (status === null) {
          popup.handle.dispose();
          popups.delete(sessionId);
        } else if (popup.status !== status) {
          popup.status = status;
          popup.handle.setStatus(status);
        }
        if (popup.shown !== shown) {
          popup.shown = shown;
          deps.formShown(sessionId, shown);
        }
      }
    },
    forget(sessionId) {
      popups.delete(sessionId);
    },
    open(sessionId) {
      popups.get(sessionId)?.handle.open();
    },
    isShown() {
      return [...popups.values()].some((popup) => popup.handle.isVisible());
    },
  };
}
