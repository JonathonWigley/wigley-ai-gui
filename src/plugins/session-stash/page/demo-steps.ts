import type { DemoPageContext, DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  type DemoStartPromptDeps,
  demoStartPrompt,
} from '../../../shared/page/demo-start-prompt';
import type { NoteDialog } from './note-dialog';

// How long and how often the note beat checks that its session shows.
const SHOWN_WAIT_MS = 5000;
const SHOWN_POLL_MS = 100;

// `activate` and `shownSessionId` are sessions' page exports; `hasRow` is
// whether the side bar holds the session; `nameOf` is the session's name as
// its row shows it.
export interface SessionStashDemoPageDeps extends DemoStartPromptDeps {
  activate(sessionId: string): void;
  shownSessionId(): string | null;
  hasRow(sessionId: string): boolean;
  nameOf(sessionId: string): string;
  noteDialog: Pick<NoteDialog, 'open' | 'cancel' | 'isOpen'>;
}

// The Stash step: the note dialog over the step's session, then the start
// prompt, whose Stashed section main answers with sample rows while the demo
// runs. An accepted stash closes the demo session, which leaves nothing saved.
export function registerDemoSteps(
  services: PageServices,
  deps: SessionStashDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'session-stash.stash',
    section: 'sessions',
    order: 140,
    title: 'Stash',
    caption:
      'Stashing closes a session with a note, and the start prompt offers it back.',
    files: [
      'src/plugins/session-stash/page/note-dialog.ts',
      'src/plugins/session-stash/main/session-stash.ts',
    ],
    enter: async (context) => stashStage(deps, context),
  });
}

function stashStage(
  deps: SessionStashDemoPageDeps,
  context: DemoPageContext,
): DemoStage {
  const session = context.sessions.session;
  const prompt = demoStartPrompt(deps);
  // Bumped by each beat and the dispose, so a note beat still waiting on its
  // session stops at its next check once another beat runs or the stage is
  // left.
  let beatRun = 0;
  const startBeat = () => {
    beatRun += 1;
    return beatRun;
  };

  const cancelDialog = () => {
    if (deps.noteDialog.isOpen()) {
      deps.noteDialog.cancel();
    }
  };

  // Resolves 'shown' once the session shows, checked now and every
  // `SHOWN_POLL_MS`; 'missed' after `SHOWN_WAIT_MS`; 'left' once `run` is no
  // longer the latest beat run.
  const waitUntilShown = (run: number) =>
    new Promise<'shown' | 'missed' | 'left'>((resolve) => {
      let waited = 0;
      const poll = () => {
        if (run !== beatRun) {
          resolve('left');
        } else if (deps.shownSessionId() === session) {
          resolve('shown');
        } else if (waited >= SHOWN_WAIT_MS) {
          resolve('missed');
        } else {
          waited += SHOWN_POLL_MS;
          deps.timers.set(poll, SHOWN_POLL_MS);
        }
      };
      poll();
    });

  return {
    beats: [
      {
        name: 'note',
        async show() {
          const run = startBeat();
          prompt.cancel();
          if (!deps.hasRow(session)) {
            deps.log('demo stash session gone');
            return;
          }
          deps.activate(session);
          const shown = await waitUntilShown(run);
          if (shown === 'missed') {
            deps.log('demo stash session not shown');
          }
          if (shown !== 'shown' || deps.noteDialog.isOpen()) {
            return;
          }
          deps.noteDialog.open({
            sessionId: session,
            name: deps.nameOf(session),
          });
          // A focused note box takes the demo's keys as typed text.
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        },
      },
      {
        name: 'stashed in the prompt',
        async show() {
          startBeat();
          cancelDialog();
          await prompt.open();
        },
      },
    ],
    dispose() {
      startBeat();
      cancelDialog();
      prompt.dispose();
    },
  };
}
