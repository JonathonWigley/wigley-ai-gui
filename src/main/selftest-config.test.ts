import { describe, expect, it } from 'vitest';
import type { PageBind } from '../contracts/keymap';
import type { SelfTestScript, SelfTestStep } from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import {
  applySelfTestConfig,
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
  const script: SelfTestScript = {
    pageBinds,
    settings,
    open: () => ({ shownLine: 'shown', result: Promise.resolve(null) }),
    steps,
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
      },
      commands: {},
      scopes: [],
      pluginSettings: { p: { size: 1, speed: 2 } },
      theme: { name: 't', colorScheme: 'dark', tokens: {}, reduced: {} },
      platform: 'macos',
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

    expect(files.get(step)).toBe('forms-gallery-full.png');
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
});
