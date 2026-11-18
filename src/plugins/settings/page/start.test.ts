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
import {
  asFake,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import type { SettingControlKind, SettingsPageExports } from '../contract';
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
          control: { kind: 'string', choices: null },
          fallback: { value: '' },
        },
      ],
    },
  ],
  commands: {},
  scopes: [],
  defaultBindLayers: [],
  defaultAccelerators: { app: [], global: [], intercept: [] },
  defaultGroups: {},
  defaultLeader: '<Space>',
};

const EMPTY_READ: UserConfigRead = {
  settings: { state: 'ok', layer: null, text: null },
  keymap: { state: 'ok', layer: null, text: null },
  themes: [],
  layoutNames: {},
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// One section `p` holding a list leaf of kind `p-list`, which no built-in is.
const LIST_SCHEMA: UserConfigSchema = {
  ...SCHEMA,
  sections: [
    {
      id: 'p',
      title: 'P',
      leaves: [
        {
          path: 'p.list',
          label: 'List',
          description: 'A list',
          control: { kind: 'p-list', choices: null },
          fallback: { value: ['a'] },
        },
      ],
    },
  ],
};

const LIST_KIND: SettingControlKind = {
  id: 'p-list',
  text: () => 'drawn',
  edit: { type: 'picker', items: () => [], label: String },
};

// The part's exports for a consumer, as the host hands them to a dependent.
function exportsOf(harness: ReturnType<typeof startPagePart>) {
  return harness.started().exports as (
    consumer: ReturnType<typeof createRegistrations>,
  ) => SettingsPageExports;
}

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

  it('a load rejecting after stop logs and toasts nothing', async () => {
    let fail: (error: Error) => void = () => undefined;
    const harness = startPagePart(settingsPagePart, {
      firstModeTaken: true,
      invoke: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      services: {
        markdown: PLAIN_MARKDOWN,
        fuzzy: fakeFuzzyMatcher,
        picker: fakeListPickerService(),
      },
    });
    await settle();
    await harness.stop();
    const linesBefore = harness.logs.map((line) => line.message);

    fail(new Error('late'));
    await settle();

    expect(harness.logs.map((line) => line.message)).toEqual(linesBefore);
  });

  it('recording_ModeHidden_DisposesTheCapture', async () => {
    const harness = startPagePart(settingsPagePart, {
      firstModeTaken: true,
      invoke: async (method) => (method === 'schema' ? SCHEMA : EMPTY_READ),
      services: {
        markdown: PLAIN_MARKDOWN,
        fuzzy: fakeFuzzyMatcher,
        picker: fakeListPickerService(),
      },
    });
    await settle();
    const mode = harness.mode('settings.main');
    const { commands } = harness.started();
    mode.shown?.();
    // Sections p, Plugins, then Keybindings.
    commands.openSectionAt({ arg: 2 } as PageCommandContext<number>);
    mode.focusMain?.();
    commands.findByKey({} as PageCommandContext);
    expect(harness.isCapturing()).toBe(true);

    mode.hidden?.();

    expect(harness.isCapturing()).toBe(false);
    expect(() => harness.pressCapture('j')).toThrow('no key capture is armed');
    await harness.stop();
  });

  it('exports_AddControlKind_DrawsWithItUntilTheConsumerStops', async () => {
    const harness = startPagePart(settingsPagePart, {
      firstModeTaken: true,
      invoke: async (method) =>
        method === 'schema' ? LIST_SCHEMA : EMPTY_READ,
      services: {
        markdown: PLAIN_MARKDOWN,
        fuzzy: fakeFuzzyMatcher,
        picker: fakeListPickerService(),
      },
    });
    await settle();
    harness.mode('settings.main').shown?.();
    const values = () =>
      findAll(
        asFake(harness.mode('settings.main').element),
        'settings-row-value',
      ).map((value) => value.textContent);
    const consumer = createRegistrations();
    const valuesBefore = values();

    exportsOf(harness)(consumer).addControlKind(LIST_KIND);
    const valuesAdded = values();
    consumer.dispose();

    expect([valuesBefore, valuesAdded, values()]).toEqual([
      ['["a"]'],
      ['drawn'],
      ['["a"]'],
    ]);
    await harness.stop();
  });

  it('exports_AddControlKind_HeldId_Throws', async () => {
    const harness = startPagePart(settingsPagePart, {
      firstModeTaken: true,
      services: { picker: fakeListPickerService() },
    });

    expect(() =>
      exportsOf(harness)(createRegistrations()).addControlKind({
        ...LIST_KIND,
        id: 'number',
      }),
    ).toThrow('control kind number is already registered');
    await harness.stop();
  });
});
