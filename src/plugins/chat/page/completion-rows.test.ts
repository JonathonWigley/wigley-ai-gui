import { describe, expect, it } from 'vitest';
import { asFake, asHtml, FakeElement } from '../../../shared/page/test-dom';
import type { CompletionCommand, CompletionRowDraw } from '../contract';
import { createCompletionRows, descriptionDraw } from './completion-rows';

const COMMAND: CompletionCommand = {
  name: 'feature',
  description: 'Plan a change',
  argumentHint: '<what>',
  aliases: ['f'],
  source: 'agent',
};

function fakeRow(): HTMLElement {
  return asHtml(new FakeElement('span'));
}

// A registry whose draws record their name in `calls`, each answering with the
// `answers` entry under its name.
function recordingRows(answers: Record<string, boolean>) {
  const calls: string[] = [];
  const logged: string[] = [];
  const rows = createCompletionRows((text) => logged.push(text));
  const drawOf =
    (name: string): CompletionRowDraw =>
    () => {
      calls.push(name);
      return answers[name];
    };
  return { rows, calls, logged, drawOf };
}

describe('completion rows', () => {
  it('draw_NewestFirst_StopsAtTrue', () => {
    const { rows, calls, drawOf } = recordingRows({ a: true, b: true });
    rows.add(drawOf('a'));
    rows.add(drawOf('b'));

    rows.draw(COMMAND, fakeRow());

    expect(calls).toEqual(['b']);
  });

  it('draw_FalseFallsThrough', () => {
    const { rows, calls, drawOf } = recordingRows({ a: true, b: false });
    rows.add(drawOf('a'));
    rows.add(drawOf('b'));

    rows.draw(COMMAND, fakeRow());

    expect(calls).toEqual(['b', 'a']);
  });

  it('dispose_RemovesOnlyThatDraw', () => {
    const { rows, calls, drawOf } = recordingRows({
      a: false,
      b: true,
      c: false,
    });
    rows.add(drawOf('a'));
    const added = rows.add(drawOf('b'));
    rows.add(drawOf('c'));

    added.dispose();
    added.dispose();
    rows.draw(COMMAND, fakeRow());

    expect(calls).toEqual(['c', 'a']);
  });

  it('draw_NoDraws_DoesNothing', () => {
    const { rows, logged } = recordingRows({});

    rows.draw(COMMAND, fakeRow());

    expect(logged).toEqual([]);
  });

  it('draw_ThrowingDraw_LogsAndFallsThrough', () => {
    const { rows, calls, logged, drawOf } = recordingRows({ a: true });
    const row = fakeRow();
    let childrenSeen = -1;
    rows.add((...args) => {
      childrenSeen = asFake(row).childNodes.length;
      return drawOf('a')(...args);
    });
    rows.add((_command, drawn) => {
      drawn.append(asHtml(new FakeElement('span')));
      throw new Error('broken draw');
    });

    rows.draw(COMMAND, row);

    expect(calls).toEqual(['a']);
    expect(childrenSeen).toBe(0);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('/feature');
    expect(logged[0]).toContain('broken draw');
  });

  it('draw_FalseDrawThatAppended_LeavesRowEmpty', () => {
    const { rows, logged } = recordingRows({});
    const row = fakeRow();
    rows.add((_command, drawn) => {
      drawn.append(asHtml(new FakeElement('span')));
      return false;
    });

    rows.draw(COMMAND, row);

    expect(asFake(row).childNodes).toEqual([]);
    expect(logged).toEqual([]);
  });
});

describe('description draw', () => {
  // The draw over a fake `drawPart` recording what it was handed.
  function recordingDraw(isEnabled: boolean) {
    const parts: { row: HTMLElement; description: string }[] = [];
    const draw = descriptionDraw({
      isEnabled: () => isEnabled,
      drawPart: (row, description) => parts.push({ row, description }),
    });
    return { draw, parts };
  }

  it('descriptionDraw_SettingOff_ReturnsFalse', () => {
    const { draw, parts } = recordingDraw(false);

    expect(draw(COMMAND, fakeRow())).toBe(false);
    expect(parts).toEqual([]);
  });

  it('descriptionDraw_EmptyDescription_ReturnsFalse', () => {
    const { draw, parts } = recordingDraw(true);

    expect(draw({ ...COMMAND, description: '' }, fakeRow())).toBe(false);
    expect(parts).toEqual([]);
  });

  it('descriptionDraw_Enabled_DrawsAndReturnsTrue', () => {
    const { draw, parts } = recordingDraw(true);
    const row = fakeRow();

    expect(draw(COMMAND, row)).toBe(true);
    expect(parts).toEqual([{ row, description: 'Plan a change' }]);
  });
});
