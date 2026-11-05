import type { Paths } from '../../../contracts/paths';
import type {
  CloneStranded,
  EditorState,
  PoolAction,
  PoolClone,
  PoolHolder,
  PoolState,
} from '../contract';
import type {
  HolderInput,
  PanelCloneInput,
  PanelInput,
  RowBadgeInput,
} from '../layouts/layout';

// A session row as the pool matches it: the app's row id, its side-bar label, its folder and its host session id.
export interface PoolRow {
  sessionId: string;
  label: string;
  projectDir: string | null;
  hostSessionId: string | null;
}

// A clone's Hold or Release: running until main answers, then its outcome.
export interface PendingAction {
  action: PoolAction;
  running: boolean;
  result: { ok: boolean; text: string } | null;
}

const EDITOR_WORDS: Record<EditorState, string> = {
  ready: 'editor ready',
  busy: 'editor busy',
  play: 'in Play Mode',
  closed: 'editor closed',
  unknown: 'editor state unknown',
};

const STRANDED_WORDS: Record<CloneStranded['reason'], string> = {
  'expired-dirty': 'claim expired with changes',
  'session-ended-dirty': 'session ended with changes',
};

const ORDINAL_SUFFIXES: Readonly<Record<number, string>> = {
  1: 'st',
  2: 'nd',
  3: 'rd',
};

// `1st`, `2nd`, `3rd`, `4th` … with `11th`, `12th` and `13th` in every hundred.
export function ordinal(position: number): string {
  const lastTwoDigits = position % 100;
  const isTeen = lastTwoDigits >= 11 && lastTwoDigits <= 13;
  const suffix = isTeen ? 'th' : (ORDINAL_SUFFIXES[position % 10] ?? 'th');
  return `${position}${suffix}`;
}

// One badge per pool, in the snapshot's name order: `Unity <n>` for a clone the row's session holds by an agent
// claim or an open handoff, else `Unity: queued <ordinal>` for its queue ticket. A hold and a stranded mark belong
// to no session and show none.
export function rowBadges(
  pools: readonly PoolState[],
  row: PoolRow,
): RowBadgeInput[] {
  const badges: RowBadgeInput[] = [];
  for (const pool of pools) {
    const badge = poolBadge(pool, row);
    if (badge !== null) {
      badges.push(badge);
    }
  }
  return badges;
}

// The pool the row's folder is in: the first, by name, with a clone path holding the folder, else the one named
// `originName`, the folder's origin repo name; null for a row with no folder.
export function poolOfRow(
  pools: readonly PoolState[],
  row: PoolRow,
  originName: string | null,
  paths: Pick<Paths, 'isInside'>,
): PoolState | null {
  const folder = row.projectDir;
  if (folder === null) {
    return null;
  }
  const byClone = pools.find((pool) =>
    pool.clones.some((clone) => paths.isInside(folder, clone.path)),
  );
  return (
    byClone ??
    pools.find((pool) => originName !== null && pool.pool === originName) ??
    null
  );
}

// The panel of `pool` at `now`: each clone in number order with its holder matched to `rows`, the queue in order,
// and the counts. `pending` holds this pool's Hold and Release runs by clone number; an action's `run` calls
// `actions.run` with its clone, and a session holder's `select` calls `actions.select` with its row id.
export function panelInput(
  pool: PoolState,
  rows: readonly PoolRow[],
  now: number,
  pending: ReadonlyMap<number, PendingAction>,
  actions: {
    run(action: PoolAction, clone: number): void;
    select(sessionId: string): void;
  },
): PanelInput {
  const longWait = pool.queue.some((ticket) => ticket.longWait);
  const clones = pool.clones.map((clone) =>
    cloneInput(
      clone,
      rows,
      now,
      pending.get(clone.number) ?? null,
      longWait,
      actions,
    ),
  );
  const queue = pool.queue.map((ticket, index) => ({
    position: ordinal(index + 1),
    holder: holderInput(ticket, rows, null, actions.select),
    branch: ticket.branch,
    waitedMs: now - ticket.enqueuedAt,
    longWait: ticket.longWait,
  }));
  return {
    pool: pool.pool,
    clones,
    queue,
    longWait,
    counts: {
      held: pool.clones.filter((clone) => clone.claim !== null).length,
      free: pool.clones.filter(
        (clone) => isUnheld(clone) && clone.facts.dirty !== true,
      ).length,
      queued: queue.length,
      blocking: clones.filter((clone) => clone.blocking).length,
    },
  };
}

