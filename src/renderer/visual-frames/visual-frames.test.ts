import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualFrame } from '../../contracts/visual-frames';
import {
  asFake,
  type FakeElement,
  installFakeDom,
} from '../../shared/page/test-dom';
import type { VisualTheme } from '../../shared/visual-messages';
import { createVisualFrames } from './visual-frames';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let turn = 0; turn < 5; turn++) {
    await Promise.resolve();
  }
}

type MessageListener = (event: { source: unknown; data: unknown }) => void;

// The service over recording deps: `serves` holds each `serveVisual` answer
// for the test to settle, and `listeners` the `message` listeners held on the
// page window.
function setup() {
  const serves: ReturnType<typeof deferred<string>>[] = [];
  const listeners: MessageListener[] = [];
  const serveVisual = vi.fn((_source: string) => {
    const serve = deferred<string>();
    serves.push(serve);
    return serve.promise;
  });
  const messages = {
    addEventListener: (_type: string, listener: MessageListener) => {
      listeners.push(listener);
    },
    removeEventListener: (_type: string, listener: MessageListener) => {
      listeners.splice(listeners.indexOf(listener), 1);
    },
  } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
  const focusPage = vi.fn();
  const log = vi.fn();
  const frames = createVisualFrames({ serveVisual, messages, focusPage, log });
  const send = (source: unknown, data: unknown) => {
    for (const listener of listeners) {
      listener({ source, data });
    }
  };
  return { frames, serveVisual, serves, listeners, focusPage, log, send };
}

function iframeOf(frame: VisualFrame): FakeElement {
  return asFake(frame.element).childNodes[0];
}

function frameWindow() {
  return { postMessage: vi.fn() };
}

function setContentWindow(iframe: FakeElement, window: unknown) {
  (iframe as unknown as { contentWindow: unknown }).contentWindow = window;
}

const URL_A = 'wigley-visual://visual/' + 'ab'.repeat(32);
const URL_B = 'wigley-visual://visual/' + 'cd'.repeat(32);

const A: VisualTheme = {
  properties: [['--wg-fg', '#111111']],
  colorScheme: 'dark',
};
const B: VisualTheme = {
  properties: [['--wg-fg', '#eeeeee']],
  colorScheme: 'light',
};

