<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Privacy on a shared phone

The app is often used on a phone shared by a family. A pregnancy, an HIV status or a contraception can be a secret there, so nothing about a profile may show without the code.

## Threat model

- **Covered:** casual access by someone else in the family who picks up the phone: they see no pseudonym, check, result, history, saved contact or mode without the code, and the quick exit hides everything at once.
- **Not covered:** a forensic attacker (someone who reads the browser's storage with tools). The profiles stay unencrypted in IndexedDB until SCRUM-39 adds encryption at rest; until then the protection is that the interface never shows them without the code.

## What protects the data

- **The code:** 4 to 6 digits, never stored. Only a PBKDF2-SHA-256 verifier is kept (600 000 iterations, random salt, constant-time comparison). An older verifier with fewer iterations is made again at the full count after the next right code.
- **Wrong codes:** the fifth wrong code starts a 30 second wait, each further one doubles it, up to 30 minutes. The count is kept in storage and shared by every tab of the app, and each try is counted before the code is worked out, so a second tab or a closed tab never gives free tries.
- **Locks:** at start, after two minutes without interaction, when the app comes back after more than two minutes hidden, and at once with "Quitter". While locked, the address is the neutral `#/unlock` and the screen that was open is held in memory only.
- **History entries:** a product searched or confirmed never goes in the address. What a profile leaves on a history entry (a result's instruction and signs, a product) is tied to the session's epoch, which changes at every lock and every page load, so neither Back nor a reload brings it back; what the quick exit leaves behind is tied to the visit, which it renews.
- **Forgotten code:** the only way is to erase the profiles, their history and the saved contacts, after typing EFFACER and a last yes. The language and the knowledge pack stay.

## Limits

- **The phone's clock:** offline, the only clock is the phone's. Setting it forward ends a wait early; setting it back never stretches a wait beyond its length.
- **The recent apps screen** of the phone may still show the last screen as a thumbnail.
- **The forgotten-code erase:** anyone who holds the phone can erase the profiles, the history and the saved contacts without the code, by typing EFFACER and a last yes. Nothing is revealed by doing so. This is an agreed trade-off: a woman who forgets her code must not lose the app for good, and the erase gives an attacker nothing to read.
- **The data key of SCRUM-39** must not reuse the verifier's derivation: the verifier is the PBKDF2 output itself and is stored, so a key equal to it or derived from it would be readable from storage. SCRUM-39 derives with another salt, or splits one PBKDF2 output with HKDF into a stored verifier part and a secret key part.