function poolBadge(pool: PoolState, row: PoolRow): RowBadgeInput | null {
  const held = pool.clones.find((clone) => {
    const claimedByRow =
      clone.claim !== null &&
      clone.claim.kind === 'agent' &&
      belongsTo(clone.claim, row);
    const handedToRow = clone.handoff !== null && belongsTo(clone.handoff, row);
    return claimedByRow || handedToRow;
  });
  if (held !== undefined) {
    return { text: `Unity ${held.number}`, queued: false };
  }
  const index = pool.queue.findIndex((ticket) => belongsTo(ticket, row));
  return index === -1
    ? null
    : { text: `Unity: queued ${ordinal(index + 1)}`, queued: true };
}

// A holder belongs to the row its `row` names, else to the row whose host session its `session` is; a null never
// matches.
function belongsTo(holder: PoolHolder, row: PoolRow): boolean {
  const byRow = holder.row !== null && holder.row === row.sessionId;
  const bySession =
    holder.session !== null && holder.session === row.hostSessionId;
  return byRow || bySession;
}

function isUnheld(clone: PoolClone): boolean {
  return (
    clone.claim === null && clone.handoff === null && clone.stranded === null
  );
}

function cloneInput(
  clone: PoolClone,
  rows: readonly PoolRow[],
  now: number,
  pending: PendingAction | null,
  longWait: boolean,
  actions: {
    run(action: PoolAction, clone: number): void;
    select(sessionId: string): void;
  },
): PanelCloneInput {
  const { facts, handoff, stranded, warmup } = clone;
  const isDirty = facts.dirty === true;
  const unheld = isUnheld(clone);
  return {
    title: `Unity ${clone.number}`,
    path: clone.path,
    branch: facts.branch ?? (facts.probedAt === null ? 'unknown' : 'detached'),
    dirty: isDirty,
    editor: EDITOR_WORDS[facts.editor],
    holder: cloneHolder(clone, rows, now, actions.select),
    handoffMs: handoff === null ? null : Math.max(0, handoff.until - now),
    stranded:
      stranded === null
        ? null
        : {
            reason: STRANDED_WORDS[stranded.reason],
            forMs: now - stranded.since,
          },
    warmup:
      warmup === null || warmup.state === 'done'
        ? null
        : { state: warmup.state, error: warmup.error },
    blocking: longWait && (!unheld || isDirty),
    action: cloneAction(clone, unheld, pending, actions.run),
    result: pending?.result ?? null,
  };
}

function cloneAction(
  clone: PoolClone,
  unheld: boolean,
  pending: PendingAction | null,
  run: (action: PoolAction, clone: number) => void,
): PanelCloneInput['action'] {
  const running = pending?.running ?? false;
  if (unheld) {
    return { label: 'Hold', run: () => run('hold', clone.number), running };
  }
  if (clone.claim?.kind === 'hold') {
    return {
      label: 'Release',
      run: () => run('release', clone.number),
      running,
    };
  }
  return null;
}

// The clone's holder from its claim, else its handoff, else its stranded mark; only a claim carries an idle time.
function cloneHolder(
  clone: PoolClone,
  rows: readonly PoolRow[],
  now: number,
  select: (sessionId: string) => void,
): HolderInput | null {
  const { claim } = clone;
  if (claim !== null) {
    return claim.kind === 'hold'
      ? { kind: 'user', label: 'Held by you', idleMs: null, select: null }
      : holderInput(claim, rows, now - claim.renewedAt, select);
  }
  const other = clone.handoff ?? clone.stranded;
  return other === null ? null : holderInput(other, rows, null, select);
}

function holderInput(
  holder: PoolHolder,
  rows: readonly PoolRow[],
  idleMs: number | null,
  select: (sessionId: string) => void,
): HolderInput {
  const row = rows.find((each) => belongsTo(holder, each));
  if (row !== undefined) {
    return {
      kind: 'session',
      label: row.label,
      idleMs,
      select: () => select(row.sessionId),
    };
  }
  const label =
    holder.session === null
      ? 'unknown session'
      : `session ${holder.session.slice(0, 8)}`;
  return { kind: 'agent', label, idleMs, select: null };
}
