import { describe, expect, it } from 'vitest';
import type {
  CandidateKit,
  CandidateRowInput,
  HeadInput,
  NotesKit,
} from '../layout';
import layout from './layout.js';

// The DOM surface the default parts use. This layer may not import the page's
// shared fake DOM.
class FakeElement {
  className = '';
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};

  constructor(readonly part: string) {}

  get classList() {
    return {
      toggle: (name: string, force: boolean) => {
        const others = this.className
          .split(' ')
          .filter((each) => each !== name);
        this.className = (force ? [...others, name] : others).join(' ');
      },
    };
  }
}

function asFake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

// A fake kit part's element: named after the part and its arguments
// (`tag:Loop:neutral`, `keyHint:choose:3:false`) and appended to `parent`, as
// every kit part appends.
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
  markdown: (parent: HTMLElement, text: string) =>
    part(parent, `markdown:${text}`),
  sectionHeader: (parent: HTMLElement, text: string) =>
    part(parent, `sectionHeader:${text}`),
  edge: (parent: HTMLElement, command: string) =>
    part(parent, `edge:${command}`),
  tag: (parent: HTMLElement, text: string, tone?: string) =>
    part(parent, `tag:${text}:${tone}`),
  keyHint: (
    parent: HTMLElement,
    command: string,
    options: { arg?: number; label?: boolean | string } = {},
  ) =>
    part(
      parent,
      `keyHint:${command}:${options.arg ?? ''}:${options.label ?? ''}`,
    ),
  playButton: (parent: HTMLElement) => part(parent, 'playButton'),
  waveform: (parent: HTMLElement) => part(parent, 'waveform'),
  textBox: (parent: HTMLElement) => part(parent, 'textBox'),
} as unknown as CandidateKit & NotesKit;

// Every part drawn under `root`, depth first, after the root's own classes
// (`class:is-active`) and data (`data-load:loading`).
function drawn(root: FakeElement): string[] {
  const lines = [
    ...root.className
      .split(' ')
      .filter((name) => name !== '')
      .map((name) => `class:${name}`),
    ...Object.entries(root.dataset).map(
      ([key, value]) => `data-${key}:${value}`,
    ),
  ];
  const pending = [...root.children].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    lines.push(node.part);
    pending.push(...[...node.children].reverse());
  }
  return lines;
}

function headInput(overrides: Partial<HeadInput>): HeadInput {
  return {
    heading: 'Sounds',
    overview: '',
    moments: 3,
    onRecommendation: 1,
    noneOfThese: 2,
    saveLabel: 'Saved',
    ...overrides,
  };
}

function candidateInput(
  overrides: Partial<CandidateRowInput>,
): CandidateRowInput {
  return {
    moment: 1,
    row: 2,
    number: 3,
    name: 'whoosh_b',
    library: 'Motion',
    play: 'one-shot',
    fileCount: 1,
    pitch: null,
    loudnessLufs: null,
    durationSeconds: 3.4,
    load: 'ready',
    error: null,
    isPlaying: false,
    isCursor: false,
    isChosen: false,
    isRecommended: false,
    ...overrides,
  };
}

function head(overrides: Partial<HeadInput>): FakeElement {
  const parent = new FakeElement('parent') as unknown as HTMLElement;
  return asFake(layout.head(parent, headInput(overrides), fakeKit).element);
}

function candidate(overrides: Partial<CandidateRowInput>): FakeElement {
  const parent = new FakeElement('parent') as unknown as HTMLElement;
  return asFake(
    layout.candidate(parent, candidateInput(overrides), fakeKit).element,
  );
}

