import { desktopCapturer, shell, systemPreferences } from 'electron';

const MAC_SCREEN_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

// The capture source of every window, with no thumbnail drawn.
export async function electronCaptureSources(): Promise<
  readonly { id: string }[]
> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
  });
  return sources.map((source) => ({ id: source.id }));
}

// macOS Screen Recording access. An undetermined grant counts as granted, so
// the first capture call can show the OS prompt.
export function macScreenAccess(): 'granted' | 'blocked' {
  const status = systemPreferences.getMediaAccessStatus('screen');
  const isRefused = status === 'denied' || status === 'restricted';
  return isRefused ? 'blocked' : 'granted';
}

// Opens the Screen Recording pane of macOS System Settings.
export function openMacScreenSettings(): Promise<void> {
  return shell.openExternal(MAC_SCREEN_SETTINGS_URL);
}
