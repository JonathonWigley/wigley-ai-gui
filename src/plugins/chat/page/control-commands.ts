import { CONTROL_ROLES } from '../../../contracts/agent';
import type { ChatCommandName } from '../ids';

// The control roles the pick keys reach, by command.
export const ROLE_COMMANDS = {
  pickMode: CONTROL_ROLES.permissionMode,
  pickEffort: CONTROL_ROLES.effort,
  pickModel: CONTROL_ROLES.model,
} as const;

type KeyedCommand = keyof typeof ROLE_COMMANDS;

// The command that opens the picker of a control with `role`: its role's own
// pick command, or `pickControl` (the list of every control) for a control
// with no role or a role no key binds.
export function controlCommand(role: string | null): ChatCommandName {
  const keyed = (Object.keys(ROLE_COMMANDS) as KeyedCommand[]).find(
    (command) => ROLE_COMMANDS[command] === role,
  );
  return keyed ?? 'pickControl';
}
