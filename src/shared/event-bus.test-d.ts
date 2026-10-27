// Type tests, checked under `vitest --typecheck`: the line after each
// `@ts-expect-error` must fail to compile.
import { describe, it } from 'vitest';
import type { Log } from '../contracts/log';
import type { EventShape, QualifiedEvents } from '../contracts/plugin';
import { createEventBus, pluginEvents } from './event-bus';

interface TestEvents extends EventShape {
  connected: { id: string };
}

const log: Log = () => {};

describe('pluginEvents', () => {
  it('types its events so misuse fails to compile', () => {
    const bus = createEventBus();
    const emitting = pluginEvents<TestEvents>(bus, 'sessions', log);
    // @ts-expect-error -- `conected` is not a declared event
    emitting.emit('conected', { id: 'a' });
    // @ts-expect-error -- `connected` carries an id string
    emitting.emit('connected', { id: 1 });

    const hearing = pluginEvents<
      EventShape,
      QualifiedEvents<'sessions', TestEvents>
    >(bus, 'forms', log);
    hearing.on('sessions.connected', ({ id }) => id);
    // @ts-expect-error -- `sessions.conected` is not a heard event
    hearing.on('sessions.conected', () => {});
    // @ts-expect-error -- `sessions.connected` carries an id, not a count
    hearing.on('sessions.connected', (data: { count: number }) => data);

    const hearingNone = pluginEvents<EventShape, Record<never, never>>(
      bus,
      'forms',
      log,
    );
    // @ts-expect-error -- this part hears no events
    hearingNone.on('sessions.connected', () => {});
    // @ts-expect-error -- a primitive is not an events shape
    pluginEvents<string>(bus, 'forms', log);
  });
});
