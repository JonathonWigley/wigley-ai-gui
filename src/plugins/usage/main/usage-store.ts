import type {
  HarnessProfile,
  PlanRow,
  PlanRowPatch,
  PlanRowUpdate,
  PlanUsage,
  UsageAgentEvent,
} from '../../../contracts/agent';
import { replacesUsage } from '../../../shared/replaces-usage';
import type { ProfilePlan, SessionUsage, UsageSnapshot } from '../contract';

// The pure fold behind usage main: each `with…` returns the same state object
// when it changes nothing, and keeps the same `snapshot` object when only
// `held` changes, so a caller sends the snapshot when its object is new.
// Profiles sharing a `configDir` share one usage, each plan keeping its own
// `name` and `isDefault`. A session's `usage` and `compaction` fold apart, so
// neither one's event changes the other.

// A live row with its update's `at`, kept until a poll reporting its kind
// lands, so a poll older than the row cannot overwrite it.
export interface HeldPatch {
  profileDir: string | null;
  patch: PlanRowPatch;
  at: number;
}

export interface UsageState {
  snapshot: UsageSnapshot;
  held: readonly HeldPatch[];
}

export type PollResult =
  | { ok: true; usage: PlanUsage }
  | { ok: false; error: string };

export const EMPTY_USAGE_STATE: UsageState = {
  snapshot: { plans: [], sessions: [] },
  held: [],
};

// One plan per profile in `profiles` order, each matched plan keeping its
// poll state; a removed profile's held patches go with it.
export function withProfiles(
  state: UsageState,
  profiles: readonly HarnessProfile[],
): UsageState {
  const { plans } = state.snapshot;
  const unchanged =
    plans.length === profiles.length &&
    profiles.every(
      (profile, index) =>
        plans[index].name === profile.name &&
        plans[index].profileDir === profile.configDir,
    );
  if (unchanged) {
    return state;
  }
  const nextPlans = profiles.map((profile, index) =>
    planFor(plans, profile, index === 0),
  );
  return {
    snapshot: { ...state.snapshot, plans: nextPlans },
    held: state.held.filter((held) =>
      profiles.some((profile) => profile.configDir === held.profileDir),
    ),
  };
}

// On success the plan takes the poll, then folds that profile's held patches
// the poll reports and is older than, dropping every held patch of a kind it
// reports; on failure it keeps its last usage and is marked stale with the
// reason.
export function withPollResult(
  state: UsageState,
  profileDir: string | null,
  result: PollResult,
): UsageState {
  const plan = state.snapshot.plans.find(
    (held) => held.profileDir === profileDir,
  );
  if (plan === undefined) {
    return state;
  }
  if (!result.ok) {
    const alreadyFailed = plan.stale && plan.error === result.error;
    if (alreadyFailed) {
      return state;
    }
    return withPlan(
      state,
      profileDir,
      { error: result.error, stale: true },
      state.held,
    );
  }
  const { usage } = result;
  const kinds = kindsOf(usage.rows);
  const foldable: PlanRowPatch[] = [];
  const held = state.held.filter((entry) => {
    const ownedHere =
      entry.profileDir === profileDir && kinds.has(entry.patch.kind);
    if (ownedHere && entry.at > usage.at) {
      foldable.push(entry.patch);
    }
    return !ownedHere;
  });
  const rows = patchedRows(usage.rows, foldable);
  return withPlan(
    state,
    profileDir,
    {
      usage: rows === usage.rows ? usage : { ...usage, rows },
      lastGoodAt: usage.at,
      error: null,
      stale: false,
    },
    held.length === state.held.length ? state.held : held,
  );
}

// Patches every row of each update row's kind the plan's usage holds, and holds
// every update row until a poll reports its kind.
export function withLiveRows(
  state: UsageState,
  profileDir: string | null,
  update: PlanRowUpdate,
): UsageState {
  const plan = state.snapshot.plans.find(
    (held) => held.profileDir === profileDir,
  );
  if (plan === undefined) {
    return state;
  }
  const { usage } = plan;
  const kinds = usage === null ? new Set<string>() : kindsOf(usage.rows);
  const foldable = update.rows.filter((patch) => kinds.has(patch.kind));
  const held = withHeldPatches(state.held, profileDir, update.rows, update.at);
  const rows = patchedRows(usage?.rows ?? [], foldable);
  if (usage !== null && rows !== usage.rows) {
    return withPlan(state, profileDir, { usage: { ...usage, rows } }, held);
  }
  return held === state.held ? state : { ...state, held };
}

