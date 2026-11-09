import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListPicker } from '../../contracts/list-picker';
import type { PagePart } from '../../contracts/plugin';
import { definePlugin } from '../define-plugin';
import { startPagePart } from '../plugin-part-harness.test-support';
import { fakeListPickerService } from './fake-list-picker-service.test-support';
import { installFakeDom } from './test-dom';

const manifest = definePlugin({
  id: 'sample',
  label: 'sample',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: { list: 'In a list' },
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

afterEach(() => vi.unstubAllGlobals());

describe('harness', () => {
  it('picker_ScopeFunctionTurnsToOneTheManifestLacks_ThrowsAtOpen', () => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
    let scope = 'list';
    let picker!: ListPicker;
    const service = fakeListPickerService();
    const part: PagePart<typeof manifest> = {
      manifest,
      start(api) {
        picker = api.services.picker.create({ scope: () => scope });
        return { commands: {} };
      },
    };
    startPagePart(part, { services: { picker: service } });

    scope = 'nope';

    expect(() =>
      picker.open({
        title: 'Pick',
        items: [],
        label: () => '',
        chosen() {},
      }),
    ).toThrow('declares no scope');
    expect(service.scopes).toEqual([]);
  });
});
