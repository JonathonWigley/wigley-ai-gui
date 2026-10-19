// Each `@ts-expect-error` below is checked by `npm run typecheck`: the line
// after it must fail to compile.
import { describe, expect, it } from 'vitest';
import type { EventShape, QualifiedEvents } from '../contracts/plugin';
import { createEventBus, pluginEvents } from './event-bus';

interface TestEvents extends EventShape {
  connected: { id: string };
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
    pluginEvents<EventShape, { 'sessions.connected': number }>(bus, 'forms').on(
      'sessions.connected',
      (data) => heard.push(data),
    );

    pluginEvents(bus, 'sessions').emit('connected', 1);

    expect(heard).toEqual([1]);
  });

  it('an undeclared event or a wrong payload is a type error on emit', () => {
    const bus = createEventBus();
    const heard: unknown[] = [];
    bus.on('sessions.conected', (data) => heard.push(data));
    const events = pluginEvents<TestEvents>(bus, 'sessions');

    // @ts-expect-error -- `conected` is not a declared event
    events.emit('conected', { id: 'a' });
    // @ts-expect-error -- `connected` carries an id string
    events.emit('connected', { id: 1 });

    expect(heard).toEqual([{ id: 'a' }]);
  });

  it('an unheard event or a mismatched listener is a type error on on', () => {
    const bus = createEventBus();
    const heard: string[] = [];
    const events = pluginEvents<
      EventShape,
      QualifiedEvents<'sessions', TestEvents>
    >(bus, 'forms');

    events.on('sessions.connected', ({ id }) => heard.push(id));
    // @ts-expect-error -- `sessions.conected` is not a heard event
    events.on('sessions.conected', () => {});
    // @ts-expect-error -- `sessions.connected` carries an id, not a count
    events.on('sessions.connected', (data: { count: number }) => data);
    pluginEvents<TestEvents>(bus, 'sessions').emit('connected', { id: 'a' });

    expect(heard).toEqual(['a']);
  });

  it('a part declaring no heard events can name none', () => {
    const bus = createEventBus();
    const heard: unknown[] = [];
    const events = pluginEvents<EventShape, Record<never, never>>(bus, 'forms');

    // @ts-expect-error -- this part hears no events
    events.on('sessions.connected', (data) => heard.push(data));
    // @ts-expect-error -- a primitive is not an events shape
    pluginEvents<string>(bus, 'forms');
    bus.emit('sessions.connected', 1);

    expect(heard).toEqual([1]);
  });
});
