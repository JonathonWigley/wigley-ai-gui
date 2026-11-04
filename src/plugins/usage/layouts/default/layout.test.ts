import { describe, expect, it } from 'vitest';
import type { SessionLineInput, UsageKit } from '../layout';
import layout from './layout.js';

// The DOM surface the default session line uses. This layer may not import the
// page's shared fake DOM.
class FakeElement {
  className = '';
  children: FakeElement[] = [];
  styleProperties = new Map<string, string>();
  style = {
    setProperty: (name: string, value: string) => {
      this.styleProperties.set(name, value);
    },
  };

  constructor(readonly part: string) {}

  get classList() {
    return {
      toggle: (name: string, force: boolean) => {
        if (force) {
          this.className = `${this.className} ${name}`;
        }
      },
    };
  }
}

function asFake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

// A fake kit part's element: named after the part and its arguments
// (`tag:compacting · auto:accent`) and appended to `parent`, as every kit part
// appends.
function part(parent: HTMLElement, name: string): HTMLElement {
  const node = new FakeElement(name);
  asFake(parent).children.push(node);
  return node as unknown as HTMLElement;
}

const fakeKit = {
  el: (parent: HTMLElement, tag: string, className = '', text = '') => {
    const element = part(parent, `${tag}:${text}`);
    element.className = className;
    return element;
  },
  tag: (parent: HTMLElement, text: string, tone?: string) =>
    part(parent, `tag:${text}:${tone}`),
  meter: (parent: HTMLElement, percent: number, tone: string) =>
    part(parent, `meter:${percent}:${tone}`),
} as unknown as UsageKit;

function lineInput(
  compacting: string | null,
  compactingElapsedMs: number | null,
): SessionLineInput {
  return {
    context: {
      label: 'Context',
      text: '180k/300k',
      percent: 60,
      tone: 'normal',
    },
    cache: 'cache 42m',
    spend: '$1.23',
    compacting,
    compactingElapsedMs,
  };
}

describe('default usage layout', () => {
  it.each([
    {
      case: 'Compacting_DrawsChipFirstAndSetsItsElapsedTime',
      compacting: 'compacting · auto',
      elapsedMs: 7250,
      isCompacting: true,
      firstParts: ['tag:compacting · auto:accent', 'meter:60:normal'],
      elapsedProperty: '7250ms',
    },
    {
      case: 'NotCompacting_DrawsNoChip',
      compacting: null,
      elapsedMs: null,
      isCompacting: false,
      firstParts: ['meter:60:normal', 'span:180k/300k'],
      elapsedProperty: undefined,
    },
  ])(
    'sessionLine_$case',
    ({ compacting, elapsedMs, isCompacting, firstParts, elapsedProperty }) => {
      const parent = new FakeElement('parent') as unknown as HTMLElement;

      const line = asFake(
        layout.sessionLine(parent, lineInput(compacting, elapsedMs), fakeKit),
      );

      expect(line.className.split(' ').includes('is-compacting')).toBe(
        isCompacting,
      );
      expect(line.children.slice(0, 2).map((child) => child.part)).toEqual(
        firstParts,
      );
      expect(line.styleProperties.get('--usage-compacting-elapsed')).toBe(
        elapsedProperty,
      );
    },
  );
});
