import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
});
