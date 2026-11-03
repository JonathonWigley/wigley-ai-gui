import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../../../contracts/plugin';
import { fakeVisualFrames } from '../../../shared/page/fake-visual-frames';
import {
  asFake,
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import { keysPageKey } from '../../keys/contract';
import { visualPagePart } from './start';

// The part on the harness, over fake frames and a chat whose focused entry is
// `entry`, with the harness's own markdown, which records the fence as the page
// API does.
function startOnHarness() {
  const { frames, opened } = fakeVisualFrames();
  const entry = new FakeElement('li');
  const harness = startPagePart(visualPagePart, {
    services: { visualFrames: frames },
    dependencies: [
      fakeDependency(keysPageKey, (consumer) => ({
        keysFor: () => null,
        onChanged: () => consumer.track({ dispose() {} }),
        anchor: () => consumer.track({ dispose() {} }),
      })),
      fakeDependency(
        chatPageKey,
        () =>
          ({ focusedEntry: () => asHtml(entry) }) as unknown as ChatPageExports,
      ),
    ],
  });
  return { harness, opened, entry };
}

type Started = ReturnType<typeof startOnHarness>;

// Mounts a closed visual in the focused entry.
function mountVisual({ harness, entry }: Started) {
  const view = harness.fences[0].mount('<p>one</p>', true);
  entry.append(asFake(view.element));
}

describe('visualPagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'fresh start',
      arrange: () => undefined,
      opened: [],
    },
    {
      name: 'a closed visual mounted',
      arrange: mountVisual,
      opened: [true],
    },
    {
      name: 'the overlay open over a visual',
      arrange(started: Started) {
        mountVisual(started);
        started.harness
          .started()
          .commands.openVisuals({} as PageCommandContext);
      },
      opened: [true, true],
    },
  ])('stop_LeavesNoLiveRegistration $name', async ({ arrange, opened }) => {
    const started = startOnHarness();
    arrange(started);
    expect(started.harness.fences.map((fence) => fence.language)).toEqual([
      'html',
    ]);
    expect(started.harness.counts().registrations).toBeGreaterThan(0);

    await started.harness.stop();

    expect(started.harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });
    expect(started.harness.fences).toEqual([]);
    expect(started.opened.map((frame) => frame.disposed)).toEqual(opened);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startOnHarness();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
    expect(harness.fences).toHaveLength(1);
  });
});
