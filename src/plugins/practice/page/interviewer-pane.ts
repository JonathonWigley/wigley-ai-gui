import type { Disposable } from '../../../contracts/disposable';
import type { TextEditor } from '../../../contracts/editor';
import type { OuterPanes } from '../../../contracts/panes';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { boxHint } from '../../../shared/page/ui/key-anchors';
import { qualify } from '../../../shared/plugin-manifests';
import type { ChatMount } from '../../chat/contract';
import type { AskBoxInput, PracticePane } from '../layouts/layout';
import type { PracticeFocus } from './practice-state';
import type { PracticeView, PracticeViewDeps } from './practice-view';
import type { ProblemWorkspace } from './problem-workspace';

const ASK_HINT =
  'Ask about the problem. The interviewer asks guiding questions and gives no answers.';

export interface InterviewerPaneDeps extends Pick<
  PracticeViewDeps,
  | 'channel'
  | 'editor'
  | 'keys'
  | 'log'
  | 'toast'
  | 'setScope'
  | 'setResizeTarget'
  | 'setFocusTarget'
  | 'mountChat'
> {
  workspace: Pick<ProblemWorkspace, 'setSidePaneShown' | 'sideResizeTarget'>;
  view: Pick<PracticeView, 'setFocus' | 'focusColumn'>;
  // The view's focus now.
  focus(): PracticeFocus;
  // The open problem's title, for the ask box's heading.
  problemTitle(): string;
  // Draws the `askBox` part into `parent`, `frame` its `textBox`.
  drawAskBox(
    parent: HTMLElement,
    input: AskBoxInput,
    frame: HTMLElement,
  ): DrawnPart<PracticePane>;
}

// The interviewer pane beside the problem column, in the workspace's side
// slot: the open attempt's interviewer chat view, mounted with `mountChat`,
// or the ask box while the attempt has none. It starts hidden; `toggle` shows
// it, asking `interviewerOf` and giving it the keys, or hides it. The mount is
// keyed on the pair (slug, attempt id) `problemOpened` names: the same pair
// keeps the mount and the ask box's text, another drops both. `send` starts the
// interviewer with the ask box's text and mounts its chat view. While the pane
// holds the keys the view's focus is `interviewer`; `columnTookKeys` hears it
// leave, and `modeHidden` gives the keys back to the column as Practice hides.
// `outerPanes` moves Alt+h from the pane to the column and Alt+l from the
// column into the shown pane.
export interface InterviewerPane extends Disposable {
  element: HTMLElement;
  isShown(): boolean;
  toggle(): void;
  problemOpened(slug: string, attemptId: string): void;
  send(): void;
  leaveBox(): void;
  columnTookKeys(): void;
  modeHidden(): void;
  outerPanes: OuterPanes;
  redraw(): void;
}

// The open problem and attempt; a new object on each change, so an answer
// can tell whether its pair is still open.
interface Pair {
  slug: string;
  attemptId: string;
}

interface AskBox {
  frame: HTMLElement;
  editor: TextEditor;
  sendHint: Disposable;
  draw: DrawnPart<PracticePane> | null;
}

