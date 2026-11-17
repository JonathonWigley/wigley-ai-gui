import type { AppInstance } from '../contracts/app-instance';
import type { Paths } from '../contracts/paths';

// The variable the relay reads to find the app's endpoint folder.
export const APP_ENDPOINT_ENV = 'WIGLEY_AI_GUI_ENDPOINT_DIR';

// The folder in `homeDir` where the app instance `instanceId` writes the
// endpoint files its sessions' relays read: `<homeDir>/.agents/<instanceId>`.
export function appEndpointDir(
  paths: Paths,
  homeDir: string,
  instanceId: AppInstance['id'],
): string {
  return paths.join(homeDir, '.agents', instanceId);
}
