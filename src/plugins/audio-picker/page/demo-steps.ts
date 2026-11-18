import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import {
  type DemoFormWaitDeps,
  demoFormBeat,
  isDemoFormActive,
} from '../../../shared/page/demo-form-wait';
import { audioPickerSelectRowCommand } from '../contract';

// The picker's page store and commands, the sessions plugin's `activate`, and
// the timers the wait for the sample picker runs on.
export interface AudioPickerPageDemoDeps extends DemoFormWaitDeps {
  commands: Pick<PluginCommands, 'run'>;
  log: PluginLog;
}

// The page half of `audio-picker.picker`: each beat shows the demo session's
// sample picker and selects one row. No beat plays a sound; the user plays one
// with the picker's own keys. Leaving dismisses a cancel prompt while the
// sample picker is active.
export function registerDemoSteps(
  services: PageServices,
  deps: AudioPickerPageDemoDeps,
): Disposable {
  const { commands } = deps;
  const onRow = async (moment: number, row: number) => {
    await commands.run('audio-picker.dismissConfirm');
    await commands.run(audioPickerSelectRowCommand, { moment, row });
  };
  return services.demoSteps.register({
    id: 'audio-picker.picker',
    section: 'forms',
    order: 30,
    title: 'Audio picker',
    caption:
      'Audio picker: an agent offers sound candidates for each moment, to hear and choose',
    files: [
      'src/plugins/audio-picker/main/start.ts',
      'src/plugins/audio-picker/main/fixtures.ts',
      'src/plugins/audio-picker/page/start.ts',
      'src/plugins/audio-picker/page/picker-view.ts',
      'src/plugins/audio-picker/page/picker-commands.ts',
      'src/plugins/audio-picker/page/picker-audio.ts',
    ],
    enter: (context) => {
      const sessionId = context.sessions.session;
      const beat = (name: string, run: () => Promise<void>) =>
        demoFormBeat(deps, sessionId, name, run);
      return Promise.resolve({
        beats: [
          beat('Candidates', () => onRow(0, 0)),
          beat('Choose', () => onRow(1, 1)),
          // Moment 2's one candidate is `broken.wav`, which does not decode.
          beat('Broken file', () => onRow(2, 0)),
        ],
        dispose() {
          if (isDemoFormActive(deps.store, sessionId)) {
            void commands.run('audio-picker.dismissConfirm');
          }
        },
      });
    },
  });
}
