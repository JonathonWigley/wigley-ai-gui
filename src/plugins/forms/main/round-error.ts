import { type ItemKind, ROUND_ERROR_NAME } from '../contract';

// Where a malformed round call is wrong.
export type RoundErrorPath =
  | { at: 'call' } // the round call as a whole
  | { at: 'field'; field: string } // one of the round's own fields
  | { at: 'item'; kind: ItemKind; number: number }; // one item, `number` 1-based

export type RoundItemPath = Extract<RoundErrorPath, { at: 'item' }>;

// A malformed round call: where it is wrong, what is wrong, and the repair
// when `problem` alone does not name it. It is the calling model's only
// repair signal, worded by `roundErrorText`; `message` is for logs.
export class RoundError extends Error {
  readonly path: RoundErrorPath;
  readonly problem: string;
  // '' when there is none.
  readonly detail: string;

  constructor(fields: {
    path: RoundErrorPath;
    problem: string;
    detail?: string;
  }) {
    const detail = fields.detail ?? '';
    super(detail === '' ? fields.problem : `${fields.problem} ${detail}`);
    this.name = ROUND_ERROR_NAME;
    this.path = fields.path;
    this.problem = fields.problem;
    this.detail = detail;
  }
}
