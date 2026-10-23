import { describe, expect, it } from 'vitest';
import type { PageBind } from '../contracts/keymap';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import {
  applySelfTestConfig,
  checkGroups,
  type HandedScript,
  mergeSelfTestConfigs,
  screenshotFiles,
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

    expect(merge).toThrow(
      'Self-test scripts of forms and chat set keys.whichKeyTimeoutMs to different values',
    );
  });

  it('mergeSelfTestConfigs_NoScripts_IsEmpty', () => {
    expect(mergeSelfTestConfigs([])).toEqual({ pageBinds: [], settings: {} });
  });
});

describe('applySelfTestConfig', () => {
  it("applySelfTestConfig appends page binds and lays settings over the plugins'", () => {
    const userBind: PageBind = { keys: ['j'], scope: 'any', command: 'p.down' };
    const scriptBind: PageBind = {
      keys: ['z'],
      scope: 'any',
      command: 'p.zap',
    };
    const config: AppConfig = {
      settings: {
        window: { width: 1, height: 1, minWidth: 1, minHeight: 1 },
        theme: 't',
        transparency: 'system',
        fonts: {},
        keySequenceTimeoutMs: 1,
        claude: { command: 'claude' },
      },
      keymap: {
        editor: { leader: ' ', remaps: [], binds: [] },
        page: [userBind],
        app: [],
        intercept: [],
        global: [],
        groups: {},
      },
      commands: {},
      scopes: [],
      pluginSettings: { p: { size: 1, speed: 2 } },
      theme: { name: 't', colorScheme: 'dark', tokens: {}, reduced: {} },
      platform: 'macos',
      homeDir: '/Users/u',
      problems: [],
    };

    const served = applySelfTestConfig(config, {
      pageBinds: [scriptBind],
      settings: { p: { speed: 9 } },
    });

    expect(served.keymap.page).toEqual([userBind, scriptBind]);
    expect(served.pluginSettings).toEqual({ p: { size: 1, speed: 9 } });
  });
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

  it('screenshotFiles_NameWithCapitalsAndSpace_Throws', () => {
    const name = () =>
      screenshotFiles([
        handed('forms', [], {}, [
          { keys: ['j'], expect: 'x', screenshot: 'Gallery full' },
        ]),
      ]);

    expect(name).toThrow(
      'Self-test step of forms names screenshot "Gallery full": a screenshot name is lowercase letters and digits in words joined by -',
    );
  });

  it('screenshotFiles_NameEndingInDash_Throws', () => {
    const name = () =>
      screenshotFiles([
        handed('forms', [], {}, [
          { keys: ['j'], expect: 'x', screenshot: 'gallery-' },
        ]),
      ]);

    expect(name).toThrow(
      'Self-test step of forms names screenshot "gallery-": a screenshot name is lowercase letters and digits in words joined by -',
    );
  });

  it('screenshotFiles_SameNameTwiceInOneScript_Throws', () => {
    const name = () =>
      screenshotFiles([
        handed('forms', [], {}, [
          { keys: ['j'], expect: 'x', screenshot: 'round' },
          { keys: ['k'], expect: 'y', screenshot: 'round' },
        ]),
      ]);

    expect(name).toThrow('Two self-test steps save forms-round.png');
  });

  it('screenshotFiles_DifferentPluginsSameFile_Throws', () => {
    const name = () =>
      screenshotFiles([
        handed('a', [], {}, [{ keys: ['j'], expect: 'x', screenshot: 'b-c' }]),
        handed('a-b', [], {}, [{ keys: ['k'], expect: 'y', screenshot: 'c' }]),
      ]);

    expect(name).toThrow('Two self-test steps save a-b-c.png');
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
    expect(clash).toThrow('Two self-test steps save forms-pages-2.png');
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

    expect(check).toThrow(
      'Self-test group forms: rounds is named twice in its script',
    );
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

    expect(noName).toThrow('A self-test group of forms has no name');
    expect(noWhy).toThrow('Self-test group forms: rounds has no why');
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

    expect(check).toThrow(
      `Self-test group forms: pages has a step (x) repeating with max ${max}: a repeat's max is a whole number of at least 2`,
    );
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

    expect(noUntil).toThrow(
      'Self-test group forms: pages has a step (x) repeating with no until line',
    );
  });

  it.each([0, -600, 600.5])('throws on a width of %s', (width) => {
    const check = () =>
      checkGroups([
        withGroups('forms', [
          { name: 'narrow', why: 'w', steps: [{ ...step, width }] },
        ]),
      ]);

    expect(check).toThrow(
      `Self-test group forms: narrow has a step (x) with width ${width}: a width is 'start' or a positive whole number`,
    );
  });
});
