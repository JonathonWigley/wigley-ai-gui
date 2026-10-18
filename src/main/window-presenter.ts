import { type BrowserWindow, ipcMain } from 'electron';
import type { Alerts } from '../contracts/alerts';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type {
  FormBody,
  PresentedRound,
  RoundEnd,
  RoundListener,
  RoundPresenter,
} from '../contracts/forms';
import type { Log } from '../contracts/log';

interface OpenRound {
  round: PresentedRound;
  listener: RoundListener;
}

// A notification click is the user's own act, so the window may come forward.
function focusRound(window: BrowserWindow, roundId: string) {
  window.show();
  window.focus();
  window.webContents.send(BRIDGE_CHANNELS.focusRound, roundId);
}

// Shows rounds in the window over the forms IPC channels; registers its IPC
// handlers once, so it lives as long as the app.
export function createWindowPresenter(
  window: BrowserWindow,
  alerts: Alerts,
  log: Log,
): RoundPresenter {
  const open = new Map<string, OpenRound>();
  const updateOpenCount = () => alerts.setOpenCount(open.size);

  ipcMain.handle(BRIDGE_CHANNELS.openRounds, () =>
    [...open.values()].map((entry) => entry.round),
  );
  // A failed write throws out of the listener, which rejects the page's invoke.
  ipcMain.handle(
    BRIDGE_CHANNELS.draft,
    (_event, roundId: string, body: FormBody) => {
      const entry = open.get(roundId);
      if (!entry) {
        return;
      }
      entry.round = { ...entry.round, draft: body };
      entry.listener.draft(body);
    },
  );
  ipcMain.on(
    BRIDGE_CHANNELS.finish,
    (_event, roundId: string, end: RoundEnd) => {
      const entry = open.get(roundId);
      if (!entry) {
        return;
      }
      open.delete(roundId);
      updateOpenCount();
      entry.listener.finish(end);
    },
  );

  return {
    show(round, listener) {
      open.set(round.roundId, { round, listener });
      window.webContents.send(BRIDGE_CHANNELS.roundShown, round);
      updateOpenCount();
      log('forms', `round shown: ${round.label}`);
      alerts.announce('New review round', round.label, () =>
        focusRound(window, round.roundId),
      );
    },
    close(roundId) {
      if (!open.delete(roundId)) {
        return;
      }
      window.webContents.send(BRIDGE_CHANNELS.roundClosed, roundId);
      updateOpenCount();
    },
  };
}
