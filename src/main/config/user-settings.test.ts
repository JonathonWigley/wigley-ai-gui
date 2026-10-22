import { describe, expect, it } from 'vitest';
import type { Settings } from '../../contracts/settings';
import { mergeUserSettings, type SettingsSchema } from './user-settings';

const CORE_DEFAULTS = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'base',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
  claude: { command: 'claude' },
} as Settings;

const SCHEMA: SettingsSchema = {
  defaults: CORE_DEFAULTS,
  pluginDefaults: {
    p: {
      timeoutMs: null,
      profiles: [{ name: 'work', dir: '~/a', paths: ['x'] }],
      anything: [],
    },
  },
  optionalSettings: { 'p.timeoutMs': 'number' },
  settingChoices: {},
};

function pluginSettings(text: string): object {
  return mergeUserSettings(text, SCHEMA).pluginSettings.p;
}

describe('mergeUserSettings', () => {
  it('a null-default setting takes its declared kind', () => {
    expect(pluginSettings('{"p":{"timeoutMs":250}}')).toMatchObject({
      timeoutMs: 250,
    });
  });

  it('a null-default setting takes null', () => {
    expect(pluginSettings('{"p":{"timeoutMs":null}}')).toMatchObject({
      timeoutMs: null,
    });
  });

  it('a null-default setting rejects a kind other than its declared one', () => {
    expect(() => pluginSettings('{"p":{"timeoutMs":"fast"}}')).toThrow(
      '"p.timeoutMs" must be a number or null, not a string.',
    );
  });

  it('a null-default setting with no declared kind is a problem', () => {
    const schema = { ...SCHEMA, optionalSettings: {} };

    expect(() => mergeUserSettings('{"p":{"timeoutMs":5}}', schema)).toThrow(
      '"p.timeoutMs" defaults to null and declares no kind.',
    );
  });

  it('an array element of another kind than the default first element is a problem', () => {
    expect(() => pluginSettings('{"p":{"profiles":[1]}}')).toThrow(
      '"p.profiles[0]" must be an object, not a number.',
    );
  });

  it('an object element names the nested key whose kind is wrong', () => {
    const text =
      '{"p":{"profiles":[{"name":"a","dir":"b"},{"name":"c","paths":[3]}]}}';

    expect(() => pluginSettings(text)).toThrow(
      '"p.profiles[1].paths[0]" must be a string, not a number.',
    );
  });

  it('an object element with a key the default element lacks is a problem', () => {
    expect(() => pluginSettings('{"p":{"profiles":[{"nmae":"a"}]}}')).toThrow(
      '"p.profiles[0].nmae" is not a setting.',
    );
  });

  it('matching elements replace the default array whole, unmerged', () => {
    const settings = pluginSettings('{"p":{"profiles":[{"name":"home"}]}}');

    expect((settings as { profiles: unknown }).profiles).toEqual([
      { name: 'home' },
    ]);
  });

  it('an empty default array takes elements of any kind', () => {
    expect(pluginSettings('{"p":{"anything":[1,"a",{}]}}')).toMatchObject({
      anything: [1, 'a', {}],
    });
  });
});
