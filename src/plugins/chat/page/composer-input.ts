import type { SessionControl } from '../../../contracts/agent';
import type { ChatSessionState } from '../contract';
import type { ChatCommandName } from '../ids';
import type {
  ComposerControlInput,
  ComposerInput,
  ModelEffortInput,
} from '../layouts/layout';
import { valueLabel } from './chat-state';
import { controlCommand } from './control-commands';

// The composer's input for a Chat tab: a turn is in progress while the
// process runs and is not idle, and the chips are enabled only while it runs.
export function composerInputOf(tab: {
  name: string;
  state: Pick<
    ChatSessionState,
    'running' | 'activity' | 'controls' | 'repo' | 'branch'
  >;
  isBoxFocused: boolean;
}): ComposerInput {
  const { running, activity } = tab.state;
  const controls = tab.state.controls.map((control) => ({
    id: control.id,
    label: control.label,
    value: valueLabel(control),
    enabled: running,
  }));
  const { modelEffort, others } = pairModelAndEffort(controls);
  return {
    session: tab.name,
    repo: tab.state.repo,
    branch: tab.state.branch,
    isBoxFocused: tab.isBoxFocused,
    running,
    working: running && activity !== 'idle',
    modelEffort,
    controls: others,
  };
}

// The controls the model and effort pick keys reach, as one pair, and every
// other control in order; with no model control there is no pair, and an
// effort control stays with the others.
function pairModelAndEffort(controls: readonly ComposerControlInput[]): {
  modelEffort: ModelEffortInput | null;
  others: ComposerControlInput[];
} {
  const model = controls.find(
    (control) => controlCommand(control.id) === 'pickModel',
  );
  if (model === undefined) {
    return { modelEffort: null, others: [...controls] };
  }
  const effort =
    controls.find((control) => controlCommand(control.id) === 'pickEffort') ??
    null;
  return {
    modelEffort: { model, effort },
    others: controls.filter(
      (control) => control !== model && control !== effort,
    ),
  };
}

// Per control, the pick command whose keys its chip holds: the command that
// opens its picker, or null when an earlier chip already holds that
// command's keys.
export function chipKeyCommands(
  controls: readonly Pick<SessionControl, 'id'>[],
): (ChatCommandName | null)[] {
  const held = new Set<ChatCommandName>();
  return controls.map((control) => {
    const command = controlCommand(control.id);
    if (held.has(command)) {
      return null;
    }
    held.add(command);
    return command;
  });
}
