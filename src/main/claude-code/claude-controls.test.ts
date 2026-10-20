import { describe, expect, it } from 'vitest';
import { controlMessage, controlValue } from './claude-controls';

describe('claude-controls', () => {
  it('controlValue_Model_MapsFullNameToAlias', () => {
    expect(controlValue('model', 'claude-sonnet-5')).toBe('sonnet');
    expect(controlValue('model', 'claude-opus-5-5[1m]')).toBe('opus');
    expect(controlValue('model', 'custom-x')).toBe('custom-x');
  });

  it('controlValue_ModeDefault_IsManual', () => {
    expect(controlValue('mode', 'default')).toBe('manual');
    expect(controlValue('mode', 'plan')).toBe('plan');
  });

  it('controlMessage_Mode_IsControlRequest', () => {
    expect(controlMessage('mode', 'plan', 'wigley-1')).toEqual({
      type: 'control_request',
      request_id: 'wigley-1',
      request: { subtype: 'set_permission_mode', mode: 'plan' },
    });
  });

  it('controlMessage_Effort_IsSlashCommand', () => {
    expect(controlMessage('effort', 'high', 'wigley-1')).toEqual({
      type: 'user',
      message: { role: 'user', content: '/effort high' },
      parent_tool_use_id: null,
    });
  });
});
