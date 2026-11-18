import { describe, expect, it } from 'vitest';
import type { DocumentEditorEvents, ExCall } from '../../contracts/editor';
import { DOCUMENT_COMMANDS } from './document-ex-commands';

function recordingEvents(calls: string[]): DocumentEditorEvents {
  return {
    changed: () => calls.push('changed'),
    write: () => calls.push('write'),
    quit: (force) => calls.push(`quit ${force}`),
    writeQuit: () => calls.push('writeQuit'),
    modeChanged: () => calls.push('modeChanged'),
  };
}

describe('DOCUMENT_COMMANDS', () => {
  it('names each command and its prefix', () => {
    expect(DOCUMENT_COMMANDS.map(({ name, prefix }) => [name, prefix])).toEqual(
      [
        ['write', 'w'],
        ['quit', 'q'],
        ['wq', 'wq'],
        ['xit', 'x'],
      ],
    );
  });

  it.each<{ name: string; command: ExCall; calls: string[] }>([
    {
      name: 'write',
      command: { argString: '', bang: false },
      calls: ['write'],
    },
    {
      name: 'quit',
      command: { argString: '', bang: false },
      calls: ['quit false'],
    },
    {
      name: 'quit',
      command: { argString: '', bang: true },
      calls: ['quit true'],
    },
    {
      name: 'wq',
      command: { argString: '', bang: true },
      calls: ['writeQuit'],
    },
    {
      name: 'xit',
      command: { argString: '', bang: false },
      calls: ['writeQuit'],
    },
  ])('raise_CallsItsEvent: $name with $command', ({ name, command, calls }) => {
    const heard: string[] = [];
    const entry = DOCUMENT_COMMANDS.find((each) => each.name === name);

    entry?.raise(recordingEvents(heard), command);

    expect(heard).toEqual(calls);
  });
});
