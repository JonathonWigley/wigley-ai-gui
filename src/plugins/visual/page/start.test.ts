import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../../../contracts/plugin';
import { fakeVisualFrames } from '../../../shared/page/fake-visual-frames';
import {
  asFake,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  fakeDependency,
  noCounts,
  probePart,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { chatFocusSlot } from '../../chat/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import { visualPagePart } from './start';

// The part on the harness, over fake frames and a `chat.focus` naming `entry`,
// marked as chat marks it inside its tab, with the harness's own markdown, which
// records the fence as the page API does, and a sessions page whose `activate`
// does nothing. `runs` holds each page command run, with its arg.
function startOnHarness() {
  const { frames, opened } = fakeVisualFrames();
  const tab = new FakeElement('div');
  tab.dataset.chatSession = 's1';
  const entry = new FakeElement('li');
  entry.dataset.chatEntry = 'e1';
  tab.append(entry);
  const runs: [string, unknown][] = [];
  const harness = startPagePart(visualPagePart, {
    services: { visualFrames: frames },
    parts: [probePart(runs)],
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        () => ({ activate: () => undefined }) as unknown as SessionsPageExports,
      ),
    ],
  });
  harness.state
    .publish(chatFocusSlot)
    .set({ sessionId: 's1', entryId: 'e1', block: null });
  return { harness, opened, entry, runs };
}

type Started = ReturnType<typeof startOnHarness>;

// Mounts a closed visual in the focused entry, and returns its element.
function mountVisual({ harness, entry }: Started, source = '<p>one</p>') {
  const view = harness.fences[0].mount(source, true);
  entry.append(asFake(view.element));
  return asFake(view.element);
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

    expect(started.harness.counts()).toEqual(noCounts);
    expect(started.harness.fences).toEqual([]);
    expect(started.opened.map((frame) => frame.disposed)).toEqual(opened);
  });

  it('expandClick_RunsVisualExpandAndOpensOverlayOnSource', async () => {
    const started = startOnHarness();
    mountVisual(started, '<p>one</p>');
    const second = mountVisual(started, '<p>two</p>');

    second
      .querySelectorAll('.ui-icon-button')
      .find((button) => button.title === 'Expand')
      ?.click();

    await vi.waitFor(() =>
      expect(started.runs).toEqual([['visual.expand', '<p>two</p>']]),
    );
    expect(started.harness.emitted).toContainEqual({
      event: 'visual.visualOpened',
      data: { count: 1, index: 0 },
    });
    expect(started.opened.at(-1)?.source).toBe('<p>two</p>');
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startOnHarness();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
    expect(harness.fences).toHaveLength(1);
  });
});
