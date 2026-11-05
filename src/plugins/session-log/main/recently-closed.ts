import type { ResumeSectionRow } from '../../chat/contract';
import { editableTitle, type SessionTitles } from '../../sessions/contract';
import type { SessionLogEntry } from './session-event-log';

interface Candidate {
  hostSessionId: string;
  projectDir: string;
  profile: string;
  titles: SessionTitles;
  at: number;
}

function candidateOf(entry: SessionLogEntry): Candidate | null {
  if (entry.event === 'closed' && entry.reason === 'user' && entry.sent) {
    return entry;
  }
  if (entry.event === 'cleared' && entry.sent) {
    return { ...entry, hostSessionId: entry.oldHostSessionId };
  }
  return null;
}

function rowOf(candidate: Candidate): ResumeSectionRow {
  return {
    hostSessionId: candidate.hostSessionId,
    projectDir: candidate.projectDir,
    profile: candidate.profile,
    title: editableTitle(candidate.titles) || 'Untitled session',
    at: candidate.at,
  };
}

// The newest `count` sessions the user closed or cleared after sending them a
// message, each once under its newest close, oldest first so the newest row
// sits next to the cursor.
export function recentlyClosed(
  entries: readonly SessionLogEntry[],
  count: number,
  isResumable: (hostSessionId: string) => boolean,
): ResumeSectionRow[] {
  const limit = Math.floor(count);
  const seen = new Set<string>();
  const rows: ResumeSectionRow[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (rows.length >= limit) {
      break;
    }
    const candidate = candidateOf(entries[index]);
    if (candidate === null || seen.has(candidate.hostSessionId)) {
      continue;
    }
    seen.add(candidate.hostSessionId);
    if (isResumable(candidate.hostSessionId)) {
      rows.push(rowOf(candidate));
    }
  }
  return rows.reverse();
}
