// How long a subagent has run, in whole seconds rounded down, a negative span
// read as none: `8s` under a minute, `3m 05s` under an hour, else `1h 02m`.
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${twoDigits(seconds % 60)}s`;
  }
  return `${Math.floor(minutes / 60)}h ${twoDigits(minutes % 60)}m`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
