import type { OsName, Platform } from '../contracts/platform';
import { platformFor } from './platform';

export function fakePlatform(os: OsName): Platform {
  return platformFor(os, {
    username: 'tester',
    env: {},
    execPath: '/app/exe',
    cwd: '/app',
    isDev: false,
  });
}
