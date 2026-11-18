import type { Disposable } from '../../../contracts/disposable';
import type { EditorHost, TextEditor } from '../../../contracts/editor';
import type {
  FocusTarget,
  OuterPanes,
  PaneDirection,
  ResizeTarget,
} from '../../../contracts/panes';
import type { KeyHints, ToastTone } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { boxHint } from '../../../shared/page/ui/key-anchors';
import { qualify } from '../../../shared/plugin-manifests';
import type { ChatMount } from '../../chat/contract';
import type { AgentPane, AgentPaneSpec } from '../contract';
import type { AskBoxInput, ScopedAgentsPane } from '../layouts/layout';

// What the page part's `askSend` and `leaveBox` commands run on the pane that
// holds the keys.
export interface AgentPaneView extends AgentPane {
  send(): void;
  leaveBox(): void;
}

export interface AgentPaneDeps {
  // The channel's `ask` and `sessionOf`, bound to the spec's owner and agent
  // id.
  ask(scope: string, text: string): Promise<string>;
  sessionOf(scope: string): Promise<string | null>;
  editor: EditorHost;
  keys: KeyHints;
  log(line: string): void;
  toast(text: string, tone: ToastTone): void;
  setScope(scope: 'ask'): void;
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  // Draws the session's chat view of `sessionId` into `element`.
  mountChat(element: HTMLElement, sessionId: string): ChatMount;
  // Draws the `askBox` part into `parent`, `frame` its `textBox`.
  drawAskBox(
    parent: HTMLElement,
    input: AskBoxInput,
    frame: HTMLElement,
  ): DrawnPart<ScopedAgentsPane>;
  // The page part's record of the pane that holds the keys: the pane names
  // itself where it takes them and null where it gives them up.
  heldKeys(pane: AgentPaneView | null): void;
}

const OPPOSITE_DIRECTIONS: Record<PaneDirection, PaneDirection> = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
};

// The open scope; a new object on each change, so an answer can tell whether
// the scope it was asked for is still open, even when the same scope was
// closed and opened again.
interface OpenScope {
  scope: string;
}

interface AskBox {
  frame: HTMLElement;
  editor: TextEditor;
  sendHint: Disposable;
  draw: DrawnPart<ScopedAgentsPane> | null;
}

