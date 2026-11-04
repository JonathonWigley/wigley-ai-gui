import { asJson, type Json } from './json-fields';

// US dollars per million tokens of each token class. A row prices a reply whose prompt (input, cache writes and cache
// reads) is at most `maxPromptTokens`; null for any prompt.
interface PriceRow {
  maxPromptTokens: number | null;
  input: number;
  write5m: number;
  write1h: number;
  cacheRead: number;
  output: number;
}

function flatRate(
  input: number,
  write5m: number,
  write1h: number,
  cacheRead: number,
  output: number,
): readonly PriceRow[] {
  return [
    { maxPromptTokens: null, input, write5m, write1h, cacheRead, output },
  ];
}

// https://platform.claude.com/docs/en/about-claude/pricing § Model pricing, fetched 2026-11-02.
const MODEL_PRICES: Readonly<Record<string, readonly PriceRow[]>> = {
  'claude-fable-5-1': flatRate(10, 12.5, 20, 0.25, 50),
  'claude-fable-5': flatRate(10, 12.5, 20, 1, 50),
  'claude-opus-5-5': flatRate(4, 5, 8, 0.2, 20),
  'claude-opus-5': flatRate(5, 6.25, 10, 0.5, 25),
  'claude-opus-4-8': flatRate(5, 6.25, 10, 0.5, 25),
  'claude-opus-4-7': flatRate(5, 6.25, 10, 0.5, 25),
  'claude-opus-4-6': flatRate(5, 6.25, 10, 0.5, 25),
  'claude-opus-4-5': flatRate(5, 6.25, 10, 0.5, 25),
  'claude-sonnet-5-5': flatRate(2, 2.5, 4, 0.1, 10),
  'claude-sonnet-5': flatRate(2, 2.5, 4, 0.2, 10),
  'claude-sonnet-4-6': flatRate(3, 3.75, 6, 0.3, 15),
  'claude-sonnet-4-5': flatRate(3, 3.75, 6, 0.3, 15),
  'claude-haiku-5-5': [
    {
      maxPromptTokens: 100000,
      input: 0.1,
      write5m: 0.125,
      write1h: 0.2,
      cacheRead: 0.01,
      output: 0.5,
    },
    {
      maxPromptTokens: null,
      input: 0.5,
      write5m: 0.625,
      write1h: 1,
      cacheRead: 0.05,
      output: 2.5,
    },
  ],
  'claude-haiku-4-5': flatRate(1, 1.25, 2, 0.1, 5),
};

// A context-size suffix such as `[1m]`, and a dated snapshot's `-YYYYMMDD`.
export const CONTEXT_SUFFIX = /\[[^\]]*\]$/;
const SNAPSHOT_DATE = /-\d{8}$/;

function numberOrZero(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function priceRowsOf(model: string): readonly PriceRow[] | null {
  const id = model.replace(CONTEXT_SUFFIX, '');
  const key = Object.hasOwn(MODEL_PRICES, id)
    ? id
    : id.replace(SNAPSHOT_DATE, '');
  return Object.hasOwn(MODEL_PRICES, key) ? MODEL_PRICES[key] : null;
}

// Cache writes by lifetime: the `cache_creation` split when it holds either field, else all of
// `cache_creation_input_tokens` as five-minute writes.
function cacheWrites(usage: Json): { write5m: number; write1h: number } {
  const split = asJson(usage.cache_creation);
  const hasSplit =
    typeof split.ephemeral_5m_input_tokens === 'number' ||
    typeof split.ephemeral_1h_input_tokens === 'number';
  return hasSplit
    ? {
        write5m: numberOrZero(split.ephemeral_5m_input_tokens),
        write1h: numberOrZero(split.ephemeral_1h_input_tokens),
      }
    : { write5m: numberOrZero(usage.cache_creation_input_tokens), write1h: 0 };
}

// One reply's estimated spend in US dollars from its `message.usage`, at the list price of `model`; null when the
// model has none.
export function replySpendUsd(model: string, usage: Json): number | null {
  const rows = priceRowsOf(model);
  if (rows === null) {
    return null;
  }
  const input = numberOrZero(usage.input_tokens);
  const { write5m, write1h } = cacheWrites(usage);
  const cacheRead = numberOrZero(usage.cache_read_input_tokens);
  const output = numberOrZero(usage.output_tokens);
  const promptTokens = input + write5m + write1h + cacheRead;
  const row = rows.find(
    (candidate) =>
      candidate.maxPromptTokens === null ||
      candidate.maxPromptTokens >= promptTokens,
  );
  if (row === undefined) {
    return null;
  }
  const perMillion =
    input * row.input +
    write5m * row.write5m +
    write1h * row.write1h +
    cacheRead * row.cacheRead +
    output * row.output;
  return perMillion / 1_000_000;
}
