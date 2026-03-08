#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const iconsDir = path.join(projectRoot, 'public', 'icons');

const SIZES = [192, 512];
const COLORS = {
  navy: { r: 0x1a, g: 0x1a, b: 0x2e, a: 0xff },
  gold: { r: 0xc9, g: 0xa8, b: 0x4c, a: 0xff }
};

function crc32(buffer) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[i] = c >>> 0;
    }
    return t;
  })());

  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = table[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function buildSimplePng(width, height) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  const borderWidth = Math.max(2, Math.floor(width * 0.035));

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;

    for (let x = 0; x < width; x += 1) {
      const inBorder = x < borderWidth || x >= (width - borderWidth) || y < borderWidth || y >= (height - borderWidth);
      const color = inBorder ? COLORS.gold : COLORS.navy;
      const pixelStart = rowStart + 1 + x * 4;
      raw[pixelStart] = color.r;
      raw[pixelStart + 1] = color.g;
      raw[pixelStart + 2] = color.b;
      raw[pixelStart + 3] = color.a;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', idat),
    createPngChunk('IEND', Buffer.alloc(0))
  ]);
}

function buildSvg(size) {
  const borderWidth = Math.max(6, Math.floor(size * 0.04));
  const textSize = Math.floor(size * 0.34);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a1a2e" />
  <rect x="${Math.floor(borderWidth / 2)}" y="${Math.floor(borderWidth / 2)}" width="${size - borderWidth}" height="${size - borderWidth}" rx="${Math.floor(size * 0.08)}" ry="${Math.floor(size * 0.08)}" fill="none" stroke="#c9a84c" stroke-width="${borderWidth}" opacity="0.9" />
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${textSize}" font-weight="700" letter-spacing="1">C&amp;R</text>
</svg>`;
}

async function generateWithSharp() {
  const { default: sharp } = await import('sharp');

  await Promise.all(
    SIZES.map(async (size) => {
      const outputPath = path.join(iconsDir, `icon-${size}x${size}.png`);
      const svg = buildSvg(size);
      await sharp(Buffer.from(svg)).png().toFile(outputPath);
      console.log(`Generated ${outputPath}`);
    })
  );
}

async function generateFallback() {
  await Promise.all(
    SIZES.map(async (size) => {
      const outputPath = path.join(iconsDir, `icon-${size}x${size}.png`);
      const pngBuffer = buildSimplePng(size, size);
      await fs.writeFile(outputPath, pngBuffer);
      console.log(`Generated fallback ${outputPath}`);
    })
  );
}

async function main() {
  await fs.mkdir(iconsDir, { recursive: true });

  try {
    await generateWithSharp();
  } catch (error) {
    console.warn(`sharp unavailable or failed (${error?.message || error}); using fallback icon generator.`);
    await generateFallback();
  }
}

main().catch((error) => {
  console.error('Icon generation failed:', error);
  process.exit(1);
});
