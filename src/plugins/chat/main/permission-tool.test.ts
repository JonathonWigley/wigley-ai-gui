import { describe, expect, it } from 'vitest';
import { permissionReplyText, readPermissionRequest } from './permission-tool';

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
      'permission_prompt: tool_name must be a string',
    );
    expect(() => readPermissionRequest({ tool_name: 'Bash' })).toThrow(
      'permission_prompt: input is missing',
    );
  });
});

describe('permissionReplyText', () => {
  it('permissionReplyText_allowAndDeny', () => {
    const input = { command: 'ls' };

    expect(permissionReplyText({ allowed: true, reason: null }, input)).toBe(
      '{"behavior":"allow","updatedInput":{"command":"ls"}}',
    );
    expect(permissionReplyText({ allowed: false, reason: null }, input)).toBe(
      '{"behavior":"deny","message":"The user denied this tool call."}',
    );
    expect(
      permissionReplyText({ allowed: false, reason: 'use rg' }, input),
    ).toBe('{"behavior":"deny","message":"use rg"}');
  });
});
