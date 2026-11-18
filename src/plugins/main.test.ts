import { describe, expect, it } from 'vitest';
import { startPlugins } from '../shared/plugin-host';
import { mainParts } from './main';

describe('mainParts', () => {
  it('mainParts_StartOrder_ClaudeCodeBeforeChatAndUsage', () => {
    const started: string[] = [];

    startPlugins(mainParts, 'main', ({ manifest }) => {
      started.push(manifest.id);
      return {};
    });

    const claudeCodeAt = started.indexOf('claude-code');
    expect(claudeCodeAt).not.toBe(-1);
    expect(claudeCodeAt).toBeLessThan(started.indexOf('chat'));
    expect(claudeCodeAt).toBeLessThan(started.indexOf('usage'));
  });
});
