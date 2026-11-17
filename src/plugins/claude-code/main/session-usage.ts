import { MAIN_AGENT_ID, type UsageAgentEvent } from '../../../contracts/agent';
import { asJson, type Json, numberOrNull, parsed } from './json-fields';

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

// What one `get_context_usage` reply says: the main model's context window, the autocompact limit the harness reports
// and the context's size now, each null when the reply carries none.
export interface ContextUsage {
  contextWindow: number | null;
  reported: number | null;
  totalTokens: number | null;
}

// A main reply a saved transcript holds, `at` its line's time.
export interface SavedReply {
  reply: ReplyUsage;
  at: number;
}

// One process's usage so far. `isContextKnown` is false until the state knows the context; `cacheTtlMs` is the last
// lifetime a reply wrote; `configuredPercent` is the profile's autocompact override, `reported` the harness's limit.
export interface SessionUsageState {
  isContextKnown: boolean;
  contextTokens: number;
  contextWindow: number | null;
  cacheTtlMs: number | null;
  cacheExpiresAt: number | null;
  spendUsd: number | null;
  configuredPercent: number | null;
  reported: number | null;
}

export const EMPTY_SESSION_USAGE: SessionUsageState = {
  isContextKnown: false,
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
    isContextKnown: true,
    contextTokens: reply.contextTokens,
    cacheTtlMs,
    cacheExpiresAt,
  };
}

// A known state is kept: a live reply came first. Otherwise every saved reply folds in order, so a last reply that
// only read the cache keeps the lifetime an earlier one wrote; no reply leaves the state known at 0 tokens.
export function withSavedReplies(
  state: SessionUsageState,
  replies: readonly SavedReply[],
): SessionUsageState {
  if (state.isContextKnown) {
    return state;
  }
  let folded: SessionUsageState = { ...state, isContextKnown: true };
  for (const { reply, at } of replies) {
    folded = foldReply(folded, reply, at);
  }
  return folded;
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

// The reply's limit replaces the kept one; a null window keeps the kept one.
export function foldContextUsage(
  state: SessionUsageState,
  usage: ContextUsage,
): SessionUsageState {
  return {
    ...state,
    contextWindow: usage.contextWindow ?? state.contextWindow,
    reported: usage.reported,
  };
}

// The context a compaction left. Its cache expiry is unknown until the next reply, which rebuilds the cache.
export function withCompactedContext(
  state: SessionUsageState,
  contextTokens: number,
): SessionUsageState {
  return {
    ...state,
    isContextKnown: true,
    contextTokens,
    cacheExpiresAt: null,
  };
}

export function withConfiguredPercent(
  state: SessionUsageState,
  percent: number | null,
): SessionUsageState {
  return { ...state, configuredPercent: percent };
}

// The tokens `percent` of `contextWindow` comes to; null when either is unknown.
export function configuredAutocompactLimit(
  percent: number | null,
  contextWindow: number | null,
): number | null {
  return percent === null || contextWindow === null
    ? null
    : Math.round((percent / 100) * contextWindow);
}

// The main agent's `usage` event at `at`; null while the state does not know the context.
export function usageEvent(
  state: SessionUsageState,
  at: number,
): UsageAgentEvent | null {
  if (!state.isContextKnown) {
    return null;
  }
  const { contextWindow } = state;
  const configured = configuredAutocompactLimit(
    state.configuredPercent,
    contextWindow,
  );
  return {
    type: 'usage',
    agentId: MAIN_AGENT_ID,
    at,
    contextTokens: state.contextTokens,
    contextWindow,
    autocompact: { configured, reported: state.reported },
    cacheExpiresAt: state.cacheExpiresAt,
    spendUsd: state.spendUsd,
  };
}

// The input side of an `assistant` message's `usage`, a missing field counting 0.
export function replyInputTokens(usage: Json): number {
  return (
    numberOr(usage.input_tokens, 0) +
    numberOr(usage.cache_read_input_tokens, 0) +
    numberOr(usage.cache_creation_input_tokens, 0)
  );
}

// An `assistant` message's `usage`. A reply that wrote both cache lifetimes takes the shorter: part of its context
// goes cold then.
export function replyUsageOf(usage: Json): ReplyUsage {
  const cacheRead = numberOr(usage.cache_read_input_tokens, 0);
  const contextTokens =
    replyInputTokens(usage) + numberOr(usage.output_tokens, 0);
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

// The context window `model` ran with, null when its entry names none; the largest the result names when `model` is
// null or not among them.
function contextWindowOf(
  modelUsage: Json,
  model: string | null,
): number | null {
  if (model !== null && Object.hasOwn(modelUsage, model)) {
    return numberOrNull(asJson(modelUsage[model]).contextWindow);
  }
  const windows = Object.values(modelUsage)
    .map((usage) => asJson(usage).contextWindow)
    .filter((window) => typeof window === 'number');
  return windows.length === 0 ? null : Math.max(...windows);
}

// A `result` line's usage, `model` the main conversation's last model (null before any main reply).
export function turnUsageOf(result: Json, model: string | null): TurnUsage {
  return {
    contextWindow: contextWindowOf(asJson(result.modelUsage), model),
    spendUsd: numberOrNull(result.total_cost_usd),
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

// What a `get_context_usage` reply's data says.
export function contextUsageOf(response: Json): ContextUsage {
  return {
    contextWindow: numberOrNull(response.maxTokens),
    reported: numberOrNull(response.autoCompactThreshold),
    totalTokens: numberOrNull(response.totalTokens),
  };
}
