// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { appName } from './src/app-name.js';
// The engine's wording check, by path: the config loader keeps the workspace
// package @siapso/engine external, and Node cannot load its TypeScript index;
// this one file imports types only, so it is bundled with the config.
import { findForbiddenWording } from '../engine/src/wording.js';
import { EMERGENCY_NUMBERS } from './src/config/emergency.js';
import { PACK_PUBLIC_KEYS, type PackPublicKey } from './src/config/pack-keys.js';
import {
  ALLOW_UNSIGNED_VARIABLE,
  allowsUnsignedPack,
  signingBuildError,
  unsignedPackAllowed,
} from './src/config/pack-signing.js';
import { checkOrigin, isVersion } from './src/data/pack-verify.js';
import { readReferralFile } from './src/domain/referral-file.js';

const root = fileURLToPath(new URL('.', import.meta.url));

/** The knowledge pack the build ships (`pnpm knowledge:build` writes it). */
const PACK_DIR = path.join(root, 'public', 'pack');
const SHOWN_PACK_DIR = 'app/public/pack';

/** A demo build goes to its own folder: app/dist only ever holds a release. */
export const DEMO_OUT_DIR = 'dist-demo';

/** What the build ships, from the manifest of the pack built in app/public/pack. */
export interface BundledPack {
  /** The floor: the app never accepts a lower version (`__MIN_PACK_VERSION__`). */
  version: string;
  /** No rollback below it, and a pack rolled back to below it is replaced (`__MIN_SAFE_PACK_VERSION__`). */
  minimumSafeVersion: string | null;
  /** The key that signed it, or null for an unsigned pack. */
  keyId: string | null;
}

/** The pack built in `dir`, or null when none was built. */
export function bundledPack(dir: string = PACK_DIR): BundledPack | null {
  let text: string;
  try {
    text = readFileSync(path.join(dir, 'manifest.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const { version, minimumSafeVersion, keyId } = manifest;
  if (!isVersion(version)) {
    throw new Error(
      `${SHOWN_PACK_DIR}/manifest.json: version ${String(version)} is not a semantic version`,
    );
  }
  if (minimumSafeVersion !== undefined && !isVersion(minimumSafeVersion)) {
    throw new Error(
      `${SHOWN_PACK_DIR}/manifest.json: minimumSafeVersion ${typeof minimumSafeVersion === 'string' ? minimumSafeVersion : JSON.stringify(minimumSafeVersion)} is not a semantic version`,
    );
  }
  return {
    version,
    minimumSafeVersion: minimumSafeVersion ?? null,
    keyId: typeof keyId === 'string' ? keyId : null,
  };
}

/**
 * build-info.json, written next to the app: the Vite mode, whether the build
 * accepts unsigned packs, and which pack it ships. Nothing secret. The
 * release steps check it (docs/pack-signing.md).
 */
export function buildInfo(
  mode: string,
  acceptsUnsigned: boolean,
  pack: BundledPack | null,
): string {
  const info = {
    mode,
    acceptsUnsignedPack: acceptsUnsigned,
    packVersion: pack?.version ?? null,
    packMinimumSafeVersion: pack?.minimumSafeVersion ?? null,
    packKeyId: pack?.keyId ?? null,
  };
  return `${JSON.stringify(info, null, 2)}\n`;
}

/**
 * Why a build that accepts unsigned packs must not go to `outDir`, or null.
 * On Windows folder names ignore case, so DIST is app/dist too.
 */
export function demoOutDirProblem(
  acceptsUnsigned: boolean,
  appRoot: string,
  outDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!acceptsUnsigned) return null;
  const same = (a: string, b: string) =>
    platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!same(path.resolve(appRoot, outDir), path.resolve(appRoot, 'dist'))) return null;
  return `A demo build never goes to app/dist, where a release goes: it goes to app/${DEMO_OUT_DIR}.`;
}

/** Writes build-info.json, and keeps a demo build out of app/dist. */
function buildInfoPlugin(info: string, acceptsUnsigned: boolean): Plugin {
  return {
    name: 'siapso-build-info',
    apply: 'build',
    configResolved(config) {
      const problem = demoOutDirProblem(acceptsUnsigned, config.root, config.build.outDir);
      if (problem !== null) throw new Error(problem);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: info });
    },
  };
}

/**
 * Checks, with the same code as the app (checkOrigin), that the pack a
 * release build ships is signed by a key of src/config/pack-keys.ts.
 */
