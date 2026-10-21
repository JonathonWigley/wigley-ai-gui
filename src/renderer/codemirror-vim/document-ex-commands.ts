export type DocumentExEvent =
  | { kind: 'write' }
  | { kind: 'quit'; force: boolean }
  | { kind: 'writeQuit' };

// Each ex command a document editor answers: vim's full name and the shortest
// prefix that runs it. Vim accepts a typed name only when it is a prefix of
// the command's full name, so `wq` needs its own entry or `write` catches it.
export const DOCUMENT_EX_COMMANDS: readonly { name: string; prefix: string }[] =
  [
    { name: 'write', prefix: 'w' },
    { name: 'quit', prefix: 'q' },
    { name: 'wq', prefix: 'wq' },
    { name: 'xit', prefix: 'x' },
  ];

// The event an ex command `name` from DOCUMENT_EX_COMMANDS raises, given the
// text vim read after the name: vim reads `:q!` as `q` with `!` after it.
export function documentExEvent(
  name: string,
  argString: string | undefined,
): DocumentExEvent {
  switch (name) {
    case 'write':
      return { kind: 'write' };
    case 'quit':
      return { kind: 'quit', force: (argString ?? '').trim().startsWith('!') };
    case 'wq':
    case 'xit':
      return { kind: 'writeQuit' };
    default:
      throw new Error(`"${name}" is not a document ex command`);
  }
}
