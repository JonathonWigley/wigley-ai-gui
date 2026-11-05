import { SESSION_HOST_PROTOCOL } from '../../contracts/session-host-protocol';
import type { OsName } from '../../contracts/platform';
import { channelPath } from '../../shared/local-channel/channel-path';

// The channel of the session host speaking this build's protocol, for the app instance `instanceId`.
export function sessionHostChannel(
  platform: OsName,
  home: string,
  username: string,
  instanceId: string,
): string {
  return channelPath(
    platform,
    home,
    username,
    instanceId,
    `-session-host-v${SESSION_HOST_PROTOCOL}`,
  );
}
