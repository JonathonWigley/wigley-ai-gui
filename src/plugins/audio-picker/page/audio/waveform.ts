// One peak per bucket, each 0 to 1: the largest absolute sample across every
// channel in the bucket's span of samples. Peaks are not normalised, so a
// quiet sound draws low. A sound shorter than `buckets` repeats samples so
// no bucket is empty.
export function waveformPeaks(
  channels: readonly Float32Array[],
  buckets: number,
): number[] {
  if (buckets <= 0) {
    return [];
  }
  const length = channels.length === 0 ? 0 : channels[0].length;
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i++) {
    if (length === 0) {
      peaks.push(0);
      continue;
    }
    const start = Math.floor((i * length) / buckets);
    const end = Math.min(
      length,
      Math.max(Math.floor(((i + 1) * length) / buckets), start + 1),
    );
    peaks.push(Math.min(1, peakOf(channels, start, end)));
  }
  return peaks;
}

function peakOf(
  channels: readonly Float32Array[],
  start: number,
  end: number,
): number {
  let peak = 0;
  for (const channel of channels) {
    for (let sample = start; sample < end; sample++) {
      peak = Math.max(peak, Math.abs(channel[sample]));
    }
  }
  return peak;
}
