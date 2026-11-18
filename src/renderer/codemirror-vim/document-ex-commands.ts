import type { DocumentEditorEvents, ExCall } from '../../contracts/editor';

// An ex command a document editor answers: vim's full name, the shortest
// prefix that runs it, and the event it raises in the editor it ran in.
export interface DocumentCommand {
  name: string;
  prefix: string;
  raise(events: DocumentEditorEvents, command: ExCall): void;
}

// Vim accepts a typed name only when it is a prefix of the command's full
// name, so `wq` needs its own entry or `write` catches it. A bang on `wq` and
// `xit` is ignored.
export const DOCUMENT_COMMANDS: readonly DocumentCommand[] = [
  { name: 'write', prefix: 'w', raise: (events) => events.write() },
  {
    name: 'quit',
    prefix: 'q',
    raise: (events, command) => events.quit(command.bang),
  },
  { name: 'wq', prefix: 'wq', raise: (events) => events.writeQuit() },
  { name: 'xit', prefix: 'x', raise: (events) => events.writeQuit() },
];
