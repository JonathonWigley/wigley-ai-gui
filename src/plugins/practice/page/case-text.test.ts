import { describe, expect, it } from 'vitest';
import type { DesignSignature, FunctionSignature, JsonValue } from '../problem';
import { caseInputText, valueText } from './case-text';

const TWO_SUM: FunctionSignature = {
  kind: 'function',
  method: 'twoSum',
  params: [
    { name: 'nums', type: 'vector<int>' },
    { name: 'target', type: 'int' },
  ],
  returns: 'vector<int>',
};

const LRU: DesignSignature = {
  kind: 'design',
  className: 'LRUCache',
  constructor: [{ name: 'capacity', type: 'int' }],
  methods: [],
};

describe('caseInputText', () => {
  it.each<{
    case: string;
    signature: FunctionSignature | DesignSignature;
    input: JsonValue;
    text: string;
  }>([
    {
      case: 'one line per parameter',
      signature: TWO_SUM,
      input: [[2, 7, 11, 15], 9],
      text: 'nums = [2,7,11,15]\ntarget = 9',
    },
    {
      case: 'a length mismatch as JSON',
      signature: TWO_SUM,
      input: [[1]],
      text: '[[1]]',
    },
    {
      case: 'a design case as JSON',
      signature: LRU,
      input: { ops: ['LRUCache'], args: [[2]] },
      text: '{"ops":["LRUCache"],"args":[[2]]}',
    },
  ])('writes $case', ({ signature, input, text }) => {
    expect(caseInputText(signature, input)).toBe(text);
  });
});

describe('valueText', () => {
  it.each<{ value: JsonValue | null; text: string }>([
    { value: 'ab', text: '"ab"' },
    { value: null, text: 'null' },
  ])('writes $value as $text', ({ value, text }) => {
    expect(valueText(value)).toBe(text);
  });
});
