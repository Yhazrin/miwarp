#!/usr/bin/env node
/**
 * Generate platform-specific app icons for MiWarp
 *
 * Windows/Linux: transparent background logo
 * macOS: transparent canvas + white rounded rectangle + centered logo
 *
 * Usage: node scripts/generate-app-icons.mjs
 */

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = process.argv[1] ? path.resolve(process.argv[1]) : fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const iconsDir = path.join(rootDir, 'src-tauri', 'icons');
const sourceLogo = path.join(rootDir, "static", "logo.png");

const WINDOWS_SIZES = [16, 24, 32, 48, 64, 128, 256];
const MACOS_SIZE = 1024;

// Threshold for detecting background (corners were ~245,245,246)
const BG_THRESHOLD = 245;

/**
 * Remove near-white background to create transparent logo
 * Returns RGBA buffer with transparent background
 */
async function makeTransparentLogo() {
  const logoBuffer = await fs.readFile(sourceLogo);
  const meta = await sharp(logoBuffer).metadata();
  const width = meta.width;
  const height = meta.height;

  // Get raw RGB data
  const { data: rgbData } = await sharp(logoBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Create RGBA output buffer
  const rgbaBuffer = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * 3; // RGB
    const dstIdx = i * 4; // RGBA

    const r = rgbData[srcIdx];
    const g = rgbData[srcIdx + 1];
    const b = rgbData[srcIdx + 2];

    // If all channels are above threshold (light background), make transparent
    const isBackground = r >= BG_THRESHOLD && g >= BG_THRESHOLD && b >= BG_THRESHOLD;

    rgbaBuffer[dstIdx] = r;
    rgbaBuffer[dstIdx + 1] = g;
    rgbaBuffer[dstIdx + 2] = b;
    rgbaBuffer[dstIdx + 3] = isBackground ? 0 : 255;
  }

  return sharp(rgbaBuffer, {
    raw: { width, height, channels: 4 }
  }).png().toBuffer();
}

/**
 * Create transparent icon for Windows/Linux
 */
async function createTransparentIcon(size) {
  const logoSize = Math.round(size * 0.75); // 75% of canvas

  // Get transparent logo
  const transparentLogo = await makeTransparentLogo();

  // Resize to target
  const resizedLogo = await sharp(transparentLogo)
    .resize(logoSize, logoSize, { fit: 'contain' })
    .png()
    .toBuffer();

  const offset = Math.round((size - logoSize) / 2);

  // Create transparent canvas and composite
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: resizedLogo, top: offset, left: offset }])
    .png()
    .toBuffer();
}

/**
 * Create macOS icon with white rounded rectangle on transparent canvas
 */
async function createMacIcon(size) {
  const logoSize = Math.round(size * 0.75); // 75% of canvas
  const logoYOffset = Math.round(size * 0.02); // slight downward offset

  // Get transparent logo
  const transparentLogo = await makeTransparentLogo();

  // Resize logo to target size
  const resizedLogo = await sharp(transparentLogo)
    .resize(logoSize, logoSize, { fit: 'contain' })
    .png()
    .toBuffer();

  // White rounded rectangle parameters
  const rectSize = Math.round(size * 0.84); // 84% of canvas
  const rectX = Math.round((size - rectSize) / 2);
  const rectY = Math.round((size - rectSize) / 2);
  const radius = Math.round(size * 0.2); // 20% corner radius

  // Create SVG with white rounded rectangle on transparent background
  const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-opacity="0.12"/>
    </filter>
  </defs>
  <rect x="${rectX}" y="${rectY}" width="${rectSize}" height="${rectSize}" rx="${radius}" fill="#FFFFFF" filter="url(#shadow)"/>
  <image href="data:image/png;base64,${resizedLogo.toString('base64')}" x="${Math.round((size - logoSize) / 2)}" y="${Math.round((size - logoSize) / 2) + logoYOffset}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Create iconset for ICNS
 */
async function createIcnsForMacOS() {
  const tempDir = path.join(iconsDir, 'icon.iconset');
  await fs.mkdir(tempDir, { recursive: true });

  const iconSizes = [
    { size: 16, scale: 1 },
    { size: 16, scale: 2 },
    { size: 32, scale: 1 },
    { size: 32, scale: 2 },
    { size: 128, scale: 1 },
    { size: 128, scale: 2 },
    { size: 256, scale: 1 },
    { size: 256, scale: 2 },
    { size: 512, scale: 1 },
    { size: 512, scale: 2 },
    { size: 512, scale: 3 },
  ];

  for (const { size, scale } of iconSizes) {
    const actualSize = size * scale;
    const icon = await createMacIcon(actualSize);
    const filename = scale === 1
      ? `icon_${size}x${size}.png`
      : `icon_${size}x${size}@${scale}x.png`;
    await fs.writeFile(path.join(tempDir, filename), icon);
    console.log(`  Created ${filename}`);
  }

  // Generate ICNS
  execSync(`iconutil -c icns "${tempDir}" -o "${path.join(iconsDir, 'icon.icns')}"`, { stdio: 'inherit' });
  console.log(`  Created icon.icns`);

  // Clean up
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function main() {
  console.log('Generating MiWarp app icons...\n');

  const logoMeta = await sharp(sourceLogo).metadata();
  console.log(`Source logo: ${logoMeta.width}x${logoMeta.height} (${logoMeta.channels} channels)\n`);

  // Ensure icons directory exists
  await fs.mkdir(iconsDir, { recursive: true });

  // ── Windows / Linux Icons (transparent) ──
  console.log('Generating Windows/Linux icons (transparent background)...');

  for (const size of WINDOWS_SIZES) {
    const pngBuffer = await createTransparentIcon(size);
    const outputPath = path.join(iconsDir, `${size}x${size}.png`);
    await fs.writeFile(outputPath, pngBuffer);
    const meta = await sharp(pngBuffer).metadata();
    console.log(`  Created ${size}x${size}.png (${meta.width}x${meta.height}, ${meta.channels}ch)`);
  }

  // 128x128@2x = 256px
  const retinaBuffer = await createTransparentIcon(256);
  await fs.writeFile(path.join(iconsDir, '128x128@2x.png'), retinaBuffer);
  const retinaMeta = await sharp(retinaBuffer).metadata();
  console.log(`  Created 128x128@2x.png (${retinaMeta.width}x${retinaMeta.height})`);

  // Generate icon.ico
  console.log('Generating icon.ico...');
  const icoBuffers = await Promise.all(WINDOWS_SIZES.map(size => createTransparentIcon(size)));
  const icoBuffer = await pngToIco(icoBuffers);
  await fs.writeFile(path.join(iconsDir, 'icon.ico'), icoBuffer);
  console.log(`  Created icon.ico`);

  console.log('\nWindows/Linux icons generated successfully!\n');

  // ── macOS Icons ──
  console.log('Generating macOS icons (white rounded rectangle)...');

  // Generate mac-icon-source.png (1024x1024)
  const macSource = await createMacIcon(MACOS_SIZE);
  await fs.writeFile(path.join(iconsDir, 'mac-icon-source.png'), macSource);
  const macMeta = await sharp(macSource).metadata();
  console.log(`  Created mac-icon-source.png (${macMeta.width}x${macMeta.height})`);

  // Generate icon.icns
  console.log('Creating icon.icns...');
  await createIcnsForMacOS();

  console.log('\nmacOS icons generated successfully!\n');

  console.log('All icons generated!');
  console.log(`\nIcons directory: ${iconsDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
