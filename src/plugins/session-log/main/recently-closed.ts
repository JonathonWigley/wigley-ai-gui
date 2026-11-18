import { DEMO_HARNESS_ID, DEMO_PROFILE } from '../../../contracts/demo';
import { isUserClose, type ResumeSectionRow } from '../../chat/contract';
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
  if (entry.event === 'closed' && isUserClose(entry.reason) && entry.sent) {
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

// The demo's closed sessions, oldest first; `ago` is how long before now each
// closed.
const SAMPLE_CLOSES = [
  {
    hostSessionId: 'demo-closed-1',
    title: 'Write the release notes',
    ago: 86_400_000,
  },
  {
    hostSessionId: 'demo-closed-2',
    title: 'Profile the sidebar redraw',
    ago: 7_200_000,
  },
  {
    hostSessionId: 'demo-closed-3',
    title: 'Fix the flaky upload test',
    ago: 900_000,
  },
];

// The rows the section answers while the demo runs, on the demo profile in the
// sample folder `projectDir`: the newest `count` that `isResumable` lets
// through, oldest first, capped after the filter as `recentlyClosed` caps.
export function sampleRecentlyClosed(
  now: number,
  count: number,
  projectDir: string,
  isResumable: (hostSessionId: string) => boolean,
): ResumeSectionRow[] {
  const limit = Math.max(0, Math.floor(count));
  const rows = SAMPLE_CLOSES.filter((sample) =>
    isResumable(sample.hostSessionId),
  ).map((sample) => ({
    hostSessionId: sample.hostSessionId,
    projectDir,
    harness: DEMO_HARNESS_ID,
    profile: DEMO_PROFILE,
    title: sample.title,
    at: now - sample.ago,
  }));
  return rows.slice(rows.length - Math.min(limit, rows.length));
}
