import { describe, expect, it } from 'vitest';
import { SESSION_HOST_PROTOCOL } from '../../contracts/session-host-protocol';
import { sessionHostChannel } from './session-host-channel';

describe('sessionHostChannel', () => {
  it('sessionHostChannel_Darwin_UsesTheProtocolSuffix', () => {
    expect(sessionHostChannel('macos', '/Users/u', 'u', 'wigley-ai-gui')).toBe(
      `/Users/u/.agents/wigley-ai-gui/app-session-host-v${SESSION_HOST_PROTOCOL}.sock`,
    );
  });
});
