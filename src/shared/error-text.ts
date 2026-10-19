// The message a thrown value carries, for a log line.
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
