// The `postinstall` script: makes the installed node-pty's macOS
// `spawn-helper` files executable, so `npm start` can spawn a pty. Does nothing
// on an install without darwin prebuilds.
import path from 'node:path';
import {
  darwinPrebuildFolders,
  makeSpawnHelperExecutable,
} from './node-pty-files.mts';

const nodePtyDir = path.join(
  import.meta.dirname,
  '..',
  'node_modules',
  'node-pty',
);
for (const folder of darwinPrebuildFolders(nodePtyDir)) {
  makeSpawnHelperExecutable(folder);
}
