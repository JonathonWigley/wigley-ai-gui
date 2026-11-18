import { DEMO_HARNESS_ID } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { NotePopup } from './popup';
import { createSampleNoteChannel } from './sample-note';

const IMAGE_WIDTH = 480;
const IMAGE_HEIGHT = 270;

// The note popup the sample shows in.
export interface NotesPageDemoDeps {
  popup: Pick<NotePopup, 'showSample'>;
}

// The sample note's image: a quest card whose timer reads an hour too long.
async function drawSampleImage(): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('No 2D canvas to draw the sample image');
  }
  context.fillStyle = '#1e2433';
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  context.fillStyle = '#2f3a52';
  context.fillRect(40, 60, IMAGE_WIDTH - 80, IMAGE_HEIGHT - 120);
  context.fillStyle = '#e8ecf4';
  context.font = '24px sans-serif';
  context.fillText('Daily quests', 64, 110);
  context.fillStyle = '#f0b44c';
  context.font = '40px monospace';
  context.fillText('24:59:58', 64, 170);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await png.arrayBuffer());
}

// The page half of `notes.note`: the note popup showing a sample note that
// names the demo session, in place of the user's draft, which it never reads
// or writes.
export function registerDemoSteps(
  services: PageServices,
  deps: NotesPageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'notes.note',
    section: 'forms',
    order: 50,
    title: 'Notes',
    caption:
      'Notes: a quick note over any mode, filed as a follow-up or sent to a new session',
    files: [
      'src/plugins/notes/page/popup.ts',
      'src/plugins/notes/page/popup-state.ts',
      'src/plugins/notes/page/markup-view.ts',
      'src/plugins/notes/main/start.ts',
      'src/plugins/notes/main/note-sender.ts',
    ],
    enter: (context) => {
      const sessionId = context.sessions.session;
      const channel = createSampleNoteChannel({
        session: {
          sessionId,
          harness: DEMO_HARNESS_ID,
          hostSessionId: sessionId,
          projectDir: context.scratchDir,
        },
        drawImage: drawSampleImage,
      });
      const view = deps.popup.showSample(channel);
      return Promise.resolve({
        beats: [{ name: 'Note', show: () => view.show('body') }],
        dispose: () => view.dispose(),
      });
    },
  });
}
