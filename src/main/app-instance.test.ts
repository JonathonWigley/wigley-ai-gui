import { describe, expect, it } from 'vitest';
import { appInstanceOf } from './app-instance';

describe('appInstanceOf', () => {
  it('the stable app when packaged', () => {
    expect(appInstanceOf(true)).toEqual({
      id: 'wigley-ai-gui',
      displayName: 'Auri',
      isDev: false,
    });
  });

  it('the dev app when not packaged', () => {
    expect(appInstanceOf(false)).toEqual({
      id: 'wigley-ai-gui-dev',
      displayName: 'Auri Dev',
      isDev: true,
    });
  });
});