// Replaces the session's entry, keeping its `compaction`, or appends one for a
// new id with no compaction; `usage` null, a subagent's, or one whose `at` is
// older than the kept usage's, records only the session's profile, keeping a known
// session's usage. An equal `at` replaces.
export function withSessionUsage(
  state: UsageState,
  sessionId: string,
  profileDir: string | null,
  usage: UsageAgentEvent | null,
): UsageState {
  const { sessions } = state.snapshot;
  const index = sessions.findIndex((held) => held.sessionId === sessionId);
  if (index === -1) {
    return withSessions(state, [
      ...sessions,
      { sessionId, profileDir, usage, compaction: null },
    ]);
  }
  const known = sessions[index];
  const entry: SessionUsage = {
    ...known,
    profileDir,
    usage:
      usage !== null && replacesUsage(known.usage, usage) ? usage : known.usage,
  };
  if (known.profileDir === profileDir && known.usage === entry.usage) {
    return state;
  }
  return withSessions(state, sessions.with(index, entry));
}

// A known session takes `compaction` and the profile, keeping its usage; an
// unknown one is appended with no usage while `compaction` is not null.
export function withSessionCompaction(
  state: UsageState,
  sessionId: string,
  profileDir: string | null,
  compaction: SessionUsage['compaction'],
): UsageState {
  const { sessions } = state.snapshot;
  const index = sessions.findIndex((held) => held.sessionId === sessionId);
  if (index === -1) {
    return compaction === null
      ? state
      : withSessions(state, [
          ...sessions,
          { sessionId, profileDir, usage: null, compaction },
        ]);
  }
  const known = sessions[index];
  if (
    known.profileDir === profileDir &&
    sameCompaction(known.compaction, compaction)
  ) {
    return state;
  }
  return withSessions(
    state,
    sessions.with(index, { ...known, profileDir, compaction }),
  );
}

export function withoutSession(
  state: UsageState,
  sessionId: string,
): UsageState {
  const { sessions } = state.snapshot;
  const remaining = sessions.filter((held) => held.sessionId !== sessionId);
  return remaining.length === sessions.length
    ? state
    : withSessions(state, remaining);
}

function sameCompaction(
  a: SessionUsage['compaction'],
  b: SessionUsage['compaction'],
): boolean {
  return a?.trigger === b?.trigger && a?.startedAt === b?.startedAt;
}

function planFor(
  plans: readonly ProfilePlan[],
  profile: HarnessProfile,
  isDefault: boolean,
): ProfilePlan {
  const matched = plans.find((plan) => plan.profileDir === profile.configDir);
  if (matched !== undefined) {
    return { ...matched, name: profile.name, isDefault };
  }
  return {
    name: profile.name,
    profileDir: profile.configDir,
    isDefault,
    usage: null,
    lastGoodAt: null,
    error: null,
    stale: false,
  };
}

function kindsOf(rows: readonly PlanRow[]): Set<string> {
  return new Set(rows.map((row) => row.kind));
}

// `rows` with each patch's `percent`, `resetsAt` and `severity` on every row
// of its kind; the same array when no row's values change.
function patchedRows(
  rows: readonly PlanRow[],
  patches: readonly PlanRowPatch[],
): readonly PlanRow[] {
  let changed = false;
  const next = rows.map((row) => {
    const patch = patches.find((candidate) => candidate.kind === row.kind);
    const differs =
      patch !== undefined &&
      (patch.percent !== row.percent ||
        patch.resetsAt !== row.resetsAt ||
        patch.severity !== row.severity);
    if (!differs) {
      return row;
    }
    changed = true;
    return {
      ...row,
      percent: patch.percent,
      resetsAt: patch.resetsAt,
      severity: patch.severity,
    };
  });
  return changed ? next : rows;
}

// `held` with each of `patches` replacing that profile's held patch of its
// kind; the same array when every patch is already held as it is.
function withHeldPatches(
  held: readonly HeldPatch[],
  profileDir: string | null,
  patches: readonly PlanRowPatch[],
  at: number,
): readonly HeldPatch[] {
  let next = held;
  for (const patch of patches) {
    const index = next.findIndex(
      (entry) =>
        entry.profileDir === profileDir && entry.patch.kind === patch.kind,
    );
    const entry: HeldPatch = { profileDir, patch, at };
    if (index === -1) {
      next = [...next, entry];
    } else if (!sameHeldPatch(next[index], entry)) {
      next = next.with(index, entry);
    }
  }
  return next;
}

function sameHeldPatch(a: HeldPatch, b: HeldPatch): boolean {
  return (
    a.at === b.at &&
    a.patch.percent === b.patch.percent &&
    a.patch.resetsAt === b.patch.resetsAt &&
    a.patch.severity === b.patch.severity
  );
}

// Every plan of `profileDir` with `change`, each keeping its own `name` and
// `isDefault`.
function withPlan(
  state: UsageState,
  profileDir: string | null,
  change: Partial<
    Pick<ProfilePlan, 'usage' | 'lastGoodAt' | 'error' | 'stale'>
  >,
  held: readonly HeldPatch[],
): UsageState {
  const plans = state.snapshot.plans.map((current) =>
    current.profileDir === profileDir ? { ...current, ...change } : current,
  );
  return { snapshot: { ...state.snapshot, plans }, held };
}

function withSessions(
  state: UsageState,
  sessions: readonly SessionUsage[],
): UsageState {
  return { ...state, snapshot: { ...state.snapshot, sessions } };
}