async function checkReleasePack(dir: string, keys: readonly PackPublicKey[]): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path.join(dir, 'manifest.json')));
  } catch {
    throw new Error(
      `Release build refused: ${SHOWN_PACK_DIR}/manifest.json is missing: run pnpm knowledge:build, then pnpm knowledge:sign --key <file>.`,
    );
  }
  const keyId = (JSON.parse(new TextDecoder().decode(bytes)) as { keyId?: unknown }).keyId;
  if (keyId === undefined) {
    throw new Error(
      `Release build refused: the pack in ${SHOWN_PACK_DIR} is not signed. Make a release with pnpm release:build --key <file> (docs/pack-signing.md), or a demo build with pnpm build at the repository root.`,
    );
  }
  if (typeof keyId === 'string' && !keys.some((key) => key.keyId === keyId)) {
    throw new Error(
      `Release build refused: the pack in ${SHOWN_PACK_DIR} is signed with key "${keyId}", which app/src/config/pack-keys.ts does not list.`,
    );
  }
  try {
    await checkOrigin(bytes, keyId, { keys, allowUnsigned: false }, () =>
      readFile(path.join(dir, 'manifest.sig'), 'utf8'),
    );
  } catch (error) {
    throw new Error(
      `Release build refused: the signature of the pack in ${SHOWN_PACK_DIR} does not hold (${error instanceof Error ? error.message : String(error)}). Sign it again with pnpm knowledge:sign --key <file>.`,
      { cause: error },
    );
  }
}

const DEMO_WARNING = [
  '',
  '========================================================================',
  ' DEMO BUILD: this app accepts an unsigned knowledge pack.',
  ' It is a test or demo build: never publish it as a release.',
  ' Status and About say "Version de test" ("Test version").',
  '========================================================================',
  '',
].join('\n');

export interface PackSigningCheck {
  command: 'build' | 'serve';
  /** The Vite mode: 'production' for `pnpm release:build`, 'demo' for `pnpm build` (the demo build). */
  mode: string;
  isPreview: boolean;
  /** VITE_ALLOW_UNSIGNED_PACK as the build reads it. */
  flag: string | undefined;
  keys?: readonly PackPublicKey[];
  packDir?: string;
  warn?: (message: string) => void;
}

/**
 * The signing rules of a build (docs/pack-signing.md, tested in
 * src/config/pack-signing.test.ts). A production build never takes
 * VITE_ALLOW_UNSIGNED_PACK. A build that accepts unsigned packs (a demo build:
 * another mode with the flag) says so loudly. Every other build, whatever
 * its mode, needs a public key and ships only a pack signed by a listed key.
 * The development server only warns, and the preview of a build says nothing.
 */
export async function checkPackSigning({
  command,
  mode,
  isPreview,
  flag,
  keys = PACK_PUBLIC_KEYS,
  packDir = PACK_DIR,
  warn = console.warn,
}: PackSigningCheck): Promise<void> {
  if (isPreview) return;
  if (command === 'serve') {
    const problem = signingBuildError(keys, flag);
    if (problem !== null) {
      warn(
        `warning: ${problem} On the development server, start it with ${ALLOW_UNSIGNED_VARIABLE}=true to use the local unsigned pack.`,
      );
    }
    return;
  }
  if (mode === 'production' && allowsUnsignedPack(flag)) {
    throw new Error(
      `${ALLOW_UNSIGNED_VARIABLE}=true is not allowed in a production build: a release only takes a signed pack. Make a test or demo build with pnpm build at the repository root.`,
    );
  }
  if (unsignedPackAllowed(mode, flag)) {
    // Only a malformed key list stops a demo build.
    const problem = signingBuildError(keys, flag);
    if (problem !== null) throw new Error(problem);
    warn(DEMO_WARNING);
    return;
  }
  const problem = signingBuildError(keys, undefined);
  if (problem !== null) throw new Error(problem);
  await checkReleasePack(packDir, keys);
}

/** A colour from src/styles/tokens.css, so the manifest never drifts from the design. */
function tokenColour(name: string): string {
  const css = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');
  const value = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css)?.[1];
  if (value === undefined) throw new Error(`tokens.css has no colour ${name}`);
  return value;
}

/** Fills %APP_NAME% and %THEME_COLOR% in index.html. */
function htmlValues(values: Record<string, string>): Plugin {
  return {
    name: 'siapso-html-values',
    transformIndexHtml: (html) =>
      html.replace(/%(APP_NAME|THEME_COLOR)%/g, (_, key: string) => values[key] ?? ''),
  };
}

