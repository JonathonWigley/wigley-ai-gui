import path from 'node:path';
import type { AgentHarness } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import {
  type FakeAgentProcessRecord,
  markRun,
  type RunMark,
} from '../../../shared/fake-agent-harness';
import type {
  ConnectedSession,
  SessionsMainExports,
} from '../../sessions/contract';
import type { DraftStore } from './draft-store';

export interface NotesSelfTestDeps {
  // `services.homeDir`, the self-test's temp home.
  homeDir: string;
  files: Pick<Files, 'read' | 'realPath' | 'makeFolder'>;
  paths: Paths;
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
  harnesses: readonly AgentHarness[];
  store: Pick<DraftStore, 'clear'>;
  // Resolves at the next send to a new session that main reports sent.
  nextSessionSend(): Promise<void>;
}

interface NotesSelfTestResult {
  // The fixture session's folder, docs' fixture repo.
  folder: string;
  // The fixture home's `followups.md` once the steps sent.
  followups: string;
  // The first message of the session the steps launched in `folder`.
  send: { text: string; imageCount: number } | null;
}

// The fixture session's host id, which the step lines name.
const SESSION_ID = 'notes-selftest';
// Docs' fixture repo and the features home its index lists for it.
const REPO = 'selftest-repo';
// A word no other follow-up holds, so the append picker's filter ranks the
// note's follow-up first.
const TITLE_TOKEN = 'qxnotesnit';
const TITLE = `Notes selftest ${TITLE_TOKEN}`;
const SESSION_LINE = `Source session: Claude Code ${SESSION_ID} in ~/dev/${REPO}`;
const LAUNCH_BRIEF =
  'A nitpick to fix, noted while working. Make the change, then report.';

const FRESH_LINE = `[notes] popup shown: title "", 0 images, target ${REPO}, session ${SESSION_ID}`;
const OPEN = [' ', 'n', 'n'];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'open',
    why: "Space n n opens the popup over the current mode, attaches the selected session, and defaults the target to that session's repo by its folder name.",
    steps: [
      { keys: OPEN, expect: FRESH_LINE, screenshot: 'popup', checksFit: true },
      {
        keys: [
          ...'The save hint sits low. It overlaps the bar.',
          'Escape',
          'Escape',
        ],
        expect: '[notes] field body',
      },
      { keys: ['k'], expect: '[notes] field title' },
      {
        keys: ['i', ...TITLE, 'Escape'],
        expect: '[notes] field title',
      },
      { keys: [], expect: '[notes] draft saved' },
    ],
  },
  {
    name: 'kept on close',
    why: 'Closing keeps the draft, and the reopened popup reads it back from main, the read a page reload makes.',
    steps: [
      { keys: ['Escape'], expect: '[notes] popup closed' },
      {
        keys: OPEN,
        expect: `[notes] popup shown: title "${TITLE}", 0 images, target ${REPO}, session ${SESSION_ID}`,
      },
    ],
  },
  {
    name: 'capture and markup',
    why: 'A capture attaches a PNG of the window, and the markup view opens on it with its tool and colour keys.',
    steps: [
      {
        keys: ['Escape', ' ', 'n', 'c'],
        expect: '[notes] image 1 attached (capture)',
        screenshot: 'popup-image',
      },
      { keys: ['Enter'], expect: '[notes] markup shown for image 1' },
      { keys: ['t'], expect: '[notes] tool text' },
      { keys: ['c'], expect: '[notes] colour yellow', screenshot: 'markup' },
      { keys: ['Escape'], expect: '[notes] markup closed for image 1' },
    ],
  },
  {
    name: 'new follow-up',
    why: 'Cmd+Enter files the note as a new follow-up in the target home, with its image and session line, and clears the draft.',
    steps: [
      {
        keys: ['<D-Enter>'],
        expect: `[notes] sent: Follow-up added: ${TITLE}`,
      },
    ],
  },
  {
    name: 'append',
    why: "The append picker lists the target home's open follow-ups, and the chosen one gets the note at its end.",
    steps: [
      { keys: OPEN, expect: FRESH_LINE },
      {
        keys: [...'Also the border.', 'Escape', ' ', 'n', 'a'],
        expect: '[notes] picker shown: Follow-up',
      },
      {
        keys: ['/', ...TITLE_TOKEN, 'Enter'],
        expect: `[notes] sent: Added to ${TITLE}`,
      },
    ],
  },
  {
    name: 'new session',
    why: "Space n s starts a background session in the target's folder, its first message the brief, the note and the session line.",
    steps: [
      { keys: OPEN, expect: FRESH_LINE },
      {
        keys: [...'Launch me.', 'Escape', ' ', 'n', 's'],
        expect: `[notes] sent: Session started in ~/dev/${REPO}`,
      },
    ],
  },
  {
    name: 'discard',
    why: 'Discard asks first, then drops the draft and keeps the popup open.',
    steps: [
      { keys: OPEN, expect: FRESH_LINE },
      {
        keys: [...'Throw this away', 'Escape', ' ', 'n', 'd'],
        expect: '[notes] discard asked',
      },
      { keys: ['y'], expect: '[notes] draft discarded' },
      { keys: ['Escape'], expect: '[notes] popup closed' },
    ],
  },
];

