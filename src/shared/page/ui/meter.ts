import './meter.css';
import { element } from '../dom';

export type MeterTone = 'normal' | 'warning' | 'critical';

// A small bar filled to `percent` (0–100) in a status `tone`.
export function meter(percent: number, tone: MeterTone): HTMLElement {
  const node = element('span', 'ui-meter');
  node.setAttribute('role', 'meter');
  node.setAttribute('aria-valuemin', '0');
  node.setAttribute('aria-valuemax', '100');
  node.append(element('span', 'ui-meter-fill'));
  setMeter(node, percent, tone);
  return node;
}

// Fills a meter `meter` built to `percent` in `tone`.
export function setMeter(
  meter: HTMLElement,
  percent: number,
  tone: MeterTone,
): void {
  meter.dataset.tone = tone;
  meter.setAttribute('aria-valuenow', String(Math.round(percent)));
  meter.style.setProperty('--ui-meter-percent', String(percent));
}
