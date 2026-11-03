import { describe, expect, it } from 'vitest';
import type { Log } from '../contracts/log';
import type { EventShape } from '../contracts/plugin';
import { createEventBus, type EventBus, pluginEvents } from './event-bus';

function logInto(lines: [string, string][]): Log {
  return (source, message) => lines.push([source, message]);
}

describe('createEventBus', () => {
  it('delivers an event to its listeners in subscription order', () => {
    const bus = createEventBus();
    const heard: [string, unknown][] = [];
    bus.on('p.x', (data) => heard.push(['first', data]));
    bus.on('p.x', (data) => heard.push(['second', data]));

    bus.emit('p.x', 7);

    expect(heard).toEqual([
      ['first', 7],
      ['second', 7],
    ]);
  });

  it('delivers only to listeners of the emitted name', () => {
    const bus = createEventBus();
    const heard: unknown[] = [];
    bus.on('p.y', (data) => heard.push(data));

    bus.emit('p.x', 1);

    expect(heard).toEqual([]);
  });

  it("lets a listener's throw reach the emitter", () => {
    const bus = createEventBus();
    const heard: unknown[] = [];
    bus.on('p.x', () => {
      throw new Error('boom');
    });
    bus.on('p.x', (data) => heard.push(data));

    expect(() => bus.emit('p.x', 1)).toThrow('boom');
    expect(heard).toEqual([]);
  });

  it('gives a listener added during an emit only later emits', () => {
    const bus = createEventBus();
    const heardByLater: unknown[] = [];
    let subscribed = false;
    bus.on('p.x', () => {
      if (!subscribed) {
        subscribed = true;
        bus.on('p.x', (data) => heardByLater.push(data));
      }
    });

    bus.emit('p.x', 1);
    bus.emit('p.x', 2);

    expect(heardByLater).toEqual([2]);
  });
});

describe('createEventBus registrations', () => {
  it.each([
    {
      case: 'before the emit',
      heard: ['b'],
      arrange(bus: EventBus, heard: string[]) {
        const a = bus.on('p.x', () => heard.push('a'));
        bus.on('p.x', () => heard.push('b'));
        a.dispose();
      },
    },
    {
      case: 'by an earlier listener during the emit',
      heard: ['first'],
      arrange(bus: EventBus, heard: string[]) {
        bus.on('p.x', () => {
          heard.push('first');
          second.dispose();
        });
        const second = bus.on('p.x', () => heard.push('second'));
      },
    },
    {
      case: 'one of two registrations of one listener',
      heard: ['l'],
      arrange(bus: EventBus, heard: string[]) {
        const l = () => heard.push('l');
        const first = bus.on('p.x', l);
        bus.on('p.x', l);
        first.dispose();
      },
    },
  ])(
    'stops delivering to a registration once it is disposed ($case)',
    ({ arrange, heard: expected }) => {
      const bus = createEventBus();
      const heard: string[] = [];
      arrange(bus, heard);

      bus.emit('p.x', 1);

      expect(heard).toEqual(expected);
    },
  );
});

describe('pluginEvents', () => {
  it("qualifies a plugin's emitted event with its id", () => {
    const bus = createEventBus();
    const qualified: unknown[] = [];
    const bare: unknown[] = [];
    bus.on('sessions.connected', (data) => qualified.push(data));
    bus.on('connected', (data) => bare.push(data));

    pluginEvents(bus, 'sessions', logInto([])).emit('connected', { id: 'a' });

    expect(qualified).toEqual([{ id: 'a' }]);
    expect(bare).toEqual([]);
  });

  it("logs a listener's throw under the listening plugin and runs the rest", () => {
    const bus = createEventBus();
    const lines: [string, string][] = [];
    const log = logInto(lines);
    const heard: number[] = [];
    pluginEvents<EventShape, { 'sessions.connected': number }>(
      bus,
      'forms',
      log,
    ).on('sessions.connected', () => {
      throw new Error('boom');
    });
    pluginEvents<EventShape, { 'sessions.connected': number }>(
      bus,
      'docs',
      log,
    ).on('sessions.connected', (data) => heard.push(data));

    expect(() =>
      pluginEvents(bus, 'sessions', log).emit('connected', 1),
    ).not.toThrow();
    expect(heard).toEqual([1]);
    expect(lines).toEqual([
      ['forms', expect.stringMatching(/sessions\.connected.*boom/)],
    ]);
  });

  it('stops a listener once the handle `on` returned is disposed', () => {
    const bus = createEventBus();
    const heard: number[] = [];
    const listening = pluginEvents<
      EventShape,
      { 'sessions.connected': number }
    >(bus, 'forms', logInto([])).on('sessions.connected', (data) =>
      heard.push(data),
    );

    listening.dispose();
    bus.emit('sessions.connected', 1);

    expect(heard).toEqual([]);
  });

  it("lets a plugin hear another plugin's event", () => {
    const bus = createEventBus();
    const heard: number[] = [];
    pluginEvents<EventShape, { 'sessions.connected': number }>(
      bus,
      'forms',
      logInto([]),
    ).on('sessions.connected', (data) => heard.push(data));

    pluginEvents(bus, 'sessions', logInto([])).emit('connected', 1);

    expect(heard).toEqual([1]);
  });
});
