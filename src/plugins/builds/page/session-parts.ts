import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type {
  CommandsRunIn,
  PageChannel,
  ToastTone,
} from '../../../contracts/plugin';
import type { KeyedSlotReader } from '../../../contracts/state';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  disposeDraws,
  type RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import type { LayoutParts } from '../../../shared/page/layout-host/layout-parts';
import type { ChatPageExports, ComposerStopExits } from '../../chat/contract';
import {
  followRows,
  type RowActivity,
  type SessionRow,
  type SessionsPageExports,
} from '../../sessions/contract';
import type { BuildsChannel, BuildsSnapshot, SessionBuilds } from '../contract';
import type {
  BaseKit,
  BuildsLayout,
  CompleteBuildsLayout,
} from '../layouts/layout';
import { buildsManifest } from '../manifest';
import type { BuildsDemoSample } from './demo-sample';
import {
  BUILDING_ACTIVITY,
  hubBuildInputs,
  isBuilding,
  offerCardInput,
  rowLineInput,
} from './session-parts-model';

// The page commands the session parts run.
export type SessionPartsCommand = Extract<
  CommandsRunIn<typeof buildsManifest, 'page'>,
  | 'queueOffer'
  | 'dismissOffer'
  | 'queueSessionOffer'
  | 'dismissSessionOffer'
  | 'leaveOffer'
  | 'offerFocusBox'
  | 'offerAppendBox'
>;

export const ROW_PART = 'builds.row';
export const HUB_PART = 'builds.hub';
export const OFFER_PART = 'builds.offer';
const ACTIVITY_SOURCE = 'builds';
const NO_OFFER = 'No build offer in this session';

// `snapshot` and `sessions` are `builds.snapshot` and `builds.sessions` as they are now; `sample` is the shown demo
// sample, null with none. `setScope` sets the base scope `offer`.
export interface SessionPartsDeps {
  sessionsPage: Pick<
    SessionsPageExports,
    'addRowPart' | 'setActivity' | 'shownSessionId'
  >;
  chat: Pick<ChatPageExports, 'addSidePart' | 'addComposerPart'>;
  channel: PageChannel<BuildsChannel>;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  kitServices: OwnerKitServices;
  parts: LayoutParts<BuildsLayout, CompleteBuildsLayout>;
  rows: KeyedSlotReader<SessionRow>;
  snapshot(): BuildsSnapshot;
  sessions(): ReadonlyMap<string, SessionBuilds>;
  sample(): BuildsDemoSample | null;
  setScope(): void;
}

// `changed` redraws every held part and sets every activity, after a change of the builds, the sessions' links, the
// rows, the layouts or the sample. `queueOffer` and `dismissOffer` act on the offer of the session the card's stop
// holds, else of the focused session; `queueSessionOffer` and `dismissSessionOffer` on the named session's. The other
// three hand the stop's cursor back as the agent strip's keys do.
export interface SessionParts {
  changed(): void;
  queueOffer(): void;
  dismissOffer(): void;
  queueSessionOffer(sessionId: string): void;
  dismissSessionOffer(sessionId: string): void;
  leaveOffer(): void;
  offerToBox(how: 'insert' | 'append'): void;
  dispose(): void;
}

type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

// A wrapper or a hub body sessions or chat handed a part, and what was drawn into it last.
interface Held {
  parent: HTMLElement;
  draws: DrawnRoot[];
}

// The session the offer card's stop holds the entry cursor in, and the exits its `enter` was handed.
interface Hold {
  sessionId: string;
  exits: ComposerStopExits;
}

// What a session's parts draw from: the sample while it holds the session, else the slots.
interface Source {
  builds: SessionBuilds | undefined;
  snapshot: BuildsSnapshot;
  isSample: boolean;
}

