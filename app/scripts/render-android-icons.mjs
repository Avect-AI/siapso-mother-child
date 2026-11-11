// SPDX-License-Identifier: MIT
// Renders the launcher icons and the launch screens of the Android app
// (android/app/src/main/res/) from the notebook drawing of public/icons/,
// with the Chromium that Playwright already installs for the end-to-end
// tests. Run after changing the drawing: pnpm --filter @siapso/app icons:android
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const icons = new URL('../public/icons/', import.meta.url);
const res = new URL('../android/app/src/main/res/', import.meta.url);
// The ground of the drawing, --color-primary of src/styles/tokens.css.
const GROUND = '#22379a';

const square = await readFile(new URL('icon.svg', icons), 'utf8');
const maskable = await readFile(new URL('icon-maskable.svg', icons), 'utf8');
// The notebook alone: the maskable drawing without its full-bleed ground.
const notebook = maskable.replace(/<rect width="512" height="512" fill="[^"]+"\/>/, '');
if (notebook === maskable) throw new Error('icon-maskable.svg: no full-bleed ground to remove');

const sized = (svg, width, height) =>
  svg.replace('<svg ', `<svg width="${String(width)}" height="${String(height)}" `);

// The notebook scaled around the centre: an adaptive icon shows only the
// central 66 of its 108 units, so the foreground keeps the drawing inside it.
const scaled = (svg, factor) =>
  svg
    .replace(
      /(<svg[^>]*>)/,
      `$1<g transform="translate(256 256) scale(${String(factor)}) translate(-256 -256)">`,
    )
    .replace('</svg>', '</g></svg>');

const densities = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];
const splashes = [
  ['drawable', 480, 320],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (file, width, height, body, transparent) => {
    await page.setViewportSize({ width, height });
    await page.setContent(`<body style="margin:0">${body}</body>`);
    const image = await page.locator('#frame').screenshot({ omitBackground: transparent });
    await writeFile(new URL(file, res), image);
    console.log(`${file}: ${String(width)} x ${String(height)}, ${String(image.length)} bytes`);
  };
  const frame = (width, height, style, inner) =>
    `<div id="frame" style="width:${String(width)}px;height:${String(height)}px;${style}">${inner}</div>`;

  for (const [density, scale] of densities) {
    const launcher = 48 * scale;
    const foreground = 108 * scale;
    await render(
      `mipmap-${density}/ic_launcher.png`,
      launcher,
      launcher,
      frame(launcher, launcher, '', sized(square, launcher, launcher)),
      true,
    );
    await render(
      `mipmap-${density}/ic_launcher_round.png`,
      launcher,
      launcher,
      frame(
        launcher,
        launcher,
        'border-radius:50%;overflow:hidden',
        sized(maskable, launcher, launcher),
      ),
      true,
    );
    await render(
      `mipmap-${density}/ic_launcher_foreground.png`,
      foreground,
      foreground,
      frame(foreground, foreground, '', sized(scaled(notebook, 0.75), foreground, foreground)),
      true,
    );
  }
  for (const [folder, width, height] of splashes) {
    const side = Math.round(Math.min(width, height) * 0.5);
    await render(
      `${folder}/splash.png`,
      width,
      height,
      frame(
        width,
        height,
        `background:${GROUND};display:flex;align-items:center;justify-content:center`,
        sized(notebook, side, side),
      ),
      false,
    );
  }
} finally {
  await browser.close();
}
