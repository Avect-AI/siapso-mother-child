// SPDX-License-Identifier: MIT
// The HTTP server: node:http only, no framework. Routes, status codes and
// privacy rules are in docs/api.md.
import http from 'node:http';
import type net from 'node:net';
import { evaluate as runEngine } from '@siapso/engine';
import type { Evaluation, EvaluationContext, Pack } from '@siapso/engine';
import type { Authenticate } from './auth.js';
import type { Quota } from './quota.js';
import { validateRequest } from './validate.js';

/** Default limit of a request body, in bytes. */
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
/** Defaults of the connection limits, in milliseconds (and a count). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_HEADERS_TIMEOUT_MS = 5_000;
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_CONNECTIONS = 256;
/** How often Node checks the timeouts; its own default (30 s) would make them bite late. */
export const DEFAULT_CHECK_INTERVAL_MS = 1_000;

export interface ServerOptions {
  pack: Pack;
  authenticate: Authenticate;
  quota: Quota;
  /** Receives one JSON line per request: method, path, status, latencyMs. */
  log: (line: string) => void;
  maxBodyBytes?: number;
  /** Time allowed to receive a whole request. */
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  keepAliveTimeoutMs?: number;
  maxConnections?: number;
  /** How often Node checks the timeouts above; tests lower it. */
  checkIntervalMs?: number;
  /** The engine; a parameter so tests can make it fail. */
  evaluate?: (pack: Pack, context: EvaluationContext) => Evaluation;
}

const ROUTES: Record<string, string> = {
  '/v1/health': 'GET',
  '/v1/pack': 'GET',
  '/v1/evaluate': 'POST',
};

const CLOSE = { connection: 'close' };

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
}

function problem(
  res: http.ServerResponse,
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): void {
  send(res, status, { error, message, ...extra }, headers);
}

/**
 * An answer sent before the body is read: the connection is closed after it
 * (Node then drops what is left of the request) and a timer makes sure a
 * client that keeps sending is cut.
 */
function refuse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): void {
  problem(res, status, error, message, extra, { ...headers, ...CLOSE });
  res.once('finish', () => {
    setTimeout(() => {
      req.destroy();
    }, 1000).unref();
  });
}

function keyOf(req: http.IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;
  if (authorization !== undefined) {
    const match = /^bearer (\S+)$/i.exec(authorization);
    return match?.[1];
  }
  const header = req.headers['x-api-key'];
  return typeof header === 'string' ? header : undefined;
}

type Body = { ok: true; text: string } | { ok: false; reason: 'too-large' | 'aborted' };

/** Reads the body; settles when the limit is passed or the client goes away. */
function readBody(req: http.IncomingMessage, limit: number): Promise<Body> {
  return new Promise((resolve) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) {
      resolve({ ok: false, reason: 'too-large' });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        req.off('data', onData);
        resolve({ ok: false, reason: 'too-large' });
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    });
    req.on('error', () => {
      resolve({ ok: false, reason: 'aborted' });
    });
    req.on('aborted', () => {
      resolve({ ok: false, reason: 'aborted' });
    });
    req.on('close', () => {
      resolve({ ok: false, reason: 'aborted' });
    });
  });
}

function packSummary(pack: Pack): unknown {
  return {
    version: pack.version,
    date: pack.date,
    clinicallyValidated: pack.clinicallyValidated,
    counts: {
      substances: pack.substances.length,
      classes: pack.classes.length,
      products: pack.products.length,
      plants: pack.plants.length,
      rules: pack.rules.length,
      dangerSigns: pack.dangerSigns.length,
      sources: pack.sources.length,
    },
  };
}

