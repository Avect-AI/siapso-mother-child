// SPDX-License-Identifier: MIT
// API keys. The server keeps only SHA-256 hashes, read from a JSON file whose
// path comes from an environment variable. A presented key is hashed and the
// hash is compared with every stored hash in constant time. Keys are never
// logged.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface KeyEntry {
  /** A label for the quota and for the operator; not a secret. */
  id: string;
  /** SHA-256 of the key, 64 lowercase hex characters. */
  sha256: string;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

function refuse(): never {
  throw new Error(
    'Invalid key file: expected {"keys":[{"id":"<label>","sha256":"<64 hex characters>"}]} with unique ids',
  );
}

/** Parses the key file. Its content is never echoed in the error. */
export function parseKeyFile(text: string): KeyEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return refuse();
  }
  if (typeof data !== 'object' || data === null || Object.keys(data).join() !== 'keys') {
    return refuse();
  }
  const keys = (data as { keys: unknown }).keys;
  if (!Array.isArray(keys)) return refuse();
  const seen = new Set<string>();
  const entries: KeyEntry[] = [];
  for (const raw of keys as unknown[]) {
    if (typeof raw !== 'object' || raw === null || Object.keys(raw).sort().join() !== 'id,sha256') {
      return refuse();
    }
    const { id, sha256 } = raw as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      !KEY_ID.test(id) ||
      seen.has(id) ||
      typeof sha256 !== 'string' ||
      !HEX_SHA256.test(sha256)
    ) {
      return refuse();
    }
    seen.add(id);
    entries.push({ id, sha256 });
  }
  return entries;
}

export async function loadKeys(file: string): Promise<KeyEntry[]> {
  return parseKeyFile(await readFile(file, 'utf8'));
}

/** Returns the id of the entry whose hash matches the presented key. */
export type Authenticate = (presented: string | undefined) => string | undefined;

export function createAuthenticator(entries: readonly KeyEntry[]): Authenticate {
  const stored = entries.map((entry) => ({ id: entry.id, hash: Buffer.from(entry.sha256, 'hex') }));
  return (presented) => {
    if (presented === undefined || presented === '') return undefined;
    const hash = createHash('sha256').update(presented, 'utf8').digest();
    // No early exit: every stored hash is compared, whatever the outcome.
    let found: string | undefined;
    for (const entry of stored) {
      if (timingSafeEqual(hash, entry.hash) && found === undefined) found = entry.id;
    }
    return found;
  };
}
