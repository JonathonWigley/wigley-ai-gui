import type { AppInstance } from '../contracts/app-instance';
import type { Paths } from '../contracts/paths';

// The folder in `homeDir` where the app instance `instanceId` writes the
// endpoint files its sessions' relays read: `<homeDir>/.agents/<instanceId>`.
export function appEndpointDir(
  paths: Paths,
  homeDir: string,
  instanceId: AppInstance['id'],
): string {
  return paths.join(homeDir, '.agents', instanceId);
}
