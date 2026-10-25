import type { AppInstance } from '../contracts/app-instance';

// A packaged app is the stable one; any other start is the dev app.
export function appInstanceOf(isPackaged: boolean): AppInstance {
  if (isPackaged) {
    return { id: 'wigley-ai-gui', displayName: 'Auri', isDev: false };
  }
  return { id: 'wigley-ai-gui-dev', displayName: 'Auri Dev', isDev: true };
}
