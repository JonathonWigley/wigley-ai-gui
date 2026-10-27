import type { Paths } from '../../contracts/paths';
import type { Harness } from '../sessions/contract';
import type { NoteSession } from './contract';

// The name a note gives each harness.
export const HARNESS_LABELS: Record<Harness, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

// The label, `shownId`, and the tilde folder, each null when the session
// lacks it.
function sessionParts(
  session: NoteSession,
  shownId: string,
  paths: Paths,
  homeDir: string,
): { label: string | null; id: string; folder: string | null } {
  return {
    label: session.harness === null ? null : HARNESS_LABELS[session.harness],
    id: shownId,
    folder:
      session.projectDir === null
        ? null
        : paths.tilde(session.projectDir, homeDir),
  };
}

// The line a note writes so an agent can find the session's transcript:
// `Source session: <label> <host id> in <folder>`.
export function sessionLine(
  session: NoteSession,
  paths: Paths,
  homeDir: string,
): string {
  const { label, id, folder } = sessionParts(
    session,
    session.hostSessionId,
    paths,
    homeDir,
  );
  const parts = [label, id, folder === null ? null : `in ${folder}`];
  return `Source session: ${parts.filter((part) => part !== null).join(' ')}`;
}

// The session chip's text: `<label> · <host id's first 8> · <folder>`.
export function sessionChipText(
  session: NoteSession,
  paths: Paths,
  homeDir: string,
): string {
  const { label, id, folder } = sessionParts(
    session,
    session.hostSessionId.slice(0, 8),
    paths,
    homeDir,
  );
  return [label, id, folder].filter((part) => part !== null).join(' · ');
}
