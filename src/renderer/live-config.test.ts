import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../contracts/settings';
import { createLiveConfig } from './live-config';

// A config told apart by its theme's name; nothing here reads the rest.
function config(name = 'any'): AppConfig {
  return { theme: { name } } as AppConfig;
}

describe('createLiveConfig', () => {
  it('calls listeners with the next and previous config', () => {
    const first = config('first');
    const second = config('second');
    const live = createLiveConfig(first, () => {});
    const heard: [string, AppConfig, AppConfig][] = [];
    live.onChanged((next, previous) => heard.push(['a', next, previous]));
    live.onChanged((next, previous) => heard.push(['b', next, previous]));

    live.replace(second);

    expect(live.current()).toBe(second);
    expect(heard).toEqual([
      ['a', second, first],
      ['b', second, first],
    ]);
  });

  it('logs a throwing listener and runs the rest', () => {
    const logs: string[] = [];
    const live = createLiveConfig(config(), (source, message) =>
      logs.push(`[${source}] ${message}`),
    );
    let isLaterRun = false;
    live.onChanged(() => {
      throw new Error('boom');
    });
    live.onChanged(() => {
      isLaterRun = true;
    });

    live.replace(config());

    expect(isLaterRun).toBe(true);
    expect(logs).toEqual(['[config] listener failed: boom']);
  });

  it('stops calling a disposed listener', () => {
    const live = createLiveConfig(config(), () => {});
    let calls = 0;
    const registration = live.onChanged(() => {
      calls++;
    });

    live.replace(config());
    registration.dispose();
    live.replace(config());

    expect(calls).toBe(1);
  });
});
