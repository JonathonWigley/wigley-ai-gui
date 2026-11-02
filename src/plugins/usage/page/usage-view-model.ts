import type { PlanRow, UsageAgentEvent } from '../../../contracts/agent';
import type { ProfilePlan, SessionUsage, UsageSnapshot } from '../contract';
import type {
  DetailsInput,
  DetailsProfileInput,
  DetailsRowInput,
  DetailsSessionInput,
  MeterInput,
  SessionLineInput,
  StatusLineInput,
  UsageTone,
} from '../layouts/layout';
import {
  formatDuration,
  formatMinor,
  formatPercent,
  formatTokens,
  formatUsd,
} from './usage-format';

// The shares of the autocompact limit at which the context meter turns
// `warning` and `critical`.
const CONTEXT_WARNING_PERCENT = 70;
const CONTEXT_CRITICAL_PERCENT = 90;
const MINUTE_MS = 60_000;

// The status-bar plan line for `shownSessionId` (null while no session
// shows): the plan of its session's profile, or of the default profile while
// it has none.
export function statusLineInput(
  snapshot: UsageSnapshot,
  shownSessionId: string | null,
): StatusLineInput {
  const plan = shownPlan(snapshot.plans, findSession(snapshot, shownSessionId));
  return {
    profileName: plan?.name ?? null,
    plans: plan?.usage?.rows.map(rowMeter) ?? [],
    note: planNote(plan),
    stale: plan !== null && plan.usage !== null && plan.stale,
  };
}

// `sessionId`'s line: its context, cache and spend; null while the snapshot
// holds no such session or it has no usage yet.
export function sessionLineInput(
  snapshot: UsageSnapshot,
  sessionId: string,
  now: number,
): SessionLineInput | null {
  const usage = findSession(snapshot, sessionId)?.usage ?? null;
  return usage === null ? null : sessionLine(usage, now);
}

// The details bar: every profile's plan, and the shown session's usage.
export function detailsInput(
  snapshot: UsageSnapshot,
  shownSessionId: string | null,
  now: number,
): DetailsInput {
  const usage = findSession(snapshot, shownSessionId)?.usage ?? null;
  return {
    profiles: snapshot.plans.map((plan) => detailsProfile(plan, now)),
    session: usage === null ? null : detailsSession(usage, now),
  };
}

// The plan line as the page log writes it: `work: 5h 42%, Week 61%`.
export function statusLineText(input: StatusLineInput): string {
  if (input.profileName === null) {
    return 'no profiles';
  }
  const meters =
    input.note ??
    input.plans.map((meter) => `${meter.label} ${meter.text}`).join(', ');
  const stalePart = input.stale ? ' (stale)' : '';
  return `${input.profileName}: ${meters}${stalePart}`;
}

// A session's line as the page log writes it:
// `context 180k/300k, cache 42m, spend $1.23`.
export function sessionLineText(input: SessionLineInput): string {
  const cachePart = input.cache === null ? '' : `, ${input.cache}`;
  const spendPart = input.spend === null ? '' : `, spend ${input.spend}`;
  return `context ${input.context.text}${cachePart}${spendPart}`;
}

// Each profile's state as the page log writes it: `work fresh, personal stale`.
export function detailsStatesText(input: DetailsInput): string {
  if (input.profiles.length === 0) {
    return 'no profiles';
  }
  return input.profiles
    .map((profile) => `${profile.name} ${profile.state}`)
    .join(', ');
}

function findSession(
  snapshot: UsageSnapshot,
  sessionId: string | null,
): SessionUsage | null {
  if (sessionId === null) {
    return null;
  }
  return (
    snapshot.sessions.find((session) => session.sessionId === sessionId) ?? null
  );
}

// The plan whose profile the shown session runs on, else the default plan;
// null when the snapshot holds no plan.
function shownPlan(
  plans: readonly ProfilePlan[],
  sessionUsage: SessionUsage | null,
): ProfilePlan | null {
  const sessionPlan =
    sessionUsage === null
      ? undefined
      : plans.find((plan) => plan.profileDir === sessionUsage.profileDir);
  return sessionPlan ?? plans.find((plan) => plan.isDefault) ?? null;
}

function planNote(plan: ProfilePlan | null): string | null {
  if (plan === null) {
    return 'no profiles';
  }
  if (plan.usage === null) {
    return plan.error === null ? 'plan loading' : 'plan unavailable';
  }
  return plan.usage.rows.length === 0 ? 'no plan rows' : null;
}

function sessionLine(usage: UsageAgentEvent, now: number): SessionLineInput {
  return {
    context: contextMeter(usage),
    cache: lineCache(usage.cacheExpiresAt, now),
    spend: usage.spendUsd === null ? null : formatUsd(usage.spendUsd),
  };
}

