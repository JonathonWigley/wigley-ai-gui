import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PagePart } from '../../../contracts/plugin';
import { installFakeDom } from '../../../shared/page/test-dom';
import { startPagePart } from '../../../shared/plugin-part-harness.test-support';
import { keysPagePart } from '../../keys/page/start';
import { settingsPagePart } from './start';

// The app's first mode. The first mode added shows at once, and Settings is
// never first in the app.
const firstModePart: PagePart = {
  manifest: {
    id: 'first-mode',
    dependsOn: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
  },
  start(api) {
    api.modes.add({
      id: 'first',
      title: 'First',
      icon: 'first',
      element: document.createElement('div'),
      shown() {},
      hidden() {},
    });
    return { commands: {} };
  },
};

describe('settings page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops with nothing live and starts again', async () => {
    const harness = startPagePart(settingsPagePart, {
      parts: [keysPagePart, firstModePart],
    });

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
});
