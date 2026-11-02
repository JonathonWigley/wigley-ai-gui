import { describe, expect, it } from 'vitest';
import {
  configuredPercent,
  contextUsageOf,
  EMPTY_SESSION_USAGE,
  foldContextUsage,
  foldReply,
  foldTurn,
  type ReplyUsage,
  replyUsageOf,
  type SessionUsageState,
  usageEvent,
  withConfiguredPercent,
} from './session-usage';

// REPLY_LINE's `message.usage`, docs/features/agent-chat/claude-stream.md § Usage.
const REPLY_USAGE = {
  input_tokens: 3,
  cache_creation_input_tokens: 2000,
  cache_read_input_tokens: 40000,
  output_tokens: 120,
  cache_creation: {
    ephemeral_1h_input_tokens: 2000,
    ephemeral_5m_input_tokens: 0,
  },
};

const reply = (cacheTtlMs: number | null, readsCache: boolean): ReplyUsage => ({
  contextTokens: 5000,
  cacheTtlMs,
  readsCache,
});

describe('session usage', () => {
  it.each([
    {
      name: 'MeasuredReply',
      usage: REPLY_USAGE,
      expected: {
        contextTokens: 42123,
        cacheTtlMs: 3_600_000,
        readsCache: true,
      },
    },
    {
      name: 'BothBuckets',
      usage: {
        ...REPLY_USAGE,
        cache_creation: {
          ephemeral_1h_input_tokens: 500,
          ephemeral_5m_input_tokens: 500,
        },
      },
      expected: { contextTokens: 42123, cacheTtlMs: 300_000, readsCache: true },
    },
    {
      name: 'Only5m',
      usage: {
        ...REPLY_USAGE,
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 700,
        },
      },
      expected: { contextTokens: 42123, cacheTtlMs: 300_000, readsCache: true },
    },
    {
      name: 'NoCache',
      usage: {
        input_tokens: 7,
        cache_creation_input_tokens: 11,
        output_tokens: 13,
      },
      expected: { contextTokens: 31, cacheTtlMs: null, readsCache: false },
    },
  ])('replyUsageOf_$name', ({ usage, expected }) => {
    expect(replyUsageOf(usage)).toEqual(expected);
  });

  it.each([
    {
      name: 'WritesOneHour',
      replies: [{ usage: reply(3_600_000, false), at: 2000 }],
      expiresAt: 3_602_000,
    },
    {
      name: 'ThenReadOnlyRestarts',
      replies: [
        { usage: reply(3_600_000, false), at: 2000 },
        { usage: reply(null, true), at: 9000 },
      ],
      expiresAt: 3_609_000,
    },
    {
      name: 'ThenNoCacheUseKeeps',
      replies: [
        { usage: reply(3_600_000, false), at: 2000 },
        { usage: reply(null, true), at: 9000 },
        { usage: reply(null, false), at: 12000 },
      ],
      expiresAt: 3_609_000,
    },
    {
      name: 'FirstReplyReadOnly',
      replies: [{ usage: reply(null, true), at: 2000 }],
      expiresAt: null,
    },
  ])('foldReply_CacheExpiry_$name', ({ replies, expiresAt }) => {
    const state = replies.reduce(
      (folded, { usage, at }) => foldReply(folded, usage, at),
      EMPTY_SESSION_USAGE,
    );

    expect(state.cacheExpiresAt).toBe(expiresAt);
  });

  it.each([
    {
      name: 'NullWindowKeepsWindow',
      turns: [
        { contextWindow: 1_000_000, spendUsd: null },
        { contextWindow: null, spendUsd: null },
      ],
      expected: { contextWindow: 1_000_000, spendUsd: null },
    },
    {
      name: 'LowerSpendKeepsTotal',
      turns: [
        { contextWindow: null, spendUsd: 0.5 },
        { contextWindow: null, spendUsd: 0 },
      ],
      expected: { contextWindow: null, spendUsd: 0.5 },
    },
    {
      name: 'HigherSpendReplaces',
      turns: [
        { contextWindow: null, spendUsd: 0.5 },
        { contextWindow: 200_000, spendUsd: 0.75 },
      ],
      expected: { contextWindow: 200_000, spendUsd: 0.75 },
    },
  ])('foldTurn_$name', ({ turns, expected }) => {
    const state = turns.reduce(foldTurn, EMPTY_SESSION_USAGE);

    expect({
      contextWindow: state.contextWindow,
      spendUsd: state.spendUsd,
    }).toEqual(expected);
  });

  // A state with one reply folded, then `percent` and `window` set.
  function repliedState(
    percent: number | null,
    window: number | null,
  ): SessionUsageState {
    const replied = foldReply(EMPTY_SESSION_USAGE, reply(null, false), 1000);
    const turned = foldTurn(replied, { contextWindow: window, spendUsd: 0.25 });
    return withConfiguredPercent(turned, percent);
  }

  it.each([
    {
      name: 'PercentAndWindow',
      percent: 30,
      window: 1_000_000,
      configured: 300000,
    },
    { name: 'NoWindow', percent: 30, window: null, configured: null },
    { name: 'NoPercent', percent: null, window: 1_000_000, configured: null },
  ])('usageEvent_Configured_$name', ({ percent, window, configured }) => {
    const event = usageEvent(repliedState(percent, window), 4000);

    expect(event?.autocompact.configured).toBe(configured);
  });

  it('usageEvent_NoReplyFolded_Null', () => {
    const state = withConfiguredPercent(
      foldTurn(EMPTY_SESSION_USAGE, { contextWindow: 1_000_000, spendUsd: 1 }),
      30,
    );

    expect(usageEvent(state, 4000)).toBeNull();
  });

  it('usageEvent_FullState_WholeEvent', () => {
    const replied = foldReply(
      EMPTY_SESSION_USAGE,
      { contextTokens: 42123, cacheTtlMs: 3_600_000, readsCache: true },
      2000,
    );
    const turned = foldTurn(replied, { contextWindow: 200_000, spendUsd: 0.4 });
    const state = foldContextUsage(withConfiguredPercent(turned, 45), {
      contextWindow: null,
      reported: 193_000,
    });

    expect(usageEvent(state, 7000)).toEqual({
      type: 'usage',
      agentId: 'main',
      at: 7000,
      contextTokens: 42123,
      contextWindow: 200_000,
      autocompact: { configured: 90_000, reported: 193_000 },
      cacheExpiresAt: 3_602_000,
      spendUsd: 0.4,
    });
  });

  it.each([
    {
      name: 'String',
      text: '{"env":{"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE":"30"}}',
      percent: 30,
    },
    {
      name: 'Number',
      text: '{"env":{"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE":30}}',
      percent: 30,
    },
    { name: 'NoOverride', text: '{"env":{}}', percent: null },
    {
      name: 'NotANumber',
      text: '{"env":{"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE":"abc"}}',
      percent: null,
    },
    {
      name: 'Zero',
      text: '{"env":{"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE":"0"}}',
      percent: null,
    },
    {
      name: 'OverHundred',
      text: '{"env":{"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE":"150"}}',
      percent: null,
    },
    { name: 'NotJson', text: 'not json', percent: null },
    { name: 'NoFile', text: null, percent: null },
  ])('configuredPercent_$name', ({ text, percent }) => {
    expect(configuredPercent(text)).toBe(percent);
  });

  it.each([
    {
      name: 'MeasuredReply',
      response: {
        autoCompactThreshold: 967000,
        maxTokens: 1000000,
        rawMaxTokens: 1000000,
      },
      expected: { contextWindow: 1000000, reported: 967000 },
    },
    {
      name: 'Missing',
      response: {},
      expected: { contextWindow: null, reported: null },
    },
  ])('contextUsageOf_$name', ({ response, expected }) => {
    expect(contextUsageOf(response)).toEqual(expected);
  });

  it.each([
    {
      name: 'WindowReplaces',
      usage: { contextWindow: 200_000, reported: 167_000 },
      expected: { contextWindow: 200_000, reported: 167_000 },
    },
    {
      name: 'NullWindowKeepsWindow',
      usage: { contextWindow: null, reported: null },
      expected: { contextWindow: 1_000_000, reported: null },
    },
  ])('foldContextUsage_$name', ({ usage, expected }) => {
    const kept = foldContextUsage(EMPTY_SESSION_USAGE, {
      contextWindow: 1_000_000,
      reported: 967_000,
    });

    const state = foldContextUsage(kept, usage);

    expect({
      contextWindow: state.contextWindow,
      reported: state.reported,
    }).toEqual(expected);
  });
});
