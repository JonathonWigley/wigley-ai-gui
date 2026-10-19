import type { FormBody, PresentedRound, RoundEnd } from '../../contracts/forms';
import type { ChannelShape } from '../../contracts/plugin';

export * from '../../contracts/forms';
export * from '../../contracts/relay';

// The forms page part invokes `openRounds` on load, `draft` as the user types
// and `finish` on submit or cancel; main sends each round as it opens, the id
// of a round that closed without the page, and the id of a round a
// notification click brings forward. A `draft` whose save failed rejects with
// the reason.
export interface FormsChannel extends ChannelShape {
  invoke: {
    openRounds(): PresentedRound[];
    draft(roundId: string, body: FormBody): void;
    finish(roundId: string, end: RoundEnd): void;
  };
  messages: {
    roundShown: PresentedRound;
    roundClosed: string;
    focusRound: string;
  };
}
