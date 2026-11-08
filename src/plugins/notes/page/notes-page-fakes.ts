import type {
  CommandArg,
  CommandArgShape,
  CommandId,
} from '../../../contracts/commands';
import type { KitCommands } from '../../../shared/page/layout-host/base-kit';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { notesManifest } from '../manifest';
import type { NotesPartsDeps } from './layout/notes-parts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

const NOTES_COMMANDS: Readonly<
  Record<string, { label: string; arg?: CommandArgShape }>
> = notesManifest.commands;

// The kit commands a notes part under test checks and runs: every command,
// each notes command with the arg its manifest declares. Each run goes to
// `run`.
export function fakeNotesKitCommands(run: KitCommands['run']): KitCommands {
  return {
    exists: () => true,
    argShape(id) {
      const short = id.startsWith('notes.') ? id.slice('notes.'.length) : '';
      return Object.hasOwn(NOTES_COMMANDS, short)
        ? NOTES_COMMANDS[short].arg
        : undefined;
    },
    run,
  };
}

// Parts deps whose keys record every anchor they make, and which record each
// log line and each command run with its arg.
export function notesPartsDeps() {
  const { anchors, keys } = recordingAnchors();
  const logged: string[] = [];
  const ran: [CommandId, CommandArg | undefined][] = [];
  const deps: NotesPartsDeps = {
    markdown: {
      block: () => '',
      inline: () => '',
      document: () => Promise.resolve(''),
      ...NO_FENCES,
    },
    keys,
    commands: fakeNotesKitCommands((id, arg) => ran.push([id, arg])),
    platform: 'macos',
    state: noLayoutState,
    log: (message: string) => logged.push(message),
  };
  return { deps, anchors, logged, ran };
}
