// SPDX-License-Identifier: MIT
// The built-in emergency circuit of "Qui appeler": the public national
// emergency numbers of Senegal, shown as call links on every who to call
// screen (locked or not, in both modes, with or without saved contacts), with
// the line "Allez au poste de santé ou au centre de santé le plus proche.". A
// danger sign thus always leads to a number to call and a place to go, even on
// a phone with no contact and no deployment file.
//
// A deployment replaces the numbers through its file
// public/config/referral.json ("emergencyNumbers"); the line always stays, and
// the file's "nationalCircuit" is shown under it (see README.md, "Referral
// contacts of a deployment").
//
// Only public emergency service numbers belong here, never a personal number.
//
// TEAM CHECK: the team must confirm these numbers with the health authorities
// of the pilot district before a pilot (that they answer there, from every
// operator, free of charge).
//
// The words are in the translation files: call.services.<service> names the
// service in a sentence, call.emergencyCircuit is the line.

/** A public emergency service with a built-in number. */
export type EmergencyService = 'samu' | 'firefighters';

export interface BuiltInEmergencyNumber {
  service: EmergencyService;
  /** The number the phone dials, digits only. */
  phone: string;
}

/** In the order they are shown: the first is the screen's primary action when no contact is listed. */
export const EMERGENCY_NUMBERS: readonly BuiltInEmergencyNumber[] = [
  // SAMU national: medical emergencies.
  { service: 'samu', phone: '1515' },
  // The national fire brigade (sapeurs-pompiers): fire and rescue, ambulances too.
  { service: 'firefighters', phone: '18' },
];
