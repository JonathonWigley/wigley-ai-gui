import { describe, expect, it } from 'vitest';
import { appEndpointDir } from './app-endpoint-dir';
import { posixPaths } from './paths/posix-paths';

describe('appEndpointDir', () => {
  it('names the instance folder under the home .agents folder on POSIX', () => {
    expect(appEndpointDir(posixPaths, '/home/user', 'wigley-ai-gui-dev')).toBe(
      '/home/user/.agents/wigley-ai-gui-dev',
    );
  });
});
