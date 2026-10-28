import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import type { NotesPartsDeps } from './layout/notes-parts';

// Parts deps whose keys record every anchor they make, and which record each
// log line and each command run.
export function notesPartsDeps() {
  const { anchors, keys } = recordingAnchors();
  const logged: string[] = [];
  const ran: string[] = [];
  const deps: NotesPartsDeps = {
    markdown: {
      block: () => '',
      inline: () => '',
      document: () => Promise.resolve(''),
    },
    keys,
    commands: { exists: () => true, run: (id) => ran.push(id) },
    platform: 'macos',
    log: (source, line) => logged.push(`[${source}] ${line}`),
  };
  return { deps, anchors, logged, ran };
}
