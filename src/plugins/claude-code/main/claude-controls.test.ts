import { describe, expect, it } from 'vitest';
import type { ControlChoice, SessionControl } from '../../../contracts/agent';
import {
  appliedControlsOf,
  CLAUDE_CONTROLS,
  controlMessage,
  controlOf,
  controlValue,
  isChoice,
  userMessage,
} from './claude-controls';

const choicesOf = (...values: string[]): ControlChoice[] =>
  values.map((value) => ({ value, label: value }));

describe('claude-controls', () => {
  it.each<{ reported: string; choices: ControlChoice[]; expected: string }>([
    {
      reported: 'claude-sonnet-5',
      choices: controlOf('model')?.choices ?? [],
      expected: 'sonnet',
    },
    {
      reported: 'claude-opus-5-5[1m]',
      choices: controlOf('model')?.choices ?? [],
      expected: 'opus',
    },
    {
      reported: 'custom-x',
      choices: controlOf('model')?.choices ?? [],
      expected: 'custom-x',
    },
    {
      reported: 'opus[1m]',
      choices: choicesOf('opus', 'opus[1m]'),
      expected: 'opus[1m]',
    },
    {
      reported: 'claude-opus-5-5[1m]',
      choices: choicesOf('default', 'opus'),
      expected: 'opus',
    },
    {
      reported: 'claude-haiku-4-5',
      choices: choicesOf('default', 'opus'),
      expected: 'claude-haiku-4-5',
    },
  ])(
    'controlValue_Model_MapsFullNameToAlias ($reported → $expected)',
    ({ reported, choices, expected }) => {
      expect(controlValue('model', reported, choices)).toBe(expected);
    },
  );

  it('controlValue_ModeDefault_IsManual', () => {
    expect(controlValue('mode', 'default', [])).toBe('manual');
    expect(controlValue('mode', 'plan', [])).toBe('plan');
  });

  it.each<{ id: 'model' | 'effort'; value: string; expected: boolean }>([
    { id: 'model', value: 'opus[1m]', expected: true },
    { id: 'model', value: 'opus', expected: false },
    { id: 'effort', value: 'high', expected: false },
  ])(
    'isChoice_ReadsTheGivenControls ($id $value)',
    ({ id, value, expected }) => {
      const controls: SessionControl[] = [
        {
          id: 'model',
          label: 'Model',
          choices: [{ value: 'opus[1m]', label: 'Opus 1M' }],
          value: null,
        },
      ];

      expect(isChoice(controls, id, value)).toBe(expected);
    },
  );

  it('CLAUDE_CONTROLS_DeclareRoles', () => {
    expect(
      Object.fromEntries(
        CLAUDE_CONTROLS.map((control) => [control.id, control.role]),
      ),
    ).toEqual({ mode: 'permissionMode', effort: 'effort', model: 'model' });
  });

  it.each([
    {
      case: 'model and effort',
      reply: { applied: { model: 'claude-opus-5-5', effort: 'medium' } },
      expected: { model: 'claude-opus-5-5', effort: 'medium' },
    },
    {
      case: 'effort null',
      reply: { applied: { model: 'claude-haiku-4-5', effort: null } },
      expected: { model: 'claude-haiku-4-5', effort: null },
    },
    {
      case: 'effort missing',
      reply: { applied: { model: 'claude-haiku-4-5' } },
      expected: { model: 'claude-haiku-4-5', effort: null },
    },
    {
      case: 'effort not among the choices',
      reply: { applied: { model: 'claude-opus-5-5', effort: 'ultra' } },
      expected: { model: 'claude-opus-5-5', effort: 'ultra' },
    },
    {
      case: 'no applied',
      reply: { effective: { effortLevel: 'high', model: 'claude-opus-5-5' } },
      expected: null,
    },
    {
      case: 'applied model empty',
      reply: { applied: { model: '', effort: 'medium' } },
      expected: null,
    },
  ])('appliedControlsOf ($case)', ({ reply, expected }) => {
    expect(appliedControlsOf(reply)).toEqual(expected);
  });

  it('controlMessage_Mode_IsControlRequest', () => {
    expect(controlMessage('mode', 'plan', 'wigley-1')).toEqual({
      type: 'control_request',
      request_id: 'wigley-1',
      request: { subtype: 'set_permission_mode', mode: 'plan' },
    });
  });

  it('controlMessage_Effort_IsSlashCommand', () => {
    expect(controlMessage('effort', 'high', 'u-1')).toEqual({
      type: 'user',
      message: { role: 'user', content: '/effort high' },
      parent_tool_use_id: null,
      uuid: 'u-1',
    });
  });

  it('userMessage_WithImages_ImageBlocksThenText', () => {
    const message = userMessage(
      {
        text: 'What colour?',
        images: [
          { mediaType: 'image/png', data: 'iVBORw0KGgo=' },
          { mediaType: 'image/jpeg', data: '/9j/4AAQ' },
        ],
      },
      'u-1',
    );

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
      uuid: 'u-1',
    });
  });

  it('userMessage_ImagesNoText_OmitsTextBlock', () => {
    const message = userMessage(
      {
        text: '',
        images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }],
      },
      'u-1',
    ) as { message: { content: { type: string }[] } };

    expect(message.message.content.map((block) => block.type)).toEqual([
      'image',
    ]);
  });

  it('userMessage_TextOnly_PlainStringContent', () => {
    expect(userMessage({ text: 'hi', images: [] }, 'u-1')).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      parent_tool_use_id: null,
      uuid: 'u-1',
    });
  });
});
