import type { PluginLog } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import type { ChatEntryPart } from '../../chat/contract';
import type { FormsCardPart } from '../../forms/contract';
import { chatReviewKey, confirmReviewKey, type Review } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  CompleteLayout,
  Layout,
  VerdictInput,
  VerdictPart,
} from '../layouts/layout';
import { permissionReviewManifest } from '../manifest';
import { verdictInput } from './verdict-input';

// `review` is the review under a `permission-review.reviews` key, undefined
// with none; `isConfirmRound` says whether a round is a confirm round open in
// `forms.confirms`.
export interface VerdictPartsDeps {
  kit: OwnerKitServices;
  log: PluginLog;
  review(key: string): Review | undefined;
  isConfirmRound(roundId: string): boolean;
}

// `entryPart` draws the verdict inside chat's permission entries and
// `cardPart` on the question card of a confirm round. `reviewChanged` redraws
// every part of a review key, `confirmChanged` every card of a round whose
// `forms.confirms` key changed, and `setLayouts` every part on screen.
export interface VerdictParts {
  entryPart: ChatEntryPart<'permission'>;
  cardPart: FormsCardPart;
  reviewChanged(key: string): void;
  confirmChanged(roundId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
}

// A wrapper chat or forms handed a part's `build`, under its review key, with
// the review it shows now (null for none) and the verdict drawn into it last.
interface Holder {
  key: string;
  parent: HTMLElement;
  review(): Review | null;
  drawn: DrawnPart<VerdictPart> | null;
}

// Neither chat's nor forms' part `build` returns a dispose, so every wrapper
// is held by its review key until a later build of that key finds it out of
// the page, which disposes its draw and drops it. A change redraws every
// holder of its key, in the page or not, so a view put back shows the current
// verdict. A wrapper with no review stays empty. After a draw it logs
// `verdict <key>: <heading>` when the heading differs from the last logged for
// that key; an empty draw forgets the key's heading.
export function createVerdictParts(deps: VerdictPartsDeps): VerdictParts {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: permissionReviewManifest.id,
    defaultLayout,
    log: deps.log,
  });
  const held = new Map<string, Set<Holder>>();
  const loggedHeadings = new Map<string, string>();

  const disposeDrawn = (holder: Holder) => {
    const drawn = holder.drawn;
    holder.drawn = null;
    drawn?.dispose();
  };

  const logHeading = (key: string, heading: string) => {
    if (loggedHeadings.get(key) === heading) {
      return;
    }
    loggedHeadings.set(key, heading);
    deps.log(`verdict ${key}: ${heading}`);
  };

  const drawVerdict = (parent: HTMLElement, input: VerdictInput) =>
    layoutParts.draw('verdict', parent, (part, slot, rollback) =>
      part(
        slot,
        input,
        createBaseKit(
          ownerBaseKitDeps(permissionReviewManifest, deps.kit, null, rollback),
        ),
      ),
    );

  // Disposes the last draw and empties the wrapper, then draws the holder's
  // review, or nothing for none.
  const rebuild = (holder: Holder, input: VerdictInput | null) => {
    try {
      disposeDrawn(holder);
    } finally {
      holder.parent.replaceChildren();
    }
    if (input === null) {
      loggedHeadings.delete(holder.key);
      return;
    }
    holder.drawn = drawVerdict(holder.parent, input);
    logHeading(holder.key, input.heading);
  };

  // As `rebuild`, but a last draw that returned an `update` takes a review in
  // its place.
  const redraw = (holder: Holder) => {
    const input = verdictInput(holder.review());
    const built = holder.drawn?.built;
    if (input !== null && built !== undefined && built.update !== undefined) {
      built.update(input);
      logHeading(holder.key, input.heading);
      return;
    }
    rebuild(holder, input);
  };

  const redrawKey = (key: string) => {
    callEach([...(held.get(key) ?? [])], redraw);
  };

  // Drops the key's holders out of the page, disposing their draws, then
  // holds `holder` and draws it.
  const hold = (holder: Holder) => {
    const holders = held.get(holder.key) ?? new Set<Holder>();
    held.set(holder.key, holders);
    const stale = [...holders].filter(({ parent }) => !parent.isConnected);
    for (const gone of stale) {
      holders.delete(gone);
    }
    holders.add(holder);
    callEach(stale, disposeDrawn);
    redraw(holder);
  };

  return {
    entryPart: {
      id: 'permission-review.verdict',
      kinds: ['permission'],
      build(parent, { sessionId, input }) {
        const key = chatReviewKey(sessionId, input.id);
        const holder: Holder = {
          key,
          parent,
          review: () => deps.review(key) ?? null,
          drawn: null,
        };
        hold(holder);
        return { update: () => redraw(holder) };
      },
    },
    cardPart: {
      id: 'permission-review.verdict',
      kinds: ['question'],
      build(parent, { roundId }) {
        const key = confirmReviewKey(roundId);
        const holder: Holder = {
          key,
          parent,
          review: () =>
            deps.isConfirmRound(roundId) ? (deps.review(key) ?? null) : null,
          drawn: null,
        };
        hold(holder);
        return { update: () => redraw(holder) };
      },
    },
    reviewChanged(key) {
      redrawKey(key);
    },
    confirmChanged(roundId) {
      redrawKey(confirmReviewKey(roundId));
    },
    setLayouts(shown) {
      layoutParts.setLayouts(shown);
      const connected = [...held.values()].flatMap((holders) =>
        [...holders].filter(({ parent }) => parent.isConnected),
      );
      callEach(connected, (holder) =>
        rebuild(holder, verdictInput(holder.review())),
      );
    },
  };
}
