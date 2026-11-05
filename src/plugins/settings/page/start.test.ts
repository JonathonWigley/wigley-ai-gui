import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../../../contracts/plugin';
import type {
  ConfigWriteResult,
  UserConfigRead,
  UserConfigSchema,
} from '../../../contracts/user-config';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { settingsPagePart } from './start';

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
      firstModeTaken: true,
      services: { picker: fakeListPickerService() },
    });

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    await harness.restart();
    await harness.stop();
  });

  it('a write landing after stop closes the open box with no toast', async () => {
    let land: (result: ConfigWriteResult) => void = () => undefined;
    const harness = startPagePart(settingsPagePart, {
      firstModeTaken: true,
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
      services: {
        markdown: PLAIN_MARKDOWN,
        fuzzy: fakeFuzzyMatcher,
        picker: fakeListPickerService(),
      },
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
