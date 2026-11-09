// SPDX-License-Identifier: MIT
// Builds the bench page (ocr/bench/index.html) and serves app/public/ocr/ at
// /ocr/, as the app preview does once `pnpm ocr:install-local` ran. It also
// builds the app's own service worker (app/src/sw.ts) over the bench build,
// as sw.js: offline-worker.spec.ts reads offline from what it precaches.
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defaultClientConditions, defineConfig, type Connect, type Plugin } from 'vite';

const packDir = fileURLToPath(new URL('../../app/public/ocr/', import.meta.url));
const appServiceWorkerSource = fileURLToPath(new URL('../../app/src/sw.ts', import.meta.url));

function filesUnder(dir: string, relative = ''): string[] {
  return readdirSync(path.join(dir, relative), { withFileTypes: true }).flatMap((entry) => {
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(dir, child) : [child];
  });
}

/**
 * The app's service worker over the bench build: app/src/sw.ts and its
 * setup (app/src/pwa/sw-setup.ts) as they are, with the precache list the
 * app's build would give for these files (its pattern for scripts, pages
 * and styles; vite-plugin-pwa writes the same list into the app's worker).
 * So the precache, the isolation headers and the speech worker rule that
 * the reading worker meets are the app's own.
 */
function appServiceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'siapso-bench-app-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const entries = filesUnder(outDir)
        .filter((file) => /\.(html|js|css)$/.test(file) && file !== 'sw.js')
        .map((url) => ({
          url,
          revision: createHash('sha256')
            .update(readFileSync(path.join(outDir, url)))
            .digest('hex')
            .slice(0, 16),
        }));
      await build({
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: false,
          lib: {
            entry: appServiceWorkerSource,
            formats: ['iife'],
            name: 'siapsoBenchServiceWorker',
            fileName: () => 'sw.js',
          },
          rolldownOptions: {
            output: { banner: `self.__WB_MANIFEST = ${JSON.stringify(entries)};` },
          },
        },
      });
    },
  };
}
const types: Record<string, string> = {
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

function servePack(): Plugin {
  const handler = (
    req: Connect.IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ) => {
    const { pathname } = new URL(req.url ?? '/', 'http://bench');
    if (!pathname.startsWith('/ocr/')) {
      next();
      return;
    }
    const file = path.resolve(packDir, decodeURIComponent(pathname.slice('/ocr/'.length)));
    let size: number;
    try {
      const info = statSync(file);
      if (!file.startsWith(packDir) || !info.isFile()) throw new Error('not a pack file');
      size = info.size;
    } catch {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('content-length', String(size));
    createReadStream(file).pipe(res);
  };
  return {
    name: 'siapso-serve-ocr-pack',
    configureServer: (server) => {
      server.middlewares.use(handler);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  plugins: [servePack(), appServiceWorker()],
  // ONNX Runtime Web without its default wasm asset: the worker loads the
  // binaries from the reading pack (runtime/), never from the app bundle.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  preview: {
    port: Number(process.env['BENCH_PORT'] ?? 4181),
    strictPort: true,
    // BENCH_ISOLATED=1: cross-origin isolation, so ONNX Runtime may use threads.
    headers:
      process.env['BENCH_ISOLATED'] === '1'
        ? {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          }
        : {},
  },
});
