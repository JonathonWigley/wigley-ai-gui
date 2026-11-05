import { describe, expect, it, vi } from 'vitest';
import { createElectronAlerts } from './electron-alerts';

type Listener = (...args: unknown[]) => void;

const electron = vi.hoisted(() => {
  // A notification a row fires events on, the last one made in `latest`.
  class FakeNotification {
    static isSupported = () => true;
    static latest: FakeNotification | null = null;
    private readonly listeners = new Map<string, Listener>();

    constructor() {
      FakeNotification.latest = this;
    }

    on(event: string, listener: Listener) {
      this.listeners.set(event, listener);
    }

    fire(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.(...args);
    }

    show() {}
  }
  return {
    app: { dock: { bounce: vi.fn() }, setBadgeCount: vi.fn() },
    Notification: FakeNotification,
  };
});
vi.mock('electron', () => electron);

describe('createElectronAlerts', () => {
  it('createElectronAlerts_NotificationFails_LogsAndDrawsAttention', () => {
    const attention = { drawAttention: vi.fn(), showOpenCount: vi.fn() };
    const log = vi.fn();
    const alerts = createElectronAlerts(attention, log);

    alerts.announce('title', 'body', vi.fn());
    electron.Notification.latest?.fire('failed', {}, 'no permission');

    expect(attention.drawAttention).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'alerts',
      expect.stringContaining('notification failed'),
    );
  });
});
