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
): RoundPresenter {
  const open = new Map<string, OpenRound>();
  const updateOpenCount = () => alerts.setOpenCount(open.size);
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
    updateOpenCount();
    entry.listener.finish(end);
  });

  return {
    show(round, listener) {
      open.set(round.roundId, { round, listener });
      sessions.markRound(round.sessionId);
      channel.send('roundShown', round);
      updateOpenCount();
      log('forms', `round shown: ${round.label}`);
      // A notification click is the user's own act, so it selects the round's
      // session and brings the window forward.
      alerts.announce('New review round', round.label, () => {
        sessions.activate(round.sessionId);
        window.show();
      });
    },
    close(roundId) {
      if (!open.delete(roundId)) {
        return;
      }
      channel.send('roundClosed', roundId);
      updateOpenCount();
    },
  };
}
