import './waveform.css';
import { element } from '../dom';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// The least bar height in the waveform's 2-high box, so silence draws a line.
const MIN_BAR_HEIGHT = 0.04;
const BAR_WIDTH = 0.7;

export interface WaveformBar {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The `viewBox` and `bars` of a waveform of `peaks` (each 0 to 1): bar `i` sits
// at `x = i`, centred on the 2-high box's middle; no bars while `peaks` is null.
export function waveformShape(peaks: readonly number[] | null): {
  viewBox: string;
  bars: WaveformBar[];
} {
  const bars = (peaks ?? []).map((peak, index) => {
    const height = Math.max(2 * peak, MIN_BAR_HEIGHT);
    return { x: index, y: 1 - height / 2, width: BAR_WIDTH, height };
  });
  return { viewBox: `0 0 ${Math.max(peaks?.length ?? 0, 1)} 2`, bars };
}

// An SVG bar per peak (each 0 to 1) in a fixed-size box; empty, with
// `is-loading`, while `peaks` is null. Hidden from assistive tech: it is a
// picture of the sound, not a reading.
export function waveform(peaks: readonly number[] | null): HTMLElement {
  const { viewBox, bars } = waveformShape(peaks);
  const node = element('span', 'ui-waveform');
  node.setAttribute('aria-hidden', 'true');
  node.classList.toggle('is-loading', peaks === null);
  const svg = svgElement('svg', 'ui-waveform-svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('preserveAspectRatio', 'none');
  for (const { x, y, width, height } of bars) {
    const bar = svgElement('rect', 'ui-waveform-bar');
    bar.setAttribute('x', String(x));
    bar.setAttribute('y', String(y));
    bar.setAttribute('width', String(width));
    bar.setAttribute('height', String(height));
    svg.append(bar);
  }
  node.append(svg);
  return node;
}

// An SVG element's `className` is read-only, so its class goes on as an attribute.
function svgElement<Tag extends keyof SVGElementTagNameMap>(
  tag: Tag,
  className: string,
): SVGElementTagNameMap[Tag] {
  const node = document.createElementNS(SVG_NAMESPACE, tag);
  node.setAttribute('class', className);
  return node;
}
