import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import defaultLayout from '../layouts/default/layout.js';
import { galleryPagePart } from './start';

describe('gallery page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops with nothing live and starts again', async () => {
    const harness = startPagePart(galleryPagePart, {});

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    await harness.restart();
    await harness.stop();
  });

  it('stop disconnects every HScroller sample observer', async () => {
    const harness = startPagePart(galleryPagePart, {});
    // The harness stubs `ResizeObserver` as it starts, so this fake goes in after
    // it and watches the samples the new layouts draw.
    const observers: { observed: number; disconnected: number }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly record = { observed: 0, disconnected: 0 };

        constructor() {
          observers.push(this.record);
        }

        observe() {
          this.record.observed += 1;
        }

        unobserve() {}

        disconnect() {
          this.record.disconnected += 1;
        }
      },
    );
    harness.showLayouts({
      layouts: new Map([['default', defaultLayout]]),
      user: 'default',
    } as Parameters<typeof harness.showLayouts>[0]);
    const observing = observers.filter(({ observed }) => observed > 0);
    expect(observing.length).toBeGreaterThan(0);

    await harness.stop();

    expect(observing.filter(({ disconnected }) => disconnected === 0)).toEqual(
      [],
    );
  });

  // The gallery under the harness, and `enter`, which enters its registered
  // `gallery.mode` demo step.
  function startGallery() {
    const demoSteps = createDemoStepRegistry<DemoStep>();
    const harness = startPagePart(galleryPagePart, {
      services: { demoSteps },
    });
    const enter = () => {
      const step = demoSteps.list().find(({ id }) => id === 'gallery.mode');
      if (step === undefined) {
        throw new Error('gallery.mode is not registered');
      }
      return step.enter({ scratchDir: '/scratch', sessions: {} });
    };
    return { harness, enter };
  }

  const lastLog = (harness: ReturnType<typeof startGallery>['harness']) =>
    harness.logs.at(-1)?.message;

  it.each([
    {
      name: 'no swap before',
      swappedBefore: false,
      lineAfter: 'shell layout swapped',
    },
    {
      name: 'the user swapped before',
      swappedBefore: true,
      lineAfter: 'shell layout restored',
    },
  ])(
    'demo stage dispose restores what the stage changed: $name',
    async ({ swappedBefore, lineAfter }) => {
      const { harness, enter } = startGallery();
      const { swapShellLayout, toggleTransparency } =
        harness.started().commands;
      if (swappedBefore) {
        swapShellLayout({ arg: undefined });
      }
      const stage = await enter();

      await stage.beats[1].show();
      await stage.beats[2].show();
      stage.dispose();
      swapShellLayout({ arg: undefined });
      const swapLine = lastLog(harness);
      // From no override the switch sets `reduced`; from the stage's
      // `reduced` left in force it would set `full`.
      toggleTransparency({ arg: undefined });

      expect(swapLine).toBe(lineAfter);
      expect(lastLog(harness)).toBe('transparency reduced');
      await harness.stop();
    },
  );

  it('demoStage_UserSwapsBetweenBeats_TheSwapStays', async () => {
    const { harness, enter } = startGallery();
    const { swapShellLayout } = harness.started().commands;
    const stage = await enter();

    await stage.beats[2].show();
    await stage.beats[0].show();
    swapShellLayout({ arg: undefined });
    stage.dispose();
    swapShellLayout({ arg: undefined });

    expect(lastLog(harness)).toBe('shell layout restored');
    await harness.stop();
  });
});
