// SPDX-License-Identifier: MIT
// Which knowledge packs a build accepts (docs/pack-signing.md). Used by the
// pack loader in the browser and by vite.config.ts in Node at build time, so
// nothing here reads import.meta.env or needs the DOM.
import type { PackPublicKey } from './pack-keys.js';

/** The build variable that makes a test or demo build accept an unsigned pack. */
export const ALLOW_UNSIGNED_VARIABLE = 'VITE_ALLOW_UNSIGNED_PACK';

/** Same rule as `siapso-pack keygen`: letters, digits, dot, dash, underscore, at most 64. */
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** True only for the exact value "true": anything else keeps signatures required. */
export function allowsUnsignedPack(value: string | undefined): boolean {
  return value === 'true';
}

/**
 * Whether a build of this Vite mode with this flag accepts an unsigned pack:
 * never in production mode (`pnpm release:build`), only in another mode such
 * as `--mode demo` (`pnpm build` at the repository root) with
 * VITE_ALLOW_UNSIGNED_PACK=true.
 */
export function unsignedPackAllowed(mode: string, flag: string | undefined): boolean {
  return mode !== 'production' && allowsUnsignedPack(flag);
}

/** The bytes of a base64 text (surrounding white space ignored), or null when it is not base64. */
export function base64Bytes(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text.trim());
  } catch {
    return null;
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** What is wrong with a list of public keys; empty when every entry is usable. */
export function packKeyProblems(keys: readonly PackPublicKey[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { keyId, publicKey } of keys) {
    if (seen.has(keyId)) {
      problems.push(`key "${keyId}" is listed more than once`);
      continue;
    }
    seen.add(keyId);
    if (!KEY_ID.test(keyId)) {
      problems.push(
        `key "${keyId}": the key id must be 1 to 64 letters, digits, dots, dashes or underscores`,
      );
    } else if (base64Bytes(publicKey)?.length !== 32) {
      problems.push(`key "${keyId}": the public key must be 32 bytes in base64`);
    }
  }
  return problems;
}

/**
 * Why a build with these keys and this VITE_ALLOW_UNSIGNED_PACK value must
 * not be made, or null. A build with no key that does not accept unsigned
 * packs would refuse every pack, so it is never shipped.
 */
export function signingBuildError(
  keys: readonly PackPublicKey[],
  flag: string | undefined,
): string | null {
  const problems = packKeyProblems(keys);
  if (problems.length > 0) return `app/src/config/pack-keys.ts: ${problems.join('; ')}`;
  if (keys.length > 0 || allowsUnsignedPack(flag)) return null;
  return [
    'This build would refuse every knowledge pack: app/src/config/pack-keys.ts lists no public key.',
    'Add the team public key (docs/pack-signing.md), or make a test or demo build with',
    'pnpm build at the repository root, which accepts an unsigned pack and is never published as a release.',
  ].join(' ');
}
