import { PRIMER_ERROR_NAME } from '../contract';

// A malformed open_primer call. The message names the field and what it must
// hold: it is the calling model's only repair signal.
export class PrimerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = PRIMER_ERROR_NAME;
  }
}
