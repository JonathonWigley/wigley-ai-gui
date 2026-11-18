import { describe, expect, it } from 'vitest';
import type {
  CommandArg,
  CommandArgShape,
  CommandHop,
} from '../contracts/commands';
import {
  checkCommandArg,
  commandArgLabel,
  commandHopOf,
  commandTarget,
} from './command-args';

describe('commandHopOf', () => {
  it.each<{ case: string; value: unknown; hop: CommandHop }>([
    { case: 'undefined', value: undefined, hop: {} },
    { case: 'a string', value: 's1', hop: {} },
    { case: 'an array', value: ['s1'], hop: {} },
    {
      case: 'a well-typed hop',
      value: {
        targetSessionId: 's1',
        callerSessionId: 'c1',
        reportErrors: true,
      },
      hop: {
        targetSessionId: 's1',
        callerSessionId: 'c1',
        reportErrors: true,
      },
    },
    {
      case: 'non-string ids',
      value: { targetSessionId: 1, callerSessionId: null, reportErrors: true },
      hop: { reportErrors: true },
    },
    {
      case: 'a reportErrors other than true',
      value: {
        targetSessionId: 's1',
        callerSessionId: 'c1',
        reportErrors: 'yes',
      },
      hop: { targetSessionId: 's1', callerSessionId: 'c1' },
    },
    {
      case: 'an unknown field',
      value: { callerSessionId: 'c1', editor: {}, arg: 3 },
      hop: { callerSessionId: 'c1' },
    },
  ])(
    'commandHopOf_UntrustedValue_KeepsOnlyTheTypedFields: $case',
    ({ value, hop }) => {
      expect(commandHopOf(value)).toStrictEqual(hop);
    },
  );
});

describe('checkCommandArg', () => {
  const shape: CommandArgShape = { n: 'number', s: 'string' };
  it.each<{
    case: string;
    shape: CommandArgShape | undefined;
    arg: unknown;
    text: string | null;
  }>([
    { case: 'no shape, no arg', shape: undefined, arg: undefined, text: null },
    {
      case: 'no shape, an arg',
      shape: undefined,
      arg: 1,
      text: 'command "p.c" takes no argument',
    },
    {
      case: 'no shape, null',
      shape: undefined,
      arg: null,
      text: 'command "p.c" takes no argument',
    },
    { case: 'a number', shape: 'number', arg: 3, text: null },
    {
      case: 'a number missing',
      shape: 'number',
      arg: undefined,
      text: 'command "p.c" needs a number',
    },
    {
      case: 'NaN',
      shape: 'number',
      arg: Number.NaN,
      text: 'command "p.c" needs a number',
    },
    {
      case: 'Infinity',
      shape: 'number',
      arg: Number.POSITIVE_INFINITY,
      text: 'command "p.c" needs a number',
    },
    { case: 'a string', shape: 'string', arg: 'x', text: null },
    {
      case: 'a number for a string',
      shape: 'string',
      arg: 1,
      text: 'command "p.c" needs a string',
    },
    { case: 'a record', shape, arg: { s: 'x', n: 2 }, text: null },
    {
      case: 'an array for a record',
      shape,
      arg: [],
      text: 'command "p.c" needs a record',
    },
    {
      case: 'null for a record',
      shape,
      arg: null,
      text: 'command "p.c" needs a record',
    },
    {
      case: 'a missing field',
      shape,
      arg: { n: 2 },
      text: 'command "p.c" needs "s" as a string',
    },
    {
      case: 'a mistyped field',
      shape,
      arg: { n: 'x', s: 'x' },
      text: 'command "p.c" needs "n" as a number',
    },
    {
      case: 'a non-finite field',
      shape,
      arg: { n: Number.NaN, s: 'x' },
      text: 'command "p.c" needs "n" as a number',
    },
    {
      case: 'an extra field',
      shape,
      arg: { n: 2, s: 'x', z: 1, y: 1 },
      text: 'command "p.c" takes no field "z"',
    },
    {
      case: 'a missing and an extra field',
      shape,
      arg: { z: 1, n: 2 },
      text: 'command "p.c" needs "s" as a string',
    },
  ])(
    'checkCommandArg_ShapeAndArgTable_GivesThePinnedText: $case',
    ({ shape: rowShape, arg, text }) => {
      expect(checkCommandArg('p.c', rowShape, arg)).toBe(text);
    },
  );
});

describe('commandTarget', () => {
  it('commandTarget_NoArgAndArg_GivesIdThenJson', () => {
    expect(commandTarget('p.c', undefined)).toBe('p.c');
    expect(commandTarget('forms.choose', 3)).toBe('forms.choose 3');
    expect(commandTarget('p.c', 'x')).toBe('p.c "x"');
  });

  it('commandTarget_RecordFieldsInAnyOrder_GivesOneTarget', () => {
    expect(commandTarget('p.c', { b: 2, a: 1 })).toBe('p.c {"a":1,"b":2}');
    expect(commandTarget('p.c', { a: 1, b: 2 })).toBe('p.c {"a":1,"b":2}');
  });
});

describe('commandArgLabel', () => {
  it.each<{ arg: CommandArg; label: string }>([
    { arg: 3, label: '3' },
    { arg: 'chat', label: 'chat' },
    { arg: { pool: 'p', clone: 2 }, label: 'clone 2, pool p' },
    { arg: { clone: 2, pool: 'p' }, label: 'clone 2, pool p' },
  ])('commandArgLabel_EachShape_PrintsPinnedText: $label', ({ arg, label }) => {
    expect(commandArgLabel(arg)).toBe(label);
  });
});
