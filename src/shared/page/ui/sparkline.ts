import './sparkline.css';
import { element } from '../dom';
import type { MeterTone } from './meter';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// The `viewBox` and `points` of a line through `values` (0–100, oldest first):
// point `i` sits at `x = i`, `y = 100 − value`, so the line spans the box's
// width whatever the count. A value out of range is clamped and a non-finite
// one counts as 0; one value draws a flat line, and none draws nothing.
export function sparklineShape(values: readonly number[]): {
  viewBox: string;
  points: string;
} {
  const heights = values.map(clampedPercent);
  const drawn = heights.length === 1 ? [heights[0], heights[0]] : heights;
  const points = drawn.map((height, x) => `${x},${100 - height}`).join(' ');
  return { viewBox: `0 0 ${Math.max(values.length - 1, 1)} 100`, points };
}

// A line of `values` (0–100, oldest first) in `tone`, filling its parent's
// width; hidden from assistive tech, as the meter beside it carries the reading.
export function sparkline(
  values: readonly number[],
  tone: MeterTone,
): HTMLElement {
  const { viewBox, points } = sparklineShape(values);
  const node = element('span', 'ui-sparkline');
  node.dataset.tone = tone;
  node.setAttribute('aria-hidden', 'true');
  const svg = svgElement('svg', 'ui-sparkline-svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('preserveAspectRatio', 'none');
  const line = svgElement('polyline', 'ui-sparkline-line');
  line.setAttribute('points', points);
  svg.append(line);
  node.append(svg);
  return node;
}

function clampedPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
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