/** Service worker precache (tested in src/pwa/workbox.test.ts). */
export const workbox = {
  // The app shell, its fonts and icons, and the knowledge pack: the
  // manifest, its signature (manifest.sig, when the pack is signed) and its
  // fragments. pack.json repeats every fragment in one file and the app
  // never reads it, so it is not downloaded twice.
  // config/: the deployment's referral file when the build has one (who to
  // call works offline), and its small example.
  globPatterns: [
    '**/*.{html,js,css,woff2,svg,png,webmanifest}',
    'pack/*.{json,sig}',
    'config/*.json',
  ],
  // The voice pack (voice/) is an optional download of several hundred
  // megabytes, installed on request into the Cache API by @siapso/speech:
  // never precached.
  globIgnores: ['pack/pack.json', 'voice/**'],
  // Pack fragments grow with the content; a file over the limit would
  // silently be left out of the precache.
  maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
  navigateFallback: 'index.html',
  // A voice pack file, or a deployment file such as config/referral.json, is
  // never answered with the app page: a missing file stays missing.
  navigateFallbackDenylist: [/\/voice\//, /\/config\//],
  cleanupOutdatedCaches: true,
  // The first install takes control of the page that registered it, so the
  // page can say at once that the phone is ready without the Internet
  // (src/pwa/service-worker.ts). An update still waits for the user: no
  // skipWaiting, the update prompt sends it.
  clientsClaim: true,
};

/** Lines framed loudly, so a build log cannot hide them. */
function loud(lines: string[]): string {
  const rule = '!'.repeat(76);
  return ['', rule, ...lines, rule, ''].join('\n');
}

/**
 * The warning a build prints about the deployment's referral file
 * (`<publicDir>/config/referral.json`), read as the phones read it
 * (src/domain/referral-file.ts); null when it is there and every entry filled
 * in is kept. Missing: the phones show who to call with the built-in national
 * emergency numbers only (src/config/emergency.ts), no contact of the
 * district's circuit. Not valid JSON: the phones read it as no file. An entry
 * left out: each is named, with why.
 */
export function referralFileWarning(publicDir: string): string | null {
  const file = path.join(publicDir, 'config', 'referral.json');
  if (!existsSync(file)) {
    return loud([
      'WARNING: no deployment referral file: public/config/referral.json is missing.',
      'Who to call will list no contact of the referral circuit, only the built-in',
      `national emergency numbers (${EMERGENCY_NUMBERS.map(({ service, phone }) => `${service} ${phone}`).join(', ')}) and the line`,
      '"go to the nearest health post or health centre". Before a pilot build, copy',
      'public/config/referral.example.json to public/config/referral.json and fill',
      'it in (README.md, "Referral contacts of a deployment").',
    ]);
  }
  let data: unknown;
  try {
    // A byte order mark left by an editor is dropped, as the phones' fetch
    // text() drops it (UTF-8 decode): only what they cannot read is reported.
    const text = readFileSync(file, 'utf8');
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (failure) {
    return loud([
      'WARNING: public/config/referral.json is not valid JSON: the phones will read it',
      'as no file and list no contact of the referral circuit.',
      failure instanceof Error ? failure.message : String(failure),
    ]);
  }
  const { leftOut } = readReferralFile(data, findForbiddenWording);
  if (leftOut.length === 0) return null;
  return loud([
    'WARNING: public/config/referral.json has entries the phones will leave out:',
    ...leftOut.map((entry) => `  - ${entry}`),
  ]);
}

/** Prints referralFileWarning loudly at the start of a production build. */
function referralFileCheck(): Plugin {
  return {
    name: 'siapso-referral-file-check',
    apply: 'build',
    configResolved(config) {
      const warning = referralFileWarning(config.publicDir);
      if (warning !== null) config.logger.warn(warning);
    },
  };
}

export default defineConfig(async ({ command, mode, isPreview }) => {
  const env = loadEnv(mode, root, 'VITE_');
  const flag = env[ALLOW_UNSIGNED_VARIABLE];
  const acceptsUnsigned = unsignedPackAllowed(mode, flag);
  await checkPackSigning({ command, mode, isPreview: isPreview === true, flag });
  // The version floor and the minimum safe version: from the pack built with the app.
  const pack = isPreview === true ? null : bundledPack();
  if (command === 'build' && pack === null) {
    throw new Error(
      `${SHOWN_PACK_DIR}/manifest.json is missing: run pnpm knowledge:build before building the app (its version is the lowest pack version the app accepts).`,
    );
  }
  const name = appName(env['VITE_APP_NAME']);
  const themeColour = tokenColour('--color-primary');
  return {
    define: {
      __MIN_PACK_VERSION__: JSON.stringify(pack?.version ?? null),
      __MIN_SAFE_PACK_VERSION__: JSON.stringify(pack?.minimumSafeVersion ?? null),
    },
    // A demo build never lands where a release goes (the preview of a demo
    // build, `vite preview --mode demo`, serves this folder too).
    build: { outDir: acceptsUnsigned ? DEMO_OUT_DIR : 'dist' },
    plugins: [
      react(),
      htmlValues({ APP_NAME: name, THEME_COLOR: themeColour }),
      buildInfoPlugin(buildInfo(mode, acceptsUnsigned, pack), acceptsUnsigned),
      referralFileCheck(),
      VitePWA({
        // A waiting version takes over only when the user accepts the update prompt.
        registerType: 'prompt',
        // main.tsx registers the worker with workbox-window, before the first
        // render (src/pwa/service-worker.ts).
        injectRegister: false,
        // start_url and scope are left to vite-plugin-pwa, which sets both to
        // Vite's resolved base (import.meta.env.BASE_URL, `--base` included);
        // with no id, the manifest id is start_url, so all three follow it.
        manifest: {
          name,
          short_name: name,
          lang: 'fr',
          display: 'standalone',
          theme_color: themeColour,
          background_color: tokenColour('--color-bg'),
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox,
      }),
    ],
  };
});
