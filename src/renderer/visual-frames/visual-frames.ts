import type { Log } from '../../contracts/log';
import type { VisualFrame, VisualFrames } from '../../contracts/visual-frames';
import { errorText } from '../../shared/error-text';
import {
  VISUAL_MESSAGES,
  type VisualTheme,
  type VisualThemeMessage,
} from '../../shared/visual-messages';
import { visualHashOf } from '../../shared/visual-url';
import './visual-frames.css';

// `serveVisual` is the Bridge's; `messages` is the page's window, where each
// frame's messages arrive; `focusPage` moves keyboard focus out of a frame
// whose visual reported Esc, to the page's own document; `log` is the page log.
export interface VisualFramesDeps {
  serveVisual(source: string): Promise<string>;
  messages: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  focusPage(from: HTMLIFrameElement): void;
  log: Log;
}

// `themeApplied` hands every open frame, and each frame on its later loads,
// the theme the page's theme applier just wrote.
export interface LiveVisualFrames extends VisualFrames {
  themeApplied(theme: VisualTheme): void;
}

export function createVisualFrames(deps: VisualFramesDeps): LiveVisualFrames {
  let latest: VisualTheme | null = null;
  const open = new Set<HTMLIFrameElement>();

  return {
    themeApplied(theme) {
      latest = theme;
      for (const iframe of open) {
        postTheme(iframe, theme);
      }
    },
    open(source): VisualFrame {
      const element = document.createElement('div');
      element.className = 'visual-frame';
      const iframe = document.createElement('iframe');
      iframe.className = 'visual-frame-document';
      iframe.setAttribute('sandbox', 'allow-scripts');
      element.append(iframe);

      let url: string | null = null;
      let isDisposed = false;
      iframe.addEventListener('load', () => {
        if (url === null) {
          return;
        }
        const hash = visualHashOf(url) ?? '';
        deps.log('visual', `visual frame loaded: ${hash.slice(0, 8)}`);
        if (latest !== null) {
          postTheme(iframe, latest);
        }
      });
      const onMessage = (event: MessageEvent) => {
        const frameWindow = iframe.contentWindow;
        const isFromThisFrame =
          frameWindow !== null && event.source === frameWindow;
        const isObject = typeof event.data === 'object' && event.data !== null;
        if (isFromThisFrame && isObject) {
          takeMessage(iframe, event.data as Record<string, unknown>, deps);
        }
      };
      deps.messages.addEventListener('message', onMessage);
      open.add(iframe);
      deps.serveVisual(source).then(
        (served) => {
          if (!isDisposed) {
            url = served;
            iframe.setAttribute('src', served);
          }
        },
        (error: unknown) => {
          if (!isDisposed) {
            deps.log('visual', `visual not served: ${errorText(error)}`);
            iframe.replaceWith(sourceAsCode(source));
          }
        },
      );

      return {
        element,
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          deps.messages.removeEventListener('message', onMessage);
          open.delete(iframe);
          element.remove();
        },
      };
    },
  };
}

// The target is `'*'`: the frame's origin is opaque. A detached iframe has no
// `contentWindow`.
function postTheme(iframe: HTMLIFrameElement, theme: VisualTheme) {
  const message: VisualThemeMessage = {
    type: VISUAL_MESSAGES.theme,
    properties: theme.properties,
    colorScheme: theme.colorScheme,
  };
  iframe.contentWindow?.postMessage(message, '*');
}

// The frame runs the agent's code, so a height that is not a finite,
// non-negative number is ignored.
function takeMessage(
  iframe: HTMLIFrameElement,
  data: Record<string, unknown>,
  deps: Pick<VisualFramesDeps, 'focusPage'>,
) {
  if (data.type === VISUAL_MESSAGES.height) {
    const { height } = data;
    const isHeight =
      typeof height === 'number' && Number.isFinite(height) && height >= 0;
    if (isHeight) {
      iframe.style.setProperty('--visual-frame-height', String(height));
    }
  } else if (data.type === VISUAL_MESSAGES.escape) {
    deps.focusPage(iframe);
  }
}

// The source main did not serve, as the code block it was.
function sourceAsCode(source: string): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'visual-frame-source';
  const code = document.createElement('code');
  code.textContent = source;
  pre.append(code);
  return pre;
}
