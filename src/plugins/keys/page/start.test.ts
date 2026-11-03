import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Keymap } from '../../../contracts/keymap';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { PLACEMENT_CHECK_EVENT } from '../../../shared/placement-check';
import {
  type PagePartHarness,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import type { KeysPageExports } from '../contract';
import type { keysManifest } from '../manifest';
import { keysPagePart } from './start';

const KEYMAP: Keymap = {
  editor: { leader: ' ', remaps: [], binds: [] },
  page: [],
  app: [],
  intercept: [],
  global: [],
  groups: {},
};

type KeysHarness = PagePartHarness<typeof keysManifest>;

describe('keys page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stops with nothing live and starts again', async () => {
    const harness = startPagePart(keysPagePart);

    await harness.stop();
    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });

    await harness.restart();
    await harness.stop();
  });

  it('stop removes the placement-check listener', async () => {
    const harness = startPagePart(keysPagePart);
    // The harness stubs its own `document` as it starts, so the spies go on that
    // one and the restart is the start they watch.
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    await harness.restart();
    const listener = added.mock.calls.find(
      ([type]) => type === PLACEMENT_CHECK_EVENT,
    )?.[1];
    removed.mockClear();

    await harness.stop();

    expect(listener).toBeDefined();
    expect(removed).toHaveBeenCalledWith(PLACEMENT_CHECK_EVENT, listener);
  });

  it.each<{
    member: string;
    // Registers through `view`; the result tells whether that is still live.
    register(view: KeysPageExports, harness: KeysHarness): () => boolean;
  }>([
    {
      member: 'anchor',
      register(view) {
        const span = new FakeElement('span');
        view.anchor(asHtml(span), 'keys.toggleHelp');
        return () => span.classList.contains('ui-key-anchor');
      },
    },
    {
      member: 'onChanged',
      register(view, harness) {
        const heard = vi.fn();
        view.onChanged(heard);
        return () => {
          heard.mockClear();
          harness.pushKeymap(KEYMAP);
          return heard.mock.calls.length === 1;
        };
      },
    },
  ])(
    "a dependent's handle ends when the dependent stops ($member)",
    async ({ register }) => {
      const harness = startPagePart(keysPagePart);
      const dependent = createRegistrations();
      const view = harness.started().exports?.(dependent) as KeysPageExports;
      const isLive = register(view, harness);
      expect(isLive()).toBe(true);

      dependent.dispose();

      expect(isLive()).toBe(false);
      await harness.stop();
    },
  );
});
