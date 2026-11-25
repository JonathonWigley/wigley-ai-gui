import { describe, expect, it } from 'vitest';
import { createPlainText } from './plain-text';

describe('createPlainText', () => {
  it.each([
    { case: 'CSI colour', chunks: ['a\x1b[31mred\x1b[0m'], text: 'ared' },
    { case: 'OSC to BEL', chunks: ['x\x1b]0;title\x07y'], text: 'xy' },
    { case: 'OSC to ST', chunks: ['x\x1b]8;;http://e\x1b\\y'], text: 'xy' },
    { case: 'charset escape', chunks: ['\x1b(Bz'], text: 'z' },
    { case: 'CSI split across chunks', chunks: ['a\x1b[', '1mb'], text: 'ab' },
    { case: 'carriage return overwrite', chunks: ['50%\r100%'], text: '100%' },
    { case: 'overwrite keeps the rest', chunks: ['abc\rX'], text: 'Xbc' },
    { case: 'backspace', chunks: ['ab\bc'], text: 'ac' },
    { case: 'erase echo', chunks: ['ab\b \b'], text: 'a' },
    {
      case: 'erase to the end after a return',
      chunks: ['ab\r\x1b[K'],
      text: '',
    },
    {
      case: 'erase to the end mid line',
      chunks: ['abcd\b\b\x1b[0K'],
      text: 'ab',
    },
    { case: 'erase to the cursor', chunks: ['abc\b\x1b[1Kd'], text: '  d' },
    { case: 'erase the whole line', chunks: ['abc\x1b[2K'], text: '' },
    { case: 'cursor move dropped', chunks: ['ab\x1b[2Dc'], text: 'abc' },
    {
      case: 'CRLF and trailing newline',
      chunks: ['one\r\ntwo\n'],
      text: 'one\ntwo',
    },
    { case: 'BEL dropped', chunks: ['a\x07b'], text: 'ab' },
  ])('plainText_$case', ({ chunks, text }) => {
    const plain = createPlainText(200);

    for (const chunk of chunks) {
      plain.write(chunk);
    }

    expect(plain.text()).toBe(text);
  });

  it('plainText_PastTheLimit_KeepsTheLast200Lines', () => {
    const plain = createPlainText(200);

    for (let index = 0; index < 205; index += 1) {
      plain.write(`l${index}\n`);
    }

    const lines = plain.text().split('\n');
    expect(lines).toHaveLength(200);
    expect(lines[0]).toBe('l5');
    expect(lines[199]).toBe('l204');
  });

  it('plainText_Reset_Empties', () => {
    const plain = createPlainText(200);
    plain.write('one\ntwo');

    plain.reset();

    expect(plain.text()).toBe('');
  });
});
