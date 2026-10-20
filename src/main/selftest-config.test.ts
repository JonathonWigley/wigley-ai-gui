import { describe, expect, it } from 'vitest';
import type { PageBind } from '../contracts/keymap';
import type { SelfTestScript } from '../contracts/plugin';
import { type HandedScript, mergeSelfTestConfigs } from './selftest-config';

function handed(
  pluginId: string,
  pageBinds: PageBind[],
  settings: Record<string, object>,
): HandedScript {
  const script: SelfTestScript = {
    pageBinds,
    settings,
    open: () => ({ shownLine: 'shown', result: Promise.resolve(null) }),
    steps: [],
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
