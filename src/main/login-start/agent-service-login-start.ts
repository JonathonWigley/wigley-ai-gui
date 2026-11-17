import {
  LOGIN_START_LABEL,
  type LoginStart,
  type LoginStartStatus,
} from '../../contracts/login-start';
import { errorText } from '../../shared/error-text';

// The part of Electron's `app` that registers a macOS `agentService` login item; `main.ts` passes `app` itself.
export interface LoginItems {
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    type: 'agentService';
    serviceName: string;
  }): void;
  getLoginItemSettings(options: {
    type: 'agentService';
    serviceName: string;
  }): { status?: string };
}

// The plist in the bundle's `Contents/Library/LaunchAgents/` that the packaged app ships.
const SERVICE_NAME = `${LOGIN_START_LABEL}.plist`;

// The LoginStart over the login item the app bundle ships, which macOS runs at login.
export function createAgentServiceLoginStart(
  loginItems: LoginItems,
): LoginStart {
  const readStatus = () =>
    loginItems.getLoginItemSettings({
      type: 'agentService',
      serviceName: SERVICE_NAME,
    }).status;
  return {
    set: async (on) => {
      try {
        const settledStatus = on ? 'enabled' : 'not-registered';
        if (readStatus() !== settledStatus) {
          loginItems.setLoginItemSettings({
            openAtLogin: on,
            type: 'agentService',
            serviceName: SERVICE_NAME,
          });
        }
        return statusOf(readStatus(), on);
      } catch (error) {
        return failed(errorText(error));
      }
    },
  };
}

// The LoginStartStatus that Electron's login item `status` reads as, after a `set(on)`.
function statusOf(status: string | undefined, on: boolean): LoginStartStatus {
  switch (status) {
    case 'enabled':
      return { state: 'on', detail: null };
    case 'requires-approval':
      return {
        state: 'needsApproval',
        detail: 'Turn on Auri in System Settings > General > Login Items.',
      };
    case 'not-registered':
      return {
        state: 'off',
        detail: on ? 'The login item did not register.' : null,
      };
    case 'not-found':
      return {
        state: 'off',
        detail: 'This build has no session host login item.',
      };
    default:
      return failed(status ?? 'no status');
  }
}

function failed(reason: string): LoginStartStatus {
  return { state: 'off', detail: `Login start failed: ${reason}` };
}
