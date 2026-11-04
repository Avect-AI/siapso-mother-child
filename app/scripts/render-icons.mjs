// SPDX-License-Identifier: MIT
// Renders the PNG icons of the web app manifest from the SVG drawings in
// public/icons/, with the Chromium that Playwright already installs for the
// end-to-end tests. Run after changing an SVG: pnpm --filter @siapso/app icons
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const dir = new URL('../public/icons/', import.meta.url);
const outputs = [
  { svg: 'icon.svg', png: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', png: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', png: 'icon-maskable-512.png', size: 512 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { svg, png, size } of outputs) {
    const markup = (await readFile(new URL(svg, dir), 'utf8')).replace(
      '<svg ',
      `<svg width="${String(size)}" height="${String(size)}" `,
    );
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0">${markup}</body>`);
    const image = await page.locator('svg').screenshot({ omitBackground: true });
    await writeFile(new URL(png, dir), image);
    console.log(`${png}: ${String(size)} x ${String(size)}, ${String(image.length)} bytes`);
  }
} finally {
  await browser.close();
}
