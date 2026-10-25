import { describe, expect, it } from 'vitest';
import { appEndpointDir } from './app-endpoint-dir';
import { posixPaths } from './paths/posix-paths';
import { windowsPaths } from './paths/windows-paths';

describe('appEndpointDir', () => {
  it('names the instance folder under the home .agents folder on POSIX', () => {
    expect(appEndpointDir(posixPaths, '/home/user', 'wigley-ai-gui-dev')).toBe(
      '/home/user/.agents/wigley-ai-gui-dev',
    );
  });

  it('names the instance folder under the home .agents folder on Windows', () => {
    expect(
      appEndpointDir(windowsPaths, 'C:\\Users\\user', 'wigley-ai-gui'),
    ).toBe('C:\\Users\\user\\.agents\\wigley-ai-gui');
  });
});
