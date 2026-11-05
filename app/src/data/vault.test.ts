// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { codeKeysOf, openVaultOf } from '../test/verifier.js';
import { NoCodeError } from './code-guard.js';
import {
  closeVault,
  historyScope,
  isVaultOpen,
  LockedError,
  openRecord,
  openVault,
  profileScope,
  sealRecord,
} from './vault.js';

describe('the vault of a page', () => {
  it('is closed until the code opens it: nothing is sealed or opened', async () => {
    expect(isVaultOpen()).toBe(false);

    await expect(sealRecord({ pseudonym: 'Awa' }, profileScope('a'))).rejects.toBeInstanceOf(
      LockedError,
    );
    // A write refused for want of the code, as when the code is not on the phone.
    await expect(sealRecord({}, profileScope('a'))).rejects.toBeInstanceOf(NoCodeError);
  });

  it('seals and opens with the key of the code, and forgets it when closed', async () => {
    await openVaultOf('2468');
    const sealed = await sealRecord({ pseudonym: 'Awa' }, profileScope('a'));
    expect(await openRecord(sealed, profileScope('a'))).toEqual({ pseudonym: 'Awa' });

    closeVault();

    expect(isVaultOpen()).toBe(false);
    await expect(openRecord(sealed, profileScope('a'))).rejects.toBeInstanceOf(LockedError);
    // The same code opens it again.
    openVault((await codeKeysOf('2468')).wrappingKey);
    expect(await openRecord(sealed, profileScope('a'))).toEqual({ pseudonym: 'Awa' });
  });

  it('names each record by its store and ids', () => {
    expect(profileScope('a')).toBe('profile:a');
    expect(historyScope('a', 'h1')).toBe('history:a:h1');
  });
});