export function createInterviewerPane(
  deps: InterviewerPaneDeps,
): InterviewerPane {
  const { log } = deps;
  const body = element('div', 'practice-interviewer');
  body.tabIndex = -1;

  let pair: Pair | null = null;
  let isPaneShown = false;
  let hasKeys = false;
  // The pane opened and takes the keys once its answer lands.
  let takesKeysOnAnswer = false;
  let isSending = false;
  let mount: ChatMount | null = null;
  let askBox: AskBox | null = null;

  // Draws the ask box's part again, keeping the focus in its frame.
  const drawAskBox = (box: AskBox) => {
    keepingFocusAndScroll(body, [], () => {
      box.draw?.dispose();
      box.draw?.built.element.remove();
      box.draw = deps.drawAskBox(
        body,
        { problemTitle: deps.problemTitle(), hint: ASK_HINT },
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
    deps.setResizeTarget(deps.workspace.sideResizeTarget);
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
    deps.view.setFocus('interviewer');
    hasKeys = true;
    holdKeys(movesFocus);
    log('interviewer focused');
  };

  const showAskBox = (slug: string) => {
    const frame = inputFrame();
    frame.classList.add('practice-ask-box');
    const sendAnchor = element('span', 'practice-ask-send');
    const box: AskBox = {
      frame,
      // A click in the box while the column holds the keys gives them to the
      // pane.
      editor: deps.editor.create(frame, '', {
        changed: () => undefined,
        focused() {
          if (isPaneShown && !hasKeys) {
            takeKeys(false);
          }
        },
        blurred: () => undefined,
        modeChanged: () => undefined,
      }),
      sendHint: deps.keys.anchor(sendAnchor, qualify('practice', 'askSend'), {
        scope: 'practice.ask',
        where: 'box',
        label: 'send',
      }),
      draw: null,
    };
    frame.append(boxHint('practice-ask-keys', [sendAnchor]));
    askBox = box;
    drawAskBox(box);
    log(`ask box shown for ${slug}`);
  };

  const mountSession = (slug: string, sessionId: string) => {
    try {
      mount = deps.mountChat(body, sessionId);
    } catch (error) {
      log(`interviewer not mounted ${slug}: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
      return;
    }
    log(`interviewer mounted ${slug}`);
  };

  // Shows the answer to `interviewerOf` for the open pair: its chat view, or
  // the ask box for none; a shown one stays.
  const showAnswer = (asked: Pair, sessionId: string | null) => {
    if (sessionId === null) {
      if (askBox === null && mount === null) {
        showAskBox(asked.slug);
      }
    } else if (mount === null) {
      destroyAskBox();
      mountSession(asked.slug, sessionId);
    }
    if (takesKeysOnAnswer) {
      takesKeysOnAnswer = false;
      takeKeys(true);
    } else if (hasKeys) {
      holdKeys(true);
    }
  };

  // An answer for a pair no longer open is dropped.
  const askInterviewerOf = () => {
    const asked = pair;
    if (asked === null) {
      return;
    }
    deps.channel.invoke('interviewerOf', asked.slug).then(
      (sessionId) => {
        if (asked === pair) {
          showAnswer(asked, sessionId);
        }
      },
      (error: unknown) => {
        if (asked === pair) {
          takesKeysOnAnswer = false;
          log(`interviewer not read ${asked.slug}: ${errorText(error)}`);
          deps.toast(errorText(error), 'error');
        }
      },
    );
  };

  const open = () => {
    if (pair === null) {
      deps.toast('Open a problem first', 'info');
      log('interviewer needs an open problem');
      return;
    }
    isPaneShown = true;
    deps.workspace.setSidePaneShown(true);
    log('interviewer pane shown');
    if (mount !== null) {
      takeKeys(true);
      return;
    }
    takesKeysOnAnswer = true;
    askInterviewerOf();
  };

  const hide = () => {
    takesKeysOnAnswer = false;
    if (hasKeys) {
      deps.view.focusColumn();
    }
    isPaneShown = false;
    deps.workspace.setSidePaneShown(false);
    log('interviewer pane hidden');
  };

  const outerPanes: OuterPanes = {
    focus: {
      move(direction) {
        if (direction === 'left' && deps.focus() === 'interviewer') {
          deps.view.focusColumn();
          return true;
        }
        if (direction === 'right' && deps.focus() === 'main' && isPaneShown) {
          takeKeys(true);
          return true;
        }
        return false;
      },
    },
    resize: deps.workspace.sideResizeTarget,
  };

  return {
    element: body,
    isShown: () => isPaneShown,
    toggle() {
      if (isPaneShown) {
        hide();
      } else {
        open();
      }
    },
    problemOpened(slug, attemptId) {
      if (pair?.slug === slug && pair.attemptId === attemptId) {
        return;
      }
      dropMount();
      destroyAskBox();
      isSending = false;
      pair = { slug, attemptId };
      if (isPaneShown) {
        askInterviewerOf();
      }
    },
    send() {
      const box = askBox;
      const asked = pair;
      if (box === null || asked === null) {
        return;
      }
      if (isSending) {
        log('ask ignored: sending');
        return;
      }
      const text = box.editor.text().trim();
      if (text === '') {
        log('ask ignored: empty');
        return;
      }
      isSending = true;
      deps.channel.invoke('askInterviewer', asked.slug, text).then(
        (sessionId) => {
          if (asked !== pair) {
            return;
          }
          isSending = false;
          destroyAskBox();
          if (mount === null) {
            mountSession(asked.slug, sessionId);
          }
          if (hasKeys) {
            holdKeys(true);
          }
        },
        (error: unknown) => {
          if (asked !== pair) {
            return;
          }
          isSending = false;
          deps.toast(
            `Could not start the interviewer: ${errorText(error)}`,
            'error',
          );
          log(`ask failed: ${errorText(error)}`);
        },
      );
    },
    leaveBox: () => deps.view.focusColumn(),
    columnTookKeys() {
      if (!hasKeys) {
        return;
      }
      hasKeys = false;
      mount?.hidden();
      log('interviewer left');
    },
    modeHidden() {
      takesKeysOnAnswer = false;
      if (deps.focus() === 'interviewer') {
        deps.view.setFocus('main');
      }
    },
    outerPanes,
    redraw() {
      if (askBox !== null) {
        drawAskBox(askBox);
      }
    },
    // An answer landing after the dispose finds no open pair.
    dispose() {
      pair = null;
      dropMount();
      destroyAskBox();
    },
  };
}
