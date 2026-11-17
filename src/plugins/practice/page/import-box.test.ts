import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageChannel } from '../../../contracts/plugin';
import {
  asFake,
  type FakeElement,
  type FocusFakeDocument,
  FocusFakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { PracticeChannel } from '../contract';
import type { ImportBoxInput } from '../layouts/layout';
import { createImportBox } from './import-box';

// An import box over a channel whose `startImport` answers wait in
// `answers`, one per call; its pushed scope records pushes and pops and runs
// its base-change listener on `baseChanged`. `drawn` holds each body input
// drawn, `frames` each frame's panel and body, drawn by a fake `drawFrame`.
function boxSetup() {
  const logs: string[] = [];
  const toasts: [string, string][] = [];
  const invokes: string[] = [];
  const answers: ReturnType<typeof deferred<string>>[] = [];
  const drawn: ImportBoxInput[] = [];
  const frames: { panel: HTMLElement; body: HTMLElement }[] = [];
  let frame: FakeElement | null = null;
  let pushes = 0;
  let pops = 0;
  let onBaseChanged: (base: string) => void = () => undefined;
  const channel = {
    invoke(_method: string, request: string) {
      invokes.push(request);
      const answer = deferred<string>();
      answers.push(answer);
      return answer.promise;
    },
  } as unknown as PageChannel<PracticeChannel>;
  const box = createImportBox({
    channel,
    log: (line) => logs.push(line),
    toast: (text, tone) => toasts.push([text, tone]),
    pushScope: () => {
      pushes += 1;
      return {
        pop: () => {
          throw new Error('the box closes by dispose');
        },
        dispose: () => {
          pops += 1;
        },
        onBaseChanged: (listener) => {
          onBaseChanged = listener;
          return { dispose: () => undefined };
        },
      };
    },
    drawFrame: (parent) => {
      const panel = document.createElement('section');
      const body = document.createElement('div');
      panel.append(body);
      parent.append(panel);
      frames.push({ panel, body });
      return { element: panel, body, actions: null };
    },
    drawBody: (parent, input, textBox) => {
      drawn.push(input);
      frame = textBox as unknown as FakeElement;
      parent.append(textBox);
      return {
        built: { element: textBox },
        layoutName: 'default',
        drewPick: false,
        dispose: () => undefined,
      };
    },
  });
  return {
    box,
    logs,
    toasts,
    invokes,
    frames,
    textBox: () => frame!,
    pushes: () => pushes,
    pops: () => pops,
    baseChanged: () => onBaseChanged('practice.list'),
    type(text: string) {
      (frame!.children[0] as FocusFakeElement).value = text;
    },
    // The problem the last draw showed.
    problem: () => drawn.at(-1)?.problem ?? null,
    async answer(result: 'resolve' | { error: string }) {
      const pending = answers.shift()!;
      if (result === 'resolve') {
        pending.resolve('s9');
      } else {
        pending.reject(new Error(result.error));
      }
      await settle();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createImportBox', () => {
  let doc: FocusFakeDocument;
  beforeEach(() => {
    doc = installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<{
    case: string;
    typed: string;
    accepts: number;
    answer: 'resolve' | { error: string } | null;
    isOpen: boolean;
    pops: number;
    invokes: string[];
    problem: string | null;
    line: string;
    toasts: [string, string][];
  }>([
    {
      case: 'a request',
      typed: 'add two sum',
      accepts: 1,
      answer: 'resolve',
      isOpen: false,
      pops: 1,
      invokes: ['add two sum'],
      problem: null,
      line: 'import started: add two sum',
      toasts: [
        ['Import session started: follow it in Sessions mode', 'success'],
      ],
    },
    {
      case: 'blank',
      typed: '  ',
      accepts: 1,
      answer: null,
      isOpen: true,
      pops: 0,
      invokes: [],
      problem: 'Type what to import.',
      line: 'import refused: empty',
      toasts: [],
    },
    {
      case: 'refused',
      typed: 'add two sum',
      accepts: 1,
      answer: { error: 'no profile' },
      isOpen: true,
      pops: 0,
      invokes: ['add two sum'],
      problem: 'no profile',
      line: 'import failed: no profile',
      toasts: [],
    },
    {
      case: 'a second accept while pending',
      typed: 'add two sum',
      accepts: 2,
      answer: null,
      isOpen: true,
      pops: 0,
      invokes: ['add two sum'],
      problem: null,
      line: 'import box opened',
      toasts: [],
    },
  ])('accept: $case', async (row) => {
    const setup = boxSetup();
    setup.box.open();
    setup.type(row.typed);

    for (let accepted = 0; accepted < row.accepts; accepted += 1) {
      setup.box.accept();
    }
    if (row.answer !== null) {
      await setup.answer(row.answer);
    }

    expect(setup.box.isOpen()).toBe(row.isOpen);
    expect(setup.pops()).toBe(row.pops);
    expect(setup.invokes).toEqual(row.invokes);
    expect(setup.problem()).toBe(row.problem);
    expect(setup.logs).toContain(row.line);
    expect(setup.toasts).toEqual(row.toasts);
  });

  it.each<{
    case: string;
    close: (setup: ReturnType<typeof boxSetup>) => void;
  }>([
    { case: 'cancel', close: (setup) => setup.box.cancel() },
    { case: 'base change', close: (setup) => setup.baseChanged() },
  ])('closes without starting on $case', (row) => {
    const setup = boxSetup();
    setup.box.open();
    setup.type('add two sum');

    row.close(setup);

    expect(setup.box.isOpen()).toBe(false);
    expect(setup.pushes()).toBe(1);
    expect(setup.pops()).toBe(1);
    expect(setup.logs).toEqual(['import box opened', 'import box closed']);
    expect(setup.invokes).toEqual([]);
  });

  it('redraw_ChangedLayout_DrawsTheFrameAndKeepsTheBox', () => {
    const setup = boxSetup();
    setup.box.open();
    setup.type('add two sum');
    const typing = setup.textBox().children[0] as FocusFakeElement;
    expect(doc.activeElement).toBe(typing);

    setup.box.redraw();

    const [earlier, redrawn] = setup.frames;
    expect(setup.frames).toHaveLength(2);
    expect(asFake(setup.box.element).contains(asFake(earlier.panel))).toBe(
      false,
    );
    expect(asFake(redrawn.body).contains(setup.textBox())).toBe(true);
    expect(typing.value).toBe('add two sum');
    expect(doc.activeElement).toBe(typing);
  });
});
