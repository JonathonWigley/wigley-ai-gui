import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PagePart, PluginManifest } from '../../../contracts/plugin';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { type KeysPageExports, keysPageKey } from '../../keys/contract';
import { backlogPagePart } from './start';

const DOCS_MANIFEST: PluginManifest = {
  id: 'docs',
  dependsOn: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
};

// A stand-in for docs' part that also adds the first mode, as sessions' part does
// in the app, so Backlog mode is not shown as it is added.
const docsStandIn = {
  manifest: DOCS_MANIFEST,
  start(api) {
    api.modes.add({
      id: 'stand-in',
      title: 'Stand-in',
      icon: 'book',
      element: {} as HTMLElement,
      shown: () => undefined,
      hidden: () => undefined,
    });
    return { commands: {}, exports: () => ({ openDoc: () => undefined }) };
  },
} as PagePart;

function startBacklogPage() {
  installFakeDom(vi.stubGlobal);
  const keys = fakeDependency(keysPageKey, (consumer): KeysPageExports => ({
    keysFor: () => null,
    onChanged: () => consumer.track({ dispose: () => undefined }),
    anchor: () => consumer.track({ dispose: () => undefined }),
  }));
  return startPagePart(backlogPagePart, {
    dependencies: [keys],
    parts: [docsStandIn],
  });
}

describe('backlog page part lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startBacklogPage();
    expect(harness.counts().observers).toBe(1);

    await harness.stop();

    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startBacklogPage();

    await harness.restart();

    expect(harness.started().commands).toHaveProperty('showMode');
  });
});