// The first message of the first fake process this run started in `folder`.
function launchedSend(
  marks: readonly RunMark[],
  folder: string,
  paths: Paths,
): NotesSelfTestResult['send'] {
  const launched: FakeAgentProcessRecord | undefined = marks
    .flatMap((mark) => mark.harness.processes.slice(mark.processes))
    .find((record) => paths.samePath(record.request.projectDir, folder));
  const send = launched?.calls.find((call) => call.method === 'send');
  return send === undefined
    ? null
    : { text: send.text, imageCount: send.imageCount };
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

function followupProblems(followups: string): string[] {
  const problems: string[] = [];
  if (!followups.includes(`**${TITLE}**`)) {
    problems.push(`follow-up "${TITLE}" missing`);
  }
  const holdsBody =
    followups.includes('The save hint sits low.') &&
    followups.includes('It overlaps the bar.');
  if (!holdsBody) {
    problems.push('note body missing');
  }
  const sessionLines = countOf(followups, SESSION_LINE);
  if (sessionLines !== 2) {
    problems.push(`session line count ${String(sessionLines)}, expected 2`);
  }
  const imageLink = followups.indexOf('followups-images/');
  const appended = followups.indexOf('Also the border.');
  if (imageLink === -1) {
    problems.push('image link missing');
  }
  if (appended === -1) {
    problems.push('appended text missing');
  }
  const isImageAfterAppend =
    imageLink !== -1 && appended !== -1 && imageLink > appended;
  if (isImageAfterAppend) {
    problems.push('image link after the appended text');
  }
  return problems;
}

function sendProblems({ folder, send }: NotesSelfTestResult): string[] {
  if (send === null) {
    return [`no session launched in ${folder}`];
  }
  const problems: string[] = [];
  const holdsNote =
    send.text.startsWith(LAUNCH_BRIEF) &&
    send.text.includes('Launch me.') &&
    send.text.includes(SESSION_LINE);
  if (!holdsNote) {
    problems.push(`launched message ${send.text}`);
  }
  if (send.imageCount !== 0) {
    problems.push(`launched message carries ${String(send.imageCount)} images`);
  }
  return problems;
}

// Each run ends the last run's fixture session, clears the draft, and
// connects the session `notes-selftest` in docs' fixture repo, activating its
// row so the popup attaches it. The result waits for the steps' send to a new
// session, then reads the fixture home's follow-ups and that session's first
// message.
export function notesSelfTestScript(deps: NotesSelfTestDeps): SelfTestScript {
  const { homeDir, files, paths, sessions, harnesses, store } = deps;
  let previous: ConnectedSession | null = null;

  async function run(sent: Promise<void>): Promise<NotesSelfTestResult> {
    await store.clear();
    const home = await files.realPath(homeDir);
    const folder = path.join(home, 'dev', REPO);
    await files.makeFolder(folder);
    const connected = sessions.connect({
      sessionId: SESSION_ID,
      projectDir: folder,
      deadlineSeconds: null,
      harness: 'claude',
    });
    previous = connected;
    sessions.activate(connected.session.id);
    const marks = markRun(harnesses);
    await sent;
    const followups = await files.read(
      path.join(home, 'wigley-features', REPO, 'followups.md'),
    );
    return { folder, followups, send: launchedSend(marks, folder, paths) };
  }

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: ['.notes-target', '.notes-session'],
    open() {
      previous?.end();
      previous = null;
      const result = run(deps.nextSessionSend());
      return { shownLine: `[notes] session ${SESSION_ID} listed`, result };
    },
    groups: GROUPS,
    problems: (result) => {
      const ran = result as NotesSelfTestResult;
      return [...followupProblems(ran.followups), ...sendProblems(ran)];
    },
  };
}
