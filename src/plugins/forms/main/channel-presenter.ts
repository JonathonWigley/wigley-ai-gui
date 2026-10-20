import type { Alerts } from '../../../contracts/alerts';
import type { Log } from '../../../contracts/log';
import type { MainChannel } from '../../../contracts/plugin';
import type { SessionsMainExports } from '../../sessions/contract';
import type {
  FormsChannel,
  PresentedRound,
  RoundListener,
  RoundPresenter,
} from '../contract';

interface OpenRound {
  round: PresentedRound;
  listener: RoundListener;
  // A quiet round raises no alert and leaves the open count.
  quiet: boolean;
}

// The presenter that announces each round and counts it open, and `quiet`,
// a view onto the same open rounds whose own rounds do neither.
export interface ChannelPresenter extends RoundPresenter {
  quiet: RoundPresenter;
}

// Shows rounds on the page over the forms channel, each marked on its
// session's row, and keeps that row from closing while the round is open; registers its
// channel handlers and close guard once, so it lives as long as the app.
export function createChannelPresenter(
  channel: MainChannel<FormsChannel>,
  alerts: Alerts,
  window: { show(): void },
  log: Log,
  sessions: SessionsMainExports,
): ChannelPresenter {
  const open = new Map<string, OpenRound>();
  const updateOpenCount = () =>
    alerts.setOpenCount(
      [...open.values()].filter((entry) => !entry.quiet).length,
    );
  const hasOpenRound = (sessionId: string) =>
    [...open.values()].some((entry) => entry.round.sessionId === sessionId);

  sessions.addCloseGuard((sessionId) => !hasOpenRound(sessionId));

  channel.handle('openRounds', () =>
    [...open.values()].map((entry) => entry.round),
  );
  // A failed write throws out of the listener, which rejects the page's invoke.
  channel.handle('draft', (roundId, body) => {
    const entry = open.get(roundId);
    if (!entry) {
      return;
    }
    entry.round = { ...entry.round, draft: body };
    entry.listener.draft(body);
  });
  channel.handle('finish', (roundId, end) => {
    const entry = open.get(roundId);
    if (!entry) {
      return;
    }
    open.delete(roundId);
    if (!entry.quiet) {
      updateOpenCount();
    }
    entry.listener.finish(end);
  });

  const show = (
    round: PresentedRound,
    listener: RoundListener,
    quiet: boolean,
  ) => {
    open.set(round.roundId, { round, listener, quiet });
    sessions.markRound(round.sessionId);
    channel.send('roundShown', round);
    log('forms', `round shown: ${round.label}`);
    if (quiet) {
      return;
    }
    updateOpenCount();
    // A notification click is the user's own act, so it selects the round's
    // session and brings the window forward.
    alerts.announce('New review round', round.label, () => {
      sessions.activate(round.sessionId);
      window.show();
    });
  };
  const close = (roundId: string) => {
    const entry = open.get(roundId);
    if (!entry) {
      return;
    }
    open.delete(roundId);
    channel.send('roundClosed', roundId);
    if (!entry.quiet) {
      updateOpenCount();
    }
  };

  return {
    show: (round, listener) => show(round, listener, false),
    close,
    quiet: {
      show: (round, listener) => show(round, listener, true),
      close,
    },
  };
}
