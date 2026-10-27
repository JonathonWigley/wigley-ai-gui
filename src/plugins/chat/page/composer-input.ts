import type { SessionControl } from '../../../contracts/agent';
import type { VimMode } from '../../../contracts/editor';
import { modeLabel } from '../../../shared/vim-mode-label';
import type { ChatSessionState } from '../contract';
import type { ChatCommandName } from '../ids';
import type { ComposerInput } from '../layouts/layout';
import { valueLabel } from './chat-state';
import { controlCommand } from './control-commands';

// The composer's input for a Chat tab: a turn is in progress while the
// process runs and is not idle, and the chips are enabled only while it runs.
export function composerInputOf(tab: {
  name: string;
  state: Pick<ChatSessionState, 'running' | 'activity' | 'controls'>;
  isBoxFocused: boolean;
  boxMode: VimMode;
}): ComposerInput {
  const { running, activity } = tab.state;
  return {
    session: tab.name,
    modeLabel: modeLabel(tab.isBoxFocused ? tab.boxMode : null),
    isBoxFocused: tab.isBoxFocused,
    running,
    working: running && activity !== 'idle',
    controls: tab.state.controls.map((control) => ({
      id: control.id,
      label: control.label,
      value: valueLabel(control),
      enabled: running,
    })),
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
