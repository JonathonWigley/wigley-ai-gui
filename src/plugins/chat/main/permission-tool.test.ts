import { describe, expect, it } from 'vitest';
import { readPermissionRequest } from './permission-tool';

describe('readPermissionRequest', () => {
  it('readPermissionRequest_readsTheDocumentedShape', () => {
    expect(
      readPermissionRequest({
        tool_name: 'Write',
        input: { file_path: '/a.txt' },
        tool_use_id: 'toolu_1',
      }),
    ).toEqual({
      toolName: 'Write',
      input: { file_path: '/a.txt' },
      toolUseId: 'toolu_1',
    });
    expect(
      readPermissionRequest({ tool_name: 'Bash', input: { command: 'ls' } }),
    ).toEqual({ toolName: 'Bash', input: { command: 'ls' }, toolUseId: null });
  });

  it('readPermissionRequest_namesTheWrongField', () => {
    expect(() => readPermissionRequest({ tool_name: 7, input: {} })).toThrow(
      /tool_name/,
    );
    expect(() => readPermissionRequest({ tool_name: 'Bash' })).toThrow(/input/);
  });
});
