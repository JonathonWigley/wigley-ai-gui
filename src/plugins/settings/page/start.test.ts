import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { PageCommandContext, PagePart } from '../../../contracts/plugin';
import type {
  ConfigWriteResult,
  UserConfigRead,
  UserConfigSchema,
} from '../../../contracts/user-config';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
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

const SCHEMA: UserConfigSchema = {
  sections: [
    {
      id: 'p',
      title: 'P',
      leaves: [
        {
          path: 'p.name',
          label: 'Name',
          description: 'A name',
          control: { kind: 'string' },
          fallback: { value: '' },
        },
      ],
    },
  ],
  commands: {},
  scopes: [],
  defaultBindLayers: [],
  defaultAccelerators: { app: [], global: [], intercept: [] },
  defaultLeader: '<Space>',
};

const EMPTY_READ: UserConfigRead = {
  settings: { state: 'ok', layer: null, text: null },
  keymap: { state: 'ok', layer: null, text: null },
  themes: [],
};

const MARKDOWN: MarkdownRenderer = {
  block: (text) => text,
  inline: (text) => text,
  document: async (text) => text,
  ...NO_FENCES,
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settings page part', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
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

  it('a write landing after stop closes the open box with no toast', async () => {
    let land: (result: ConfigWriteResult) => void = () => undefined;
    const harness = startPagePart(settingsPagePart, {
      parts: [keysPagePart, firstModePart],
      invoke: async (method) => {
        if (method === 'schema') {
          return SCHEMA;
        }
        if (method === 'read') {
          return EMPTY_READ;
        }
        return new Promise<ConfigWriteResult>((resolve) => {
          land = resolve;
        });
      },
      services: { markdown: MARKDOWN },
    });
    await settle();
    const { commands } = harness.started();
    commands.edit({} as PageCommandContext);
    await settle();
    const input = document.activeElement as HTMLInputElement;
    input.value = 'typed';
    commands.boxAccept({} as PageCommandContext);
    await settle();

    await harness.stop();
    land({ type: 'written' });
    await settle();

    const lines = harness.logs.map((line) => line.message);
    expect(lines).toContainEqual(expect.stringContaining('box closed'));
    expect(lines.filter((line) => line.startsWith('toast'))).toEqual([]);
  });
});
