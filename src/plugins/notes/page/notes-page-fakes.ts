import type { CommandArg, CommandId } from '../../../contracts/commands';
import { fakeKitCommandsOf } from '../../../shared/page/layout-host/fake-kit-commands.test-support';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { notesManifest } from '../manifest';
import type { NotesPartsDeps } from './layout/notes-parts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

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
    commands: fakeKitCommandsOf(notesManifest, (id, arg) =>
      ran.push([id, arg]),
    ),
    platform: 'macos',
    state: noLayoutState,
    log: (message: string) => logged.push(message),
  };
  return { deps, anchors, logged, ran };
}
