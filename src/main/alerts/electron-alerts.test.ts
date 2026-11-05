import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronAlerts, createPlainAlerts } from './electron-alerts';

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

function expectNoOsCall() {
  expect(electron.app.dock.bounce).not.toHaveBeenCalled();
  expect(electron.app.setBadgeCount).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  electron.Notification.isSupported = () => true;
});

describe('createPlainAlerts', () => {
  it('createPlainAlerts_NotificationUnsupported_CallsNothing', () => {
    electron.Notification.isSupported = () => false;

    createPlainAlerts(vi.fn()).announce('title', 'body', vi.fn());

    expectNoOsCall();
  });

  it('createPlainAlerts_SetOpenCount_DrawsNothing', () => {
    createPlainAlerts(vi.fn()).setOpenCount('forms', 2);

    expectNoOsCall();
  });
});

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
