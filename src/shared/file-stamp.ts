// `epochMs` in local time as `yyyyMMdd-HHmmss`, 24-hour and zero-padded:
// 2026-11-02 09:05:07 → '20261102-090507'.
export function fileStamp(epochMs: number): string {
  const time = new Date(epochMs);
  const date = [time.getFullYear(), time.getMonth() + 1, time.getDate()].map(
    twoDigits,
  );
  const clock = [time.getHours(), time.getMinutes(), time.getSeconds()].map(
    twoDigits,
  );
  return `${date.join('')}-${clock.join('')}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
