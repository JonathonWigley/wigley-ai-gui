import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { MainServices } from '../../../contracts/plugin';
import type { ScreenCapture } from '../../../contracts/screen-capture';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import type { LivePick } from '../contract';
import { demoStreamPick } from '../window-pick';

// `picks` is the `live-view.picks` writer; `ownProcessId` is the main
// process's id, which owns the app's window.
export interface LiveViewDemoMainDeps {
  screenCapture: Pick<ScreenCapture, 'access' | 'listWindows'>;
  picks: Pick<KeyedSlotWriter<LivePick>, 'set' | 'delete'>;
  ownProcessId: number;
  log: PluginLog;
}

// The Live view step's main half: a session whose Live section streams the
// Unity editor, else the app's own window, until the step is left. Access
// the user was never asked for shows the blocked pick and lists no windows,
// so the demo raises no Screen Recording prompt.
export function registerDemoSteps(
  services: MainServices,
  deps: LiveViewDemoMainDeps,
): Disposable {
  const { picks, log } = deps;
  return services.demoSteps.register({
    id: 'live-view.stream',
    async enter(context) {
      const session = await context.launchSession('Watch the game.');
      const stage = {
        sessions: { session },
        dispose: () => picks.delete(session),
      };
      if (deps.screenCapture.access() === 'undetermined') {
        picks.set(session, { kind: 'blocked' });
        return stage;
      }
      let pick: LivePick | null;
      try {
        pick = demoStreamPick(
          await deps.screenCapture.listWindows(),
          deps.ownProcessId,
        );
      } catch (error) {
        log(`demo live view: windows not listed: ${errorText(error)}`);
        return stage;
      }
      if (pick === null) {
        log('demo live view: no window to stream');
      } else {
        picks.set(session, pick);
      }
      return stage;
    },
  });
}
