// `node scripts/make-icon.mts` (Windows): rebuilds the installed app's icon from
// `assets/icon/auri-source.png`. `make-icon.ps1` beside it draws the PNG sizes
// with Windows' built-in imaging; this writes `assets/icon/icon.png` (1024 px),
// `icon.ico` for Windows and `icon.icns` for macOS from them.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_DIR = path.resolve(import.meta.dirname, '..');
const ICON_DIR = path.join(REPO_DIR, 'assets', 'icon');
const SOURCE = path.join(ICON_DIR, 'auri-source.png');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// Each icns type code holds a PNG of one size; ic11 to ic14 are the @2x
// entries for 16, 32, 128 and 256 pt.
const ICNS_ENTRIES = [
  { type: 'ic07', size: 128 },
  { type: 'ic08', size: 256 },
  { type: 'ic09', size: 512 },
  { type: 'ic10', size: 1024 },
  { type: 'ic11', size: 32 },
  { type: 'ic12', size: 64 },
  { type: 'ic13', size: 256 },
  { type: 'ic14', size: 512 },
];
const LARGEST = 1024;

function drawSizes(outDir: string, sizes: number[]): void {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(import.meta.dirname, 'make-icon.ps1'),
      '-Source',
      SOURCE,
      '-OutDir',
      outDir,
      '-Sizes',
      sizes.join(','),
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`make-icon.ps1 exited with ${result.status}`);
  }
}

// ICO: a 6-byte header, a 16-byte directory entry per image, then each image
// as a PNG; a width or height of 0 means 256.
function packIco(pngs: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length + pngs.length * 16;
  const entries = pngs.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map(({ png }) => png)]);
}

// ICNS: big-endian throughout; the file's and each entry's length count their
// own 8-byte header.
function packIcns(pngs: { type: string; png: Buffer }[]): Buffer {
  const entries = pngs.map(({ type, png }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const body = Buffer.concat(entries);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

function main(): void {
  if (process.platform !== 'win32') {
    throw new Error('make-icon draws with Windows imaging; run it on Windows');
  }
  const sizes = [
    ...new Set([
      ...ICO_SIZES,
      ...ICNS_ENTRIES.map(({ size }) => size),
      LARGEST,
    ]),
  ];
  const outDir = mkdtempSync(path.join(tmpdir(), 'make-icon-'));
  try {
    drawSizes(outDir, sizes);
    const pngOf = (size: number): Buffer =>
      readFileSync(path.join(outDir, `icon-${size}.png`));
    copyFileSync(
      path.join(outDir, `icon-${LARGEST}.png`),
      path.join(ICON_DIR, 'icon.png'),
    );
    const ico = packIco(ICO_SIZES.map((size) => ({ size, png: pngOf(size) })));
    writeFileSync(path.join(ICON_DIR, 'icon.ico'), ico);
    const icns = packIcns(
      ICNS_ENTRIES.map(({ type, size }) => ({ type, png: pngOf(size) })),
    );
    writeFileSync(path.join(ICON_DIR, 'icon.icns'), icns);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main();
