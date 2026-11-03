import { describe, expect, it } from 'vitest';
import {
  hostLogFile,
  hostRecordFile,
  hostRecordProtocol,
  pipeLogFile,
} from './session-host-protocol';

describe('pipeLogFile', () => {
  it.each([
    ['a', 'a.jsonl'],
    ['x:1', 'x%3A1.jsonl'],
    ['../y', '..%2Fy.jsonl'],
    ['A', '%41.jsonl'],
    ['0b4c-9e.1_2', '0b4c-9e.1_2.jsonl'],
    ['é', '%C3%A9.jsonl'],
    ['\n', '%0A.jsonl'],
    ['', '.jsonl'],
  ])('pipeLogFile_IdCases_EncodesUnsafeCharacters: %j', (id, expected) => {
    expect(pipeLogFile(id)).toBe(expected);
  });
});

describe('host files', () => {
  it('hostFiles_Protocol_NamesAndParsesBack: names', () => {
    expect(hostRecordFile(1)).toBe('host-v1.json');
    expect(hostLogFile(1)).toBe('host-v1.log');
  });

  it.each([
    ['host-v1.json', 1],
    ['host-v12.json', 12],
    ['host-v1.log', null],
    ['host-v1.json.tmp', null],
    ['host-v.json', null],
  ])('hostFiles_Protocol_NamesAndParsesBack: %s', (fileName, expected) => {
    expect(hostRecordProtocol(fileName)).toBe(expected);
  });
});