describe('createVisualFrames', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a sandboxed frame on the URL main serves for the source', async () => {
    const { frames, serveVisual, serves } = setup();

    const frame = frames.open('<p>a</p>');

    expect(serveVisual).toHaveBeenCalledWith('<p>a</p>');
    const element = asFake(frame.element);
    expect(element.tagName).toBe('DIV');
    expect(element.className).toBe('visual-frame');
    expect(element.childNodes).toHaveLength(1);
    const iframe = iframeOf(frame);
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.className).toBe('visual-frame-document');
    expect(iframe.attributes.get('sandbox')).toBe('allow-scripts');
    expect(iframe.attributes.has('src')).toBe(false);

    serves[0].resolve(URL_A);
    await flush();

    expect(iframe.attributes.get('src')).toBe(URL_A);
  });

  it('shows the source as code when main does not serve it', async () => {
    const { frames, serves, log } = setup();
    const frame = frames.open('<p>a</p>');

    serves[0].reject(new Error('boom'));
    await flush();

    expect(log).toHaveBeenCalledWith('visual', 'visual not served: boom');
    const children = asFake(frame.element).childNodes;
    expect(children).toHaveLength(1);
    const [pre] = children;
    expect(pre.tagName).toBe('PRE');
    expect(pre.className).toBe('visual-frame-source');
    expect(pre.childNodes[0].tagName).toBe('CODE');
    expect(pre.childNodes[0].textContent).toBe('<p>a</p>');
  });

  it('logs each load and posts the latest theme on it and on every theme change', async () => {
    const { frames, serves, log } = setup();
    const frame = frames.open('<p>a</p>');
    const iframe = iframeOf(frame);
    const window = frameWindow();
    setContentWindow(iframe, window);

    iframe.fire('load');

    expect(window.postMessage).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();

    serves[0].resolve(URL_A);
    await flush();
    iframe.fire('load');

    expect(log).toHaveBeenCalledWith('visual', 'visual frame loaded: abababab');
    expect(window.postMessage).not.toHaveBeenCalled();

    frames.themeApplied(A);

    expect(window.postMessage.mock.calls).toEqual([
      [{ type: 'wigley-visual:theme', ...A }, '*'],
    ]);

    iframe.fire('load');

    expect(window.postMessage.mock.calls).toEqual([
      [{ type: 'wigley-visual:theme', ...A }, '*'],
      [{ type: 'wigley-visual:theme', ...A }, '*'],
    ]);
    expect(log).toHaveBeenCalledTimes(2);

    frames.themeApplied(B);

    expect(window.postMessage.mock.calls.at(-1)).toEqual([
      { type: 'wigley-visual:theme', ...B },
      '*',
    ]);

    const late = frames.open('<p>b</p>');
    const lateIframe = iframeOf(late);
    const lateWindow = frameWindow();
    setContentWindow(lateIframe, lateWindow);
    serves[1].resolve(URL_B);
    await flush();
    lateIframe.fire('load');

    expect(lateWindow.postMessage.mock.calls).toEqual([
      [{ type: 'wigley-visual:theme', ...B }, '*'],
    ]);
  });

  describe('takes height and Esc only from its own frame', () => {
    const height = { type: 'wigley-visual:height', height: 240 };
    const escape = { type: 'wigley-visual:escape' };

    it.each([
      {
        case: 'height from its frame',
        from: 'own',
        data: height,
        height: '240',
        leaves: false,
      },
      {
        case: 'height from another frame',
        from: 'other',
        data: height,
        height: undefined,
        leaves: false,
      },
      {
        case: 'height from a null source to a detached frame',
        from: 'null',
        data: height,
        height: undefined,
        leaves: false,
      },
      {
        case: 'negative height',
        from: 'own',
        data: { type: 'wigley-visual:height', height: -1 },
        height: undefined,
        leaves: false,
      },
      {
        case: 'height as text',
        from: 'own',
        data: { type: 'wigley-visual:height', height: '240' },
        height: undefined,
        leaves: false,
      },
      {
        case: 'infinite height',
        from: 'own',
        data: { type: 'wigley-visual:height', height: Infinity },
        height: undefined,
        leaves: false,
      },
      {
        case: 'Esc from its frame',
        from: 'own',
        data: escape,
        height: undefined,
        leaves: true,
      },
      {
        case: 'Esc from another frame',
        from: 'other',
        data: escape,
        height: undefined,
        leaves: false,
      },
      {
        case: 'Esc from a null source to a detached frame',
        from: 'null',
        data: escape,
        height: undefined,
        leaves: false,
      },
      {
        case: 'not an object',
        from: 'own',
        data: 'wigley-visual:escape',
        height: undefined,
        leaves: false,
      },
    ] as const)('$case', ({ from, data, height, leaves }) => {
      const { frames, focusPage, send } = setup();
      const frame = frames.open('<p>a</p>');
      const iframe = iframeOf(frame);
      const own = frameWindow();
      setContentWindow(iframe, own);

      if (from === 'null') {
        setContentWindow(iframe, null);
      }
      const source = { own, other: frameWindow(), null: null }[from];
      send(source, data);

      expect(iframe.style['--visual-frame-height']).toBe(height);
      expect(focusPage.mock.calls).toEqual(leaves ? [[iframe]] : []);
    });
  });

  it('stops a disposed frame', async () => {
    const { frames, serves, listeners } = setup();
    const frame = frames.open('<p>a</p>');
    const iframe = iframeOf(frame);
    const window = frameWindow();
    setContentWindow(iframe, window);
    const parent = document.createElement('div');
    parent.append(frame.element);

    frame.dispose();

    expect(asFake(frame.element).parentNode).toBeNull();
    expect(listeners).toEqual([]);
    frames.themeApplied(A);
    expect(window.postMessage).not.toHaveBeenCalled();
    serves[0].resolve(URL_A);
    await flush();
    expect(iframe.attributes.has('src')).toBe(false);

    expect(() => frame.dispose()).not.toThrow();
    expect(listeners).toEqual([]);
  });
});