// One agent pane in a host's slot: the open scope's chat view, mounted with
// `mountChat`, or the ask box while the scope has no session. It starts
// hidden, and `toggle` shows it, asking `sessionOf` and giving it the keys, or
// hides it; a spec's `isAlwaysShown` pane shows from the start, reads
// `sessionOf` on each scope without taking the keys, and `toggle` gives it the
// keys or hands them back to the host. A focus anywhere in the shown pane,
// as a click gives, takes the keys while the host holds them. The mount is
// keyed on the open scope `scopeOpened` names: the same scope keeps the mount
// and the ask box's text, another or null drops both. Within one scope, an
// answer naming another session than the mounted one remounts on it. `send`
// asks the agent with the ask box's text and mounts its chat view. An answer
// for a scope no longer open is dropped. While the pane holds the keys it
// sets the scope `ask`; `hostTookKeys` hears them leave. Hiding,
// `modeHidden`, the move opposite `entersFrom` and `leaveBox` give them back
// to the host and give them up whether or not the host's `leave` answers.
// `outerPanes` moves the spec's `entersFrom` direction from the host into the
// shown pane, and the opposite one from the pane to the host.
// After `dispose` every method does nothing.
export function createAgentPane(
  deps: AgentPaneDeps,
  spec: AgentPaneSpec,
): AgentPaneView {
  const log = (line: string) => deps.log(line);
  const { agentId } = spec;
  const body = element('div', 'scoped-agents-pane');
  body.tabIndex = -1;

  let open: OpenScope | null = null;
  let isDisposed = false;
  let isPaneShown = false;
  let hasKeys = false;
  // The pane opened and takes the keys once its answer lands.
  let takesKeysOnAnswer = false;
  let isSending = false;
  let mount: ChatMount | null = null;
  // The session `mount` shows; null while there is no mount.
  let mountedSessionId: string | null = null;
  let askBox: AskBox | null = null;

  // Draws the ask box's part again, keeping the focus in its frame.
  const drawAskBox = (box: AskBox) => {
    keepingFocusAndScroll(body, [], () => {
      box.draw?.dispose();
      box.draw?.built.element.remove();
      box.draw = deps.drawAskBox(
        body,
        { heading: spec.heading(), hint: spec.hint },
        box.frame,
      );
    });
  };

  const destroyAskBox = () => {
    if (askBox === null) {
      return;
    }
    askBox.draw?.dispose();
    askBox.draw?.built.element.remove();
    askBox.sendHint.dispose();
    askBox.editor.destroy();
    askBox.frame.remove();
    askBox = null;
  };

  const dropMount = () => {
    if (hasKeys) {
      mount?.hidden();
    }
    mount?.dispose();
    mount = null;
    mountedSessionId = null;
  };

  // Sets the keys on what the pane shows; `movesFocus` takes the DOM focus
  // there too.
  const holdKeys = (movesFocus: boolean) => {
    if (mount !== null) {
      mount.shown();
      return;
    }
    deps.setScope('ask');
    deps.setFocusTarget(null);
    deps.setResizeTarget(spec.resizeTarget);
    if (!movesFocus) {
      return;
    }
    if (askBox !== null) {
      askBox.editor.focus({ insertAtEnd: true });
    } else {
      body.focus();
    }
  };

  const takeKeys = (movesFocus: boolean) => {
    spec.tookKeys();
    hasKeys = true;
    deps.heldKeys(view);
    holdKeys(movesFocus);
    log(`${agentId} focused`);
  };

  // The keys left the pane; a pane without them does nothing.
  const releaseKeys = () => {
    if (!hasKeys) {
      return;
    }
    hasKeys = false;
    deps.heldKeys(null);
    mount?.hidden();
    log(`${agentId} left`);
  };

  // Hands the keys back to the host, then gives them up, unless the host's
  // `leave` already said it took them; a pane without the keys does nothing.
  const leaveToHost = () => {
    if (!hasKeys) {
      return;
    }
    spec.leave();
    releaseKeys();
  };

  const showAskBox = (scope: string) => {
    const frame = inputFrame();
    frame.classList.add('scoped-agents-ask-box');
    const sendAnchor = element('span', 'scoped-agents-ask-send');
    const box: AskBox = {
      frame,
      editor: deps.editor.create(frame, '', {
        changed: () => undefined,
        focused: () => undefined,
        blurred: () => undefined,
        modeChanged: () => undefined,
      }),
      sendHint: deps.keys.anchor(
        sendAnchor,
        qualify('scoped-agents', 'askSend'),
        { scope: 'scoped-agents.ask', where: 'box', label: 'send' },
      ),
      draw: null,
    };
    frame.append(boxHint('scoped-agents-ask-keys', [sendAnchor]));
    askBox = box;
    drawAskBox(box);
    log(`${agentId} ask box shown for ${scope}`);
  };

  const mountSession = (scope: string, sessionId: string) => {
    try {
      mount = deps.mountChat(body, sessionId);
    } catch (error) {
      log(`${agentId} not mounted ${scope}: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
      return;
    }
    mountedSessionId = sessionId;
    log(`${agentId} mounted ${scope}`);
  };

  // Shows `sessionId`'s chat view in place of the ask box or a mount of
  // another session; a mount of `sessionId` stays. Says whether it changed
  // what shows.
  const showSession = (scope: string, sessionId: string): boolean => {
    if (mount !== null && mountedSessionId === sessionId) {
      return false;
    }
    dropMount();
    destroyAskBox();
    mountSession(scope, sessionId);
    return true;
  };

  // Shows the answer to `sessionOf` for the open scope: its chat view, or the
  // ask box for none. A shown ask box stays on null; a mount stays unless the
  // answer names another session. The keys go where they went before: to the
  // pane when it waits to take them, onto what changed when it holds them.
  const showAnswer = (asked: OpenScope, sessionId: string | null) => {
    let isChanged = false;
    if (sessionId === null) {
      if (askBox === null && mount === null) {
        showAskBox(asked.scope);
        isChanged = true;
      }
    } else {
      isChanged = showSession(asked.scope, sessionId);
    }
    if (takesKeysOnAnswer) {
      takesKeysOnAnswer = false;
      takeKeys(true);
    } else if (hasKeys && isChanged) {
      holdKeys(true);
    }
  };

  const readSession = () => {
    const asked = open;
    if (asked === null) {
      return;
    }
    deps.sessionOf(asked.scope).then(
      (sessionId) => {
        if (asked === open) {
          showAnswer(asked, sessionId);
        }
      },
      (error: unknown) => {
        if (asked === open) {
          takesKeysOnAnswer = false;
          log(`${agentId} not read ${asked.scope}: ${errorText(error)}`);
          deps.toast(errorText(error), 'error');
        }
      },
    );
  };

  // Gives the shown pane the keys, once `sessionOf` answers when it shows
  // nothing yet, or no chat view in a pane that hides; an always-shown pane
  // read `sessionOf` on its scope's open.
  const enter = () => {
    const showsAnswer =
      mount !== null || (spec.isAlwaysShown && askBox !== null);
    if (showsAnswer) {
      takeKeys(true);
      return;
    }
    takesKeysOnAnswer = true;
    readSession();
  };

  const show = () => {
    isPaneShown = true;
    spec.setShown(true);
    log(`${agentId} pane shown`);
  };

  const hide = () => {
    takesKeysOnAnswer = false;
    leaveToHost();
    isPaneShown = false;
    spec.setShown(false);
    log(`${agentId} pane hidden`);
  };

  const send = () => {
    const box = askBox;
    const asked = open;
    if (box === null || asked === null) {
      return;
    }
    if (isSending) {
      log(`${agentId} ask ignored: sending`);
      return;
    }
    const text = box.editor.text().trim();
    if (text === '') {
      log(`${agentId} ask ignored: empty`);
      return;
    }
    isSending = true;
    deps.ask(asked.scope, text).then(
      (sessionId) => {
        if (asked !== open) {
          return;
        }
        isSending = false;
        destroyAskBox();
        showSession(asked.scope, sessionId);
        if (hasKeys) {
          holdKeys(true);
        }
      },
      (error: unknown) => {
        if (asked !== open) {
          return;
        }
        isSending = false;
        deps.toast(
          `Could not start the ${agentId}: ${errorText(error)}`,
          'error',
        );
        log(`${agentId} ask failed: ${errorText(error)}`);
      },
    );
  };

  const outerPanes: OuterPanes = {
    focus: {
      move(direction) {
        if (isDisposed) {
          return false;
        }
        const entersPane = direction === spec.entersFrom;
        const leavesPane = direction === OPPOSITE_DIRECTIONS[spec.entersFrom];
        if (leavesPane && hasKeys) {
          leaveToHost();
          return true;
        }
        if (entersPane && isPaneShown && open !== null && !hasKeys) {
          takeKeys(true);
          return true;
        }
        return false;
      },
    },
    resize: spec.resizeTarget,
  };

  const view: AgentPaneView = {
    element: body,
    isShown: () => isPaneShown,
    toggle() {
      if (isDisposed) {
        return;
      }
      const hidesPane = isPaneShown && !spec.isAlwaysShown;
      if (spec.isAlwaysShown && hasKeys) {
        leaveToHost();
      } else if (hidesPane) {
        hide();
      } else if (open === null) {
        log(`${agentId} has no scope`);
      } else {
        if (!isPaneShown) {
          show();
        }
        enter();
      }
    },
    scopeOpened(scope) {
      const isOpenAlready =
        open === null ? scope === null : open.scope === scope;
      if (isDisposed || isOpenAlready) {
        return;
      }
      dropMount();
      destroyAskBox();
      isSending = false;
      if (spec.isAlwaysShown) {
        takesKeysOnAnswer = false;
      }
      open = scope === null ? null : { scope };
      if (isPaneShown) {
        readSession();
      }
    },
    refresh() {
      if (isDisposed || !isPaneShown) {
        return;
      }
      readSession();
    },
    send() {
      if (!isDisposed) {
        send();
      }
    },
    leaveBox() {
      if (!isDisposed) {
        leaveToHost();
      }
    },
    hostTookKeys: releaseKeys,
    modeHidden() {
      takesKeysOnAnswer = false;
      leaveToHost();
    },
    outerPanes,
    redraw() {
      if (askBox !== null) {
        drawAskBox(askBox);
      }
    },
    // An answer landing after the dispose finds no open scope.
    dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      open = null;
      takesKeysOnAnswer = false;
      callEach<() => void>(
        [
          dropMount,
          destroyAskBox,
          () => {
            if (hasKeys) {
              hasKeys = false;
              deps.heldKeys(null);
            }
          },
        ],
        (step) => step(),
      );
    },
  };
  body.addEventListener('focusin', () => {
    const isHostHolding = isPaneShown && open !== null && !hasKeys;
    if (!isDisposed && isHostHolding) {
      takeKeys(false);
    }
  });
  if (spec.isAlwaysShown) {
    show();
  }
  return view;
}
