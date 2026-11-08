import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatImage } from '../../../contracts/agent';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import { installFakeDom } from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout, ImageViewerInput } from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { createImageViewer, type ImageRemoval } from './image-viewer';

const red: ChatImage = { mediaType: 'image/png', data: 'cmVk' };
const green: ChatImage = { mediaType: 'image/png', data: 'Z3JlZW4=' };
const blue: ChatImage = { mediaType: 'image/png', data: 'Ymx1ZQ==' };

// The viewer over a layout whose image viewer records each input it draws or
// updates with in `drawn`; the log records each line in `logs`.
function viewerSetup() {
  const logs: string[] = [];
  const drawn: ImageViewerInput[] = [];
  const log = (line: string) => logs.push(line);
  const noEvent = () => undefined;
  const layouts = createChatLayouts(log);
  layouts.set(
    withUser<ChatLayout>(
      defaultLayout,
      {
        imageViewer(parent, input) {
          drawn.push(input);
          const frame = document.createElement('div');
          parent.append(frame);
          return { element: frame, update: (next) => drawn.push(next) };
        },
      },
      'recording',
    ),
  );
  const viewer = createImageViewer({
    layouts,
    markdown: {},
    keys: { anchor: () => ({ dispose: noEvent }), keysFor: () => null },
    commands: { exists: () => true, argShape: () => undefined, run: noEvent },
    platform: 'macos',
    state: {},
    log,
    overlay: { contribute: () => ({ dispose: noEvent }) },
    pushScope: () => ({
      pop: noEvent,
      dispose: noEvent,
      onBaseChanged: () => ({ dispose: noEvent }),
    }),
  } as unknown as Parameters<typeof createImageViewer>[0]);
  return { viewer, logs, drawn };
}

// A removal over `images` that records each index it is asked to remove and
// tells its listeners of each change, as the attachments do; `change` is a
// change made elsewhere, and `listening` counts the listeners held.
function removalOver(images: ChatImage[]) {
  const held = [...images];
  const calls: number[] = [];
  const listeners = new Set<() => void>();
  const change = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const removal: ImageRemoval = {
    remove(index) {
      calls.push(index);
      held.splice(index, 1);
      change();
      return [...held];
    },
    onChanged(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  return { removal, calls, change, listening: () => listeners.size };
}

describe('createImageViewer', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      given: 'the middle of three shows the next at the same index',
      images: [red, green, blue],
      index: 1,
      removable: true,
      opens: true,
      calls: [1],
      logs: ['removed attached image 2 of 3', 'image viewer showing 2 of 2'],
      last: { index: 1, count: 2, removable: true },
    },
    {
      given: 'the last of two shows the previous',
      images: [red, green],
      index: 1,
      removable: true,
      opens: true,
      calls: [1],
      logs: ['removed attached image 2 of 2', 'image viewer showing 1 of 1'],
      last: { index: 0, count: 1, removable: true },
    },
    {
      given: 'the last of one closes',
      images: [red],
      index: 0,
      removable: true,
      opens: true,
      calls: [0],
      logs: ['removed attached image 1 of 1', 'image viewer closed'],
      last: { index: 0, count: 1, removable: true },
    },
    {
      given: 'no removal keeps the image',
      images: [red, green],
      index: 1,
      removable: false,
      opens: true,
      calls: [],
      logs: ['sent images cannot be removed'],
      last: { index: 1, count: 2, removable: false },
    },
    {
      given: 'a closed viewer removes nothing',
      images: [red, green],
      index: 0,
      removable: true,
      opens: false,
      calls: [],
      logs: [],
      last: null,
    },
  ])(
    'removeShown_$given',
    ({ images, index, removable, opens, calls, logs, last }) => {
      const setup = viewerSetup();
      const { removal, calls: removed } = removalOver(images);
      if (opens) {
        setup.viewer.open(images, index, removable ? removal : undefined);
      }
      const logsBefore = setup.logs.length;

      setup.viewer.removeShown();

      expect(removed).toEqual(calls);
      expect(setup.logs.slice(logsBefore)).toEqual(logs);
      const shown = setup.drawn.at(-1);
      expect(
        shown === undefined
          ? null
          : {
              index: shown.index,
              count: shown.count,
              removable: shown.removable,
            },
      ).toEqual(last);
    },
  );

  // Breaks: the viewer ignoring an outside change, so `x` removes by a stale
  // index; the viewer closing on its own removal; the watch left after close.
  it('removalChange_MadeElsewhere_ClosesAndStopsListening', () => {
    const setup = viewerSetup();
    const { removal, calls, change, listening } = removalOver([red, green]);
    setup.viewer.open([red, green], 1, removal);
    const logsBefore = setup.logs.length;

    change();
    setup.viewer.removeShown();

    expect(setup.logs.slice(logsBefore)).toEqual(['image viewer closed']);
    expect(calls).toEqual([]);
    expect(listening()).toBe(0);
  });
});
