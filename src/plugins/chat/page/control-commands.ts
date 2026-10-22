import type { ChatCommandName } from '../ids';

// The control ids the pick keys reach, by command.
export const CONTROL_IDS = {
  pickMode: 'mode',
  pickEffort: 'effort',
  pickModel: 'model',
} as const;

type KeyedCommand = keyof typeof CONTROL_IDS;

// The command that opens `controlId`'s picker: its own pick command, or
// `pickControl` (the list of every control) for a control with none.
export function controlCommand(controlId: string): ChatCommandName {
  const keyed = (Object.keys(CONTROL_IDS) as KeyedCommand[]).find(
    (command) => CONTROL_IDS[command] === controlId,
  );
  return keyed ?? 'pickControl';
}
