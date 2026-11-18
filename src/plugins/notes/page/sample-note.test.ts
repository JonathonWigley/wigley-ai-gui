import { describe, expect, it } from 'vitest';
import type { NoteSession } from '../contract';
import { createSampleNoteChannel, SAMPLE_NOTE } from './sample-note';

const SESSION: NoteSession = {
  sessionId: 'demo-1',
  harness: 'demo',
  hostSessionId: 'demo-1',
  projectDir: '/scratch',
};

const IMAGE = new Uint8Array([1, 2, 3]);

function sampleChannel() {
  return createSampleNoteChannel({
    session: SESSION,
    drawImage: () => Promise.resolve(IMAGE),
  });
}

describe('createSampleNoteChannel', () => {
  it.each([
    {
      call: 'sendToFollowup',
      run: (channel: ReturnType<typeof sampleChannel>) =>
        channel.invoke('sendToFollowup', { type: 'create' }, [null]),
      result: { type: 'refused', reason: 'A sample note sends nothing.' },
    },
    {
      call: 'sendToSession',
      run: (channel: ReturnType<typeof sampleChannel>) =>
        channel.invoke('sendToSession', '/scratch', [null]),
      result: { type: 'refused', reason: 'A sample note sends nothing.' },
    },
    {
      call: 'discard',
      run: async (channel: ReturnType<typeof sampleChannel>) => {
        await channel.invoke('saveDraft', {
          ...SAMPLE_NOTE,
          title: 'Edited',
          session: SESSION,
        });
        await channel.invoke('addImage', new Uint8Array([9]));
        return channel.invoke('discard');
      },
      result: { ...SAMPLE_NOTE, session: SESSION },
    },
  ])('$call is refused or inert', async ({ run, result }) => {
    await expect(run(sampleChannel())).resolves.toEqual(result);
  });

  it('capture is refused or inert', async () => {
    await expect(sampleChannel().invoke('capture')).rejects.toThrow(
      'A sample note captures nothing.',
    );
  });

  it('edits change only the copy it loads', async () => {
    const channel = sampleChannel();

    await channel.invoke('saveDraft', {
      ...SAMPLE_NOTE,
      title: 'Edited',
      session: SESSION,
    });
    const added = await channel.invoke('addImage', new Uint8Array([9]));

    expect(await channel.invoke('loadDraft')).toEqual({
      ...SAMPLE_NOTE,
      title: 'Edited',
      session: SESSION,
      images: [...SAMPLE_NOTE.images, { id: 2, hasMarkup: false }],
      nextImageId: 3,
    });
    expect(added.images).toHaveLength(2);
    expect(await channel.invoke('image', 2)).toEqual(new Uint8Array([9]));
    expect(await channel.invoke('image', 1)).toBe(IMAGE);
  });
});