describe('default audio picker layout', () => {
  // `parts` must be drawn in that order; `absent` must be in no part.
  it.each<{
    case: string;
    root: () => FakeElement;
    parts: string[];
    absent?: string;
  }>([
    {
      case: 'counts, plural',
      root: () => head({ moments: 3, onRecommendation: 1, noneOfThese: 2 }),
      parts: ['p:3 moments · 1 on the recommendation · 2 none of these'],
    },
    {
      case: 'counts, one moment',
      root: () => head({ moments: 1, onRecommendation: 1, noneOfThese: 0 }),
      parts: ['p:1 moment · 1 on the recommendation · 0 none of these'],
    },
    {
      case: 'length below a minute',
      root: () => candidate({ durationSeconds: 2.54 }),
      parts: ['span:2.5 s'],
    },
    {
      case: 'length that rounds to a minute',
      root: () => candidate({ durationSeconds: 59.96 }),
      parts: ['span:1:00'],
    },
    {
      case: 'length past a minute',
      root: () => candidate({ durationSeconds: 119.7 }),
      parts: ['span:1:59'],
    },
    {
      case: 'length loading',
      root: () => candidate({ load: 'loading', durationSeconds: null }),
      parts: ['data-load:loading', 'span:Loading…'],
    },
    {
      case: 'length after an error',
      root: () =>
        candidate({ load: 'error', error: 'bad data', durationSeconds: null }),
      parts: ['data-load:error', 'span:–', "p:Can't load: bad data"],
    },
    {
      case: 'loudness',
      root: () => candidate({ loudnessLufs: -14 }),
      parts: ['span:-14.0 LUFS'],
    },
    {
      case: 'no loudness',
      root: () => candidate({ loudnessLufs: null }),
      parts: [],
      absent: 'LUFS',
    },
    {
      case: 'symmetric pitch',
      root: () => candidate({ play: 'one-shot', pitch: { min: -2, max: 2 } }),
      parts: ['tag:One-shot · ±2 st:neutral'],
    },
    {
      case: 'uneven pitch',
      root: () => candidate({ play: 'loop', pitch: { min: -1, max: 3 } }),
      parts: ['tag:Loop · -1 to +3 st:neutral'],
    },
    {
      case: 'fractional pitch',
      root: () => candidate({ play: 'loop', pitch: { min: 0.5, max: 1.25 } }),
      parts: ['tag:Loop · +0.5 to +1.25 st:neutral'],
    },
    {
      case: 'fixed pitch',
      root: () =>
        candidate({
          play: 'variants',
          fileCount: 4,
          pitch: { min: -1, max: -1 },
        }),
      parts: ['tag:Variants ×4 · -1 st:neutral'],
    },
    {
      case: 'no pitch shift',
      root: () => candidate({ play: 'one-shot', pitch: { min: 0, max: 0 } }),
      parts: ['tag:One-shot · 0 st:neutral'],
    },
    {
      case: 'recommended',
      root: () => candidate({ isRecommended: true }),
      parts: ['tag:Recommended:accent'],
    },
    {
      case: 'playing',
      root: () => candidate({ isPlaying: true }),
      parts: ['class:is-active'],
    },
    {
      case: 'cursor prompt, stopped',
      root: () => candidate({ isCursor: true, isPlaying: false }),
      parts: ['keyHint:togglePlay::play'],
    },
    {
      case: 'cursor prompt, playing',
      root: () => candidate({ isCursor: true, isPlaying: true }),
      parts: ['keyHint:togglePlay::stop'],
    },
    {
      case: 'none row',
      root: () =>
        asFake(
          layout.none(
            new FakeElement('parent') as unknown as HTMLElement,
            { moment: 0, row: 2, number: 3, isCursor: false, isChosen: false },
            fakeKit,
          ).element,
        ),
      parts: ['keyHint:choose:3:false', 'span:None of these'],
    },
    {
      case: 'notes label',
      root: () =>
        asFake(
          layout.notes(
            new FakeElement('parent') as unknown as HTMLElement,
            { moment: 0, number: 1, isNone: false },
            fakeKit,
          ).element,
        ),
      parts: ['span:Note', 'keyHint:editNote::', 'textBox'],
    },
    {
      case: 'notes label, none of these',
      root: () =>
        asFake(
          layout.notes(
            new FakeElement('parent') as unknown as HTMLElement,
            { moment: 0, number: 1, isNone: true },
            fakeKit,
          ).element,
        ),
      parts: ['span:What to search for instead', 'keyHint:editNote::'],
    },
  ])('defaultLayout_Parts_DrawTheirText ($case)', ({ root, parts, absent }) => {
    const lines = drawn(root());

    expect(lines.filter((line) => parts.includes(line))).toEqual(parts);
    if (absent !== undefined) {
      expect(lines.filter((line) => line.includes(absent))).toEqual([]);
    }
  });
});