function lineCache(cacheExpiresAt: number | null, now: number): string | null {
  if (cacheExpiresAt === null) {
    return null;
  }
  return cacheExpiresAt <= now
    ? 'cache cold'
    : `cache ${formatDuration(cacheExpiresAt - now)}`;
}

// The limit the context meter measures against: the configured autocompact
// limit, else the reported one.
function contextLimit(usage: UsageAgentEvent): number | null {
  return usage.autocompact.configured ?? usage.autocompact.reported;
}

function contextMeter(usage: UsageAgentEvent): MeterInput {
  const used = usage.contextTokens;
  const limit = contextLimit(usage);
  if (limit === null) {
    return {
      label: 'Context',
      text: formatTokens(used),
      percent: 0,
      tone: 'normal',
    };
  }
  const share = (used * 100) / limit;
  return {
    label: 'Context',
    text: `${formatTokens(used)}/${formatTokens(limit)}`,
    percent: Math.min(100, share),
    tone: contextTone(share),
  };
}

function contextTone(share: number): UsageTone {
  if (share < CONTEXT_WARNING_PERCENT) {
    return 'normal';
  }
  return share < CONTEXT_CRITICAL_PERCENT ? 'warning' : 'critical';
}

function rowMeter(row: PlanRow): MeterInput {
  return {
    label: row.label,
    text: formatPercent(row.percent),
    percent: row.percent,
    tone: row.severity,
  };
}

function detailsProfile(plan: ProfilePlan, now: number): DetailsProfileInput {
  return {
    name: plan.name,
    isDefault: plan.isDefault,
    state: profileState(plan),
    rows: plan.usage?.rows.map((row) => detailsRow(row, now)) ?? [],
    extraUsage: extraUsageText(plan),
    freshness: freshness(plan, now),
    error: plan.error,
  };
}

function profileState(plan: ProfilePlan): DetailsProfileInput['state'] {
  if (plan.usage === null) {
    return plan.error === null ? 'loading' : 'error';
  }
  return plan.stale ? 'stale' : 'fresh';
}

function freshness(plan: ProfilePlan, now: number): string {
  if (plan.usage === null) {
    return plan.error === null ? 'loading' : 'no good read yet';
  }
  if (plan.stale) {
    return `stale, last good ${ago(now - (plan.lastGoodAt ?? plan.usage.at))}`;
  }
  return `updated ${ago(now - plan.usage.at)}`;
}

function ago(ms: number): string {
  return ms < MINUTE_MS ? 'just now' : `${formatDuration(ms)} ago`;
}

function extraUsageText(plan: ProfilePlan): string | null {
  const extra = plan.usage?.extraUsage ?? null;
  if (extra === null) {
    return null;
  }
  if (!extra.enabled) {
    return 'off';
  }
  const used = formatMinor(extra.usedMinor ?? 0, extra.currency);
  const limit =
    extra.limitMinor === null
      ? 'no limit'
      : formatMinor(extra.limitMinor, extra.currency);
  return `${used} / ${limit}`;
}

function detailsRow(row: PlanRow, now: number): DetailsRowInput {
  return { ...rowMeter(row), resets: resetsText(row.resetsAt, now) };
}

function resetsText(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) {
    return null;
  }
  return resetsAt <= now
    ? 'resets now'
    : `resets in ${formatDuration(resetsAt - now)}`;
}

function detailsSession(
  usage: UsageAgentEvent,
  now: number,
): DetailsSessionInput {
  const { configured, reported } = usage.autocompact;
  return {
    context: contextMeter(usage),
    window:
      usage.contextWindow === null
        ? 'unknown'
        : formatTokens(usage.contextWindow),
    configuredLimit: configured === null ? 'none' : formatTokens(configured),
    reportedLimit: reported === null ? 'unknown' : formatTokens(reported),
    remaining: remainingText(usage.contextTokens, contextLimit(usage)),
    limitsDiffer:
      configured !== null && reported !== null && configured !== reported,
    cache: detailsCache(usage.cacheExpiresAt, now),
    spend: usage.spendUsd === null ? 'unknown' : formatUsd(usage.spendUsd),
  };
}

// The context left before autocompact fires.
function remainingText(used: number, limit: number | null): string {
  if (limit === null) {
    return 'unknown';
  }
  if (used > limit) {
    return 'past the limit';
  }
  return `${formatTokens(limit - used)} left`;
}

function detailsCache(cacheExpiresAt: number | null, now: number): string {
  if (cacheExpiresAt === null) {
    return 'unknown';
  }
  return cacheExpiresAt <= now
    ? 'cold'
    : `expires in ${formatDuration(cacheExpiresAt - now)}`;
}
