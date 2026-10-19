import { describe, expect, it } from 'vitest';
import { createEventBus, pluginEvents } from './event-bus';

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

describe('pluginEvents', () => {
  it("qualifies a plugin's emitted event with its id", () => {
    const bus = createEventBus();
    const qualified: unknown[] = [];
    const bare: unknown[] = [];
    bus.on('sessions.connected', (data) => qualified.push(data));
    bus.on('connected', (data) => bare.push(data));

    pluginEvents(bus, 'sessions').emit('connected', { id: 'a' });

    expect(qualified).toEqual([{ id: 'a' }]);
    expect(bare).toEqual([]);
  });

  it("lets a plugin hear another plugin's event", () => {
    const bus = createEventBus();
    const heard: number[] = [];
    pluginEvents(bus, 'forms').on<number>('sessions.connected', (data) =>
      heard.push(data),
    );

    pluginEvents(bus, 'sessions').emit('connected', 1);

    expect(heard).toEqual([1]);
  });
});
