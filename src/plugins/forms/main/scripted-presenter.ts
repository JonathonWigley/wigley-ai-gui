import type {
  FormBody,
  PresentedRound,
  RoundListener,
  RoundPresenter,
} from '../contract';

// The test adapter: records what the service shows and closes, and plays the
// user's side through each shown round's listener.
export class ScriptedRoundPresenter implements RoundPresenter {
  readonly shown: PresentedRound[] = [];
  readonly closed: string[] = [];
  private readonly listeners = new Map<string, RoundListener>();

  show(round: PresentedRound, listener: RoundListener) {
    this.shown.push(round);
    this.listeners.set(round.roundId, listener);
  }

  close(roundId: string) {
    this.closed.push(roundId);
  }

  // The round shown most recently.
  latest(): PresentedRound {
    const round = this.shown.at(-1);
    if (round === undefined) {
      throw new Error('No round has been shown');
    }
    return round;
  }

  draft(roundId: string, body: FormBody) {
    this.listenerFor(roundId).draft(body);
  }

  submit(roundId: string, body: FormBody) {
    this.listenerFor(roundId).finish({ kind: 'submitted', body });
  }

  cancel(roundId: string, body: FormBody) {
    this.listenerFor(roundId).finish({ kind: 'cancelled', body });
  }

  private listenerFor(roundId: string): RoundListener {
    const listener = this.listeners.get(roundId);
    if (listener === undefined) {
      throw new Error(`No round ${roundId} was shown`);
    }
    return listener;
  }
}
