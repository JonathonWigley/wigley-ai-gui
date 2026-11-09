import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { AgentHarness } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import {
  type FakeAgentProcessRecord,
  markRun,
  type RunMark,
} from '../../../shared/fake-agent-harness';
import { base64LengthOf, MAX_IMAGE_BASE64 } from '../../../shared/image-types';
import type {
  OwnedSession,
  SessionsMainExports,
} from '../../sessions/contract';
import type { DraftStore } from './draft-store';

export interface NotesSelfTestDeps {
  // `services.homeDir`, the self-test's temp home.
  homeDir: string;
  files: Pick<Files, 'read' | 'realPath' | 'makeFolder'>;
  paths: Paths;
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
  harnesses: readonly AgentHarness[];
  store: Pick<DraftStore, 'clear' | 'addImage'>;
  // Resolves at the next send to a new session that main reports sent.
  nextSessionSend(): Promise<void>;
}

interface NotesSelfTestResult {
  // The fixture session's folder, docs' fixture repo.
  folder: string;
  // The fixture home's `followups.md` once the steps sent.
  followups: string;
  // The first message of each session the steps launched in `folder`, in
  // launch order.
  sends: LaunchedSend[];
  // The base64 length of the over-cap PNG the fixture put in the draft.
  overCapBase64: number;
}

interface LaunchedSend {
  text: string;
  imageCount: number;
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
const SESSION_SENT_LINE = `[notes] sent: Session started in ~/dev/${REPO}`;
// The over-cap image's size: RGB noise, which deflate cannot shrink, whose
// base64 text is over the API's cap at full size and under it at the first
// shrink step's 0.75 scale.
const NOISE_WIDTH = 1600;
const NOISE_HEIGHT = 1000;
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
      {
        keys: ['i', '<Tab>', 'Escape', 'Escape'],
        expect: '[notes] field body',
        why: 'Tab moves from the title box to the body box, which takes it in INSERT.',
      },
      {
        keys: ['i', '<S-Tab>', 'Escape'],
        expect: '[notes] field title',
        why: 'Shift+Tab, in INSERT in the body box, moves back to the title box.',
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
        expect: SESSION_SENT_LINE,
      },
    ],
  },
  {
    name: 'shrunk image',
    why: "A session send re-encodes an image over the API's cap smaller through main's native image encoder, so the new session gets it under the cap; the fixture adds the over-cap PNG once the new session group's send went out.",
    steps: [
      {
        keys: OPEN,
        expect: `[notes] popup shown: title "", 1 images, target ${REPO}, session ${SESSION_ID}`,
      },
      {
        keys: [...'Shrink me.', 'Escape', ' ', 'n', 's'],
        expect: SESSION_SENT_LINE,
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

// The first message of each fake process this run started in `folder`, in
// start order.
function launchedSends(
  marks: readonly RunMark[],
  folder: string,
  paths: Paths,
): LaunchedSend[] {
  const launched: FakeAgentProcessRecord[] = marks
    .flatMap((mark) => mark.harness.processes.slice(mark.processes))
    .filter((record) => paths.samePath(record.request.projectDir, folder));
  return launched.flatMap((record) => {
    const send = record.calls.find((call) => call.method === 'send');
    return send === undefined
      ? []
      : [{ text: send.text, imageCount: send.imageCount }];
  });
}

// A PNG of `width` by `height` RGB noise, each row unfiltered.
function noisePng(width: number, height: number): Uint8Array {
  const rowLength = 1 + width * 3;
  const pixels = randomBytes(rowLength * height);
  for (let row = 0; row < height; row++) {
    pixels[row * rowLength] = 0;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Bit depth 8, colour type 2 (RGB), then default compression, filter and
  // interlace.
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// A PNG chunk: its data's length, its type, the data, and the CRC of the type
// and data.
function pngChunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
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

function sendProblems({ folder, sends }: NotesSelfTestResult): string[] {
  const send = sends.at(0);
  if (send === undefined) {
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

function shrunkSendProblems({
  folder,
  sends,
  overCapBase64,
}: NotesSelfTestResult): string[] {
  const problems: string[] = [];
  if (overCapBase64 <= MAX_IMAGE_BASE64) {
    problems.push(
      `fixture image ${String(overCapBase64)} base64, not over the cap`,
    );
  }
  const send = sends.at(1);
  if (send === undefined) {
    return [...problems, `no second session launched in ${folder}`];
  }
  if (!send.text.includes('Shrink me.')) {
    problems.push(`second launched message ${send.text}`);
  }
  // Chat refuses to launch with an image over the cap, so one that arrived is
  // under it.
  if (send.imageCount !== 1) {
    problems.push(
      `second launched message carries ${String(send.imageCount)} images, expected 1`,
    );
  }
  return problems;
}

// Each run ends the last run's fixture session, clears the draft, and opens
// the session `notes-selftest` in docs' fixture repo in the background,
// activating its row so the popup attaches it. Once the steps' first send to
// a new session went out it adds an over-cap noise PNG to the cleared draft,
// for the shrunk image group, and the result waits for the second send, then
// reads the fixture home's follow-ups and each launched session's first
// message. A run a later open replaced writes nothing more, and its result
// never settles.
export function notesSelfTestScript(deps: NotesSelfTestDeps): SelfTestScript {
  const { homeDir, files, paths, sessions, harnesses, store } = deps;
  let previous: OwnedSession | null = null;
  let latestOpen = 0;

  async function run(sent: Promise<void>): Promise<NotesSelfTestResult> {
    const thisOpen = latestOpen;
    const isReplaced = () => thisOpen !== latestOpen;
    const overCapPng = noisePng(NOISE_WIDTH, NOISE_HEIGHT);
    await store.clear();
    const home = await files.realPath(homeDir);
    if (isReplaced()) {
      return new Promise<never>(() => {});
    }
    const folder = path.join(home, 'dev', REPO);
    await files.makeFolder(folder);
    if (isReplaced()) {
      return new Promise<never>(() => {});
    }
    const opened = sessions.open(
      {
        sessionId: SESSION_ID,
        projectDir: folder,
        harness: 'claude',
      },
      { select: false },
    );
    previous = opened;
    sessions.activate(opened.session.id);
    const marks = markRun(harnesses);
    await sent;
    if (isReplaced()) {
      return new Promise<never>(() => {});
    }
    // Registered before the image is added, so it waits for the send after
    // `sent`.
    const shrunkSent = deps.nextSessionSend();
    await store.addImage(overCapPng);
    await shrunkSent;
    const followups = await files.read(
      path.join(home, 'wigley-features', REPO, 'followups.md'),
    );
    return {
      folder,
      followups,
      sends: launchedSends(marks, folder, paths),
      overCapBase64: base64LengthOf(overCapPng.length),
    };
  }

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: ['.notes-target', '.notes-session'],
    open() {
      latestOpen++;
      previous?.end();
      previous = null;
      const result = run(deps.nextSessionSend());
      return { shownLine: `[notes] session ${SESSION_ID} listed`, result };
    },
    groups: GROUPS,
    problems: (result) => {
      const ran = result as NotesSelfTestResult;
      return [
        ...followupProblems(ran.followups),
        ...sendProblems(ran),
        ...shrunkSendProblems(ran),
      ];
    },
  };
}
