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

// The ex command name of the `index`th bound key sequence: vim ex command
// names are letters only, so each digit is spelled as a word.
export function exBindName(index: number): string {
  const digits = [...String(index)].map((digit) => DIGIT_WORDS[Number(digit)]);
  return `wigleybind${digits.join('')}`;
}
