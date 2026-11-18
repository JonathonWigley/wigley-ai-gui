// A Bash call input's `command`, when it holds a string.
export function bashCommandOf(input: unknown): string | null {
  const command =
    typeof input === 'object' && input !== null && 'command' in input
      ? input.command
      : null;
  return typeof command === 'string' ? command : null;
}
