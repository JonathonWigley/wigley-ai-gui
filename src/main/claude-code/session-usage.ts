import type { UsageAgentEvent } from '../../contracts/agent';
import { asJson, type Json, parsed } from './json-fields';

// The prompt cache's two lifetimes, by the `usage.cache_creation` bucket a reply wrote.
const CACHE_TTL_5M_MS = 300_000;
const CACHE_TTL_1H_MS = 3_600_000;

// The `settings.json` `env` variable that sets autocompact as a percent of the context window.
const AUTOCOMPACT_OVERRIDE = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

// What one main-conversation reply says of the context: its size in tokens, the cache lifetime it wrote (null when
// it wrote none) and whether it read the cache.
export interface ReplyUsage {
  contextTokens: number;
  cacheTtlMs: number | null;
  readsCache: boolean;
}

// What one turn's `result` says: the main model's context window and the process's cumulative spend.
export interface TurnUsage {
  contextWindow: number | null;
  spendUsd: number | null;
}

// One process's usage so far. `hasReply` is false until a reply was folded; `cacheTtlMs` is the last lifetime a
// reply wrote; `configuredPercent` is the profile's autocompact override, `reported` the harness's limit.
export interface SessionUsageState {
  hasReply: boolean;
  contextTokens: number;
  contextWindow: number | null;
  cacheTtlMs: number | null;
  cacheExpiresAt: number | null;
  spendUsd: number | null;
  configuredPercent: number | null;
  reported: number | null;
}

export const EMPTY_SESSION_USAGE: SessionUsageState = {
  hasReply: false,
  contextTokens: 0,
  contextWindow: null,
  cacheTtlMs: null,
  cacheExpiresAt: null,
  spendUsd: null,
  configuredPercent: null,
  reported: null,
};

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' ? value : fallback;

// A reply that wrote the cache restarts its expiry with the lifetime it wrote; one that only read it restarts it
// with the kept lifetime.
export function foldReply(
  state: SessionUsageState,
  reply: ReplyUsage,
  at: number,
): SessionUsageState {
  let { cacheTtlMs, cacheExpiresAt } = state;
  if (reply.cacheTtlMs !== null) {
    cacheTtlMs = reply.cacheTtlMs;
    cacheExpiresAt = at + reply.cacheTtlMs;
  } else if (reply.readsCache && cacheTtlMs !== null) {
    cacheExpiresAt = at + cacheTtlMs;
  }
  return {
    ...state,
    hasReply: true,
    contextTokens: reply.contextTokens,
    cacheTtlMs,
    cacheExpiresAt,
  };
}

// A null window keeps the kept one; a spend below the kept one (a local command's 0) keeps the process's total.
export function foldTurn(
  state: SessionUsageState,
  turn: TurnUsage,
): SessionUsageState {
  const isSpendKept =
    turn.spendUsd === null ||
    (state.spendUsd !== null && turn.spendUsd < state.spendUsd);
  return {
    ...state,
    contextWindow: turn.contextWindow ?? state.contextWindow,
    spendUsd: isSpendKept ? state.spendUsd : turn.spendUsd,
  };
}

export function withReported(
  state: SessionUsageState,
  reported: number | null,
): SessionUsageState {
  return { ...state, reported };
}

export function withConfiguredPercent(
  state: SessionUsageState,
  percent: number | null,
): SessionUsageState {
  return { ...state, configuredPercent: percent };
}

// The main agent's `usage` event at `at`; null until a reply was folded.
export function usageEvent(
  state: SessionUsageState,
  at: number,
): UsageAgentEvent | null {
  if (!state.hasReply) {
    return null;
  }
  const { configuredPercent, contextWindow } = state;
  const configured =
    configuredPercent === null || contextWindow === null
      ? null
      : Math.round((configuredPercent / 100) * contextWindow);
  return {
    type: 'usage',
    agentId: 'main',
    at,
    contextTokens: state.contextTokens,
    contextWindow,
    autocompact: { configured, reported: state.reported },
    cacheExpiresAt: state.cacheExpiresAt,
    spendUsd: state.spendUsd,
  };
}

// An `assistant` message's `usage`. A reply that wrote both cache lifetimes takes the shorter: part of its context
// goes cold then.
export function replyUsageOf(usage: Json): ReplyUsage {
  const cacheRead = numberOr(usage.cache_read_input_tokens, 0);
  const contextTokens =
    numberOr(usage.input_tokens, 0) +
    cacheRead +
    numberOr(usage.cache_creation_input_tokens, 0) +
    numberOr(usage.output_tokens, 0);
  const cacheCreation = asJson(usage.cache_creation);
  const wrote1h = numberOr(cacheCreation.ephemeral_1h_input_tokens, 0) > 0;
  const wrote5m = numberOr(cacheCreation.ephemeral_5m_input_tokens, 0) > 0;
  let cacheTtlMs: number | null = null;
  if (wrote5m) {
    cacheTtlMs = CACHE_TTL_5M_MS;
  } else if (wrote1h) {
    cacheTtlMs = CACHE_TTL_1H_MS;
  }
  return { contextTokens, cacheTtlMs, readsCache: cacheRead > 0 };
}

// The context window `model` ran with, or the largest the result names when `model` is null or not among them.
function contextWindowOf(
  modelUsage: Json,
  model: string | null,
): number | null {
  const own =
    model !== null && Object.hasOwn(modelUsage, model)
      ? asJson(modelUsage[model]).contextWindow
      : undefined;
  if (typeof own === 'number') {
    return own;
  }
  const windows = Object.values(modelUsage)
    .map((usage) => asJson(usage).contextWindow)
    .filter((window) => typeof window === 'number');
  return windows.length === 0 ? null : Math.max(...windows);
}

// A `result` line's usage, `model` the main conversation's last model (null before any main reply).
export function turnUsageOf(result: Json, model: string | null): TurnUsage {
  const spend = result.total_cost_usd;
  return {
    contextWindow: contextWindowOf(asJson(result.modelUsage), model),
    spendUsd: typeof spend === 'number' ? spend : null,
  };
}

// The autocompact percent a profile's `settings.json` text sets: a number in (0, 100], else null.
export function configuredPercent(settingsText: string | null): number | null {
  if (settingsText === null) {
    return null;
  }
  const json = parsed(settingsText);
  if (!json.ok) {
    return null;
  }
  const override = asJson(asJson(json.value).env)[AUTOCOMPACT_OVERRIDE];
  if (typeof override !== 'string' && typeof override !== 'number') {
    return null;
  }
  const percent = Number(override);
  const isPercent = Number.isFinite(percent) && percent > 0 && percent <= 100;
  return isPercent ? percent : null;
}

// The autocompact limit a `get_context_usage` reply reports, or null.
export function reportedLimit(response: Json): number | null {
  const threshold = response.autoCompactThreshold;
  return typeof threshold === 'number' ? threshold : null;
}
