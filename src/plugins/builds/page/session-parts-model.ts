import type { RowActivity } from '../../sessions/contract';
import { kindLabel, shortRevision } from '../builds-model';
import type {
  BuildOffer,
  BuildRecord,
  BuildRef,
  BuildsSnapshot,
  GameEntry,
  GameView,
  SessionBuilds,
} from '../contract';
import type {
  HubBuildInput,
  OfferCardInput,
  RowLineInput,
} from '../layouts/layout';
import { buildDetailInput } from './builds-view-model';

// A session waiting on a build it queued: over a workflow stage (15) and `done` (10), under chat's `working` (20).
export const BUILDING_ACTIVITY: RowActivity = {
  word: 'building',
  tone: 'running',
  rank: 18,
};

// The build `ref` names and the game view that lists it; null when the snapshot does not hold it.
export function findRecord(
  snapshot: BuildsSnapshot,
  ref: BuildRef,
): { record: BuildRecord; view: GameView } | null {
  const backend = snapshot.backends.find((held) => held.id === ref.backendId);
  for (const view of backend?.games ?? []) {
    const record = view.builds.find((held) => held.id === ref.buildId);
    if (record !== undefined) {
      return { record, view };
    }
  }
  return null;
}

// The row line of the session's newest build; null with no build, or when the snapshot does not hold the newest.
export function rowLineInput(
  builds: SessionBuilds | undefined,
  snapshot: BuildsSnapshot,
): RowLineInput | null {
  const newest = builds?.builds[0];
  const found = newest === undefined ? null : findRecord(snapshot, newest);
  if (found === null) {
    return null;
  }
  const { record, view } = found;
  return {
    gameLabel: view.game.label,
    kindLabel: choiceLabel(view.game, record.kind),
    number: record.number,
    state: record.state,
    result: record.result,
    percent: record.percent,
    leftMs: record.leftSeconds === null ? null : record.leftSeconds * 1000,
  };
}

// True while a build the session links, and the snapshot holds, has not finished.
export function isBuilding(
  builds: SessionBuilds | undefined,
  snapshot: BuildsSnapshot,
): boolean {
  return (builds?.builds ?? []).some((ref) => {
    const found = findRecord(snapshot, ref);
    return found !== null && found.record.state !== 'finished';
  });
}

// One hub build per build the session links that the snapshot holds, newest first.
export function hubBuildInputs(
  builds: SessionBuilds | undefined,
  snapshot: BuildsSnapshot,
): HubBuildInput[] {
  return (builds?.builds ?? []).flatMap((ref) => {
    const found = findRecord(snapshot, ref);
    if (found === null) {
      return [];
    }
    const { record, view } = found;
    const detail = buildDetailInput(record);
    return [
      {
        gameLabel: view.game.label,
        kindLabel: choiceLabel(view.game, record.kind),
        number: record.number,
        branch: record.branch,
        shortRevision:
          record.revision === null ? null : shortRevision(record.revision),
        state: record.state,
        result: record.result,
        jobs: detail.jobs,
        links: detail.links,
      },
    ];
  });
}

// The offer card of session `sessionId`; a game the snapshot does not hold shows its id and the offer's kind.
export function offerCardInput(
  sessionId: string,
  offer: BuildOffer,
  snapshot: BuildsSnapshot,
): OfferCardInput {
  const game =
    snapshot.backends
      .find((backend) => backend.id === offer.backendId)
      ?.games.find((view) => view.game.id === offer.gameId)?.game ?? null;
  return {
    sessionId,
    gameLabel: game?.label ?? offer.gameId,
    choiceLabel: game === null ? offer.kind : choiceLabel(game, offer.kind),
    branch: offer.branch,
    shortRevision:
      offer.revision === null ? null : shortRevision(offer.revision),
    subject: offer.subject,
  };
}

// The label of `kind` in `game`: its kind's, else its set's, else the id.
function choiceLabel(game: GameEntry, kind: string): string {
  if (Object.hasOwn(game.kinds, kind)) {
    return kindLabel(game, kind);
  }
  return game.sets.find((set) => set.id === kind)?.label ?? kind;
}
