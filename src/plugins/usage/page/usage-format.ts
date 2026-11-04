// How the usage page words its numbers.

// `42%`.
export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

// `$1.23`.
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

// `minor` units of `currency` (`1234` USD is `$12.34`, `500` JPY `¥500`); with
// no currency, hundredths to two decimals and no symbol.
export function formatMinor(minor: number, currency: string | null): string {
  if (currency === null) {
    return (minor / 100).toFixed(2);
  }
  const format = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(minor / 10 ** digits);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// `<1m`, `42m`, `2h 14m`, `3d 4h`, each unit floored.
export function formatDuration(ms: number): string {
  if (ms < MINUTE_MS) {
    return '<1m';
  }
  if (ms < HOUR_MS) {
    return `${Math.floor(ms / MINUTE_MS)}m`;
  }
  if (ms < DAY_MS) {
    return `${Math.floor(ms / HOUR_MS)}h ${Math.floor((ms % HOUR_MS) / MINUTE_MS)}m`;
  }
  return `${Math.floor(ms / DAY_MS)}d ${Math.floor((ms % DAY_MS) / HOUR_MS)}h`;
}
