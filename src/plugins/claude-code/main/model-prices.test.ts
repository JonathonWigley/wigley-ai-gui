import { describe, expect, it } from 'vitest';
import type { Json } from './json-fields';
import { replySpendUsd } from './model-prices';

describe('model prices', () => {
  it.each<{
    name: string;
    model: string;
    usage: Json;
    expected: number | null;
  }>([
    {
      name: 'HaikuUnderTier',
      model: 'claude-haiku-5-5',
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 15637,
        cache_read_input_tokens: 0,
        cache_creation: {
          ephemeral_5m_input_tokens: 15637,
          ephemeral_1h_input_tokens: 0,
        },
        output_tokens: 17,
      },
      expected: 0.001963325,
    },
    {
      name: 'HaikuOverTier',
      model: 'claude-haiku-5-5',
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 150000,
        output_tokens: 10,
      },
      expected: 0.007526,
    },
    {
      name: 'Opus1hWrite',
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 3,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 40000,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 2000,
        },
        output_tokens: 120,
      },
      expected: 0.026412,
    },
    {
      name: 'NoSplitIsFiveMinute',
      model: 'claude-sonnet-5-5',
      usage: { cache_creation_input_tokens: 1000 },
      expected: 0.0025,
    },
    {
      name: 'SplitWithoutFieldsIsFiveMinute',
      model: 'claude-sonnet-5-5',
      usage: { cache_creation_input_tokens: 1000, cache_creation: {} },
      expected: 0.0025,
    },
    {
      name: 'DatedSnapshot',
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 1000, output_tokens: 1000 },
      expected: 0.006,
    },
    {
      name: 'ContextSuffix',
      model: 'claude-opus-5-5[1m]',
      usage: { output_tokens: 1000 },
      expected: 0.02,
    },
    {
      name: 'Unpriced',
      model: 'claude-mythos-5-1',
      usage: { output_tokens: 1000 },
      expected: null,
    },
    {
      name: 'NotADateSuffix',
      model: 'claude-opus-5-5-preview',
      usage: { output_tokens: 1000 },
      expected: null,
    },
  ])('replySpendUsd_$name', ({ model, usage, expected }) => {
    const spend = replySpendUsd(model, usage);
    if (expected === null) {
      expect(spend).toBeNull();
      return;
    }
    expect(spend).toBeCloseTo(expected, 12);
  });
});
