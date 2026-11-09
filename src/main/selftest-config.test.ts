import { describe, expect, it } from 'vitest';
import type { PageBind } from '../contracts/keymap';
import type {
  CommandInfo,
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../contracts/plugin';
import type { ServedPlugin } from '../contracts/plugin-catalog';
import type { AppConfig } from '../contracts/settings';
import { fakePlatform } from '../shared/platform.test-support';
import {
  applySelfTestConfig,
  checkGroups,
  type HandedScript,
  mergeSelfTestConfigs,
  SELFTEST_FILTER_ENV,
  screenshotFiles,
  selectScripts,
  selfTestFilterOf,
} from './selftest-config';

function handed(
  pluginId: string,
  pageBinds: PageBind[],
  settings: Record<string, object>,
  steps: SelfTestStep[] = [],
): HandedScript {
  return withGroups(pluginId, [{ name: 'all', why: 'every step', steps }], {
    pageBinds,
    settings,
  });
}

function withGroups(
  pluginId: string,
  groups: SelfTestGroup[],
  config: Pick<SelfTestScript, 'pageBinds' | 'settings'> = {
    pageBinds: [],
    settings: {},
  },
): HandedScript {
  const script: SelfTestScript = {
    ...config,
    open: () => ({ shownLine: 'shown', result: Promise.resolve(null) }),
    groups,
    scrollsItself: [],
    problems: () => [],
  };
  return { pluginId, script };
}

describe('mergeSelfTestConfigs', () => {
  it('mergeSelfTestConfigs_TwoScripts_ConcatenatesBindsInHandOverOrder', () => {
    const formsBind: PageBind = {
      keys: ['a'],
      scope: 'forms.review',
      command: 'forms.next',
    };
    const chatBind: PageBind = {
      keys: ['b'],
      scope: 'chat.chat',
      command: 'chat.send',
    };

    const merged = mergeSelfTestConfigs([
      handed('forms', [formsBind], { forms: { previewDelayMs: 5 } }),
      handed('chat', [chatBind], { chat: { profiles: [] } }),
    ]);

    expect(merged).toEqual({
      pageBinds: [formsBind, chatBind],
      settings: { forms: { previewDelayMs: 5 }, chat: { profiles: [] } },
    });
  });

  it('mergeSelfTestConfigs_SameSettingSameValue_Merges', () => {
    const merged = mergeSelfTestConfigs([
      handed('forms', [], { keys: { whichKeyTimeoutMs: 1000 } }),
      handed('chat', [], { keys: { whichKeyTimeoutMs: 1000 } }),
    ]);

    expect(merged.settings).toEqual({ keys: { whichKeyTimeoutMs: 1000 } });
  });

  it('mergeSelfTestConfigs_SameSettingDifferentValues_Throws', () => {
    const merge = () =>
      mergeSelfTestConfigs([
        handed('forms', [], { keys: { whichKeyTimeoutMs: 1000 } }),
        handed('chat', [], { keys: { whichKeyTimeoutMs: 2000 } }),
      ]);

    expect(merge).toThrow(/forms.*chat.*keys\.whichKeyTimeoutMs/);
  });

  it('mergeSelfTestConfigs_NoScripts_IsEmpty', () => {
    expect(mergeSelfTestConfigs([])).toEqual({ pageBinds: [], settings: {} });
  });
});

describe('applySelfTestConfig', () => {
  it.each<{ given: string; command: string; isKept: boolean }>([
    { given: 'a known command', command: 'core.help', isKept: true },
    {
      given: 'an unknown command of a loaded plugin',
      command: 'p.zap',
      isKept: true,
    },
    {
      given: 'a command of a plugin not loaded',
      command: 'gone.hello',
      isKept: false,
    },
  ])(
    "applySelfTestConfig appends page binds and lays settings over the plugins': a script bind to $given",
    ({ command, isKept }) => {
      const userBind: PageBind = {
        keys: ['j'],
        scope: 'any',
        command: 'p.down',
      };
      const scriptBind: PageBind = { keys: ['z'], scope: 'any', command };
      const config: AppConfig = {
        settings: {
          window: { width: 1, height: 1, minWidth: 1, minHeight: 1 },
          theme: 't',
          transparency: 'system',
          fonts: {},
          keySequenceTimeoutMs: 1,
          claude: { command: 'claude' },
          shell: { layout: 'default' },
          plugins: { disabled: ['p'] },
        },
        keymap: {
          editor: { leader: ' ', remaps: [], binds: [] },
          page: [userBind],
          app: [],
          intercept: [],
          global: [],
          groups: {},
        },
        commands: {
          'core.help': { id: 'core.help', plugin: 'core' } as CommandInfo,
        },
        scopes: [],
        pluginSettings: { p: { size: 1, speed: 2 } },
        theme: { name: 't', colorScheme: 'dark', tokens: {}, reduced: {} },
        platform: fakePlatform('macos'),
        homeDir: '/Users/u',
        appInstance: {
          id: 'wigley-ai-gui-dev',
          displayName: 'Auri Dev',
          isDev: true,
        },
        runMode: 'live',
        plugins: [{ id: 'p' } as ServedPlugin],
        problems: [],
      };

      const served = applySelfTestConfig(config, {
        pageBinds: [scriptBind],
        settings: { p: { speed: 9 } },
      });

      expect(served.keymap.page).toEqual(
        isKept ? [userBind, scriptBind] : [userBind],
      );
      expect(served.pluginSettings).toEqual({ p: { size: 1, speed: 9 } });
    },
  );
});

describe('screenshotFiles', () => {
  it('screenshotFiles_NamedStep_MapsToPluginDashName', () => {
    const step: SelfTestStep = {
      keys: ['j'],
      expect: 'x',
      screenshot: 'gallery-full',
    };

    const files = screenshotFiles([handed('forms', [], {}, [step])]);

    expect(files.get(step)).toEqual(['forms-gallery-full.png']);
  });

  it('screenshotFiles_StepWithoutScreenshot_IsAbsent', () => {
    const files = screenshotFiles([
      handed('forms', [], {}, [{ keys: ['j'], expect: 'x' }]),
    ]);

    expect(files.size).toBe(0);
  });

  it.each(['Gallery full', 'gallery-'])(
    'screenshotFiles throws on the screenshot name "%s"',
    (screenshot) => {
      const name = () =>
        screenshotFiles([
          handed('forms', [], {}, [{ keys: ['j'], expect: 'x', screenshot }]),
        ]);

      expect(name).toThrow(`forms names screenshot "${screenshot}"`);
    },
  );

  it('screenshotFiles_SameNameTwiceInOneScript_Throws', () => {
    const name = () =>
      screenshotFiles([
        handed('forms', [], {}, [
          { keys: ['j'], expect: 'x', screenshot: 'round' },
          { keys: ['k'], expect: 'y', screenshot: 'round' },
        ]),
      ]);

    expect(name).toThrow('forms-round.png');
  });

  it('screenshotFiles_DifferentPluginsSameFile_Throws', () => {
    const name = () =>
      screenshotFiles([
        handed('a', [], {}, [{ keys: ['j'], expect: 'x', screenshot: 'b-c' }]),
        handed('a-b', [], {}, [{ keys: ['k'], expect: 'y', screenshot: 'c' }]),
      ]);

    expect(name).toThrow('a-b-c.png');
  });

  it('names a repeating step one file per press, each checked against the others', () => {
    const pages: SelfTestStep = {
      keys: ['n'],
      expect: 'next page',
      repeat: { until: 'last page', max: 3 },
      screenshot: 'pages',
    };

    const files = screenshotFiles([handed('forms', [], {}, [pages])]);
    const clash = () =>
      screenshotFiles([
        handed('forms', [], {}, [
          pages,
          { keys: ['j'], expect: 'x', screenshot: 'pages-2' },
        ]),
      ]);

    expect(files.get(pages)).toEqual([
      'forms-pages-1.png',
      'forms-pages-2.png',
      'forms-pages-3.png',
    ]);
    expect(clash).toThrow('forms-pages-2.png');
  });

  it('walks every group of a script', () => {
    const first: SelfTestStep = { keys: ['j'], expect: 'x', screenshot: 'a' };
    const second: SelfTestStep = { keys: ['k'], expect: 'y', screenshot: 'b' };

    const files = screenshotFiles([
      withGroups('forms', [
        { name: 'one', why: 'first', steps: [first] },
        { name: 'two', why: 'second', steps: [second] },
      ]),
    ]);

    expect(files.get(first)).toEqual(['forms-a.png']);
    expect(files.get(second)).toEqual(['forms-b.png']);
  });
});

describe('checkGroups', () => {
  const step: SelfTestStep = { keys: ['j'], expect: 'x' };

  it('passes groups with names, whys and valid steps', () => {
    const check = () =>
      checkGroups([
        withGroups('forms', [
          {
            name: 'rounds',
            why: 'rounds open',
            steps: [
              { ...step, width: 600 },
              { ...step, width: 'start' },
              { ...step, repeat: { until: 'end', max: 2 } },
            ],
          },
          { name: 'gallery', why: 'gallery shows', steps: [step] },
        ]),
      ]);

    expect(check).not.toThrow();
  });

  it('throws on two groups of one script named alike, naming the plugin and the group', () => {
    const check = () =>
      checkGroups([
        withGroups('forms', [
          { name: 'rounds', why: 'first', steps: [step] },
          { name: 'rounds', why: 'second', steps: [step] },
        ]),
      ]);

    expect(check).toThrow(/forms.*rounds/);
  });

  it('lets two scripts each have a group of one name', () => {
    const check = () =>
      checkGroups([
        withGroups('forms', [{ name: 'keys', why: 'forms keys', steps: [] }]),
        withGroups('chat', [{ name: 'keys', why: 'chat keys', steps: [] }]),
      ]);

    expect(check).not.toThrow();
  });

  it('throws on a group with no name or no why', () => {
    const noName = () =>
      checkGroups([withGroups('forms', [{ name: '', why: 'w', steps: [] }])]);
    const noWhy = () =>
      checkGroups([
        withGroups('forms', [{ name: 'rounds', why: ' ', steps: [] }]),
      ]);

    expect(noName).toThrow('forms');
    expect(noWhy).toThrow(/forms.*rounds/);
  });

  it.each(['', '  '])('throws on a step whose why is "%s"', (why) => {
    const check = () =>
      checkGroups([
        withGroups('forms', [
          { name: 'rounds', why: 'w', steps: [{ ...step, why }] },
        ]),
      ]);

    expect(check).toThrow(/forms.*rounds.*\(x\)/);
  });

  it.each([1, 2.5])('throws on a repeat with max %s', (max) => {
    const check = () =>
      checkGroups([
        withGroups('forms', [
          {
            name: 'pages',
            why: 'w',
            steps: [{ ...step, repeat: { until: 'end', max } }],
          },
        ]),
      ]);

    expect(check).toThrow(new RegExp(`forms.*pages.*\\(x\\).*max ${max}`));
  });

  it('throws on a repeat with no until line', () => {
    const noUntil = () =>
      checkGroups([
        withGroups('forms', [
          {
            name: 'pages',
            why: 'w',
            steps: [{ ...step, repeat: { until: '', max: 3 } }],
          },
        ]),
      ]);

    expect(noUntil).toThrow(/forms.*pages.*\(x\)/);
  });

  it('throws on a repeating step with alsoExpect', () => {
    const check = () =>
      checkGroups([
        withGroups('forms', [
          {
            name: 'pages',
            why: 'w',
            steps: [
              {
                ...step,
                repeat: { until: 'end', max: 3 },
                alsoExpect: [/id/],
              },
            ],
          },
        ]),
      ]);

    expect(check).toThrow(/forms.*pages.*\(x\).*alsoExpect/);
  });

  it.each([0, -600, 600.5])('throws on a width of %s', (width) => {
    const check = () =>
      checkGroups([
        withGroups('forms', [
          { name: 'narrow', why: 'w', steps: [{ ...step, width }] },
        ]),
      ]);

    expect(check).toThrow(new RegExp(`forms.*narrow.*\\(x\\).*width ${width}`));
  });
});

describe('selectScripts', () => {
  const groupsOf = (...names: string[]): SelfTestGroup[] =>
    names.map((name) => ({ name, why: 'w', steps: [] }));
  const scripts = [
    withGroups('forms', groupsOf('gallery', 'side bar', 'review')),
    withGroups('settings', groupsOf('side bar', 'keymap')),
    withGroups('docs', groupsOf('editor', 'pickers', 'side bar', 'stars')),
  ];
  const kept = (plugins: string[], groups: string[]) =>
    selectScripts(scripts, { plugins, groups }).map((run) => [
      run.pluginId,
      run.script.groups.map((group) => group.name),
      run.checksResult,
    ]);

  it.each([
    {
      filter: 'nothing',
      plugins: [],
      groups: [],
      runs: [
        ['forms', ['gallery', 'side bar', 'review'], true],
        ['settings', ['side bar', 'keymap'], true],
        ['docs', ['editor', 'pickers', 'side bar', 'stars'], true],
      ],
    },
    {
      filter: 'two plugins, in hand-over order',
      plugins: ['docs', 'forms'],
      groups: [],
      runs: [
        ['forms', ['gallery', 'side bar', 'review'], true],
        ['docs', ['editor', 'pickers', 'side bar', 'stars'], true],
      ],
    },
    {
      filter: 'a qualified group, with the groups before it',
      plugins: [],
      groups: ['docs: pickers'],
      runs: [['docs', ['editor', 'pickers'], false]],
    },
    {
      filter: 'a bare group, in every script holding it',
      plugins: [],
      groups: ['side bar', 'review', 'keymap'],
      runs: [
        ['forms', ['gallery', 'side bar', 'review'], true],
        ['settings', ['side bar', 'keymap'], true],
        ['docs', ['editor', 'pickers', 'side bar'], false],
      ],
    },
    {
      filter: 'a plugin and a group of another',
      plugins: ['settings'],
      groups: ['docs: editor'],
      runs: [
        ['settings', ['side bar', 'keymap'], true],
        ['docs', ['editor'], false],
      ],
    },
  ])('keeps $filter', ({ plugins, groups, runs }) => {
    expect(kept(plugins, groups)).toEqual(runs);
  });

  it.each([
    {
      name: 'an unknown plugin',
      plugins: ['chat'],
      groups: [],
      message: /chat.*forms, settings, docs/,
    },
    {
      name: 'an unknown group',
      plugins: [],
      groups: ['settings: review'],
      message:
        /"settings: review".*forms: gallery.*settings: keymap.*docs: stars/,
    },
    {
      name: 'a cut script before a kept one',
      plugins: [],
      groups: ['forms: gallery', 'keymap'],
      message:
        /cuts the forms script.*"gallery".*keeps settings.*forms groups on their own/,
    },
    {
      name: 'a bare group that cuts an earlier script',
      plugins: [],
      groups: ['side bar'],
      message: /cuts the forms script.*"side bar".*keeps settings/,
    },
    {
      name: 'a cut script before a whole plugin',
      plugins: ['docs'],
      groups: ['settings: side bar'],
      message: /cuts the settings script.*keeps docs/,
    },
  ])(
    'throws on $name, naming the known ones',
    ({ plugins, groups, message }) => {
      expect(() => selectScripts(scripts, { plugins, groups })).toThrow(
        message,
      );
    },
  );
});

describe('selfTestFilterOf', () => {
  it.each([
    { env: {}, filter: { plugins: [], groups: [] } },
    { env: { [SELFTEST_FILTER_ENV]: '' }, filter: { plugins: [], groups: [] } },
    {
      env: {
        [SELFTEST_FILTER_ENV]:
          '{"plugins":["settings"],"groups":["docs: stars"]}',
      },
      filter: { plugins: ['settings'], groups: ['docs: stars'] },
    },
  ])('reads $env', ({ env, filter }) => {
    expect(selfTestFilterOf(env)).toEqual(filter);
  });

  it.each([
    { value: '{"plugins":', why: /is not JSON/ },
    { value: '["forms"]', why: /is not a JSON object/ },
    { value: 'null', why: /is not a JSON object/ },
    { value: '{"plugins":"forms"}', why: /not lists of strings/ },
    { value: '{"groups":[1]}', why: /not lists of strings/ },
  ])(
    'makes selectScripts throw on the malformed value $value, naming it',
    ({ value, why }) => {
      const filter = selfTestFilterOf({ [SELFTEST_FILTER_ENV]: value });

      const select = () => selectScripts([withGroups('forms', [])], filter);

      expect(select).toThrow(SELFTEST_FILTER_ENV);
      expect(select).toThrow(JSON.stringify(value));
      expect(select).toThrow(why);
    },
  );
});
