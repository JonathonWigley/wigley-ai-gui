import { describe, expect, it } from 'vitest';
import { contextBreakdownOf } from './context-breakdown';

const AT = 1000;

// A `get_context_usage` reply in the shape Claude 2.1.318 sends, trimmed to the fields the breakdown reads.
const REPLY = {
  totalTokens: 1600,
  maxTokens: 10_000,
  autoCompactThreshold: 9000,
  categories: [
    { id: 'system_prompt', name: 'System prompt', tokens: 100, kind: 'used' },
    { id: 'mcp_tools', name: 'MCP tools', tokens: 50, kind: 'used' },
    {
      id: 'mcp_tools_deferred',
      name: 'MCP tools (deferred)',
      tokens: 300,
      kind: 'deferred',
    },
    {
      id: 'system_tools_deferred',
      name: 'System tools (deferred)',
      tokens: 200,
      kind: 'deferred',
    },
    { id: 'memory_files', name: 'Memory files', tokens: 250, kind: 'used' },
    { id: 'messages', name: 'Messages', tokens: 1200, kind: 'used' },
    {
      id: 'autocompact_buffer',
      name: 'Autocompact buffer',
      tokens: 1000,
      kind: 'buffer',
    },
    { id: 'free_space', name: 'Free space', tokens: 7400, kind: 'free' },
  ],
  memoryFiles: [
    { path: '/home/u/AGENTS.md', type: 'User', tokens: 200 },
    { path: '/home/u/CLAUDE.md', type: 'User', tokens: 50 },
  ],
  mcpTools: [
    { name: 'mcp__a__x', serverName: 'a', tokens: 30, isLoaded: true },
    { name: 'mcp__a__y', serverName: 'a', tokens: 20, isLoaded: true },
    { name: 'mcp__b__z', serverName: 'b', tokens: 300, isLoaded: false },
  ],
  messageBreakdown: {
    toolCallTokens: 200,
    toolResultTokens: 400,
    attachmentTokens: 800,
    assistantMessageTokens: 100,
    userMessageTokens: 100,
    redirectedContextTokens: 0,
    unattributedTokens: 0,
    toolCallsByType: [
      { name: 'Bash', callTokens: 150, resultTokens: 300 },
      { name: 'Read', callTokens: 50, resultTokens: 100 },
    ],
    attachmentsByType: [{ name: 'hook_success', tokens: 800 }],
  },
};

describe('contextBreakdownOf', () => {
  it('reply_MakesUsedCategoriesSourcesLargestFirst_SplitsMessages_CountsDeferred', () => {
    const event = contextBreakdownOf(REPLY, AT);

    expect(event).toEqual({
      type: 'contextBreakdown',
      agentId: 'main',
      at: AT,
      totalTokens: 1600,
      contextWindow: 10_000,
      autocompactAt: 9000,
      deferredTokens: 500,
      sources: [
        {
          id: 'messages.attachments',
          label: 'Attachments',
          tokens: 600,
          items: [{ label: 'hook_success', isPath: false, tokens: 600 }],
        },
        {
          id: 'messages.tool-results',
          label: 'Tool results',
          tokens: 300,
          items: [
            { label: 'Bash', isPath: false, tokens: 225 },
            { label: 'Read', isPath: false, tokens: 75 },
          ],
        },
        {
          id: 'memory_files',
          label: 'Memory files',
          tokens: 250,
          items: [
            { label: '/home/u/AGENTS.md', isPath: true, tokens: 200 },
            { label: '/home/u/CLAUDE.md', isPath: true, tokens: 50 },
          ],
        },
        {
          id: 'messages.tool-calls',
          label: 'Tool calls',
          tokens: 150,
          items: [
            { label: 'Bash', isPath: false, tokens: 113 },
            { label: 'Read', isPath: false, tokens: 38 },
          ],
        },
        { id: 'system_prompt', label: 'System prompt', tokens: 100, items: [] },
        {
          id: 'messages.replies',
          label: 'Agent replies',
          tokens: 75,
          items: [],
        },
        { id: 'messages.user', label: 'User messages', tokens: 75, items: [] },
        {
          id: 'mcp_tools',
          label: 'MCP tools',
          tokens: 50,
          items: [{ label: 'a', isPath: false, tokens: 50 }],
        },
      ],
    });
  });

  it.each([
    [
      'parts that round apart',
      { ...REPLY.messageBreakdown, userMessageTokens: 101 },
    ],
    ['no breakdown', undefined],
  ])('messages_%s_SourcesStillSumToTotal', (_case, messageBreakdown) => {
    const event = contextBreakdownOf({ ...REPLY, messageBreakdown }, AT);

    const sum = event?.sources.reduce((total, { tokens }) => total + tokens, 0);
    expect(sum).toBe(1600);
  });

  it('noBreakdown_KeepsMessagesOneSource', () => {
    const event = contextBreakdownOf(
      { ...REPLY, messageBreakdown: undefined },
      AT,
    );

    expect(event?.sources[0]).toEqual({
      id: 'messages',
      label: 'Messages',
      tokens: 1200,
      items: [],
    });
  });

  it('noCategories_IsNull', () => {
    expect(contextBreakdownOf({ totalTokens: 5 }, AT)).toBeNull();
  });
});
