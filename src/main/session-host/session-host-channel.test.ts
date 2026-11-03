import { describe, expect, it } from 'vitest';
import { sessionHostChannel } from './session-host-channel';

describe('sessionHostChannel', () => {
  it('sessionHostChannel_Darwin_UsesTheProtocolSuffix', () => {
    expect(sessionHostChannel('darwin', '/Users/u', 'u', 'wigley-ai-gui')).toBe(
      '/Users/u/.agents/wigley-ai-gui/app-session-host-v1.sock',
    );
  });
});
