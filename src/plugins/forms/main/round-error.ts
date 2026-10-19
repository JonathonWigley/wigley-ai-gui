import { ROUND_ERROR_NAME } from '../contract';

// A malformed ask_round call. The message names the field, the 1-based
// item number, and the repair: it is the calling model's only
// repair signal.
export class RoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = ROUND_ERROR_NAME;
  }
}
