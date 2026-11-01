import type {
  ExtraUsage,
  PlanRow,
  PlanRowPatch,
  PlanSeverity,
  PlanUsage,
} from '../../contracts/agent';
import { isJsonObject } from '../../shared/json';
import { asArray, asJson, asString, type Json, parsed } from './json-fields';

// The adapter's names for the kinds the server sends unscoped.
const KIND_LABELS: Readonly<Record<string, string>> = {
  session: '5h',
  weekly_all: 'Week',
};

const SEVERITIES: ReadonlySet<string> = new Set([
  'normal',
  'warning',
  'critical',
]);

// `rate_limit_info.unifiedWindows` keys, in row order, and the plan row kind each reports.
const WINDOW_KINDS: readonly (readonly [string, string])[] = [
  ['five_hour', 'session'],
  ['seven_day', 'weekly_all'],
];

const WINDOW_SEVERITIES: Readonly<Record<string, PlanSeverity>> = {
  allowed: 'normal',
  allowed_warning: 'warning',
  rejected: 'critical',
};

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

function resetTime(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

// A scoped row's model or surface name, else the kind's own label, else the kind itself.
function rowLabel(kind: string, scope: Json): string {
  const modelName = stringOrNull(asJson(scope.model).display_name);
  const surfaceName = stringOrNull(asJson(scope.surface).display_name);
  return modelName ?? surfaceName ?? KIND_LABELS[kind] ?? kind;
}

// One `limits[]` item as a row; null when it has no string `kind` or number `percent`.
function planRow(item: Json): PlanRow | null {
  const { kind, percent } = item;
  if (typeof kind !== 'string' || typeof percent !== 'number') {
    return null;
  }
  const severity = asString(item.severity);
  return {
    kind,
    group: typeof item.group === 'string' ? item.group : kind,
    label: rowLabel(kind, asJson(item.scope)),
    percent,
    resetsAt: resetTime(item.resets_at),
    severity: SEVERITIES.has(severity) ? (severity as PlanSeverity) : 'normal',
    isActive: item.is_active === true,
  };
}

function extraUsageOf(value: unknown): ExtraUsage | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const extra = value;
  return {
    enabled: extra.is_enabled === true,
    usedMinor: numberOrNull(extra.used_credits),
    limitMinor: numberOrNull(extra.monthly_limit),
    currency: stringOrNull(extra.currency),
  };
}

// The `rate_limits` object of the first `assistant` line carrying one, or null.
function reportedRateLimits(stdout: string): Json | null {
  for (const line of stdout.split('\n')) {
    const json = parsed(line);
    if (!json.ok) {
      continue;
    }
    const event = asJson(json.value);
    const rateLimits = asJson(event.usage_report).rate_limits;
    if (event.type === 'assistant' && isJsonObject(rateLimits)) {
      return rateLimits;
    }
  }
  return null;
}

// The plan usage `claude -p /usage --output-format stream-json` printed, read at `at`. Throws when no line carries
// a usage report, or the report holds no row.
export function readPlanUsage(stdout: string, at: number): PlanUsage {
  const rateLimits = reportedRateLimits(stdout);
  if (rateLimits === null) {
    throw new Error('claude -p /usage printed no usage report');
  }
  const rows = asArray(rateLimits.limits)
    .map((item) => planRow(asJson(item)))
    .filter((row) => row !== null);
  if (rows.length === 0) {
    throw new Error('claude -p /usage reported no plan limits');
  }
  return { rows, extraUsage: extraUsageOf(rateLimits.extra_usage), at };
}

// The plan rows a `rate_limit_event`'s `rate_limit_info` reports; null when it reports none.
export function rateLimitRows(event: Json): PlanRowPatch[] | null {
  const windows = asJson(event.unifiedWindows);
  const rows: PlanRowPatch[] = [];
  for (const [key, kind] of WINDOW_KINDS) {
    const window = asJson(windows[key]);
    if (typeof window.utilization !== 'number') {
      continue;
    }
    const resetsAt = numberOrNull(window.resetsAt);
    rows.push({
      kind,
      percent: Math.round(window.utilization * 100),
      resetsAt: resetsAt === null ? null : resetsAt * 1000,
      severity: WINDOW_SEVERITIES[asString(window.status)] ?? 'normal',
    });
  }
  return rows.length === 0 ? null : rows;
}
