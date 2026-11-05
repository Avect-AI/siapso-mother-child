// SPDX-License-Identifier: MIT
// Builds the bench page (ocr/bench/index.html) and serves app/public/ocr/ at
// /ocr/, as the app preview does once `pnpm ocr:install-local` ran.
import { createReadStream, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, type Connect, type Plugin } from 'vite';

const packDir = fileURLToPath(new URL('../../app/public/ocr/', import.meta.url));
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
  plugins: [servePack()],
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