// The line under each session row with a build (`builds.row`), the `building` activity of a session waiting on its
// build, the session hub's Builds section (`builds.hub`) and the offer card above the Chat composer (`builds.offer`),
// whose stop takes the entry cursor while the session has an offer. Each part redraws into its own wrapper on each
// `changed`. The hold ends when the held session's offer goes, the cursor going back to the entries. While a sample
// shows, the sample's sessions draw and set their activity from it, every other session's activity stays as it was,
// and queueing or dismissing a sample session's offer logs `demo: <command> does nothing`.
export function startSessionParts(deps: SessionPartsDeps): SessionParts {
  const { channel, log, parts } = deps;
  const rowsHeld = new Map<string, Held>();
  const hubsHeld = new Map<string, Set<Held>>();
  const cardsHeld = new Map<string, Set<Held>>();
  // The activity each session was last set, by session id; a session never set holds no key.
  const activities = new Map<string, RowActivity>();
  let hold: Hold | null = null;
  let isDisposed = false;

  const labelOf = (sessionId: string) =>
    deps.rows.get(sessionId)?.label ?? sessionId;

  const sourceOf = (sessionId: string): Source => {
    const sample = deps.sample();
    if (sample?.sessions.has(sessionId)) {
      return {
        builds: sample.sessions.get(sessionId),
        snapshot: sample.snapshot,
        isSample: true,
      };
    }
    return {
      builds: deps.sessions().get(sessionId),
      snapshot: deps.snapshot(),
      isSample: false,
    };
  };

  const kitFor = (scope: 'list' | 'offer', rollback: RollbackDeps): BaseKit =>
    createBaseKit(
      ownerBaseKitDeps(buildsManifest, deps.kitServices, scope, rollback),
    );

  const clear = (held: Held) => {
    const draws = held.draws;
    held.draws = [];
    try {
      disposeDraws(draws);
    } finally {
      held.parent.replaceChildren();
    }
  };

  // ── Drawing ────────────────────────────────────────────────────────────
  const drawRow = (sessionId: string, held: Held) => {
    clear(held);
    const { builds, snapshot } = sourceOf(sessionId);
    const input = rowLineInput(builds, snapshot);
    if (input === null) {
      return;
    }
    held.draws.push(
      parts.draw('rowLine', held.parent, (rowLine, into, rollback) => ({
        element: rowLine(into, input, kitFor('list', rollback)),
      })),
    );
  };

  const drawHub = (sessionId: string, held: Held) => {
    clear(held);
    const { builds, snapshot } = sourceOf(sessionId);
    for (const input of hubBuildInputs(builds, snapshot)) {
      held.draws.push(
        parts.draw('hubBuild', held.parent, (hubBuild, into, rollback) => ({
          element: hubBuild(into, input, kitFor('list', rollback)),
        })),
      );
    }
  };

  const drawCard = (sessionId: string, held: Held) => {
    clear(held);
    const { builds, snapshot } = sourceOf(sessionId);
    const offer = builds?.offer ?? null;
    if (offer === null) {
      return;
    }
    const input = offerCardInput(sessionId, offer, snapshot);
    const drawn = parts.draw(
      'offerCard',
      held.parent,
      (offerCard, into, rollback) => ({
        element: offerCard(into, input, kitFor('offer', rollback)),
      }),
    );
    held.draws.push(drawn);
    drawn.built.element.classList.toggle(
      'is-cursor',
      hold?.sessionId === sessionId,
    );
  };

  const drawCardsOf = (sessionId: string) => {
    callEach([...(cardsHeld.get(sessionId) ?? [])], (held) =>
      drawCard(sessionId, held),
    );
  };

  const drawAll = () => {
    callEach<() => void>(
      [
        () => callEach([...rowsHeld], ([id, held]) => drawRow(id, held)),
        () =>
          callEach([...hubsHeld], ([id, set]) =>
            callEach([...set], (held) => drawHub(id, held)),
          ),
        () =>
          callEach([...cardsHeld], ([id, set]) =>
            callEach([...set], (held) => drawCard(id, held)),
          ),
      ],
      (step) => step(),
    );
  };

  // ── Activity ───────────────────────────────────────────────────────────
  const setActivity = (sessionId: string) => {
    const { builds, snapshot } = sourceOf(sessionId);
    const next = isBuilding(builds, snapshot) ? BUILDING_ACTIVITY : null;
    if ((activities.get(sessionId) ?? null) === next) {
      return;
    }
    if (next === null) {
      activities.delete(sessionId);
    } else {
      activities.set(sessionId, next);
    }
    deps.sessionsPage.setActivity(sessionId, ACTIVITY_SOURCE, next);
    log(`activity in ${labelOf(sessionId)}: ${next?.word ?? 'none'}`);
  };

  // While a sample shows, only its sessions; else every row, every session the slot holds, and every session set
  // before, so one that left the slot is cleared.
  const setActivities = () => {
    const sample = deps.sample();
    const sessionIds =
      sample === null
        ? new Set([
            ...deps.rows.all().keys(),
            ...deps.sessions().keys(),
            ...activities.keys(),
          ])
        : new Set(sample.sessions.keys());
    callEach([...sessionIds], setActivity);
  };

  // ── Offer stop ─────────────────────────────────────────────────────────
  const dropHold = (): Hold | null => {
    const dropped = hold;
    if (dropped === null) {
      return null;
    }
    hold = null;
    drawCardsOf(dropped.sessionId);
    return dropped;
  };

  // The held session's offer is gone, whatever ended it: the cursor goes back to the entries.
  const endHoldWithoutOffer = () => {
    if (hold === null || (sourceOf(hold.sessionId).builds?.offer ?? null)) {
      return;
    }
    const dropped = dropHold();
    if (dropped !== null) {
      log(`offer card left in ${labelOf(dropped.sessionId)}: offer gone`);
      dropped.exits.toEntries();
    }
  };

  const leaveWith = (exit: (exits: ComposerStopExits) => void) => {
    const dropped = dropHold();
    if (dropped === null) {
      return;
    }
    log(`offer card left in ${labelOf(dropped.sessionId)}`);
    exit(dropped.exits);
  };

  const toastFailure = (method: string, error: unknown) => {
    const text = errorText(error);
    log(`${method} failed: ${text}`);
    if (!isDisposed) {
      deps.toast(text, 'error');
    }
  };

  // The session to act on, or null after toasting that it has no offer; a sample session logs and gives null.
  const offerSession = (
    method: 'queueOffer' | 'dismissOffer',
    sessionId: string | null,
  ): string | null => {
    const source = sessionId === null ? null : sourceOf(sessionId);
    if (sessionId === null || !source?.builds?.offer) {
      deps.toast(NO_OFFER, 'info');
      return null;
    }
    if (source.isSample) {
      log(`demo: ${method} does nothing`);
      return null;
    }
    return sessionId;
  };

  const queueOfferOf = (target: string | null) => {
    const sessionId = offerSession('queueOffer', target);
    if (sessionId === null) {
      return;
    }
    channel.invoke('queueOffer', sessionId).then(
      (answer) => {
        if ('problem' in answer) {
          if (!isDisposed) {
            deps.toast(answer.problem, 'error');
          }
          return;
        }
        log(`queued the build offer in ${labelOf(sessionId)}`);
      },
      (error: unknown) => toastFailure('queueOffer', error),
    );
  };

  const dismissOfferOf = (target: string | null) => {
    const sessionId = offerSession('dismissOffer', target);
    if (sessionId === null) {
      return;
    }
    channel.invoke('dismissOffer', sessionId).then(
      () => log(`dismissed the build offer in ${labelOf(sessionId)}`),
      (error: unknown) => toastFailure('dismissOffer', error),
    );
  };

  const heldOrShown = () =>
    hold?.sessionId ?? deps.sessionsPage.shownSessionId();

  // ── Parts ──────────────────────────────────────────────────────────────
  const addTo = (
    map: Map<string, Set<Held>>,
    sessionId: string,
    held: Held,
  ): Disposable => {
    const set = map.get(sessionId) ?? new Set<Held>();
    set.add(held);
    map.set(sessionId, set);
    return {
      dispose() {
        set.delete(held);
        if (set.size === 0 && map.get(sessionId) === set) {
          map.delete(sessionId);
        }
        clear(held);
      },
    };
  };

  const registrations: Disposable[] = [
    deps.sessionsPage.addRowPart({
      id: ROW_PART,
      build(wrapper, sessionId) {
        const held: Held = { parent: wrapper, draws: [] };
        rowsHeld.set(sessionId, held);
        drawRow(sessionId, held);
        return {
          dispose() {
            if (rowsHeld.get(sessionId) === held) {
              rowsHeld.delete(sessionId);
            }
            clear(held);
          },
        };
      },
    }),
    deps.chat.addSidePart({
      id: HUB_PART,
      title: 'Builds',
      order: 20,
      build(parent, sessionId) {
        const held: Held = { parent, draws: [] };
        const added = addTo(hubsHeld, sessionId, held);
        // Chat keeps no dispose for a build that throws.
        try {
          drawHub(sessionId, held);
        } catch (error) {
          added.dispose();
          throw error;
        }
        return added;
      },
    }),
    deps.chat.addComposerPart({
      id: OFFER_PART,
      build(wrapper, sessionId) {
        const held: Held = { parent: wrapper, draws: [] };
        const added = addTo(cardsHeld, sessionId, held);
        drawCard(sessionId, held);
        return added;
      },
      stop: {
        // A hold another session's card has hands its cursor back first.
        enter(sessionId, exits) {
          if (!sourceOf(sessionId).builds?.offer) {
            return false;
          }
          if (hold !== null && hold.sessionId !== sessionId) {
            leaveWith((otherExits) => otherExits.toEntries());
          }
          hold = { sessionId, exits };
          deps.setScope();
          drawCardsOf(sessionId);
          log(`offer card holds the cursor in ${labelOf(sessionId)}`);
          return true;
        },
        leave(sessionId) {
          if (hold?.sessionId !== sessionId) {
            return;
          }
          dropHold();
          log(`offer card left in ${labelOf(sessionId)}`);
        },
      },
    }),
    followRows(deps.rows, {
      removed(sessionId) {
        activities.delete(sessionId);
      },
    }),
  ];

  return {
    changed() {
      if (isDisposed) {
        return;
      }
      callEach<() => void>(
        [endHoldWithoutOffer, drawAll, setActivities],
        (step) => step(),
      );
    },
    queueOffer: () => queueOfferOf(heldOrShown()),
    dismissOffer: () => dismissOfferOf(heldOrShown()),
    queueSessionOffer: (sessionId) => queueOfferOf(sessionId),
    dismissSessionOffer: (sessionId) => dismissOfferOf(sessionId),
    leaveOffer: () => leaveWith((exits) => exits.toEntries()),
    offerToBox: (how) => leaveWith((exits) => exits.toBox(how)),
    dispose() {
      isDisposed = true;
      hold = null;
      callEach(registrations, (registration) => registration.dispose());
    },
  };
}
