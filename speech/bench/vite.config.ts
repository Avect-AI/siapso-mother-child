// SPDX-License-Identifier: MIT
// Builds the bench page (speech/bench/index.html) and serves app/public/voice/
// at /voice/, as the app preview does once `pnpm voice:install-local` ran.
import { createReadStream, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, type Connect, type Plugin } from 'vite';

const voiceDir = fileURLToPath(new URL('../../app/public/voice/', import.meta.url));
const types: Record<string, string> = {
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};

function serveVoice(): Plugin {
  const handler = (
    req: Connect.IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ) => {
    const { pathname } = new URL(req.url ?? '/', 'http://bench');
    if (!pathname.startsWith('/voice/')) {
      next();
      return;
    }
    const file = path.resolve(voiceDir, decodeURIComponent(pathname.slice('/voice/'.length)));
    let size: number;
    try {
      const info = statSync(file);
      if (!file.startsWith(voiceDir) || !info.isFile()) throw new Error('not a pack file');
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
    name: 'siapso-serve-voice',
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
  plugins: [serveVoice()],
  // ONNX Runtime Web without its default wasm asset: the worker loads the
  // binaries from the voice pack (runtime/), never from the app bundle.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  preview: {
    port: Number(process.env['BENCH_PORT'] ?? 4180),
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
