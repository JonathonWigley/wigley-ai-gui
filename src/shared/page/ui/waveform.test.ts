import { describe, expect, it } from 'vitest';
import { waveformShape } from './waveform';

describe('waveformShape', () => {
  it.each([
    {
      case: 'peaks',
      peaks: [0.5, 0.25, 1],
      viewBox: '0 0 3 2',
      bars: [
        { x: 0, y: 0.5, width: 0.7, height: 1 },
        { x: 1, y: 0.75, width: 0.7, height: 0.5 },
        { x: 2, y: 0, width: 0.7, height: 2 },
      ],
    },
    {
      case: 'silence',
      peaks: [0, 0],
      viewBox: '0 0 2 2',
      bars: [
        { x: 0, y: 0.98, width: 0.7, height: 0.04 },
        { x: 1, y: 0.98, width: 0.7, height: 0.04 },
      ],
    },
    { case: 'no peaks yet', peaks: null, viewBox: '0 0 1 2', bars: [] },
  ])(
    'places a bar per peak, centred on the middle ($case)',
    ({ peaks, viewBox, bars }) => {
      expect(waveformShape(peaks)).toEqual({ viewBox, bars });
    },
  );
});
