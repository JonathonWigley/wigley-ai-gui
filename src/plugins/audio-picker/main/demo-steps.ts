import type { AgentFormService } from '../../../contracts/agent-forms';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { MainServices } from '../../../contracts/plugin';
import {
  openSampleForm,
  sampleFormOwner,
} from '../../../shared/agent-forms/demo-form';
import type { AudioPickerPayload } from '../contract';
import { writeSampleSoundsIn } from './fixtures';
import { previewPickerArgs } from './preview/preview-picker';

// `samples` is the picker's sample service (memory store, quiet presenter, no
// wake), `files` and `paths` write the sample sounds into the demo's scratch
// folder, `activate` is the sessions plugin's main `activate`.
export interface AudioPickerMainDemoDeps {
  samples: AgentFormService<AudioPickerPayload>;
  files: Pick<Files, 'writeBytes'>;
  paths: Pick<Paths, 'join'>;
  activate(sessionId: string): void;
  log: (line: string) => void;
}

// The main half of `audio-picker.picker`: the sample sounds written under the
// demo's scratch folder, never the plugin's data folder, and a demo session
// holding a picker over them. Leaving the step ends the picker; the demo
// closes the session.
export function registerDemoSteps(
  services: MainServices,
  deps: AudioPickerMainDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'audio-picker.picker',
    async enter(context) {
      const dir = deps.paths.join(
        context.scratchDir,
        'audio-picker',
        'sample-sounds',
      );
      await writeSampleSoundsIn(deps.files, dir, deps.paths);
      const sessionId = await context.launchSession(
        'A sample session for the audio picker step.',
      );
      const form = openSampleForm(
        {
          forms: deps.samples,
          activate: deps.activate,
          log: deps.log,
          noun: 'picker',
        },
        sampleFormOwner(sessionId),
        {
          ...previewPickerArgs(dir, deps.paths),
          heading: 'Daily quests: sounds',
          overview:
            'A sample picker for the demo; nothing chosen here reaches an agent.',
        },
      );
      return {
        sessions: { session: sessionId },
        dispose: () => form.dispose(),
      };
    },
  });
}
