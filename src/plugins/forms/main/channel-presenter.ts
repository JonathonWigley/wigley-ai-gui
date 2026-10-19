import type { Alerts } from '../../../contracts/alerts';
import type { Log } from '../../../contracts/log';
import type { MainChannel } from '../../../contracts/plugin';
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

// Shows rounds on the page over the forms channel; registers its channel
// handlers once, so it lives as long as the app.
export function createChannelPresenter(
  channel: MainChannel<FormsChannel>,
  alerts: Alerts,
  window: { show(): void },
  log: Log,
): RoundPresenter {
  const open = new Map<string, OpenRound>();
  const updateOpenCount = () => alerts.setOpenCount(open.size);

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
      channel.send('roundShown', round);
      updateOpenCount();
      log('forms', `round shown: ${round.label}`);
      // A notification click is the user's own act, so the window may come
      // forward.
      alerts.announce('New review round', round.label, () => {
        window.show();
        channel.send('focusRound', round.roundId);
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