async function evaluateRoute(
  options: ServerOptions,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const keyId = options.authenticate(keyOf(req));
  if (keyId === undefined) {
    refuse(
      req,
      res,
      401,
      'unauthorized',
      'A valid API key is required.',
      {},
      {
        'www-authenticate': 'Bearer',
      },
    );
    return;
  }
  const quota = options.quota.consume(keyId);
  if (!quota.allowed) {
    refuse(
      req,
      res,
      429,
      'quota_exceeded',
      'The request quota of this key is used up.',
      {},
      {
        'retry-after': String(quota.retryAfterSeconds),
      },
    );
    return;
  }
  if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    refuse(req, res, 415, 'unsupported_media_type', 'The body must be application/json.');
    return;
  }
  const body = await readBody(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
  if (!body.ok) {
    // An aborted request has nobody to answer; the log line is written on close.
    if (body.reason === 'too-large') {
      refuse(req, res, 413, 'payload_too_large', 'The body is too large.');
    }
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    problem(res, 400, 'invalid_json', 'The body is not valid JSON.');
    return;
  }
  const result = validateRequest(json);
  if (!result.ok) {
    problem(res, 400, 'invalid_request', 'The request does not match the schema.', {
      details: result.errors,
    });
    return;
  }
  if (result.value.pack_version !== options.pack.version) {
    problem(res, 409, 'pack_version_mismatch', 'The request was made for another pack version.', {
      packVersion: options.pack.version,
    });
    return;
  }
  try {
    send(res, 200, (options.evaluate ?? runEngine)(options.pack, result.value.context));
  } catch (error) {
    // The engine refuses a value it cannot read with a RangeError; its message
    // may quote values, so it is dropped. Any other failure, a TypeError
    // included, is ours.
    if (error instanceof RangeError) {
      problem(res, 400, 'invalid_request', 'The engine refused the context.');
    } else {
      problem(res, 500, 'internal_error', 'Internal error.');
    }
  }
}

/** The path of a request target, or undefined when it is not an origin-form target. */
function pathOf(target: string | undefined): string | undefined {
  if (target === undefined || !target.startsWith('/')) return undefined;
  const end = target.search(/[?#]/);
  return end === -1 ? target : target.slice(0, end);
}

export function createServer(options: ServerOptions): http.Server {
  const server = http.createServer(
    { connectionsCheckingInterval: options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS },
    (req, res) => {
      const started = process.hrtime.bigint();
      const method = req.method ?? 'GET';
      const path = pathOf(req.url);
      // Only known paths are logged, and never a query string.
      const known = path !== undefined && Object.hasOwn(ROUTES, path);
      let logged = false;
      const record = (status: number | string): void => {
        if (logged) return;
        logged = true;
        options.log(
          JSON.stringify({
            method,
            path: known ? path : '-',
            status,
            latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
          }),
        );
      };
      res.on('finish', () => {
        record(res.statusCode);
      });
      // A request that ends without an answer (the client left, or was cut).
      res.on('close', () => {
        record('-');
      });

      const run = async (): Promise<void> => {
        if (path === undefined) {
          refuse(req, res, 400, 'bad_request', 'The request target is not valid.');
          return;
        }
        const allowed = ROUTES[path];
        if (allowed === undefined) {
          refuse(req, res, 404, 'not_found', 'No such endpoint.');
        } else if (method !== allowed) {
          refuse(
            req,
            res,
            405,
            'method_not_allowed',
            'Method not allowed.',
            {},
            { allow: allowed },
          );
        } else if (path === '/v1/health') {
          send(res, 200, { status: 'ok' });
        } else if (path === '/v1/pack') {
          send(res, 200, packSummary(options.pack));
        } else {
          await evaluateRoute(options, req, res);
        }
      };
      const fail = (): void => {
        if (!res.headersSent) problem(res, 500, 'internal_error', 'Internal error.', {}, CLOSE);
        else res.destroy();
      };
      try {
        run().catch(fail);
      } catch {
        fail();
      }
    },
  );
  server.requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(
    options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS,
    server.requestTimeout,
  );
  server.keepAliveTimeout = options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  server.maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  // A broken or too slow client must never reach an uncaught exception.
  server.on('clientError', (error: NodeJS.ErrnoException, socket: net.Socket) => {
    if (!socket.writable || socket.destroyed) {
      socket.destroy();
      return;
    }
    const slow = error.code === 'ERR_HTTP_REQUEST_TIMEOUT';
    socket.end(
      `HTTP/1.1 ${slow ? '408 Request Timeout' : '400 Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  });
  return server;
}
