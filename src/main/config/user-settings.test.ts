import { describe, expect, it } from 'vitest';
import type { Settings } from '../../contracts/settings';
import { mergeUserSettings, type SettingsSchema } from './user-settings';

const CORE_DEFAULTS = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'base',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
} as Settings;

const SCHEMA: SettingsSchema = {
  defaults: CORE_DEFAULTS,
  pluginDefaults: {
    p: {
      timeoutMs: null,
      profiles: [{ name: 'work', dir: '~/a', paths: ['x'], note: null }],
      anything: [],
    },
  },
  optionalSettings: { 'p.timeoutMs': 'number', 'p.profiles[].note': 'string' },
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
      '{"p":{"profiles":[{"name":"a","dir":"b","paths":[]},{"name":"c","dir":"d","paths":[3]}]}}';

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
    const settings = pluginSettings(
      '{"p":{"profiles":[{"name":"home","dir":"~/h","paths":[]}]}}',
    );

    expect((settings as { profiles: unknown }).profiles).toEqual([
      { name: 'home', dir: '~/h', paths: [] },
    ]);
  });

  it('an object element missing a key the default element has is a problem', () => {
    const text =
      '{"p":{"profiles":[{"name":"a","dir":"b","paths":[]},{"name":"c","paths":[]}]}}';

    expect(() => pluginSettings(text)).toThrow(
      '"p.profiles[1].dir" is missing.',
    );
  });

  it('an object element may leave out a key declared optional', () => {
    const settings = pluginSettings(
      '{"p":{"profiles":[{"name":"a","dir":"b","paths":[],"note":"n"},{"name":"c","dir":"d","paths":[]}]}}',
    );

    expect((settings as { profiles: unknown }).profiles).toEqual([
      { name: 'a', dir: 'b', paths: [], note: 'n' },
      { name: 'c', dir: 'd', paths: [] },
    ]);
  });

  it("a core setting keeps its name when a settingless plugin's id shares it", () => {
    const schema = {
      ...SCHEMA,
      pluginDefaults: { ...SCHEMA.pluginDefaults, window: {} },
    };

    const unset = mergeUserSettings('{}', schema);
    const set = mergeUserSettings('{"window":{"width":1200}}', schema);

    expect(unset.settings.window).toEqual(CORE_DEFAULTS.window);
    expect(set.settings.window).toEqual({
      ...CORE_DEFAULTS.window,
      width: 1200,
    });
    expect(set.pluginSettings.window).toEqual({});
  });

  it.each([
    {
      case: 'object under an absent id',
      text: '{"gone":{"x":1}}',
      ignored: ['gone'],
    },
    { case: 'object under a plugin id', text: '{"p":{}}', ignored: [] },
    { case: 'object under a core name', text: '{"fonts":{}}', ignored: [] },
    {
      case: 'object under an id two edits from a core name',
      text: '{"wind":{}}',
      ignored: ['wind'],
    },
  ])(
    'mergeUserSettings_AbsentPluginSection_Ignored: $case',
    ({ text, ignored }) => {
      expect(mergeUserSettings(text, SCHEMA).ignored).toEqual(ignored);
    },
  );

  it.each([
    { case: 'scalar under an unknown key', text: '{"zz":1}' },
    { case: 'object under a key no id can have', text: '{"Gone":{}}' },
    {
      case: 'object under a core name missing a letter',
      text: '{"windw":{}}',
    },
    {
      case: 'object under a core name with a letter more',
      text: '{"fontss":{}}',
    },
    {
      case: 'object under a core name with a letter changed',
      text: '{"thame":{}}',
    },
    {
      case: 'object under a core name with two letters swapped',
      text: '{"tehme":{}}',
    },
  ])('mergeUserSettings_UnknownKey_IsAProblem: $case', ({ text }) => {
    expect(() => mergeUserSettings(text, SCHEMA)).toThrow('is not a setting.');
  });

  // Breaks when an empty default array stops taking any elements, which rejects
  // a group leaving out `at`, or when `shell` stops merging key by key.
  it.each([
    {
      case: 'only hidden set',
      text: '{"shell":{"activityBar":{"hidden":["docs.docs"]}}}',
      activityBar: { groups: [], hidden: ['docs.docs'] },
    },
    {
      case: 'two groups set',
      text: '{"shell":{"activityBar":{"groups":[{"modes":["sessions.sessions","work-inbox.main"]},{"modes":["settings.settings"],"at":"bottom"}]}}}',
      activityBar: {
        groups: [
          { modes: ['sessions.sessions', 'work-inbox.main'] },
          { modes: ['settings.settings'], at: 'bottom' },
        ],
        hidden: [],
      },
    },
  ])(
    'mergeUserSettings_ActivityBar_MergesOverDefaults: $case',
    ({ text, activityBar }) => {
      const defaults = {
        ...CORE_DEFAULTS,
        shell: { layout: 'base', activityBar: { groups: [], hidden: [] } },
      } as Settings;
      const schema = { ...SCHEMA, defaults };
      expect(mergeUserSettings(text, schema).settings.shell).toEqual({
        layout: 'base',
        activityBar,
      });
    },
  );

  it('an empty default array takes elements of any kind', () => {
    expect(pluginSettings('{"p":{"anything":[1,"a",{}]}}')).toMatchObject({
      anything: [1, 'a', {}],
    });
  });
});
