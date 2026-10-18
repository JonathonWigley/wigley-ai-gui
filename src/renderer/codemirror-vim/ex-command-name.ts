import type { CommandId } from '../../contracts/commands';

const DIGIT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

// Vim ex command names are letters only.
export function exCommandName(command: CommandId): string {
  return command
    .toLowerCase()
    .replace(/[0-9]/g, (digit) => DIGIT_WORDS[Number(digit)])
    .replace(/[^a-z]/g, '');
}
