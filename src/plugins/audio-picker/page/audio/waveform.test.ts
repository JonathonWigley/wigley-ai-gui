import { describe, expect, it } from 'vitest';
import { waveformPeaks } from './waveform';

// Every sample below is exact in float32, so the peaks compare exactly.
describe('waveformPeaks', () => {
  it.each<{
    case: string;
    channels: number[][];
    buckets: number;
    peaks: number[];
  }>([
    {
      case: 'one channel, absolute peak',
      channels: [[0.25, -0.5, 0.125, 0.375]],
      buckets: 2,
      peaks: [0.5, 0.375],
    },
    {
      case: 'two channels, the larger wins',
      channels: [
        [0.125, 0.25, -0.125, 0],
        [-0.375, 0.125, 0.0625, 0.5],
      ],
      buckets: 2,
      peaks: [0.375, 0.5],
    },
    {
      case: 'uneven split',
      channels: [[0.125, 0.875, 0.25, 0.375, 0.5]],
      buckets: 2,
      peaks: [0.875, 0.5],
    },
    {
      case: 'fewer samples than buckets',
      channels: [[0.25, -0.75]],
      buckets: 4,
      peaks: [0.25, 0.25, 0.75, 0.75],
    },
    {
      case: 'clipped to 1',
      channels: [[1.5, -0.25, 0.125]],
      buckets: 1,
      peaks: [1],
    },
    { case: 'no channels', channels: [], buckets: 3, peaks: [0, 0, 0] },
    { case: 'an empty channel', channels: [[]], buckets: 2, peaks: [0, 0] },
    { case: 'no buckets', channels: [[0.5]], buckets: 0, peaks: [] },
  ])(
    'waveformPeaks_Channels_GivesEachBucketsPeak: $case',
    ({ channels, buckets, peaks }) => {
      const samples = channels.map((channel) => new Float32Array(channel));

      expect(waveformPeaks(samples, buckets)).toEqual(peaks);
    },
  );
});
