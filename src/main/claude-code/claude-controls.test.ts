import { describe, expect, it } from 'vitest';
import { controlMessage, controlValue, userMessage } from './claude-controls';

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

  it('userMessage_WithImages_ImageBlocksThenText', () => {
    const message = userMessage({
      text: 'What colour?',
      images: [
        { mediaType: 'image/png', data: 'iVBORw0KGgo=' },
        { mediaType: 'image/jpeg', data: '/9j/4AAQ' },
      ],
    });

    expect(message).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgo=',
            },
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: '/9j/4AAQ',
            },
          },
          { type: 'text', text: 'What colour?' },
        ],
      },
      parent_tool_use_id: null,
    });
  });

  it('userMessage_ImagesNoText_OmitsTextBlock', () => {
    const message = userMessage({
      text: '',
      images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }],
    }) as { message: { content: { type: string }[] } };

    expect(message.message.content.map((block) => block.type)).toEqual([
      'image',
    ]);
  });

  it('userMessage_TextOnly_PlainStringContent', () => {
    expect(userMessage({ text: 'hi', images: [] })).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      parent_tool_use_id: null,
    });
  });
});
